/**
 * What the model reads. Two parts, for cost:
 *  - systemPrompt(): who the agent is and how the team works. It changes only
 *    when the owner edits the agent, so it is identical on every call of a run
 *    (and cached after the first one).
 *  - briefing(): a compact snapshot of what's new for this agent. It replaces
 *    any need to "look around" with tool calls.
 */
import { unitBreakdown, economicsComplete } from "../../shared/economics.ts";
import { formatCents } from "../../shared/money.ts";
import { channelNames } from "../../shared/channels.ts";
import { FULFILLMENT_LABEL, lowSupplies } from "../../shared/shipping.ts";
import { PHASES, PHASE_GOAL, PHASE_LABEL } from "../../shared/team.ts";
import { findTemplate } from "../../shared/templates.ts";
import type { Agent, DashboardState } from "../../shared/types.ts";
import { agentSpent, agentSpentToday } from "../finance.ts";
import { priceFloorCents } from "../guardrails.ts";
import { resolveInputs } from "../inputs.ts";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** Each role's job in a sentence or two, on top of its listed responsibilities. */
const ROLE_FOCUS: Record<string, string> = {
  orchestrator:
    "You coordinate. Keep the team brief current, read teammates' notes and run summaries, hand work to the right role with a note, and propose the next phase as soon as its goal is met (don't wait for extra polish). You don't do the specialists' work yourself.",
  research:
    "You confirm the product and market with evidence: demand, competitors' prices, customer complaints, required certifications. Search the web sparingly and share findings as a note with sources.",
  sourcing:
    "You find certified suppliers and compare quotes (unit price, MOQ, lead time, certifications). You cannot contact suppliers or pay; write the owner exact instructions (supplier, link, what to ask or order) and request approval for any spend.",
  storefront:
    "You build the Shopify store: product listings and pages (About, FAQ, Shipping & returns), always as hidden drafts the owner reviews. Write clear, honest copy and never claim certifications the product doesn't have.",
  inventory:
    "You keep product and packing supplies in stock and tell the owner exactly what to order and when, through approved requests.",
  finance: "You watch the numbers: sales, spending, margins and budget. Flag problems early to the Orchestrator and the owner.",
  marketing:
    "You plan launch and promotion: keywords, ad tests with small budgets, and listing improvements. Request approval before any ad spend.",
  support: "You draft replies and policies for customer questions, returns and reviews, and flag anything urgent to the owner.",
};

export function systemPrompt(s: DashboardState, agent: Agent): string {
  const tpl = findTemplate(agent.role);
  const roleName = tpl?.name ?? agent.name;
  const inputs = resolveInputs(s, agent).values;
  const settings = agent.inputFields
    .filter((f) => f.kind !== "secret" && (inputs[f.key] ?? "").trim())
    .map((f) => `- ${f.label}: ${clip(inputs[f.key]!.trim(), 300)}`);
  const allowed = agent.actions
    .filter((a) => agent.guardrails.allowedActions.includes(a.key))
    .map((a) => {
      const tags = [a.spends ? "spends money" : "", agent.guardrails.approvalRequiredActions.includes(a.key) ? "owner approves" : ""].filter(Boolean);
      return `- ${a.key}: ${a.label}${tags.length ? ` (${tags.join(", ")})` : ""}`;
    });

  return [
    `You are ${agent.name}, the ${roleName} agent on a small team of AI agents that runs an online store for its owner. The owner is a person who funds the business, approves risky steps, and does the physical work (paying suppliers, packing orders).`,
    "",
    "## Your job",
    ROLE_FOCUS[agent.role] ?? (agent.description || "Do the work described in your responsibilities."),
    ...(agent.responsibilities.length ? ["", "Responsibilities:", ...agent.responsibilities.map((r) => `- ${r}`)] : []),
    ...(settings.length ? ["", "Owner's settings for you:", ...settings] : []),
    "",
    "## How the team works",
    `- Work moves through phases: ${PHASES.map((p) => PHASE_LABEL[p]).join(" → ")}. Stick to what the current phase needs.`,
    "- The team notebook is how you share context. Your briefing shows notes addressed to you. Write a note only when it changes what someone should do; a note wakes the agents it is addressed to, which costs money.",
    "- You work in short sessions that start when something changes for you. Do the next useful steps, then stop. Don't redo work the notebook shows is done.",
    "- If your task isn't finished when you stop (for example you ran out of steps), call keep_working with exactly what's left: you'll continue in a few minutes. If you're waiting on the owner or a teammate, don't; their reply wakes you.",
    "- When you finish something a teammate needs, send it to them in a note. Report results and blockers to the orchestrator so the team can move on.",
    "- You can't pay, sign up for accounts or message anyone outside the team. To spend money, use request_action first. When the owner must do something, give exact steps (where, what, how many, links) in a note to owner.",
    "- Never invent facts, prices, certifications or results. If you're unsure, say so.",
    "",
    "## Actions you may request",
    ...(allowed.length ? allowed : ["- none"]),
    "",
    "## Finish",
    "End every session with a plain-text summary of 1-3 sentences: what you did and what happens next. The owner and your teammates read it.",
  ].join("\n");
}

