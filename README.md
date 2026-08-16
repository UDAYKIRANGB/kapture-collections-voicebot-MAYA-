$readme = @'
# Maya — Voice AI Collections Agent (Kapture Finance demo)

A side project I built to explore voice AI agents for real-world workflows: an outbound collections
voicebot on [Vapi.ai](https://vapi.ai) that calls overdue-EMI customers, verifies their identity, discloses
the outstanding amount, and drives the call to a clean disposition (Promise-to-Pay, already paid, hardship,
dispute, do-not-call, etc.) — all under strict authentication and compliance guardrails.

I wanted to see how far I could push a voice agent on tool-calling discipline, state management, and
compliance rules that actually matter in a regulated domain like debt collection — not just a chatty demo,
but something that behaves predictably under edge cases (silence, abusive callers, failed verification,
disputes).

**Demo scenario:** Rahul Sharma, Account `ACC-88392`, ₹8,499 overdue by 12 days.

---

## Repository Structure

```
kapture-collections-voicebot/
├── README.md                     ← you are here
├── docs/
│   ├── HLD_Document.md           ← design notes: architecture, state machine, compliance rules
│   └── System_Architecture.png   ← pipeline + state machine diagram
├── vapi/
│   ├── system_prompt.txt         ← the assistant's system prompt
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

1. A call connects through Vapi's telephony layer → Deepgram (STT) → GPT-4o (orchestrator) → ElevenLabs (TTS).
2. GPT-4o follows the instructions in `vapi/system_prompt.txt`, which enforce a strict state machine:
   `INIT → AUTH_PENDING → AUTHENTICATED → NEGOTIATION → PTP_COLLECTED/ESCALATED → CALL_ENDED`.
3. When the model needs to verify identity, log a promise-to-pay, send a payment link, escalate, or log a final
   disposition, it invokes one of the 5 tools defined in `vapi/tool_definitions.json`.
4. Vapi calls out to the mock webhook server (`mock-server/server.js`) to execute each tool and get a real result.
5. **No debt information is ever spoken until `verify_customer` returns `verified: true`.**

Full architecture, latency notes, compliance rules, and observability details are in
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
- **STT:** Deepgram (Nova-2).
- **TTS:** ElevenLabs.
- **Model:** GPT-4o, temperature `0.1` (kept low for consistent, predictable behavior).

### 4. Place a test call

Use Vapi's web test-call feature or a connected phone number, and step through the scenarios in
[`tests/test_cases.json`](tests/test_cases.json) — I'd start with **TC-002 (happy path PTP)** and
**TC-001 (zero-debt-disclosure)**.

---

## Verifying a Call

While testing, hit `GET http://localhost:3000/debug/state` to confirm the right tools fired with the right
arguments and that the final disposition matches what you'd expect.

---

## Things I Cared About Getting Right

- Debt terms are withheld until identity is verified (max 2 attempts).
- No settlement/waiver greater than 10% without human escalation.
- Do-Not-Call requests are honored immediately.
- Customer names are masked in server logs; raw verification codes are never persisted.
- Spoken output (amounts, dates) is formatted for natural speech, not read digit-by-digit.

See the [design doc](docs/HLD_Document.md) for the full reasoning behind these decisions.

---

## Notes to self / possible next steps

- Swap the mock webhook server for a real loan-servicing API integration.
- Add multi-language support beyond English/Hindi code-switching.
- Add real outbound telephony (currently tested via Vapi's web test-call).

'@
$readme | Out-File -FilePath README.md -Encoding utf8 -NoNewline