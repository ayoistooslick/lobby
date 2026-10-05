import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { store, type BusinessRow } from "./store";
import { ApiError } from "./validate";

const SESSION_COOKIE = "lobby_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1 };

declare global {
  namespace Express {
    interface Request {
      business?: BusinessRow;
    }
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// Spent on unknown emails so login timing doesn't reveal which accounts exist.
export const DUMMY_PASSWORD_HASH = hashPassword("placeholder-password");

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(businessId: string): Promise<{ token: string; expiresAt: number }> {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_MS;
  await store.createSession(businessId, hashToken(token), now, expiresAt);
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  await store.deleteSession(hashToken(token));
}

export async function businessForToken(token: string): Promise<BusinessRow | null> {
  return store.businessForToken(hashToken(token), Date.now());
}

// Expired sessions are swept at boot and then on an interval.
let prunerStarted = false;
export function startSessionPruner(): void {
  if (prunerStarted) return;
  prunerStarted = true;
  void store.pruneSessions(Date.now());
  const timer = setInterval(() => {
    void store.pruneSessions(Date.now());
  }, 6 * 60 * 60 * 1000);
  timer.unref();
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

export function setSessionCookie(res: Response, token: string, expiresAt: number): void {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`);
}

export function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readSessionToken(req);
  const business = token ? await businessForToken(token) : null;
  if (!business) {
    next(new ApiError(401, "Please sign in to continue."));
    return;
  }
  req.business = business;
  next();
}

export async function authed(req: Request): Promise<BusinessRow> {
  if (req.business) return req.business;
  const token = readSessionToken(req);
  const business = token ? await businessForToken(token) : null;
  if (!business) throw new ApiError(401, "Please sign in to continue.");
  return business;
}