export function briefing(s: DashboardState, agent: Agent, reason: string, now: Date): string {
  const since = agent.runtime.lastRunAt;
  const out: string[] = [];
  const b = s.business;
  out.push(`Now: ${when(now.toISOString())} UTC. Why you're running: ${reason}.`);
  out.push(`Phase: ${PHASE_LABEL[s.plan.phase]}. Goal: ${PHASE_GOAL[s.plan.phase]}`);
  out.push(`Team brief: ${s.plan.brief ? clip(s.plan.brief, 1500) : "(none yet)"}`);

  const biz = [
    b.name && `Business: ${b.name}`,
    b.product && `Product: ${b.product}`,
    b.description && `About: ${clip(b.description, 300)}`,
    b.targetMarket && `Customers: ${clip(b.targetMarket, 200)}`,
    b.channels.length && `Selling on: ${channelNames(b.channels)}`,
    b.fulfillmentMode && `Shipping: ${FULFILLMENT_LABEL[b.fulfillmentMode]}`,
  ].filter(Boolean);
  if (biz.length) out.push(biz.join(". ") + ".");
  if (economicsComplete(s.economics)) {
    const u = unitBreakdown(s.economics);
    out.push(`Plan: sell at ${formatCents(s.economics.salePriceCents)}, landed cost ${formatCents(u.landedCost)}, profit after fees and ads ${formatCents(u.contribution)} per unit.`);
  }
  const floor = priceFloorCents(s, agent);
  const g = agent.guardrails;
  out.push(
    [
      `Your budget: ${formatCents(agent.budgetCents)} allocated, ${formatCents(agentSpent(s, agent.id))} committed, ${formatCents(agentSpentToday(s, agent.id, now))} today`,
      g.perTransactionLimitCents !== null ? `max ${formatCents(g.perTransactionLimitCents)} per request` : "",
      g.dailySpendLimitCents !== null ? `max ${formatCents(g.dailySpendLimitCents)} per day` : "",
      floor !== null ? `price floor ${formatCents(floor)}` : "",
    ]
      .filter(Boolean)
      .join("; ") + ".",
  );

  const lastRun = [...s.runs].reverse().find((r) => r.agentId === agent.id && r.status !== "running" && r.summary);
  if (lastRun) out.push(`\nYour last session (${when(lastRun.startedAt)}): ${clip(lastRun.summary, 600)}`);

  // Notes: new ones addressed to this agent; the Orchestrator sees all new notes.
  const after = (iso: string | null) => !since || (iso !== null && iso > since);
  const forMe = (to: string[]) => agent.role === "orchestrator" || to.includes(agent.role) || to.includes("all");
  const notes = s.notebook.filter((n) => after(n.at) && n.authorId !== agent.id && forMe(n.to)).slice(-12);
  if (notes.length) {
    out.push("\nNew notes:");
    for (const n of notes) out.push(`- [${when(n.at)}] ${n.author} → ${n.to.join(", ")}: ${clip(n.text, 700)}`);
  } else {
    out.push("\nNo new notes for you. (read_notebook shows older ones.)");
  }

  const mine = s.requests.filter((r) => r.agentId === agent.id);
  const open = mine.filter((r) => r.status === "approved" || r.status === "pending_approval").slice(-10);
  if (open.length) {
    out.push("\nYour open requests:");
    for (const r of open) out.push(`- ${r.id} ${r.action} ${r.amountCents ? formatCents(r.amountCents) + " " : ""}[${r.status === "approved" ? "approved, not done yet" : "waiting for owner"}]: ${clip(r.description, 160)}`);
  }
  const decided = mine.filter((r) => r.decidedBy === "owner" && after(r.decidedAt)).slice(-8);
  if (decided.length) {
    out.push("\nThe owner decided:");
    for (const r of decided) out.push(`- ${r.id} ${r.action}: ${r.status}${r.resultNote ? ` (${clip(r.resultNote, 200)})` : ""}`);
  }

  out.push(...roleExtras(s, agent, since));
  return out.join("\n");
}

