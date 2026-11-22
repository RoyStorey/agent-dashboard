# Agent Dashboard

A local command center for running a business with a team of AI agents.

You decide what to sell and provide the money. The agents do the work. This dashboard sits between them and enforces your rules on every request an agent makes:

- **Things you need to do**: a live list of everything the business still needs from you (legal setup, accounts, missing agent inputs, approvals, funding). It updates itself as you configure things.
- **Agent team**: add agents from templates (Orchestrator, Research, Sourcing, Storefront & Listings, Marketing & Ads, Customer Service, Inventory & Fulfillment, Finance) or build custom ones. Each agent lists the inputs it needs from you, the actions it may request, and its own token.
- **Guardrails**: a kill switch, global per-transaction/daily/monthly caps, approval thresholds, and per-agent limits and allowed actions.
- **Funding**: record deposits, give each agent a budget, and track spend, revenue and profit in a ledger.
- **Approvals**: requests your guardrails held for a human decision.
- **Activity**: a log of everything agents and you have done.

It runs entirely on your computer. Nothing is sent anywhere except by the agents you connect.

## Quick start

Requires [Node.js](https://nodejs.org) 20.19 or newer (22 recommended).

```bash
npm install
```

```bash
npm run serve
```

Open http://localhost:4317.

For development with hot reload, run `npm run dev` and open http://localhost:5173.

## Setting up a business

1. **Business profile**: name, product and target customers. Every agent receives this.
2. **Agent team**: add the agents you need and fill in each one's inputs (API keys, accounts, targets). An agent can't be activated until every required input is set.
3. **Guardrails**: set global caps and approval thresholds, and review each agent's limits and allowed actions.
4. **Funding**: record a deposit, then give each agent a budget.
5. **Connect your agents**: copy each agent's token from its **Connect** tab into the agent's environment and activate it.
6. Work through **Things you need to do**. Some steps (forming a company, bank accounts, seller verification, product safety) legally need a person.

## How agents connect

Agents talk to the dashboard over a small HTTP API, authenticated with their own bearer token. Any agent in any language can use it:

1. `GET /api/agent/v1/config` to get the business profile, its inputs, allowed actions, guardrails and budget.
2. `POST /api/agent/v1/actions` before every real-world action. The response is `approved`, `pending_approval` or `denied`, with reasons.
3. `POST /api/agent/v1/actions/:id/complete` with the real amount spent, or `/cancel`. Any unused amount goes back to the agent's budget.
4. `POST /api/agent/v1/log` and `/heartbeat` so you can see what it is doing.

The full reference is in [docs/AGENT_API.md](docs/AGENT_API.md).

### Example Claude agent

[`examples/claude-agent.ts`](examples/claude-agent.ts) is a complete agent built on the Claude API (Anthropic TypeScript SDK, tool runner, `claude-opus-5-5`). The model can only *ask* for actions. The script's code refuses to perform anything the dashboard hasn't approved.

```bash
ANTHROPIC_API_KEY=sk-ant-... AGENT_TOKEN=agt_... npm run agent:example -- "Find three UL-certified suppliers and order samples"
```

`DRY_RUN` is on by default: approved actions are cancelled instead of performed, so no spend is recorded. To make an agent do real work, add a function for each action to the `integrations` map (e.g. call your supplier's or marketplace's API), then run with `DRY_RUN=false`. Schedule runs with cron or Task Scheduler.

## How the guardrails decide

Each request is checked in this order:

1. **Denied** if the kill switch is on, the agent isn't active, a required input is missing, the action isn't allowed for the agent, money is attached to a no-cost action, or the amount would exceed the per-transaction limit (agent or global), the agent's remaining budget, available cash, or the daily (agent or global) or monthly cap.
2. **Held for approval** if the action is marked "always ask me first", or the amount is at or above the agent's or the global approval threshold.
3. Otherwise **approved**. The money is reserved right away.

When you approve a held request, every hard limit is checked again at that moment, so you can't approve your way past a budget or cap. A stricter rule always wins.

All money is stored as whole cents. Daily and monthly caps use calendar days and months in your computer's time zone.

## Data and security

- Everything is stored in `data/db.json` (file mode 600). Back it up, and don't commit it. It's already in `.gitignore`.
- Secrets (agent API keys) are stored in that file in plain text, so protect your computer the same way you protect saved passwords. The dashboard UI never displays a saved secret again. Only the agent that owns a secret receives it, via its config.
- The server listens on `127.0.0.1` only. The owner API rejects requests addressed to other hostnames (DNS rebinding) and cross-site requests, and changes must be sent as JSON.
- Agent tokens can be rotated at any time on the agent's **Connect** tab.

### Agents on another machine

If your agents run elsewhere (a server or the cloud), they need to reach the agent API. Either run the dashboard on that network with `HOST=0.0.0.0`, or expose it through a tunnel. Put HTTPS in front of it, because agent tokens are sent with every request. The owner pages stay restricted to the hosts listed in `ALLOWED_HOSTS`, so keep that list short.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4317` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind to |
| `DATA_DIR` | `./data` | Where `db.json` is stored |
| `ALLOWED_HOSTS` | (none) | Extra comma-separated hostnames allowed to use the owner UI/API |

## Development

```bash
npm test
```

```bash
npm run typecheck
```

- `server/`: Express API, guardrail engine (`guardrails.ts`), finance math (`finance.ts`), JSON-file store
- `client/`: React + Vite dashboard
- `shared/`: types, money helpers and agent templates used by both
- `examples/`: example agent and typed API client

## Important

This is a tool for control and visibility. It doesn't guarantee a profit, and it doesn't replace legal, tax or safety advice. Start with a small budget. Keep approval thresholds low until you trust an agent. Check real product safety certifications yourself.
