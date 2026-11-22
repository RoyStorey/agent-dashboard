import { useEffect, useState, type ReactNode } from "react";
import { bpsToInput, parsePercent } from "../../../shared/economics.ts";
import { centsToInput, formatCents, parseDollars } from "../../../shared/money.ts";
import type { Toast } from "../api.ts";

export function Card(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ""}`}>
      {(props.title || props.actions) && (
        <header className="card-head">
          {props.title && <h3>{props.title}</h3>}
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function Badge(props: { tone?: "neutral" | "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  return <span className={`badge badge-${props.tone ?? "neutral"}`}>{props.children}</span>;
}

export function Stat(props: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="stat">
      <div className="stat-label">{props.label}</div>
      <div className={`stat-value ${props.tone ? `tone-${props.tone}` : ""}`}>{props.value}</div>
      {props.hint && <div className="stat-hint">{props.hint}</div>}
    </div>
  );
}

export function Money({ cents }: { cents: number }) {
  return <span className="num">{formatCents(cents)}</span>;
}

export function PageHeader(props: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h2>{props.title}</h2>
        {props.subtitle && <p className="muted">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </div>
  );
}

export function EmptyState(props: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{props.title}</strong>
      {props.children && <div className="muted">{props.children}</div>}
    </div>
  );
}

/**
 * Dollar input that edits a cents value. `nullable` adds a "No limit" state
 * represented by an empty field.
 */
export function MoneyInput(props: {
  value: number | null;
  onChange: (cents: number | null) => void;
  nullable?: boolean;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(centsToInput(props.value));
  const [invalid, setInvalid] = useState(false);

  // Re-sync only when the value changes from outside (not while typing "12.").
  useEffect(() => {
    const typed = text.trim() === "" ? null : parseDollars(text);
    if (typed !== props.value) {
      setText(centsToInput(props.value));
      setInvalid(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  return (
    <div className={`money-input ${invalid ? "invalid" : ""}`}>
      <span className="prefix">$</span>
      <input
        id={props.id}
        aria-label={props.ariaLabel}
        inputMode="decimal"
        value={text}
        placeholder={props.placeholder ?? (props.nullable ? "No limit" : "0.00")}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t.trim() === "") {
            setInvalid(!props.nullable);
            if (props.nullable) props.onChange(null);
            return;
          }
          const c = parseDollars(t);
          setInvalid(c === null);
          if (c !== null) props.onChange(c);
        }}
      />
    </div>
  );
}

export function Field(props: { label: string; htmlFor?: string; help?: ReactNode; children: ReactNode; required?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={props.htmlFor}>
        {props.label}
        {props.required && <span className="req" aria-label="required"> *</span>}
      </label>
      {props.children}
      {props.help && <div className="help">{props.help}</div>}
    </div>
  );
}

export function Toasts(props: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {props.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => props.onDismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function timeAgo(iso: string | null, nowIso: string): string {
  if (!iso) return "never";
  const diff = Math.max(0, new Date(nowIso).getTime() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** `kind="spend"` (default) turns red as it fills; `kind="progress"` is always green, since full means done. */
export function ProgressBar(props: { value: number; max: number; label?: string; kind?: "spend" | "progress" }) {
  const pct = props.max <= 0 ? 0 : Math.min(100, Math.round((props.value / props.max) * 100));
  const tone = props.kind === "progress" ? "good" : pct >= 90 ? "bad" : pct >= 70 ? "warn" : "good";
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={props.label}>
      <div className={`progress-fill tone-bg-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Percentage input that edits basis points (15.5% = 1550). */
export function PercentInput(props: { value: number; onChange: (bps: number) => void; id?: string; ariaLabel?: string }) {
  const [text, setText] = useState(bpsToInput(props.value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (parsePercent(text) !== props.value) {
      setText(bpsToInput(props.value));
      setInvalid(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  return (
    <div className={`money-input ${invalid ? "invalid" : ""}`}>
      <input
        id={props.id}
        aria-label={props.ariaLabel}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = parsePercent(e.target.value);
          setInvalid(v === null);
          if (v !== null) props.onChange(v);
        }}
      />
      <span className="prefix" style={{ paddingRight: 10 }}>
        %
      </span>
    </div>
  );
}

/** Opens in a new tab; the arrow makes it obvious it leaves the dashboard. */
export function ExtLink(props: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer" className={props.className}>
      {props.children} ↗
    </a>
  );
}

export function StepState({ done }: { done: boolean }) {
  return <span className={`step-dot ${done ? "done" : ""}`} aria-label={done ? "Done" : "To do"}>{done ? "✓" : ""}</span>;
}

export const MONEY_META = {
  moves: { label: "Moves real money", tone: "bad", icon: "$", explain: "Real money changes hands: bank transfers, card charges, billing." },
  reads: { label: "Reads real accounts", tone: "info", icon: "👁", explain: "Connects to a real account read-only. It can see money but can't move it." },
  records: { label: "Accounting only", tone: "good", icon: "✎", explain: "Numbers written down in this dashboard. No real money moves." },
} as const;

export function MoneyBadge({ kind }: { kind: keyof typeof MONEY_META }) {
  const m = MONEY_META[kind];
  return (
    <span title={m.explain}>
      <Badge tone={m.tone}>
        <span aria-hidden>{m.icon}</span> {m.label}
      </Badge>
    </span>
  );
}

export function MoneyLegend() {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {(Object.keys(MONEY_META) as Array<keyof typeof MONEY_META>).map((k) => (
        <div key={k} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <MoneyBadge kind={k} />
          <span className="muted">{MONEY_META[k].explain}</span>
        </div>
      ))}
    </div>
  );
}
