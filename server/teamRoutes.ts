/** Owner routes for the agent team: run/stop, schedules, phase and brief, notes, and store drafts. */
import type { Response, Router } from "express";
import { formatCents } from "../shared/money.ts";
import { PHASES, PHASE_LABEL, SCHEDULE_CHOICES } from "../shared/team.ts";
import type { DashboardState, Phase, StoreDraft } from "../shared/types.ts";
import { addNote, setPhase } from "./agentOps.ts";
import { priceFloorCents } from "./guardrails.ts";
import type { AgentRunner } from "./runner/runner.ts";
import { log, type Store } from "./store.ts";
import { HttpError, asBody, bad, bool, oneOf, str, strArray } from "./validate.ts";

export interface TeamPublisher {
  publishProduct(id: string): Promise<void>;
  publishPage(id: string): Promise<void>;
}

export interface TeamContext {
  store: Store;
  now: () => Date;
  sendState: (res: Response) => void;
  runner: AgentRunner;
  shopify: TeamPublisher;
}

function findDraft(s: DashboardState, id: string): StoreDraft {
  const d = s.drafts.find((x) => x.id === id);
  if (!d) throw new HttpError(404, "Draft not found.");
  if (d.status !== "pending") throw new HttpError(409, `This draft is already ${d.status}.`);
  return d;
}

export function registerTeamRoutes(owner: Router, ctx: TeamContext): void {
  const { store, now, sendState, runner } = ctx;

  owner.post("/agents/:id/run", (req, res) => {
    runner.runNow(req.params.id as string);
    sendState(res);
  });

  owner.post("/agents/:id/stop", (req, res) => {
    if (!runner.stop(req.params.id as string)) throw new HttpError(409, "This agent isn't working right now.");
    sendState(res);
  });

  owner.put("/agents/:id/schedule", (req, res) => {
    const body = asBody(req.body);
    const enabled = bool(body, "enabled");
    const every = body.everyMinutes;
    const maxRuns = body.maxRunsPerDay;
    if (every !== undefined && !SCHEDULE_CHOICES.some((c) => c.minutes === every)) {
      throw bad(`"everyMinutes" must be one of ${SCHEDULE_CHOICES.map((c) => c.minutes).join(", ")}.`);
    }
    if (maxRuns !== undefined && (typeof maxRuns !== "number" || !Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 48)) {
      throw bad('"maxRunsPerDay" must be a whole number from 1 to 48.');
    }
    store.mutate((s) => {
      const agent = s.agents.find((a) => a.id === req.params.id);
      if (!agent) throw new HttpError(404, "Agent not found.");
      const t = now();
      if (enabled !== undefined) agent.schedule.enabled = enabled;
      if (typeof every === "number") agent.schedule.everyMinutes = every;
      if (typeof maxRuns === "number") agent.schedule.maxRunsPerDay = maxRuns;
      // Re-plan the next check from the last one under the new interval (or check right away).
      const last = agent.runtime.lastCheckedAt ? Date.parse(agent.runtime.lastCheckedAt) : null;
      agent.runtime.nextCheckAt = last === null ? null : new Date(Math.max(t.getTime(), last + agent.schedule.everyMinutes * 60_000)).toISOString();
      const label = SCHEDULE_CHOICES.find((c) => c.minutes === agent.schedule.everyMinutes)?.label ?? `every ${agent.schedule.everyMinutes} min`;
      log(s, "Owner", "info", `${agent.name}: ${agent.schedule.enabled ? `checks for work ${label}, at most ${agent.schedule.maxRunsPerDay} runs a day` : "automatic runs off"}.`, t);
    });
    sendState(res);
  });

  owner.put("/team/plan", (req, res) => {
    const body = asBody(req.body);
    const phase = oneOf(body, "phase", PHASES as readonly Phase[]);
    const brief = str(body, "brief", { max: 1500 });
    store.mutate((s) => {
      const t = now();
      if (brief !== undefined && brief.trim() !== s.plan.brief) {
        s.plan.brief = brief.trim();
        s.plan.updatedAt = t.toISOString();
        s.plan.updatedBy = "Owner";
        log(s, "Owner", "info", "Updated the team brief.", t);
      }
      if (phase !== undefined) setPhase(s, phase, "Owner", t);
    });
    sendState(res);
  });

  owner.post("/team/notes", (req, res) => {
    const body = asBody(req.body);
    const text = str(body, "text", { max: 2000, required: true })!.trim();
    if (!text) throw bad("Write a note first.");
    const to = [...new Set(strArray(body, "to", { maxItems: 10, maxLen: 30 }) ?? ["all"])].map((x) => x.toLowerCase());
    store.mutate((s) => {
      const valid = new Set(["all", ...s.agents.map((a) => a.role)]);
      const unknown = to.filter((r) => !valid.has(r));
      if (!to.length) throw bad("Choose who the note is for.");
      if (unknown.length) throw bad(`No agent has the role ${unknown.join(", ")}.`);
      addNote(s, { name: "Owner", id: null }, to, text, now());
    });
    sendState(res);
  });

  owner.post("/drafts/:id/publish", async (req, res) => {
    const s = store.get();
    const d = findDraft(s, req.params.id as string);
    if (d.kind === "product" && d.priceCents !== null) {
      const agent = s.agents.find((a) => a.id === d.agentId);
      const floor = agent ? priceFloorCents(s, agent) : null;
      if (floor !== null && d.priceCents < floor) {
        throw new HttpError(409, `Its price ${formatCents(d.priceCents)} is below your price floor of ${formatCents(floor)}. Reject it, or change the price in Shopify and publish it there.`);
      }
    }
    try {
      if (d.kind === "product") await ctx.shopify.publishProduct(d.shopifyId);
      else await ctx.shopify.publishPage(d.shopifyId);
    } catch (err) {
      throw bad(err instanceof Error ? err.message : String(err));
    }
    store.mutate((x) => {
      const draft = findDraft(x, d.id);
      const t = now();
      draft.status = "published";
      draft.decidedAt = t.toISOString();
      log(x, "Owner", "success", `Published the store ${draft.kind} “${draft.title}”. Customers can see it now.`, t, { kind: "system", title: `Published: ${draft.title}` });
    });
    sendState(res);
  });

  owner.post("/drafts/:id/reject", (req, res) => {
    const body = asBody(req.body);
    const note = (str(body, "note", { max: 1000 }) ?? "").trim();
    store.mutate((s) => {
      const d = findDraft(s, req.params.id as string);
      const t = now();
      d.status = "rejected";
      d.decidedAt = t.toISOString();
      d.note = note;
      log(s, "Owner", "warning", `Rejected the store ${d.kind} “${d.title}”.${note ? ` ${note}` : ""} It stays hidden in Shopify.`, t);
    });
    sendState(res);
  });
}

/** When the owner approves a phase change, the team moves on right away. */
export function applyApprovedPhase(s: DashboardState, requestId: string, t: Date): void {
  const r = s.requests.find((x) => x.id === requestId);
  if (!r || r.action !== "advance_phase" || r.status !== "approved") return;
  const phase = r.meta?.phase as Phase | undefined;
  if (!phase || !PHASES.includes(phase)) return;
  // Never move backwards: the owner may already have moved the team on.
  const ahead = PHASES.indexOf(phase) > PHASES.indexOf(s.plan.phase);
  if (ahead) setPhase(s, phase, "Owner", t);
  r.status = "completed";
  r.closedAt = t.toISOString();
  r.resultNote = ahead ? `Moved to “${PHASE_LABEL[phase]}”.` : `The team is already in “${PHASE_LABEL[s.plan.phase]}”.`;
}
