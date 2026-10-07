import crypto from "node:crypto";

/** Where a customer sits in the queue lifecycle. */
export type TicketStatus =
  | "waiting"
  | "called"
  | "on_hold"
  | "served"
  | "skipped"
  | "no_show"
  | "cancelled";

export const OPEN_STATUSES: TicketStatus[] = ["waiting", "called", "on_hold"];
export const CLOSED_STATUSES: TicketStatus[] = ["served", "skipped", "no_show", "cancelled"];

/** What a staff member is allowed to do inside one business. */
export type StaffRole = "owner" | "manager" | "staff" | "viewer";

export const STAFF_ROLES: StaffRole[] = ["owner", "manager", "staff", "viewer"];

export type Capability =
  | "queue.read"
  | "queue.operate"
  | "queue.settings"
  | "staff.manage"
  | "reports.read";

export interface BusinessRow {
  id: string;
  slug: string;
  name: string;
  owner_name: string;
  email: string;
  password_hash: string;
  customer_note: string;
  brand_color: string;
  brand_accent: string;
  logo_url: string;
  logo_data: string;
  paused: number;
  created_at: number;
}

export interface BranchRow {
  id: string;
  business_id: string;
  slug: string;
  name: string;
  address: string;
  phone: string;
  note: string;
  paused: number;
  sort_order: number;
  created_at: number;
}

export interface ServiceRow {
  id: string;
  business_id: string;
  branch_id: string;
  slug: string;
  name: string;
  prefix: string;
  description: string;
  avg_minutes: number;
  paused: number;
  sort_order: number;
  open_from: string;
  open_to: string;
  created_at: number;
}

export interface CounterRow {
  id: string;
  business_id: string;
  branch_id: string;
  service_id: string;
  name: string;
  paused: number;
  sort_order: number;
  created_at: number;
}

export interface StaffRow {
  id: string;
  business_id: string;
  email: string;
  name: string;
  role: StaffRole;
  password_hash: string;
  /** Empty string means every branch in the business. */
  branch_id: string;
  active: number;
  created_at: number;
}

export interface InviteRow {
  id: string;
  business_id: string;
  email: string;
  name: string;
  role: StaffRole;
  branch_id: string;
  token_hash: string;
  created_by: string;
  created_at: number;
  expires_at: number;
  accepted_at: number;
}

export interface TicketRow {
  id: string;
  business_id: string;
  branch_id: string;
  service_id: string;
  counter_id: string;
  day: string;
  number: number;
  /** Copied from the queue so a number always reads the same on screen. */
  prefix: string;
  name: string;
  phone: string;
  status: TicketStatus;
  confirmed: number;
  source: string;
  device_token: string;
  note: string;
  skip_count: number;
  moved_from: string;
  created_at: number;
  updated_at: number;
  called_at: number;
  served_at: number;
  closed_at: number;
}

export interface EventRow {
  id: string;
  business_id: string;
  branch_id: string;
  service_id: string;
  ticket_id: string;
  type: string;
  actor: string;
  detail: string;
  at: number;
}

export interface AuditRow {
  id: string;
  business_id: string;
  branch_id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  detail: string;
  at: number;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base || "queue";
}

/** YYYY-MM-DD in UTC, the key used to restart numbering each day. */
export function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function dayRange(days: number, at = Date.now()): { from: string; to: string } {
  const end = new Date(at);
  const start = new Date(at - (days - 1) * 86_400_000);
  return { from: dayKey(start.getTime()), to: dayKey(end.getTime()) };
}

export function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toInt(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Per-minute rounding so wait estimates stay readable. */
export function minutesBetween(from: number, to: number): number {
  return Math.max(0, Math.round((to - from) / 60_000));
}
