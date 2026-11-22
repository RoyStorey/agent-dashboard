import { useState } from "react";
import type { ActivityLevel } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { Badge, Card, EmptyState, PageHeader, formatDateTime } from "../components/ui.tsx";

const TONE: Record<ActivityLevel, "info" | "warn" | "bad" | "good"> = { info: "info", warning: "warn", error: "bad", success: "good" };

export function Activity({ state }: SectionProps) {
  const [actor, setActor] = useState("all");
  const [query, setQuery] = useState("");
  const actors = [...new Set(state.activity.map((e) => e.actor))].sort();
  const q = query.trim().toLowerCase();
  const rows = state.activity.filter((e) => (actor === "all" || e.actor === actor) && (!q || e.message.toLowerCase().includes(q)));

  return (
    <>
      <PageHeader title="Activity" subtitle="Everything the agents and you have done, newest first. Agents can write here through the log endpoint." />
      <Card
        actions={
          <div className="row">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-label="Search activity" style={{ width: 200 }} />
            <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Filter by actor" style={{ width: "auto" }}>
              <option value="all">Everyone</option>
              {actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No activity to show" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Level</th>
                  <th>What happened</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(e.at)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{e.actor}</td>
                    <td>
                      <Badge tone={TONE[e.level]}>{e.level}</Badge>
                    </td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="help">Showing the latest {state.activity.length} entries.</p>
      </Card>
    </>
  );
}
