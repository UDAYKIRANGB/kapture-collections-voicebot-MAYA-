# Kapture Finance — "Maya" Voice AI Collections Agent

An outbound collections voicebot built on [Vapi.ai](https://vapi.ai), designed for Kapture Finance to call
overdue-EMI customers, verify their identity, disclose the outstanding amount, and drive the call to a clean
disposition (Promise-to-Pay, already paid, hardship, dispute, do-not-call, etc.) — all under strict
authentication and compliance guardrails.

**Demo scenario:** Rahul Sharma, Account `ACC-88392`, ₹8,499 overdue by 12 days.

---

## Repository Structure

```
kapture-collections-voicebot/
├── README.md                     ← you are here
├── docs/
│   ├── HLD_Document.md           ← full High-Level Design document
│   └── System_Architecture.png   ← pipeline + state machine diagram
├── vapi/
│   ├── system_prompt.txt         ← production system prompt for the Vapi assistant
│   └── tool_definitions.json     ← JSON schemas for the 5 function-calling tools
├── mock-server/
│   ├── server.js                 ← Express webhook backing the Vapi tool calls
│   ├── package.json
│   └── .env.example              ← demo account config (copy to .env)
└── tests/
    └── test_cases.json           ← QA test matrix (12 scenarios, happy path + edge cases)
```

---

## How It Works

1. A call connects through Vapi's telephony layer → Deepgram (STT) → GPT-4o (orchestrator) → ElevenLabs/Cartesia (TTS).
2. GPT-4o follows the instructions in `vapi/system_prompt.txt`, which enforce a strict state machine:
   `INIT → AUTH_PENDING → AUTHENTICATED → NEGOTIATION → PTP_COLLECTED/ESCALATED → CALL_ENDED`.
3. When the model needs to verify identity, log a promise-to-pay, send a payment link, escalate, or log a final
   disposition, it invokes one of the 5 tools defined in `vapi/tool_definitions.json`.
4. Vapi calls out to the mock webhook server (`mock-server/server.js`) to execute each tool and get a real result.
5. **No debt information is ever spoken until `verify_customer` returns `verified: true`.**

Full architecture, latency budget, compliance rules, and observability metrics are documented in
[`docs/HLD_Document.md`](docs/HLD_Document.md).

---

## Setup

### 1. Run the mock webhook server

```bash
cd mock-server
npm install
cp .env.example .env
npm start
```

The server starts on `http://localhost:3000` with:
- `POST /webhook` — the tool-call endpoint Vapi will call
- `GET /health` — health check
- `GET /debug/state` — inspect in-memory verification/PTP/escalation/disposition state during testing

### 2. Expose it publicly with ngrok

```bash
ngrok http 3000
```

Copy the `https://<subdomain>.ngrok-free.app` URL.

### 3. Configure the Vapi Assistant

In the Vapi dashboard (or via API):
- **System Prompt:** paste the contents of `vapi/system_prompt.txt`.
- **Tools:** import `vapi/tool_definitions.json`, replacing every `<your-ngrok-subdomain>` placeholder with
  your actual ngrok URL from step 2.
- **STT:** Deepgram (Nova-2 recommended).
- **TTS:** ElevenLabs or Cartesia.
- **Model:** GPT-4o, temperature `0.1` (kept low for consistent compliance behavior).

### 4. Place a test call

Use Vapi's web test-call feature or a connected phone number, and step through the scenarios in
[`tests/test_cases.json`](tests/test_cases.json) — starting with **TC-002 (happy path PTP)** and
**TC-001 (zero-debt-disclosure)**.

---

## Verifying a Call

While testing, hit `GET http://localhost:3000/debug/state` to confirm the correct tools fired with the correct
arguments and that the final disposition matches what the test case expects.

---

## Compliance Highlights

- Debt terms are withheld until identity is verified (max 2 attempts).
- No settlement/waiver greater than 10% without human escalation.
- Do-Not-Call requests are honored immediately.
- Customer names are masked in server logs; raw verification codes are never persisted.

See §5–§6 of the [HLD document](docs/HLD_Document.md) for full detail.
