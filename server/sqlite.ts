import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { toSqliteSql, type SqlDriver } from "./sql";
/**
 * Postgres happily reuses a `$1`, SQLite has one `?` per occurrence. Every
 * query in the store therefore lists each placeholder exactly once, and this
 * guard turns a mistake into a clear error instead of a confusing crash.
 */
function prepare(sql: string, params: unknown[]): string {
  const text = toSqliteSql(sql);
  const expected = (text.match(/\?/g) ?? []).length;
  if (expected !== params.length) {
    throw new Error(
      `SQL placeholder mismatch: statement has ${expected} but ${params.length} values were given.`
    );
  }
  return text;
}

/**
 * SQLite fallback: no external service, same file-based behaviour as the
 * original release. Writes go through better-sqlite3's own transactions and
 * BEGIN IMMEDIATE keeps concurrent writers honest.
 */
export class SqliteDriver implements SqlDriver {
  readonly kind = "sqlite" as const;
  readonly canAlterConstraints = false;
  private readonly db: Database.Database;
  private lock: Promise<void> = Promise.resolve();
  private inTx = false;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(prepare(sql, params)).all(...(params as never[])) as T[];
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(prepare(sql, params)).get(...(params as never[])) as T | undefined;
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(prepare(sql, params)).run(...(params as never[]));
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async tx<T>(_key: string | null, fn: (scoped: SqlDriver) => Promise<T>): Promise<T> {
    // better-sqlite3 refuses to wrap a promise, so the transaction is opened by
    // hand. A single-slot mutex plus BEGIN IMMEDIATE gives the same guarantee:
    // one writer at a time, rolled back whole on error.
    if (this.inTx) return fn(this);
    const run = this.lock.then(async () => {
      this.inTx = true;
      this.db.prepare("BEGIN IMMEDIATE").run();
      try {
        const value = await fn(this);
        this.db.prepare("COMMIT").run();
        return value;
      } catch (err) {
        try {
          this.db.prepare("ROLLBACK").run();
        } catch {
          // Nothing to roll back if the transaction never opened.
        }
        throw err;
      } finally {
        this.inTx = false;
      }
    });
    this.lock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async tableColumns(table: string): Promise<string[]> {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  async hasTable(table: string): Promise<boolean> {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { name?: string } | undefined;
    return Boolean(row?.name);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
