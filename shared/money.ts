import type { Cents } from "./types.ts";

/** Formats integer cents as US dollars, e.g. 123456 -> "$1,234.56". */
export function formatCents(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${withCommas}.${rem.toString().padStart(2, "0")}`;
}

/**
 * Parses a dollar string ("1,234.5", "$20", "0.99") into integer cents using
 * string arithmetic (no floating point). Returns null for invalid input.
 */
export function parseDollars(input: string): Cents | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const frac = (match[2] ?? "").padEnd(2, "0");
  const cents = Number(whole) * 100 + Number(frac);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Cents -> plain editable dollar string ("1234.50"), or "" for null. */
export function centsToInput(cents: Cents | null): string {
  if (cents === null) return "";
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

export function isValidCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
