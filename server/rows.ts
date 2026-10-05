import crypto from "node:crypto";

export type TicketStatus = "waiting" | "called" | "served" | "skipped" | "no_show";

export interface BusinessRow {
  id: string;
  slug: string;
  name: string;
  owner_name: string;
  email: string;
  password_hash: string;
  customer_note: string;
  paused: number;
  created_at: number;
}

export interface TicketRow {
  id: string;
  business_id: string;
  day: string;
  number: number;
  name: string;
  status: TicketStatus;
  confirmed: number;
  created_at: number;
  updated_at: number;
}

export function today(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function newId(): string {
  return crypto.randomUUID();
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
  return base || "shop";
}
