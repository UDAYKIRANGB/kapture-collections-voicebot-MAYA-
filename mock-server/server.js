/**
 * Kapture Finance — Mock Webhook Server
 * Backs the "Maya" Vapi voice agent's tool calls:
 *   verify_customer, log_promise_to_pay, send_payment_link,
 *   escalate_to_agent, mark_disposition
 *
 * Run with: npm install && npm start
 * Expose publicly for Vapi with: ngrok http 3000
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// In-memory "database" — resets on server restart. Good enough for a demo.
// ---------------------------------------------------------------------------
const accounts = {
  [process.env.DEMO_ACCOUNT_ID || 'ACC-88392']: {
    customerName: process.env.DEMO_CUSTOMER_NAME || 'Rahul Sharma',
    overdueAmount: Number(process.env.DEMO_OVERDUE_AMOUNT || 8499),
    dpd: Number(process.env.DEMO_DPD || 12),
    verificationPanLast4: process.env.DEMO_VERIFICATION_PAN_LAST4 || '1234',
    verificationBirthYear: process.env.DEMO_VERIFICATION_BIRTH_YEAR || '1995',
  },
};

const calls = {}; // per-account call/verification state
const promisesToPay = {};
const escalations = {};
const dispositions = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Masks a name for safe logging, e.g. "Rahul Sharma" -> "Rahul S****" */
function maskName(name) {
  if (!name) return name;
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0][0] + '****';
  const last = parts[parts.length - 1];
  return parts.slice(0, -1).join(' ') + ' ' + last[0] + '****';
}

function logEvent(toolName, accountId, extra = {}) {
  const acct = accounts[accountId];
  const maskedName = acct ? maskName(acct.customerName) : 'unknown';
  console.log(
    `[${new Date().toISOString()}] TOOL=${toolName} account=${accountId} customer=${maskedName}`,
    JSON.stringify(extra)
  );
}

