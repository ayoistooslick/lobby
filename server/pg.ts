import { Pool, types, type PoolClient } from "pg";
import type { SqlDriver } from "./sql";

// int8/bigint arrive as strings by default. Every counter here fits a double.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

export class PgDriver implements SqlDriver {
  readonly kind = "postgres" as const;
  readonly canAlterConstraints = true;
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    // pg v8.17+ reads sslmode straight from the URL and treats "require" as
    // verify-full, which fails on managed providers that self-sign their certs.
    // Strip it out and drive TLS from one place instead.
    const wantsTls = /[?&]sslmode=(require|verify-ca|prefer)/.test(databaseUrl) || process.env.PGSSL === "require";
    const cleanUrl = databaseUrl.replace(/([?&])sslmode=[^&]*/g, "$1").replace(/\?&/, "?").replace(/[?&]$/, "");
    this.pool = new Pool({
      connectionString: cleanUrl,
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Managed providers (Timescale, Render, Neon) need TLS but often self-sign.
      ssl: wantsTls ? { rejectUnauthorized: false } : undefined,
    });
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params as never[]);
    return result.rows as T[];
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.pool.query(sql, params as never[]);
    return (result.rows[0] as T | undefined) ?? undefined;
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(sql, params as never[]);
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async tx<T>(key: string | null, fn: (scoped: SqlDriver) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    // Everything inside the transaction must run on this client. Going through
    // the pool would put the writes on other connections, where neither the
    // BEGIN below nor the advisory lock would protect them.
    const scoped: SqlDriver = {
      kind: "postgres",
      canAlterConstraints: false,
      all: async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params as never[])).rows as T[],
      get: async <T>(sql: string, params: unknown[] = []) =>
        ((await client.query(sql, params as never[])).rows[0] as T | undefined) ?? undefined,
      run: async (sql, params = []) => {
        await client.query(sql, params as never[]);
      },
      exec: async (sql) => {
        await client.query(sql);
      },
      tx: <U>(_nestedKey: string | null, inner: (nested: SqlDriver) => Promise<U>) => inner(scoped),
      close: async () => {},
      hasTable: async () => false,
      tableColumns: async () => [],
    };
    try {
      await client.query("BEGIN");
      if (key) {
        // Serialises ticket numbering and queue calls for one key at a time.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      }
      const result = await fn(scoped);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection may already be broken. The caller still gets the error.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async tableColumns(table: string): Promise<string[]> {
    const rows = await this.all<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
      [table]
    );
    return rows.map((row) => row.column_name);
  }

  async hasTable(table: string): Promise<boolean> {
    const row = await this.get<{ present: boolean }>(
      "SELECT TRUE AS present FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
      [table]
    );
    return Boolean(row);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
