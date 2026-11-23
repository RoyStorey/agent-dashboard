import type { AgentView, StateResponse } from "../../../shared/types.ts";
import { Badge, timeAgo } from "./ui.tsx";

export function timeUntil(iso: string | null, nowIso: string): string {
  if (!iso) return "soon";
  const diff = new Date(iso).getTime() - new Date(nowIso).getTime();
  if (diff <= 60_000) return "within a minute";
  const m = Math.round(diff / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h} hr`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

export function elapsed(iso: string | null, nowIso: string): string {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((new Date(nowIso).getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`;
}

export interface LiveStatus {
  label: string;
  tone: "good" | "warn" | "bad" | "info" | "neutral";
  /** What it's doing (working) or when it was last seen (idle). */
  detail: string;
  /** Why it's idle and when it checks next. */
  note: string | null;
  working: boolean;
}

export function liveStatus(state: StateResponse, agent: AgentView): LiveStatus {
  const now = state.serverTime;
  const rt = agent.runtime;
  const seen = [agent.lastSeenAt, rt.lastRunAt].filter(Boolean).sort().at(-1) ?? null;
  const lastSeen = `Last seen ${timeAgo(seen, now)}`;
  if (rt.state === "working") {
    return { label: "Working", tone: "good", detail: `${rt.step ?? "Working"} · for ${elapsed(rt.since, now)}`, note: null, working: true };
  }
  if (agent.status === "draft") return { label: "Not active", tone: "neutral", detail: lastSeen, note: "Activate it on its page to let it work.", working: false };
  if (agent.status === "paused") return { label: "Paused", tone: "warn", detail: lastSeen, note: "Paused by you.", working: false };
  if (state.guardrails.killSwitch) return { label: "Stopped", tone: "bad", detail: lastSeen, note: "Kill switch is on.", working: false };
  const next = agent.schedule.enabled ? `Next check ${timeUntil(rt.nextCheckAt, now)}.` : "Automatic runs are off; use Run now.";
  return { label: "Idle", tone: "info", detail: lastSeen, note: [rt.lastSkip, next].filter(Boolean).join(" "), working: false };
}

export function LiveBadge({ status }: { status: LiveStatus }) {
  return (
    <Badge tone={status.tone}>
      {status.working && <span className="live-dot" aria-hidden />}
      {status.label}
    </Badge>
  );
}