function genId(prefix) {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// ---------------------------------------------------------------------------
// Individual tool handlers — each returns a plain JS object result
// ---------------------------------------------------------------------------

function handleVerifyCustomer(args) {
  const { account_id, verification_code } = args;
  const acct = accounts[account_id];

  if (!acct) {
    return { verified: false, message: 'Account not found.' };
  }

  calls[account_id] = calls[account_id] || { attempts: 0 };
  calls[account_id].attempts += 1;

  // Normalize: strip everything except digits, so "1, 2, 3, 4", "12-34",
  // "1234" etc. all reduce to the same comparable string.
  const normalize = (v) => String(v || '').replace(/[^0-9]/g, '');
  const code = normalize(verification_code);
  const isMatch =
    code === normalize(acct.verificationPanLast4) ||
    code === normalize(acct.verificationBirthYear);

  logEvent('verify_customer', account_id, {
    attempt: calls[account_id].attempts,
    verified: isMatch,
    // NOTE: raw verification_code is intentionally NOT logged — only the boolean result is.
  });

  if (isMatch) {
    calls[account_id].verified = true;
    return {
      verified: true,
      message: `Identity verified for ${acct.customerName}.`,
    };
  }

  return {
    verified: false,
    message:
      calls[account_id].attempts >= 2
        ? 'Verification failed twice. Do not disclose account details.'
        : 'Verification code did not match. You may ask the customer to try once more.',
  };
}

function handleLogPromiseToPay(args) {
  const { account_id, ptp_date, amount } = args;
  const acct = accounts[account_id];
  if (!acct) return { success: false, message: 'Account not found.' };

  if (!calls[account_id]?.verified) {
    return {
      success: false,
      message: 'Cannot log a Promise-to-Pay before the customer is verified.',
    };
  }

  const ptpId = genId('PTP');
  promisesToPay[account_id] = {
    ptp_id: ptpId,
    ptp_date,
    amount,
    logged_at: new Date().toISOString(),
  };

  logEvent('log_promise_to_pay', account_id, { ptpId, ptp_date, amount });

  return {
    success: true,
    ptp_id: ptpId,
    confirmed_date: ptp_date,
    amount,
    message: `Promise-to-Pay of ₹${amount} logged for ${ptp_date}.`,
  };
}

function handleSendPaymentLink(args) {
  const { account_id, channel } = args;
  const acct = accounts[account_id];
  if (!acct) return { success: false, message: 'Account not found.' };

  if (!calls[account_id]?.verified) {
    return {
      success: false,
      message: 'Cannot send a payment link before the customer is verified.',
    };
  }

  const mockLink = `https://pay.kapturefinance.example/${account_id}/${genId(
    'LNK'
  )}`;

  logEvent('send_payment_link', account_id, { channel, mockLink });

  return {
    success: true,
    message: `Mock payment link sent via ${channel}: ${mockLink}`,
  };
}

function handleEscalateToAgent(args) {
  const { account_id, reason } = args;
  const acct = accounts[account_id];
  if (!acct) return { success: false, message: 'Account not found.' };

  const escalationId = genId('ESC');
  escalations[account_id] = {
    escalation_id: escalationId,
    reason,
    created_at: new Date().toISOString(),
  };

  logEvent('escalate_to_agent', account_id, { escalationId, reason });

  return {
    success: true,
    escalation_id: escalationId,
    message: `Case escalated to a human agent for reason: ${reason}.`,
  };
}

function handleMarkDisposition(args) {
  const { account_id, status, notes } = args;

  const timestamp = new Date().toISOString();
  dispositions[account_id] = { status, notes: notes || null, timestamp };

  logEvent('mark_disposition', account_id, { status, notes: notes || null });

  return {
    success: true,
    disposition_logged: status,
    timestamp,
  };
}

// Map of tool name -> handler function
const TOOL_HANDLERS = {
  verify_customer: handleVerifyCustomer,
  log_promise_to_pay: handleLogPromiseToPay,
  send_payment_link: handleSendPaymentLink,
  escalate_to_agent: handleEscalateToAgent,
  mark_disposition: handleMarkDisposition,
};

// ---------------------------------------------------------------------------
// Webhook endpoint — matches Vapi's tool-call server message format:
// { message: { toolCalls: [ { id, function: { name, arguments } } ] } }
// Responds with: { results: [ { toolCallId, result } ] }
// ---------------------------------------------------------------------------
app.post('/webhook', (req, res) => {
  try {
    const toolCalls =
      req.body?.message?.toolCalls ||
      req.body?.toolCalls || // fallback for simplified/manual testing
      [];

    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return res.status(400).json({ error: 'No toolCalls found in request body.' });
    }

    const results = toolCalls.map((call) => {
      const name = call.function?.name || call.name;
      let args = call.function?.arguments || call.arguments || {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }

      const handler = TOOL_HANDLERS[name];
      const result = handler
        ? handler(args)
        : { success: false, message: `Unknown tool: ${name}` };

      return {
        toolCallId: call.id || call.toolCallId,
        result: JSON.stringify(result),
      };
    });

    return res.json({ results });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// Individual routes for Vapi "apiRequest" tools.
// Each apiRequest tool posts a FLAT body (matching its schema) directly
// to its own URL -- no toolCalls wrapper, no tool name in the body.
// So we give each tool its own route and pass req.body straight to the handler.
// ---------------------------------------------------------------------------

app.post('/webhook/verify_customer', (req, res) => {
  try {
    const result = handleVerifyCustomer(req.body || {});
    return res.json(result);
  } catch (err) {
    console.error('verify_customer error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/webhook/log_promise_to_pay', (req, res) => {
  try {
    const result = handleLogPromiseToPay(req.body || {});
    return res.json(result);
  } catch (err) {
    console.error('log_promise_to_pay error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/webhook/send_payment_link', (req, res) => {
  try {
    const result = handleSendPaymentLink(req.body || {});
    return res.json(result);
  } catch (err) {
    console.error('send_payment_link error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/webhook/escalate_to_agent', (req, res) => {
  try {
    const result = handleEscalateToAgent(req.body || {});
    return res.json(result);
  } catch (err) {
    console.error('escalate_to_agent error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/webhook/mark_disposition', (req, res) => {
  try {
    const result = handleMarkDisposition(req.body || {});
    return res.json(result);
  } catch (err) {
    console.error('mark_disposition error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Simple health check + a debug endpoint to inspect in-memory state during dev/demo
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/debug/state', (_req, res) => {
  res.json({
    calls,
    promisesToPay,
    escalations,
    dispositions,
  });
});

app.listen(PORT, () => {
  console.log(`Kapture mock webhook server listening on port ${PORT}`);
  console.log(`Health check:  http://localhost:${PORT}/health`);
  console.log(`Webhook:       http://localhost:${PORT}/webhook`);
  console.log(`Debug state:   http://localhost:${PORT}/debug/state`);
});
