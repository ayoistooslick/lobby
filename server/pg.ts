import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { newId, slugify, today, type BusinessRow, type TicketRow, type TicketStatus } from "./rows";

export type { BusinessRow, TicketRow, TicketStatus } from "./rows";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    customer_note TEXT NOT NULL DEFAULT '',
    paused INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    number INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'waiting',
    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE (business_id, day, number)
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_business_status ON tickets(business_id, status);

  -- Case-insensitive email matching without needing COLLATE NOCASE.
  CREATE INDEX IF NOT EXISTS idx_businesses_email_lower ON businesses(lower(email));
`;

const SELECT_BUSINESS = `SELECT id, slug, name, owner_name, email, password_hash, customer_note, paused, created_at FROM businesses`;
const SELECT_TICKET = `SELECT id, business_id, day, number, name, status, confirmed, created_at, updated_at FROM tickets`;

export class PgStore {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    // pg v8.17+ reads sslmode straight from the URL and treats "require" as
    // verify-full, which fails on managed providers that self-sign their certs.
    // Strip it out and drive TLS from one place instead.
    const wantsTls = /[?&]sslmode=(require|verify-ca|prefer)/.test(databaseUrl) || process.env.PGSSL === "require";
    const cleanUrl = databaseUrl.replace(/([?&])sslmode=[^&]*/g, "$1").replace(/\?&/, "?").replace(/[?&]$/, "");
    this.pool = new Pool({
      connectionString: cleanUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Managed providers (Timescale, Render, Neon) need TLS but often self-sign.
      ssl: wantsTls ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(SCHEMA);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection may already be broken; the caller still gets the error.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------- businesses

  async createBusiness(input: {
    name: string;
    ownerName: string;
    email: string;
    passwordHash: string;
  }): Promise<BusinessRow> {
    const id = newId();
    const base = slugify(input.name);
    const now = Date.now();

    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${crypto.randomBytes(2).toString("hex")}`;
      try {
        await this.pool.query(
          `INSERT INTO businesses (id, slug, name, owner_name, email, password_hash, customer_note, paused, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, '', 0, $7)`,
          [id, slug, input.name, input.ownerName, input.email.toLowerCase(), input.passwordHash, now]
        );
        const row = await this.pool.query(`${SELECT_BUSINESS} WHERE id = $1`, [id]);
        return row.rows[0] as BusinessRow;
      } catch (err) {
        lastError = err;
        const code = (err as { code?: string }).code;
        const constraint = (err as { constraint?: string }).constraint ?? "";
        // 23505 = unique_violation. Only a taken slug is retried with a suffix;
        // a taken email must surface as "account already exists" upstream.
        if (code === "23505" && constraint.includes("slug")) continue;
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Could not create the business.");
  }

  async getBusinessById(id: string): Promise<BusinessRow | undefined> {
    const row = await this.pool.query(`${SELECT_BUSINESS} WHERE id = $1`, [id]);
    return (row.rows[0] as BusinessRow | undefined) ?? undefined;
  }

  async getBusinessBySlug(slug: string): Promise<BusinessRow | undefined> {
    const row = await this.pool.query(`${SELECT_BUSINESS} WHERE slug = $1`, [slug]);
    return (row.rows[0] as BusinessRow | undefined) ?? undefined;
  }

  async getBusinessByEmail(emailAddress: string): Promise<BusinessRow | undefined> {
    // Emails are stored lowercased; match case-insensitively like SQLite's COLLATE NOCASE.
    const row = await this.pool.query(`${SELECT_BUSINESS} WHERE lower(email) = lower($1)`, [emailAddress]);
    return (row.rows[0] as BusinessRow | undefined) ?? undefined;
  }

  async updateBusinessPaused(id: string, paused: boolean): Promise<void> {
    await this.pool.query("UPDATE businesses SET paused = $1 WHERE id = $2", [paused ? 1 : 0, id]);
  }

  async updateBusinessProfile(id: string, name: string, customerNote: string): Promise<void> {
    await this.pool.query("UPDATE businesses SET name = $1, customer_note = $2 WHERE id = $3", [
      name,
      customerNote,
      id,
    ]);
  }

  // --------------------------------------------------------------- sessions

  async createSession(businessId: string, tokenHash: string, now: number, expiresAt: number): Promise<void> {
    await this.pool.query(
      "INSERT INTO sessions (token_hash, business_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
      [tokenHash, businessId, now, expiresAt]
    );
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async businessForToken(tokenHash: string, now: number): Promise<BusinessRow | null> {
    const row = await this.pool.query(
      `SELECT b.id, b.slug, b.name, b.owner_name, b.email, b.password_hash, b.customer_note, b.paused, b.created_at
       FROM sessions s JOIN businesses b ON b.id = s.business_id
       WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [tokenHash, now]
    );
    return (row.rows[0] as BusinessRow | undefined) ?? null;
  }

  async pruneSessions(now: number): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE expires_at < $1", [now]);
  }

  // ---------------------------------------------------------------- tickets

  async createTicket(businessId: string, name: string): Promise<TicketRow> {
    const id = newId();
    const now = Date.now();
    const day = today();

    // The number is allocated inside the transaction with a row lock on the
    // business, so two phones joining at the same instant can't draw a tie.
    return this.tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
      const maxRow = await client.query(
        "SELECT COALESCE(MAX(number), 0) AS n FROM tickets WHERE business_id = $1 AND day = $2",
        [businessId, day]
      );
      const next = Number(maxRow.rows[0].n) + 1;
      await client.query(
        `INSERT INTO tickets (id, business_id, day, number, name, status, confirmed, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'waiting', 0, $6, $6)`,
        [id, businessId, day, next, name, now]
      );
      const created = await client.query(`${SELECT_TICKET} WHERE id = $1`, [id]);
      return created.rows[0] as TicketRow;
    });
  }

  async getTicket(id: string, businessId: string): Promise<TicketRow | undefined> {
    const row = await this.pool.query(`${SELECT_TICKET} WHERE id = $1 AND business_id = $2`, [id, businessId]);
    return (row.rows[0] as TicketRow | undefined) ?? undefined;
  }

  async listTickets(businessId: string, day: string): Promise<TicketRow[]> {
    const row = await this.pool.query(
      `SELECT id, business_id, day, number, name, status, confirmed, created_at, updated_at FROM tickets
       WHERE business_id = $1 AND (day = $2 OR status IN ('waiting', 'called'))
       ORDER BY day ASC, number ASC`,
      [businessId, day]
    );
    return row.rows as TicketRow[];
  }

  async currentNumber(businessId: string): Promise<number | null> {
    const row = await this.pool.query(
      "SELECT number FROM tickets WHERE business_id = $1 AND status = 'called' ORDER BY updated_at DESC LIMIT 1",
      [businessId]
    );
    return row.rows.length ? Number(row.rows[0].number) : null;
  }

  async waitingCount(businessId: string): Promise<number> {
    const row = await this.pool.query(
      "SELECT COUNT(*) AS n FROM tickets WHERE business_id = $1 AND status = 'waiting'",
      [businessId]
    );
    return Number(row.rows[0].n);
  }

  async peopleAhead(ticket: TicketRow): Promise<number> {
    const row = await this.pool.query(
      `SELECT COUNT(*) AS n FROM tickets
       WHERE business_id = $1 AND day = $2 AND status = 'waiting' AND number < $3`,
      [ticket.business_id, ticket.day, ticket.number]
    );
    return Number(row.rows[0].n);
  }

  async setTicketConfirmed(id: string, now: number): Promise<void> {
    await this.pool.query("UPDATE tickets SET confirmed = 1, updated_at = $1 WHERE id = $2", [now, id]);
  }

  async deleteTicket(id: string): Promise<void> {
    await this.pool.query("DELETE FROM tickets WHERE id = $1", [id]);
  }

  async setTicketStatus(id: string, businessId: string, status: TicketStatus, now: number): Promise<void> {
    await this.pool.query("UPDATE tickets SET status = $1, updated_at = $2 WHERE id = $3 AND business_id = $4", [
      status,
      now,
      id,
      businessId,
    ]);
  }

  async callNext(businessId: string): Promise<string | null> {
    const now = Date.now();
    return this.tx(async (client) => {
      const current = await client.query(
        "SELECT id FROM tickets WHERE business_id = $1 AND status = 'called' LIMIT 1",
        [businessId]
      );
      if (current.rows.length) {
        await client.query("UPDATE tickets SET status = 'served', updated_at = $1 WHERE id = $2", [
          now,
          current.rows[0].id,
        ]);
      }

      // Lock the waiting rows so two staff taps can't promote the same ticket.
      const next = await client.query(
        `SELECT id FROM tickets WHERE business_id = $1 AND status = 'waiting'
         ORDER BY day ASC, number ASC LIMIT 1 FOR UPDATE`,
        [businessId]
      );
      if (!next.rows.length) return null;

      await client.query("UPDATE tickets SET status = 'called', updated_at = $1 WHERE id = $2", [
        now,
        next.rows[0].id,
      ]);
      return next.rows[0].id as string;
    });
  }

  // Seed/demo helper: number of businesses, used by the smoke tests.
  async countBusinesses(): Promise<number> {
    const row = await this.pool.query("SELECT COUNT(*) AS n FROM businesses");
    return Number(row.rows[0].n);
  }
}

// Convenience for callers that want the filesystem fallback metadata.
export function defaultSqlitePath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "lobby.db");
}

export function ensureSqliteDir(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}
