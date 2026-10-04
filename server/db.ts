import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

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

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "lobby.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db: Database.Database = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    customer_note TEXT NOT NULL DEFAULT '',
    paused INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    number INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'waiting',
    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (business_id, day, number)
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_business_status ON tickets(business_id, status);
`);

export function today(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function newId(): string {
  return crypto.randomUUID();
}

function slugify(name: string): string {
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

export interface NewBusiness {
  name: string;
  ownerName: string;
  email: string;
  passwordHash: string;
}

export function createBusiness(input: NewBusiness): BusinessRow {
  const id = newId();
  const base = slugify(input.name);
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO businesses (id, slug, name, owner_name, email, password_hash, customer_note, paused, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', 0, ?)`
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${crypto.randomBytes(2).toString("hex")}`;
    try {
      insert.run(id, slug, input.name, input.ownerName, input.email, input.passwordHash, now);
      return db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) as BusinessRow;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : "";
      // Another shop may already own this slug, so retry with a suffix.
      if (message.includes("UNIQUE constraint failed") && message.includes("slug")) continue;
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not create the business.");
}

export function getBusinessById(id: string): BusinessRow | undefined {
  return db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) as BusinessRow | undefined;
}

export function getBusinessBySlug(slug: string): BusinessRow | undefined {
  return db.prepare("SELECT * FROM businesses WHERE slug = ?").get(slug) as BusinessRow | undefined;
}

export function getBusinessByEmail(email: string): BusinessRow | undefined {
  return db.prepare("SELECT * FROM businesses WHERE email = ?").get(email) as BusinessRow | undefined;
}

export function createTicket(businessId: string, name: string): TicketRow {
  const id = newId();
  const now = Date.now();
  const day = today();

  db.transaction(() => {
    const row = db
      .prepare("SELECT COALESCE(MAX(number), 0) AS n FROM tickets WHERE business_id = ? AND day = ?")
      .get(businessId, day) as { n: number };
    db.prepare(
      `INSERT INTO tickets (id, business_id, day, number, name, status, confirmed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'waiting', 0, ?, ?)`
    ).run(id, businessId, day, row.n + 1, name, now, now);
  })();

  return db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as TicketRow;
}

export function getTicket(id: string, businessId: string): TicketRow | undefined {
  return db
    .prepare("SELECT * FROM tickets WHERE id = ? AND business_id = ?")
    .get(id, businessId) as TicketRow | undefined;
}

// Today's tickets, plus anything still in progress from previous days.
export function listTickets(businessId: string): TicketRow[] {
  return db
    .prepare(
      `SELECT * FROM tickets
       WHERE business_id = ? AND (day = ? OR status IN ('waiting', 'called'))
       ORDER BY day ASC, number ASC`
    )
    .all(businessId, today()) as TicketRow[];
}

export function currentNumber(businessId: string): number | null {
  const row = db
    .prepare("SELECT number FROM tickets WHERE business_id = ? AND status = 'called' ORDER BY updated_at DESC LIMIT 1")
    .get(businessId) as { number: number } | undefined;
  return row ? row.number : null;
}

export function waitingCount(businessId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM tickets WHERE business_id = ? AND status = 'waiting'")
    .get(businessId) as { n: number };
  return row.n;
}

export function peopleAhead(ticket: TicketRow): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tickets
       WHERE business_id = ? AND day = ? AND status = 'waiting' AND number < ?`
    )
    .get(ticket.business_id, ticket.day, ticket.number) as { n: number };
  return row.n;
}
