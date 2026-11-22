# Agent API reference

Base URL: `http://127.0.0.1:4317/api/agent/v1` (or wherever the dashboard runs).

Every request must include the agent's token:

```
Authorization: Bearer agt_...
Content-Type: application/json
```

Money is always **integer cents** (`2500` = $25.00). Errors return a non-2xx status with `{"error": "message"}`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid input (e.g. a fractional or negative amount) |
| 401 | Missing, invalid or rotated token |
| 403 | Not allowed right now (e.g. revenue reporting while the kill switch is on) |
| 404 | Request not found, or it belongs to another agent |
| 409 | Wrong state (e.g. completing a request that isn't approved) |

---

## `GET /config`

Everything the agent needs to run. Call it at startup and before each run, because the owner can change things at any time.

```json
{
  "agent": { "id": "…", "name": "Sourcing", "role": "sourcing", "description": "…", "status": "active", "responsibilities": ["…"], "connection": { "provider": "Anthropic", "model": "claude-opus-5-5", "runtime": "" } },
  "business": { "name": "…", "product": "…", "description": "…", "targetMarket": "…", "salesChannels": "…" },
  "inputs": { "llm_api_key": "sk-…", "required_certifications": "UL, ETL" },
  "inputFields": [{ "key": "llm_api_key", "label": "LLM API key", "kind": "secret", "required": true }],
  "missingInputs": [],
  "actions": [{ "key": "order_samples", "label": "Order samples", "spends": true, "allowed": true, "alwaysRequiresApproval": false }],
  "guardrails": {
    "killSwitch": false,
    "agent": { "perTransactionLimitCents": 250000, "dailySpendLimitCents": 300000, "approvalThresholdCents": 20000 },
    "global": { "perTransactionLimitCents": null, "dailySpendLimitCents": null, "monthlySpendLimitCents": 150000, "approvalThresholdCents": 10000 }
  },
  "budget": { "agentId": "…", "budgetCents": 100000, "spentCents": 4500, "remainingCents": 95500, "spentTodayCents": 4500 },
  "serverTime": "2026-11-22T04:30:00.000Z"
}
```

`null` limits mean "no limit at this level". Inputs with `kind: "secret"` are credentials for the agent's own tools. Never put them in model prompts or logs.

## `POST /actions`

Ask permission before any real-world action.

```json
{ "action": "order_samples", "amountCents": 4999, "description": "Samples from 3 suppliers" }
```

`amountCents` defaults to `0`. Response (`201`):

```json
{ "request": { "id": "…", "action": "order_samples", "amountCents": 4999, "status": "approved", "reasons": ["Within all guardrails."], "…": "…" } }
```

| `status` | What the agent should do |
| --- | --- |
| `approved` | Go ahead. The money is reserved. Then call `/complete` or `/cancel`. |
| `pending_approval` | Wait. Poll `GET /actions/:id` until the owner decides. |
| `denied` | Don't do it. `reasons` explains which guardrail blocked it. Don't retry the same thing to get around a limit. |

## `GET /actions/:id`

Current state of one of this agent's requests. While waiting for approval, poll every few seconds. After a decision, `status` becomes `approved` or `rejected`.

## `POST /actions/:id/complete`

```json
{ "actualAmountCents": 4500, "note": "Order #123" }
```

Only for `approved` requests. `actualAmountCents` defaults to the approved amount and can't exceed it. Any difference goes back to the budget. Submit a new request if you need to spend more.

## `POST /actions/:id/cancel`

```json
{ "note": "Supplier out of stock" }
```

Works on `approved` or `pending_approval` requests. Reserved money goes back to the budget.

## `POST /heartbeat`

```json
{ "message": "Comparing supplier quotes" }
```

Updates "last seen" and the status line shown on the dashboard. The response includes `killSwitch` and the agent's `status`, so agents can stop promptly.

## `POST /log`

```json
{ "message": "Found 3 certified suppliers", "level": "info" }
```

`level` is `info`, `warning`, `error` or `success`. The message appears in the dashboard's activity log.

## `POST /revenue`

```json
{ "amountCents": 12999, "note": "Amazon settlement 2026-11-20" }
```

Records revenue. The agent must be active, the kill switch must be off, and the agent must be allowed the `report_revenue` action (the Finance template includes it).
