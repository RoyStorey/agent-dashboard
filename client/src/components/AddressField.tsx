import { useEffect, useId, useRef, useState } from "react";

interface Suggestion {
  label: string;
  lines: string[];
  needsNumber: boolean;
}

/**
 * Address box with suggestions as you type. Picking one fills the address,
 * which stays editable (add an apartment number, fix anything). Suggestions
 * come from Photon (OpenStreetMap) via the dashboard.
 */
export function AddressField(props: { value: string; onChange: (v: string) => void; id: string; label: string; rows?: number }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "none">("idle");
  const [hint, setHint] = useState<string | null>(null);
  const listId = useId();
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 4) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const ticket = ++latest.current;
    setStatus("loading");
    // Wait until typing pauses, so every keystroke isn't sent.
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/address/suggest?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { suggestions?: Suggestion[] };
        if (ticket !== latest.current) return;
        if (!res.ok) throw new Error();
        const list = data.suggestions ?? [];
        setResults(list);
        setActive(0);
        setOpen(true);
        setStatus(list.length ? "idle" : "none");
      } catch {
        if (ticket === latest.current) setStatus("error");
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [query]);

  const pick = (s: Suggestion) => {
    props.onChange(s.lines.join("\n"));
    setQuery("");
    setResults([]);
    setOpen(false);
    setHint(s.needsNumber ? "Add your house or building number to the first line." : "Add an apartment or unit number if you have one.");
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <label htmlFor={`${props.id}-search`} style={{ fontSize: 13, fontWeight: 600 }}>
        {props.label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          id={`${props.id}-search`}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Start typing your address, then pick it from the list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[active]!);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {open && results.length > 0 && (
          <ul id={listId} role="listbox" className="suggestions">
            {results.map((s, i) => (
              <li
                key={s.label}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="help">
        {status === "loading" && "Looking up…"}
        {status === "none" && "No matches yet. Keep typing, or enter the address in the box below."}
        {status === "error" && "Suggestions are unavailable right now. Enter the address in the box below."}
        {status === "idle" && "What you type here is sent to Photon (photon.komoot.io) to find matches. Map data © OpenStreetMap contributors."}
      </div>
      <textarea id={props.id} aria-label={`${props.label} (full address)`} rows={props.rows ?? 3} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      {hint && <div className="help">{hint}</div>}
    </div>
  );
}
