import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { newId, slugify, today, type BusinessRow, type TicketRow, type TicketStatus } from "./rows";
import { PgStore } from "./pg";

export type { BusinessRow, TicketRow, TicketStatus } from "./rows";
export { today, newId } from "./rows";

/**
 * One storage interface for the whole app. When DATABASE_URL is set the
 * Postgres implementation is used; otherwise the original SQLite file storage
 * keeps working exactly as before, with no external service needed.
 */
export interface Store {
  readonly kind: "sqlite" | "postgres";

  /** Create tables if they don't exist; called once before the server listens. */
  init(): Promise<void>;

  // businesses
  createBusiness(input: { name: string; ownerName: string; email: string; passwordHash: string }): Promise<BusinessRow>;
  getBusinessById(id: string): Promise<BusinessRow | undefined>;
  getBusinessBySlug(slug: string): Promise<BusinessRow | undefined>;
  getBusinessByEmail(email: string): Promise<BusinessRow | undefined>;
  updateBusinessPaused(id: string, paused: boolean): Promise<void>;
  updateBusinessProfile(id: string, name: string, customerNote: string): Promise<void>;

  // sessions
  createSession(businessId: string, tokenHash: string, now: number, expiresAt: number): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  businessForToken(tokenHash: string, now: number): Promise<BusinessRow | null>;
  pruneSessions(now: number): Promise<void>;

  // tickets
  createTicket(businessId: string, name: string): Promise<TicketRow>;
  getTicket(id: string, businessId: string): Promise<TicketRow | undefined>;
  listTickets(businessId: string, day: string): Promise<TicketRow[]>;
  currentNumber(businessId: string): Promise<number | null>;
  waitingCount(businessId: string): Promise<number>;
  peopleAhead(ticket: TicketRow): Promise<number>;
  setTicketConfirmed(id: string, now: number): Promise<void>;
  deleteTicket(id: string): Promise<void>;
  setTicketStatus(id: string, businessId: string, status: TicketStatus, now: number): Promise<void>;
  callNext(businessId: string): Promise<string | null>;
}

class SqliteStore implements Store {
  readonly kind = "sqlite" as const;
  readonly db: Database.Database;

