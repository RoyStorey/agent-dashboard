# Agent Dashboard

A local command center for running a business with a team of AI agents.

You provide the money and the decisions only a person can make. The agents do the work. This dashboard sits between them and enforces your rules on every request an agent makes.

- **Setup assistant**: a ten-step guided setup. Most steps are one click or one paste.
- **Business & product**: type in what you sell, or let AI research what sells right now (Claude with web search). It returns ranked ideas with prices, costs, margins, competition, compliance, sources and a product photo when the research found one. Every idea has "See pictures" and "See listings" buttons. One click fills in your profile and numbers. Address boxes suggest matching addresses as you type, from Photon/OpenStreetMap; what you type there is sent to photon.komoot.io.
- **Where to sell**: compare Shopify, Etsy, Amazon, eBay, Walmart Marketplace and TikTok Shop side by side: monthly cost, typical fees, how hard approval is, pros and cons, and links. Pick one or more; the first is your primary. Each one adds an "Open your account" step to the checklist. Agents use your selected channels' credentials, ads platform and fulfillment, and never a key for a channel you don't sell on. One click puts a channel's typical fees into your plan. Note: Etsy only allows handmade, your own designs, vintage, or craft supplies.
- **Pack & ship**: choose how orders get shipped. With **Ship it myself**, the Inventory agent queues every order with what to put in the box, which mailer and which shipping service. It also posts new orders to Discord HQ (never the customer's address), tracks stock at home and asks your approval to buy supplies before you run out, with a ready-to-use shopping list. You pack, print the label in Shopify and click "Dropped off / shipped", and product, mailer and label counts update themselves. A fulfillment company's key isn't needed in this mode. **Connect Shopify** on the same page to import paid, unshipped Shopify orders every 5 minutes, with the address and items copied exactly. It uses the store address, Client ID and Client secret saved on Credentials, gets a short-lived access token with Shopify's client credentials grant, and never adds an order twice.
- **Credentials**: paste each key once (Anthropic, OpenAI, Google, Amazon, Shopify, Keepa, QuickBooks, ShipBob…). Every agent that needs it picks it up automatically. Each service has a direct link, exact steps, and the exact format to paste.
- **Team at work**: once you activate agents, they work on their own. A queue at the top shows who is working now (and on what step), who starts next, when and why, and what's waiting on you. Each agent lists what's on its plate: notes to read, work to continue, approved tasks to finish. A live board shows what each agent is doing right now ("Working: Creating a product draft… for 40s") or, when it isn't, "Idle", when it was last seen, why it's idle and when it checks next. It also has the team's current phase and brief, the shared notebook agents use to hand work to each other, and a work log of every run: why it started, each step, tokens and cost.
- **Agent team**: add the recommended team of 8 in one click (Orchestrator, Research, Sourcing, Storefront, Marketing, Customer Service, Inventory, Finance) or build custom agents. Details are auto-filled from your profile and plan, so you only answer what nobody else can.
- **Things you need to do**: a live list of what the business still needs from you. The legal and account steps (LLC, EIN, bank, insurance, compliance, seller accounts) each have exact steps and direct links.
- **Financials**: P&L by period (gross sales, refunds, net sales, COGS, gross profit and margin, fees, ads, opex, net profit and margin), cash flow, KPIs (TACoS, ROAS, refund rate, average price, runway), and a unit-economics plan. The plan shows contribution margin, break-even price, break-even ad spend, break-even volume, ROI and scenarios.
- **Discord**: an HQ channel for approvals, alerts and a daily finance summary, plus a channel per agent for its updates and reports.
- **Guardrails**: a kill switch, global caps, approval thresholds and per-agent limits. A one-click recommended set is included.
- **Money setup**: shows what is accounting only and what touches real money. It has the ordered steps to connect real money (business bank, Stripe Issuing cards for agents, a read-only Plaid bank connection, real sales reporting), each tagged *Moves real money*, *Reads real accounts* or *Accounting only*. It also shows which dashboard features are built. Stripe cards and the Plaid sync are **not built yet**; steps that depend on them say so.
- **Funding**: deposits are split across agent budgets automatically by job, keeping a cash reserve. Adjust weights or any budget by hand, or rebalance in one click.
- **Approvals** and **Activity**: what's waiting for you (spending, phase changes, and Shopify product and page drafts to publish or reject), and everything that happened.

Light and dark mode: use the ☾ Dark / ☀ Light button in the top bar. Your choice is remembered; until you pick one, it follows your computer's setting.

It runs entirely on your computer. Nothing leaves it except calls your agents make, AI research calls to Anthropic, and Discord posts.

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

Open the dashboard and follow the **Setup assistant**:

1. **Choose what to sell.** Type it in, or click "find me the best product" to have AI research it. AI research needs your Anthropic key and uses your API credits.
2. **Your details.** Your email and shipping address, reused by agents.
3. **Add the recommended team.** One click.
4. **Price and cost per unit.** Filled in automatically if you picked a researched product.
5. **Paste your keys.** Only the ones your team needs, each with a direct link and steps.
6. **Answer what only you know.** Usually nothing or one field. Everything else is auto-filled.
7. **Fund it.** Enter a starting budget; it is split across agents automatically.
8. **Spending caps.** One click applies 75% of cash per month and 35% per day.
9. **Discord** (optional). Paste one webhook per channel.
10. **Go live.** Activate the ready agents. They start working on their own within a minute (see **Team at work**).

Then work through **Things you need to do** for the legal and account steps.

## How the agents work

The dashboard runs the agents itself, with Claude, while it's open (`npm run serve` or `npm run dev`). If your computer sleeps or the dashboard is closed, nothing runs and nothing is spent; agents pick up where they left off when it starts again.

**Phases.** The team works through Research → Sourcing & samples → Build the store → Launch → Run & grow. Each agent starts in its phase (for example, Storefront starts at Build the store) and stays idle, at no cost, until then. The Orchestrator proposes moving on when a phase's goal is met; you approve it on Approvals, or move the team yourself on Team at work.

**Shared context.** The Orchestrator keeps a short team brief every agent reads. Agents leave each other notes in the team notebook ("Sourcing: here are three UL-listed suppliers…"). You can write notes too. A note wakes the agents it's addressed to.

**What agents can do.** Agents can't pay for anything or contact anyone outside the team. They ask for approval through your guardrails, and when you must act (pay a supplier, order samples), they give you exact steps in a note. Research, Sourcing and Marketing can search the web. Storefront creates products and pages in your Shopify store as hidden drafts, which you publish or reject on Approvals; it can't price below your price floor. Finance can read Shopify sales totals (no customer details).

Storefront drafts need two extra Shopify permissions. On your app in the Shopify Dev Dashboard, add `read_online_store_pages,write_online_store_pages` to the scopes (the Copy button on Credentials has the full list), release a new version, and install the update on your store.

### Keeping AI costs low

- **Free checks.** Every minute the dashboard checks, in plain code, whether each agent has anything new: a note for it, a decision you made on its request, a new phase, new orders, low stock, or a periodic review. Only then does it call Claude. An agent with nothing new costs nothing.
- **Small, cached prompts.** Each run starts with a short briefing of only what's new. The part that doesn't change (the agent's job and rules) is cached, so later steps of a run read it at a tenth of the price.
- **Limits per role.** Routine roles (Inventory, Finance, Customer Service) think less; each role has a cap on steps, reply length and web searches. Agents write at most 4 notes and 3 store drafts per run.
- **Your controls.** On Team at work, set how often each agent checks (hourly to weekly, or only when you click Run now). Each agent runs at most 6 times a day on its own (Run now isn't limited). A note wakes an agent within minutes (after a 5-minute pause since its last run, so two agents can't bounce notes back and forth). An agent that runs out of steps mid-task says so and continues 5 minutes later. Teammates wait for the Orchestrator's brief before their first run, so no run is wasted working blind. At most two agents work at once. Your monthly AI budget on Guardrails stops runs as soon as it's reached, and the kill switch or pausing an agent stops a run mid-way.

Every run's tokens and cost are on Team at work, and AI spend is in Financials.

The built-in runner needs the agent's provider set to Anthropic and a Claude model it knows the price of, so it can keep to your budget.

## Connecting your own agents

You can also run an agent yourself (any language, any model) instead of the built-in runner. Agents talk to the dashboard over a small HTTP API, authenticated with their own bearer token. Any agent in any language can use it:

1. `GET /api/agent/v1/config` to get the business profile, its inputs, allowed actions, guardrails and budget.
2. `POST /api/agent/v1/actions` before every real-world action. The response is `approved`, `pending_approval` or `denied`, with reasons.
3. `POST /api/agent/v1/actions/:id/complete` with the real amount spent, or `/cancel`. Any unused amount goes back to the agent's budget.
4. `POST /api/agent/v1/report` for updates (routed to the agent's Discord channel), and `/log` and `/heartbeat` so you can see what it is doing.
5. The Finance agent sends sales with `POST /api/agent/v1/revenue` (gross, refunds, fees, units), which feeds the P&L.

The full reference is in [docs/AGENT_API.md](docs/AGENT_API.md).

### Example Claude agent

[`examples/claude-agent.ts`](examples/claude-agent.ts) is a complete agent built on the Claude API (Anthropic TypeScript SDK, tool runner, `claude-opus-5-5`). The model can only *ask* for actions. The script's code refuses to perform anything the dashboard hasn't approved.

```bash
AGENT_TOKEN=agt_... npm run agent:example -- "Find three UL-certified suppliers and order samples"
```

The agent uses the Anthropic key saved on Credentials (or `ANTHROPIC_API_KEY` if you set one), reports its AI usage after every call, and stops at the monthly AI cap. `DRY_RUN` is on by default: approved actions are cancelled instead of performed, so no spend is recorded. To make an agent do real work, add a function for each action to the `integrations` map (e.g. call your supplier's or marketplace's API), then run with `DRY_RUN=false`. Schedule runs with cron or Task Scheduler.

## How the guardrails decide

Each request is checked in this order:

1. **Denied** if the kill switch is on, the agent isn't active, a required input is missing, the action isn't allowed for the agent, money is attached to a no-cost action, or the amount would exceed the per-transaction limit (agent or global), the agent's remaining budget, available cash, or the daily (agent or global) or monthly cap.
2. **Held for approval** if the action is marked "always ask me first", or the amount is at or above the agent's or the global approval threshold.
3. Otherwise **approved**. The money is reserved right away.

When you approve a held request, every hard limit is checked again at that moment, so you can't approve your way past a budget or cap. A stricter rule always wins.

All money is stored as whole cents. Daily and monthly caps use calendar days and months in your computer's time zone.

## How the numbers work

- Money is stored as whole cents and percentages as basis points (1500 = 15.00%), so totals are exact.
- **Per unit:** net sales = price − refunds (return rate × price). Landed cost = supplier cost + freight + packaging. Gross profit = net sales − landed cost. Contribution = gross profit − marketplace fee − payment fee − fulfillment − ads. Returned units are assumed unsellable and fees are assumed not refunded, which is the conservative case.
- **P&L:** COGS = units sold × planned landed cost. If no units have been reported, COGS falls back to inventory purchased. Spending is categorized by action (inventory, samples, shipping, advertising, refunds, software, other). Fixed overhead from the plan is prorated by days.
- **Allocation:** new money above the reserve is split by weight with exact cents (largest remainder). Recommended shares: Sourcing 45, Marketing 20, Inventory 15, Finance 7, Storefront 5, Customer Service 5, Research 3. They adjust to your setup: Inventory 10 when you ship yourself, Marketing 25 when Shopify is your main channel and 15 for Etsy. These are rules of thumb for a new store, not a calculation from your data. "Reset to recommended" on Funding puts every share and the 15% reserve back. Rebalancing never sets a budget below what an agent has already spent.

## Data and security

- **Start over:** Settings & start over → type `START OVER`. This erases everything, optionally keeping your saved credentials. A backup is saved first and can be restored from the same page. The newest 20 backups are kept in `data/backups/`.
- Everything is stored in `data/db.json` (file mode 600). Back it up, and don't commit it. It's already in `.gitignore`.
- Secrets (agent API keys) are stored in that file in plain text, so protect your computer the same way you protect saved passwords. The dashboard UI never displays a saved secret again. Only the agent that owns a secret receives it, via its config.
- The server listens on `127.0.0.1` only. The owner API rejects requests addressed to other hostnames (DNS rebinding) and cross-site requests, and changes must be sent as JSON.
- Agent tokens can be rotated at any time on the agent's **Connect** tab.
- **Dashboard password** (Settings & start over): once set, every browser must sign in. Sessions last 12 hours and end when the dashboard restarts. Five wrong tries locks sign-in for 15 minutes. Changing the password signs out other browsers. Agents keep using their own tokens. Forgot it? Stop the dashboard and run `npm run reset-password` (your data is kept and backed up).
- **Price floor:** price changes and new listings must state the price, and anything below the floor is denied. The floor is the agent's "Lowest allowed sale price", or else your plan's break-even price. New Storefront agents also need your approval for every price change.
- **AI spending:** agents report each model call (`POST /api/agent/v1/usage`). Costs are estimated from a price list, shown on Financials and per agent, and stopped by an optional monthly AI cap on Guardrails. Also set a spending limit in your AI provider's own account, which the provider enforces even if an agent stops reporting.
- Discord webhook URLs are treated as secrets: the dashboard never sends them back to the browser. Only approval requests can ping anyone, and only the mention you configured.

### Agents on another machine

If your agents run elsewhere (a server or the cloud), they need to reach the agent API. Either run the dashboard on that network with `HOST=0.0.0.0`, or expose it through a tunnel. Put HTTPS in front of it, because agent tokens are sent with every request. The owner pages stay restricted to the hosts listed in `ALLOWED_HOSTS`, so keep that list short.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4317` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind to |
| `DATA_DIR` | `./data` | Where `db.json` is stored |
| `ALLOWED_HOSTS` | (none) | Extra comma-separated hostnames allowed to use the owner UI/API |
| `DASHBOARD_URL` | `http://localhost:PORT` | Link used in Discord approval messages |

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
