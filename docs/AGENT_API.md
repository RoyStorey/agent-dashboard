# Agent API reference

You don't need this to use the dashboard: it runs your agents itself with Claude (see "How the agents work" in the README). This API is for agents you run yourself. Those agents get the same guardrails, approvals and logging.

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
  "business": { "name": "…", "product": "…", "description": "…", "targetMarket": "…", "salesChannels": "…", "ownerName": "…", "ownerEmail": "…", "shippingAddress": "…", "productSource": "research" },
  "economics": { "salePriceCents": 1999, "unitCostCents": 380, "inboundShippingCents": 85, "otherPerUnitCents": 0, "fulfillmentFeeCents": 397, "marketplaceFeeBps": 1500, "paymentFeeBps": 0, "adSpendBps": 1500, "returnRateBps": 500, "fixedMonthlyCents": 0, "monthlyUnits": 240 },
  "inputs": { "llm_api_key": "sk-ant-…", "required_certifications": "UL 817" },
  "inputFields": [{ "key": "llm_api_key", "label": "AI model API key", "kind": "secret", "required": true }],
  "missingInputs": [],
  "reporting": { "discord": true },
  "…": "guardrails also includes { ai: { monthlyLimitCents, monthCostCents, overLimit }, priceFloorCents }",
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

`null` limits mean "no limit at this level". `inputs` are the effective values: a value typed on the agent wins, otherwise the matching key from the owner's Credentials page (the AI key follows the agent's model provider). Inputs with `kind: "secret"` are credentials for the agent's own tools. Never put them in model prompts or logs. In `economics`, percentages are basis points (1500 = 15%).

## `POST /actions`

Ask permission before any real-world action.

```json
{ "action": "order_samples", "amountCents": 4999, "description": "Samples from 3 suppliers" }
```

`amountCents` defaults to `0`. For price-setting actions (`update_price`, `publish_listing`) also send `"priceCents"`. A missing price, or one below the price floor (`guardrails.priceFloorCents` in `/config`), is denied. Requests are also denied once the month's AI usage budget is used up. Response (`201`):

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

## `POST /usage`

Report AI model usage after **each** model call, so the owner sees AI costs and the monthly AI cap can stop runaway loops.

```json
{ "model": "claude-opus-5-5", "inputTokens": 12000, "outputTokens": 1800, "cacheReadTokens": 0, "cacheWriteTokens": 0, "webSearches": 2 }
```

The cost is estimated from a built-in price list for current Claude models. For any other model, include `"costCents"` with the actual cost. The response is `{ "monthCostCents", "limitCents", "overLimit", "costCents" }`. **Stop working when `overLimit` is true.** This endpoint still works while the kill switch is on.

## Shipping orders yourself

When the owner ships orders by hand (`fulfillment.mode` is `"self"` in `/config`), `/config` also lists `fulfillment.supplies` (stock at home), `lowSupplies` and `toPackCount`.

- `POST /shipments` adds an order to the owner's packing queue:
  ```json
  { "orderRef": "#1001", "channel": "Shopify", "recipientName": "Pat Doe", "address": "12 Elm St\nSpringfield, IL 62701",
    "items": [{ "name": "Braided cord", "qty": 2, "supplyId": "<stock item id>" }],
    "packaging": "Poly mailer 10×13 in", "packagingSupplyId": "<stock item id>", "service": "USPS Ground Advantage", "notes": "" }
  ```
  A duplicate `orderRef` returns 409. When the owner marks it shipped, the linked items, the packaging and per-package supplies (labels) are subtracted from stock.
- `GET /shipments?status=to_pack` lists the queue.
- `POST /supplies/:id/adjust` with `{ "delta": 100, "note": "Delivered" }` records stock arriving (or a negative correction).
- To buy supplies, request the `order_supplies` action with the cost, and put a shopping list in the description (store, item, link, quantity). It needs the owner's approval by default.

## `POST /report`

```json
{ "title": "Week 1 P&L", "body": "First 30 units sold. Ads at 6.7% TACoS.", "fields": [{ "name": "Net profit", "value": "$310.25" }] }
```

Posts a report to the activity log and, when Discord is connected, to this agent's channel (or HQ if it has none). Agents never need webhook URLs. `fields` is optional (up to 20).

## `POST /revenue`

Send the breakdown whenever you have it, so the P&L shows gross sales, refunds, fees and units:

```json
{ "grossSalesCents": 59970, "refundsCents": 1999, "feesCents": 8996, "unitsSold": 30, "note": "Amazon settlement 2026-11-20" }
```

The net payout (`amountCents`) is computed as gross − refunds − fees. If you also send `amountCents`, it must equal that. If you only know the payout, send `{ "amountCents": 48975 }` alone.

The agent must be active, the kill switch must be off, and the agent must be allowed the `report_revenue` action (the Finance template includes it). With auto-allocation on, new revenue is split across agent budgets.
