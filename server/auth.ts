import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { hashToken, randomToken, type BranchRow, type BusinessRow, type StaffRow } from "./rows";
import { store } from "./store";
import { ApiError } from "./validate";

const SESSION_COOKIE = "lobby_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1 };

/** Everything a staff request is allowed to act on. */
export interface AuthScope {
  staff: StaffRow;
  business: BusinessRow;
}

declare global {
  namespace Express {
    interface Request {
      scope?: AuthScope;
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
  if (expected.length === 0) return false;
  const actual = crypto.scryptSync(password, salt, expected.length, SCRYPT);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Spent on unknown emails so login timing doesn't reveal which accounts exist.
export const DUMMY_PASSWORD_HASH = hashPassword("placeholder-password");

/**
 * Passwords that show up in every breach dump. Exact matches only, checked
 * case-insensitively, so a shop owner can still pick a real passphrase.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "qwertyuiop",
  "letmein",
  "welcome1",
  "welcome123",
  "admin123",
  "iloveyou",
  "monkey123",
  "dragon123",
  "sunshine1",
  "princess1",
  "football1",
  "baseball1",
  "abc123456",
  "aaaaaaaa",
  "11111111",
  "00000000",
  "passw0rd",
  "trustno1",
  "starwars1",
  "changeme",
  "secret123",
  "login123",
  "master123",
]);

/**
 * Guards signup, invite acceptance and password change. Deliberately shallow:
 * no forced symbol soup, just the rules that actually stop a guessable
 * account, so honest users are not pushed toward `Passw0rd!`.
 */
export function assertPasswordStrength(
  password: string,
  context: { email?: string; name?: string } = {}
): void {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    throw new ApiError(400, "That password is too easy to guess. Choose something less common.");
  }
  const email = (context.email ?? "").toLowerCase();
  if (email && (lower === email || lower === email.split("@")[0])) {
    throw new ApiError(400, "Your password cannot be your email address.");
  }
  const name = (context.name ?? "").toLowerCase().trim();
  if (name.length >= 4 && lower === name) {
    throw new ApiError(400, "Your password cannot just be your name.");
  }
  if (/^(.)\1+$/.test(password)) {
    throw new ApiError(400, "Pick a password that isn't one repeated character.");
  }
}

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomToken(32);
  return { token, tokenHash: hashToken(token) };
}

export async function createSession(
  staffId: string,
  userAgent = ""
): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = now + SESSION_MS;
  await store.createSession(staffId, hashToken(token), now, expiresAt, userAgent);
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  await store.deleteSession(hashToken(token));
}

export async function scopeForToken(token: string): Promise<AuthScope | null> {
  const staff = await store.staffForToken(hashToken(token), Date.now());
  if (!staff) return null;
  const business = await store.getBusinessById(staff.business_id);
  // A paused business still lets its staff work. Pausing only stops new joins.
  if (!business) return null;
  return { staff, business };
}

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

// `trust proxy` is on, so req.secure reflects x-forwarded-proto behind an
// https proxy. That keeps the Secure flag correct even when NODE_ENV was never
// set (no start script sets it), while plain-http local dev still works.
function secureSuffix(req: Request): string {
  return req.secure || process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function setSessionCookie(req: Request, res: Response, token: string, expiresAt: number): void {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const secure = secureSuffix(req);
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
  );
}

export function clearSessionCookie(req: Request, res: Response): void {
  const secure = secureSuffix(req);
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readSessionToken(req);
  const scope = token ? await scopeForToken(token) : null;
  if (!scope) {
    next(new ApiError(401, "Please sign in to continue."));
    return;
  }
  req.scope = scope;
  next();
}

export async function authed(req: Request): Promise<AuthScope> {
  if (req.scope) return req.scope;
  const token = readSessionToken(req);
  const scope = token ? await scopeForToken(token) : null;
  if (!scope) throw new ApiError(401, "Please sign in to continue.");
  return scope;
}

/** Staff pinned to one branch can never read or change another branch. */
export function branchAllowed(staff: StaffRow, branchId: string): boolean {
  return staff.branch_id === "" || staff.branch_id === branchId;
}

export async function requireBranch(req: Request, branchId: unknown): Promise<BranchRow> {
  const { staff, business } = await authed(req);
  const wanted = String(branchId ?? "");
  const branch = await store.getBranch(wanted);
  // Same message whether the branch is missing or belongs to someone else, so
  // the API never confirms that another tenant's branch exists.
  if (!branch || branch.business_id !== business.id || !branchAllowed(staff, branch.id)) {
    throw new ApiError(404, "We couldn't find that branch.");
  }
  return branch;
}

export function userAgentOf(req: Request): string {
  return String(req.headers["user-agent"] ?? "").slice(0, 200);
}