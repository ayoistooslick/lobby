/**
 * One storage contract for the whole app. Queries are written once in Postgres
 * style ($1, $2) and translated to SQLite placeholders by the driver, so the
 * two backends can never drift apart.
 */
export interface SqlDriver {
  readonly kind: "sqlite" | "postgres";
  /** SQLite keeps unique constraints inside the table, so legacy files are rebuilt. */
  readonly canAlterConstraints: boolean;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
  /** Multi-statement DDL, used once at boot to create the schema. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` inside a write transaction with `key` held exclusively. Every
   *  query inside must go through the scoped driver it is handed, or the
   *  transaction (and its lock) would not actually cover the writes. */
  tx<T>(key: string | null, fn: (scoped: SqlDriver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  hasTable(table: string): Promise<boolean>;
  tableColumns(table: string): Promise<string[]>;
}

/** Postgres placeholders -> SQLite placeholders. */
export function toSqliteSql(sql: string): string {
  return sql.replace(/\$\d+/g, "?");
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  customer_note TEXT NOT NULL DEFAULT '',
  brand_color TEXT NOT NULL DEFAULT '',
  brand_accent TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  logo_data TEXT NOT NULL DEFAULT '',
  paused INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  paused INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT 'A',
  description TEXT NOT NULL DEFAULT '',
  avg_minutes INTEGER NOT NULL DEFAULT 5,
  paused INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  open_from TEXT NOT NULL DEFAULT '',
  open_to TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff',
  password_hash TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff',
  branch_id TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  accepted_at BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL DEFAULT 0,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL DEFAULT '',
  service_id TEXT NOT NULL DEFAULT '',
  counter_id TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  number INTEGER NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting',
  confirmed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'qr',
  device_token TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  skip_count INTEGER NOT NULL DEFAULT 0,
  moved_from TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  called_at BIGINT NOT NULL DEFAULT 0,
  served_at BIGINT NOT NULL DEFAULT 0,
  closed_at BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL DEFAULT '',
  service_id TEXT NOT NULL DEFAULT '',
  ticket_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_branches_slug ON branches(business_id, slug);
CREATE INDEX IF NOT EXISTS idx_services_branch ON services(branch_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_services_business ON services(business_id);
CREATE INDEX IF NOT EXISTS idx_counters_service ON counters(service_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_counters_branch ON counters(branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_business ON staff(business_id);
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff(lower(email));
CREATE INDEX IF NOT EXISTS idx_invites_business ON invites(business_id);
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(service_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_branch ON tickets(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_business ON tickets(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id, at);
CREATE INDEX IF NOT EXISTS idx_ticket_events_business ON ticket_events(business_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_business ON audit_log(business_id, at);

-- One account per email, even when capitalisation differs. On databases that
-- already hold duplicates this line is skipped and the duplicates merged at boot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_email_unique ON businesses(lower(email));
`;
