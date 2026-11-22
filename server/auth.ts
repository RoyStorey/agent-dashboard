import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/** Hashes a password with scrypt and a random salt. Only the hash and salt are stored. */
export function hashPassword(password: string, salt: string = randomBytes(16).toString("hex")): { hash: string; salt: string } {
  return { hash: scryptSync(password, salt, 64).toString("hex"), salt };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export const SESSION_COOKIE = "ad_session";
export const SESSION_HOURS = 12;

/** Signed-in browsers. Kept in memory: restarting the dashboard signs everyone out. */
export class Sessions {
  private readonly sessions = new Map<string, number>();

  create(now: Date): string {
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, now.getTime() + SESSION_HOURS * 3_600_000);
    return token;
  }

  valid(token: string | undefined, now: Date): boolean {
    if (!token) return false;
    const exp = this.sessions.get(token);
    if (exp === undefined) return false;
    if (exp <= now.getTime()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  revoke(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }

  revokeAll(): void {
    this.sessions.clear();
  }
}

/** Slows down password guessing: 5 wrong tries within 15 minutes locks that address out for the rest of the window. */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();
  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, list);
    return list;
  }

  blocked(key: string, now: Date): boolean {
    return this.recent(key, now.getTime()).length >= this.max;
  }

  fail(key: string, now: Date): void {
    this.recent(key, now.getTime()).push(now.getTime());
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure ? "; Secure" : ""}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