function roleExtras(s: DashboardState, agent: Agent, since: string | null): string[] {
  const out: string[] = [];
  switch (agent.role) {
    case "orchestrator": {
      out.push("\nTeam:");
      for (const a of s.agents.filter((x) => x.id !== agent.id)) {
        const last = [...s.runs].reverse().find((r) => r.agentId === a.id && r.status !== "running");
        const state = a.status !== "active" ? a.status : a.runtime.state;
        out.push(`- ${a.name} (${a.role}, ${state})${last ? `, last ${when(last.startedAt)}: ${clip(last.summary || last.error || last.status, 220)}` : ", hasn't run yet"}`);
      }
      const open = s.tasks.filter((t) => !t.completedAt).slice(0, 6);
      if (open.length) out.push(`Owner's open checklist steps: ${open.map((t) => t.title).join("; ")}.`);
      const waiting = s.requests.filter((r) => r.status === "pending_approval").length;
      if (waiting) out.push(`${waiting} request${waiting === 1 ? "" : "s"} waiting for the owner.`);
      break;
    }
    case "research":
    case "sourcing":
    case "marketing": {
      const job = [...s.research].reverse().find((j) => j.status === "done" && j.chosenIndex !== null);
      const idea = job && job.chosenIndex !== null ? job.ideas[job.chosenIndex] : undefined;
      if (idea) out.push(`\nThe owner picked this idea from earlier research: ${idea.title}. Niche: ${clip(idea.niche, 160)}. Keywords: ${idea.keywords.slice(0, 8).join(", ")}. Compliance: ${idea.compliance.slice(0, 4).join("; ")}.`);
      break;
    }
    case "storefront": {
      const drafts = s.drafts.filter((d) => d.agentId === agent.id).slice(-12);
      if (drafts.length) {
        out.push("\nYour drafts:");
        for (const d of drafts) out.push(`- ${d.kind} “${d.title}”${d.priceCents !== null ? ` ${formatCents(d.priceCents)}` : ""}: ${d.status}${d.note ? ` (owner: ${clip(d.note, 200)})` : ""}`);
      }
      if (!s.vault.shopify_admin?.value.trim()) out.push("Shopify isn't connected yet, so you can't create drafts. Ask the owner to connect it on Credentials.");
      break;
    }
    case "inventory": {
      if (s.business.fulfillmentMode !== "self") {
        out.push("\nThe owner isn't shipping orders from home, so there's no stock at home to track.");
        break;
      }
      out.push("\nStock at home (id: on hand / reorder at / reorder qty):");
      for (const x of s.supplies) out.push(`- ${x.id} ${x.name}: ${x.onHand} ${x.unit} / ${x.reorderAt} / ${x.reorderQty}`);
      const low = lowSupplies(s.supplies);
      if (low.length) out.push(`Running low: ${low.map((x) => x.name).join(", ")}.`);
      const toPack = s.shipments.filter((x) => x.status === "to_pack" || x.status === "packed").length;
      out.push(`${toPack} order${toPack === 1 ? "" : "s"} waiting to be shipped.`);
      break;
    }
    case "finance": {
      const sales = s.funding.filter((f) => f.type === "revenue" && (!since || f.createdAt > since));
      if (sales.length) out.push(`\nNew sales reports: ${sales.map((f) => formatCents(f.amountCents)).join(", ")}.`);
      const shipped = s.shipments.filter((x) => x.shippedAt && (!since || x.shippedAt > since)).length;
      if (shipped) out.push(`${shipped} order${shipped === 1 ? "" : "s"} shipped since your last session.`);
      break;
    }
  }
  return out;
}