  // The SQLite schema is created in the constructor, so init is a no-op.
  init(): Promise<void> {
    return Promise.resolve();
  }

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    this.db.exec(`
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
  }

  // ------------------------------------------------------------- businesses

  createBusiness(input: { name: string; ownerName: string; email: string; passwordHash: string }): Promise<BusinessRow> {
    const id = newId();
    const base = slugify(input.name);
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT INTO businesses (id, slug, name, owner_name, email, password_hash, customer_note, paused, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '', 0, ?)`
    );

    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${newId().slice(0, 4)}`;
      try {
        insert.run(id, slug, input.name, input.ownerName, input.email, input.passwordHash, now);
        return Promise.resolve(this.db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) as BusinessRow);
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : "";
        // Another shop may already own this slug, so retry with a suffix.
        if (message.includes("UNIQUE constraint failed") && message.includes("slug")) continue;
        return Promise.reject(err);
      }
    }
    return Promise.reject(lastError instanceof Error ? lastError : new Error("Could not create the business."));
  }

  getBusinessById(id: string): Promise<BusinessRow | undefined> {
    return Promise.resolve(this.db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) as BusinessRow | undefined);
  }

  getBusinessBySlug(slug: string): Promise<BusinessRow | undefined> {
    return Promise.resolve(this.db.prepare("SELECT * FROM businesses WHERE slug = ?").get(slug) as BusinessRow | undefined);
  }

  getBusinessByEmail(email: string): Promise<BusinessRow | undefined> {
    return Promise.resolve(this.db.prepare("SELECT * FROM businesses WHERE email = ?").get(email) as BusinessRow | undefined);
  }

  updateBusinessPaused(id: string, paused: boolean): Promise<void> {
    this.db.prepare("UPDATE businesses SET paused = ? WHERE id = ?").run(paused ? 1 : 0, id);
    return Promise.resolve();
  }

  updateBusinessProfile(id: string, name: string, customerNote: string): Promise<void> {
    this.db.prepare("UPDATE businesses SET name = ?, customer_note = ? WHERE id = ?").run(name, customerNote, id);
    return Promise.resolve();
  }

  // --------------------------------------------------------------- sessions

  createSession(businessId: string, tokenHash: string, now: number, expiresAt: number): Promise<void> {
    this.db
      .prepare("INSERT INTO sessions (token_hash, business_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash, businessId, now, expiresAt);
    return Promise.resolve();
  }

  deleteSession(tokenHash: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return Promise.resolve();
  }

  businessForToken(tokenHash: string, now: number): Promise<BusinessRow | null> {
    const row = this.db
      .prepare(
        `SELECT b.* FROM sessions s JOIN businesses b ON b.id = s.business_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(tokenHash, now) as BusinessRow | undefined;
    return Promise.resolve(row ?? null);
  }

  pruneSessions(now: number): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
    return Promise.resolve();
  }

  // ---------------------------------------------------------------- tickets

  createTicket(businessId: string, name: string): Promise<TicketRow> {
    const id = newId();
    const now = Date.now();
    const day = today();

    this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(number), 0) AS n FROM tickets WHERE business_id = ? AND day = ?")
        .get(businessId, day) as { n: number };
      this.db
        .prepare(
          `INSERT INTO tickets (id, business_id, day, number, name, status, confirmed, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'waiting', 0, ?, ?)`
        )
        .run(id, businessId, day, row.n + 1, name, now, now);
    })();

    return Promise.resolve(this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as TicketRow);
  }

  getTicket(id: string, businessId: string): Promise<TicketRow | undefined> {
    return Promise.resolve(
      this.db.prepare("SELECT * FROM tickets WHERE id = ? AND business_id = ?").get(id, businessId) as TicketRow | undefined
    );
  }

  listTickets(businessId: string, day: string): Promise<TicketRow[]> {
    return Promise.resolve(
      this.db
        .prepare(
          `SELECT * FROM tickets
           WHERE business_id = ? AND (day = ? OR status IN ('waiting', 'called'))
           ORDER BY day ASC, number ASC`
        )
        .all(businessId, day) as TicketRow[]
    );
  }

  currentNumber(businessId: string): Promise<number | null> {
    const row = this.db
      .prepare("SELECT number FROM tickets WHERE business_id = ? AND status = 'called' ORDER BY updated_at DESC LIMIT 1")
      .get(businessId) as { number: number } | undefined;
    return Promise.resolve(row ? row.number : null);
  }

  waitingCount(businessId: string): Promise<number> {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM tickets WHERE business_id = ? AND status = 'waiting'")
      .get(businessId) as { n: number };
    return Promise.resolve(row.n);
  }

  peopleAhead(ticket: TicketRow): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM tickets
         WHERE business_id = ? AND day = ? AND status = 'waiting' AND number < ?`
      )
      .get(ticket.business_id, ticket.day, ticket.number) as { n: number };
    return Promise.resolve(row.n);
  }

  setTicketConfirmed(id: string, now: number): Promise<void> {
    this.db.prepare("UPDATE tickets SET confirmed = 1, updated_at = ? WHERE id = ?").run(now, id);
    return Promise.resolve();
  }

  deleteTicket(id: string): Promise<void> {
    this.db.prepare("DELETE FROM tickets WHERE id = ?").run(id);
    return Promise.resolve();
  }

  setTicketStatus(id: string, businessId: string, status: TicketStatus, now: number): Promise<void> {
    this.db
      .prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?")
      .run(status, now, id, businessId);
    return Promise.resolve();
  }

  callNext(businessId: string): Promise<string | null> {
    const now = Date.now();
    const calledId = this.db.transaction(() => {
      const current = this.db
        .prepare("SELECT id FROM tickets WHERE business_id = ? AND status = 'called'")
        .get(businessId) as { id: string } | undefined;
      if (current) {
        this.db.prepare("UPDATE tickets SET status = 'served', updated_at = ? WHERE id = ?").run(now, current.id);
      }

      const next = this.db
        .prepare(
          "SELECT id FROM tickets WHERE business_id = ? AND status = 'waiting' ORDER BY day ASC, number ASC LIMIT 1"
        )
        .get(businessId) as { id: string } | undefined;
      if (!next) return null;

      this.db.prepare("UPDATE tickets SET status = 'called', updated_at = ? WHERE id = ?").run(now, next.id);
      return next.id;
    })();

    return Promise.resolve(calledId);
  }
}

export const DATABASE_URL = process.env.DATABASE_URL || "";

export const store: Store = DATABASE_URL
  ? new PgStore(DATABASE_URL)
  : new SqliteStore(process.env.DATABASE_PATH || path.join(process.cwd(), "data", "lobby.db"));

export const usingPostgres = store.kind === "postgres";
