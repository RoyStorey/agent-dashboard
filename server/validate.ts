export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const bad = (message: string): HttpError => new HttpError(400, message);

export type Body = Record<string, unknown>;

export function asBody(value: unknown): Body {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw bad("Request body must be a JSON object.");
  return value as Body;
}

export function str(body: Body, key: string, opts: { max?: number; required?: boolean } = {}): string | undefined {
  const v = body[key];
  if (v === undefined) {
    if (opts.required) throw bad(`"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== "string") throw bad(`"${key}" must be a string.`);
  const max = opts.max ?? 2000;
  if (v.length > max) throw bad(`"${key}" must be at most ${max} characters.`);
  if (opts.required && v.trim() === "") throw bad(`"${key}" must not be empty.`);
  return v;
}

/** Non-negative integer cents. */
export function cents(body: Body, key: string, opts: { required?: boolean; positive?: boolean } = {}): number | undefined {
  const v = body[key];
  if (v === undefined) {
    if (opts.required) throw bad(`"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
    throw bad(`"${key}" must be a non-negative whole number of cents.`);
  }
  if (opts.positive && v === 0) throw bad(`"${key}" must be greater than zero.`);
  return v;
}

/** Cents or null (null = "no limit"). Returns undefined when the key is absent. */
export function centsOrNull(body: Body, key: string): number | null | undefined {
  if (body[key] === null) return null;
  return cents(body, key);
}

export function bool(body: Body, key: string): boolean | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw bad(`"${key}" must be true or false.`);
  return v;
}

export function strArray(body: Body, key: string, opts: { maxItems?: number; maxLen?: number } = {}): string[] | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw bad(`"${key}" must be a list of strings.`);
  const maxItems = opts.maxItems ?? 100;
  const maxLen = opts.maxLen ?? 500;
  if (v.length > maxItems) throw bad(`"${key}" may have at most ${maxItems} items.`);
  if ((v as string[]).some((x) => x.length > maxLen)) throw bad(`Items in "${key}" must be at most ${maxLen} characters.`);
  return v as string[];
}

export function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[], required = false): T | undefined {
  const v = body[key];
  if (v === undefined) {
    if (required) throw bad(`"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw bad(`"${key}" must be one of: ${allowed.join(", ")}.`);
  }
  return v as T;
}

export function obj(body: Body, key: string): Body | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  return asBody(v);
}

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
