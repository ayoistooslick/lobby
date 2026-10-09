import path from "node:path";
import { PgDriver } from "./pg";
import { SqliteDriver } from "./sqlite";
import { SCHEMA, type SqlDriver } from "./sql";
import {
  dayKey,
  minutesBetween,
  newId,
  slugify,
  type AuditRow,
  type BranchRow,
  type BusinessRow,
  type Capability,
  type CounterRow,
  type EventRow,
  type InviteRow,
  type ServiceRow,
  type StaffRole,
  type StaffRow,
  type TicketRow,
  type TicketStatus,
} from "./rows";
import { can } from "./permissions";

const BUSINESS_COLUMNS =
  "id, slug, name, owner_name, email, password_hash, customer_note, brand_color, brand_accent, logo_url, logo_data, paused, created_at";
const BRANCH_COLUMNS =
  "id, business_id, slug, name, address, phone, note, paused, sort_order, created_at";
const SERVICE_COLUMNS =
  "id, business_id, branch_id, slug, name, prefix, description, avg_minutes, paused, sort_order, open_from, open_to, created_at";
const COUNTER_COLUMNS =
  "id, business_id, branch_id, service_id, name, paused, sort_order, created_at";
const STAFF_COLUMNS =
  "id, business_id, email, name, role, password_hash, branch_id, active, created_at";
const INVITE_COLUMNS =
  "id, business_id, email, name, role, branch_id, token_hash, created_by, created_at, expires_at, accepted_at";
const TICKET_COLUMNS =
  "id, business_id, branch_id, service_id, counter_id, day, number, prefix, name, phone, status, confirmed, source, device_token, note, skip_count, moved_from, created_at, updated_at, called_at, served_at, closed_at";

export type QueueAction =
  | "call"
  | "serve"
  | "complete"
  | "skip"
  | "no_show"
  | "hold"
  | "release"
  | "cancel"
  | "recall";

export interface QueueSnapshot {
  service: ServiceRow;
  branch: BranchRow;
  business: BusinessRow;
  counters: CounterRow[];
  waiting: TicketRow[];
  called: TicketRow[];
  held: TicketRow[];
  finished: TicketRow[];
  nowServing: TicketRow | null;
  waitingCount: number;
  averageWaitMinutes: number;
  servingCounters: number;
  estimatedWaitMinutes: number;
}

export interface ServiceSummary {
  service: ServiceRow;
  waiting: number;
  called: number;
  nowServing: TicketRow | null;
  counters: number;
  averageWaitMinutes: number;
}

export interface HistoryRow {
  ticket: TicketRow;
  waitMinutes: number;
  serviceMinutes: number;
}

export interface AnalyticsReport {
  range: { from: string; to: string };
  totals: {
    joined: number;
    served: number;
    skipped: number;
    noShow: number;
    abandoned: number;
    waiting: number;
    averageWaitMinutes: number;
    averageServiceMinutes: number;
    busiestHour: number | null;
  };
  daily: Array<{ day: string; joined: number; served: number; averageWaitMinutes: number }>;
  hours: Array<{ hour: number; joined: number; served: number }>;
  services: Array<{ serviceId: string; name: string; joined: number; served: number; averageWaitMinutes: number }>;
}

const LEGACY_TABLES = ["businesses", "sessions", "tickets"] as const;

/**
 * Every query the app runs, written once. `SqlDriver` hides whether it is
 * talking to Postgres or the SQLite fallback.
 */
export class SqlStore {
  readonly driver: SqlDriver;

  constructor(driver: SqlDriver) {
    this.driver = driver;
  }

  get kind(): "sqlite" | "postgres" {
    return this.driver.kind;
  }

  // ------------------------------------------------------------------ boot

  async init(): Promise<void> {
    const legacy = (await this.driver.hasTable("tickets")) && !(await this.driver.hasTable("branches"));
    if (legacy) await this.migrateLegacySchema();
    await this.repairSessions();
    if (await this.driver.hasTable("businesses")) await this.deduplicateEmails();
    await this.driver.exec(SCHEMA);
    await this.repairStaleTables();
    await this.backfillDefaults();
    await this.addTicketUniqueness();
  }

  /**
   * Sessions stopped belonging to a business when staff became a table of
   * their own. A database that already gained the multi-queue tables never
   * re-enters migrateLegacySchema(), so the old NOT NULL rule on
   * sessions.business_id, and any session column an old build is missing,
   * is brought up to date here on every boot.
   */
  private async repairSessions(): Promise<void> {
    if (!this.driver.canAlterConstraints) return; // SQLite tables are rebuilt by repairStaleTables().
    if (!(await this.driver.hasTable("sessions"))) return;
    const columns = new Set(await this.driver.tableColumns("sessions"));
    const additions: Record<string, string> = {
      ...LEGACY_COLUMNS.sessions,
      ...(columns.has("token_hash") ? {} : { token_hash: "TEXT NOT NULL DEFAULT ''" }),
    };
    for (const [column, type] of Object.entries(additions)) {
      if (!columns.has(column)) {
        await this.driver.run(`ALTER TABLE sessions ADD COLUMN ${column} ${type}`);
      }
    }
    if (!columns.has("business_id")) return;
    await this.driver.run("ALTER TABLE sessions ALTER COLUMN business_id DROP NOT NULL");
  }

  /**
   * Older builds let two shops share one email, and the unique index added
   * with this release would refuse to build over them. The oldest shop wins.
   */
  private async deduplicateEmails(): Promise<void> {
    await this.driver.run(
      `DELETE FROM businesses WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY created_at ASC, id ASC) AS rn
           FROM businesses
         ) ranked WHERE ranked.rn > 1
       )`
    );
  }

  /**
   * Databases created by an earlier build of the multi-queue schema can carry
   * uniqueness rules and columns this release no longer uses. Anything whose
   * shape does not match is rebuilt once, here, so the app always boots.
   */
  private async repairStaleTables(): Promise<void> {
    const stale: string[] = [];
    for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
      if (!(await this.driver.hasTable(table))) continue;
      const columns = new Set(await this.driver.tableColumns(table));
      if (expected.every((column) => columns.has(column))) continue;
      stale.push(table);
    }
    if (!stale.length) return;

    if (this.driver.canAlterConstraints) {
      for (const table of stale) await this.addMissingColumns(table);
      return;
    }

    // SQLite cannot reshape a table in place, so each one is copied into a
    // freshly created table. Foreign keys stay off for the copy so no sibling
    // table is silently repointed at the temporary name.
    await this.driver.run("PRAGMA foreign_keys = OFF");
    try {
      for (const table of stale) await this.rebuildTable(table);
      await this.driver.exec(SCHEMA);
      // Tickets pointing at queues that were rebuilt away go back to the
      // default queue that backfillDefaults() hands out below.
      await this.driver.run(
        "UPDATE tickets SET branch_id = '', counter_id = '' WHERE branch_id <> '' AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = tickets.branch_id)"
      );
      await this.driver.run(
        "UPDATE tickets SET service_id = '' WHERE service_id <> '' AND NOT EXISTS (SELECT 1 FROM services s WHERE s.id = tickets.service_id)"
      );
    } finally {
      await this.driver.run("PRAGMA foreign_keys = ON");
    }
  }

  /** Copies the rows a table shares with its new definition, then drops the old one. */
  private async rebuildTable(table: string): Promise<void> {
    const before = await this.driver.tableColumns(table);
    const previous = `${table}_replaced_${Date.now()}`;
    await this.driver.run(`ALTER TABLE ${table} RENAME TO ${previous}`);
    await this.driver.exec(SCHEMA);
    const after = await this.driver.tableColumns(table);
    const shared = after.filter((column) => before.includes(column));
    if (shared.length) {
      const columns = shared.join(", ");
      await this.driver.run(
        `INSERT INTO ${table} (${columns}) SELECT ${columns} FROM ${previous}`
      );
    }
    await this.driver.run(`DROP TABLE ${previous}`);
  }

  /** Postgres adds what is missing in place, keeping every existing row. */
  private async addMissingColumns(table: string): Promise<void> {
    const additions = LEGACY_COLUMNS[table] ?? {};
    const existing = new Set(await this.driver.tableColumns(table));
    for (const [column, type] of Object.entries(additions)) {
      if (!existing.has(column)) {
        await this.driver.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    }
  }

  /**
   * Numbers restart daily per queue. The rule is added once the legacy rows
   * have been given a queue, otherwise the old per-business numbering clashes.
   */
  private async addTicketUniqueness(): Promise<void> {
    if (!this.driver.canAlterConstraints) return;
    try {
      await this.driver.run(
        "ALTER TABLE tickets ADD CONSTRAINT tickets_service_day_number_key UNIQUE (service_id, day, number)"
      );
    } catch (err) {
      // 42710/42P07: an earlier boot already added it.
      const code = (err as { code?: string }).code;
      if (code !== "42710" && code !== "42P07") throw err;
    }
  }

  /**
   * The first release stored one queue per business. Existing rows are kept:
   * Postgres gains columns, SQLite gets the old tables copied aside so the
   * per-service numbering can never trip the old uniqueness rule.
   */
  private async migrateLegacySchema(): Promise<void> {
    if (this.driver.canAlterConstraints) {
      for (const [table, additions] of Object.entries(LEGACY_COLUMNS)) {
        const existing = new Set(await this.driver.tableColumns(table));
        for (const [column, type] of Object.entries(additions)) {
          if (!existing.has(column)) {
            await this.driver.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
          }
        }
      }
      await this.driver.run("ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_business_id_day_number_key");
      // Old sessions were keyed by business. New ones key by staff member.
      await this.driver.run("ALTER TABLE sessions ALTER COLUMN business_id DROP NOT NULL");
      await this.driver.run("UPDATE tickets SET source = 'qr' WHERE source IS NULL OR source = ''");
      return;
    }

    const stamp = Date.now();
    const legacy: Record<string, string> = {};
    for (const table of LEGACY_TABLES) {
      if (await this.driver.hasTable(table)) {
        const as = `${table}_legacy_${stamp}`;
        await this.driver.run(`ALTER TABLE ${table} RENAME TO ${as}`);
        legacy[table] = as;
      }
    }

    await this.driver.exec(SCHEMA);
    const from = legacy.businesses;
    if (from) {
      await this.driver.run(
        `INSERT INTO businesses (${BUSINESS_COLUMNS})
         SELECT id, slug, name, owner_name, email, password_hash, customer_note, '', '', '', '', COALESCE(paused, 0), created_at FROM ${from}`
      );
    }
    const ticketsFrom = legacy.tickets;
    if (ticketsFrom) {
      // Queue history is kept. The branch and service columns stay empty here,
      // and backfillDefaults() points every row at the branch it creates below.
      await this.driver.run(
        `INSERT INTO tickets (${TICKET_COLUMNS})
         SELECT id, business_id, '', '', '', day, number, '', name, '', status, confirmed, 'qr', '', '', 0, '',
                created_at, updated_at, 0, 0, 0
         FROM ${ticketsFrom}`
      );
    }
  }

  /**
   * Makes sure every business has somewhere to put customers: one branch and
   * one queue at minimum, and every ticket pointing at a live queue.
   */
  private async backfillDefaults(): Promise<void> {
    const orphans = await this.driver.all<{ id: string; slug: string; name: string }>(
      `SELECT b.id, b.slug, b.name FROM businesses b
       WHERE NOT EXISTS (SELECT 1 FROM branches br WHERE br.business_id = b.id)`
    );
    for (const business of orphans) {
      await this.createBranch(business.id, { name: "Main branch" });
      await this.createService(business.id, (await this.listBranches(business.id))[0]!.id, {
        name: "Main queue",
        prefix: "A",
        description: "",
        avgMinutes: 5,
        counters: 1,
      });
    }

    // Businesses whose tickets lost their queue in a rebuild (empty ids above)
    // or that somehow have a branch with no queue at all.
    const unqueued = await this.driver.all<{ business_id: string }>(
      `SELECT DISTINCT business_id FROM tickets WHERE branch_id = '' OR service_id = ''
       UNION
       SELECT b.id FROM businesses b
       WHERE EXISTS (SELECT 1 FROM branches br WHERE br.business_id = b.id)
         AND NOT EXISTS (SELECT 1 FROM services s WHERE s.business_id = b.id)`
    );
    for (const { business_id: businessId } of unqueued) {
      const branch = (await this.listBranches(businessId))[0];
      if (!branch) continue;
      const existing = await this.listServices(branch.id);
      const service = existing[0] ?? (await this.createService(businessId, branch.id, {
        name: "Main queue",
        prefix: "A",
        description: "",
        avgMinutes: 5,
        counters: 1,
      }));
      await this.driver.run(
        "UPDATE tickets SET branch_id = $1, service_id = $2 WHERE business_id = $3 AND (branch_id = '' OR service_id = '')",
        [branch.id, service.id, businessId]
      );
    }

    // Labels copied from the queue so every number reads the same on screen.
    await this.driver.run(
      "UPDATE tickets SET prefix = (SELECT s.prefix FROM services s WHERE s.id = tickets.service_id) WHERE prefix = '' AND service_id <> ''"
    );

    const withoutOwner = await this.driver.all<{ id: string; email: string; owner_name: string }>(
      `SELECT b.id, b.email, b.owner_name FROM businesses b
       WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.business_id = b.id)`
    );
    for (const business of withoutOwner) {
      await this.driver.run(
        `INSERT INTO staff (id, business_id, email, name, role, password_hash, branch_id, active, created_at)
         SELECT $1, id, email, owner_name, 'owner', password_hash, '', 1, created_at FROM businesses WHERE id = $2`,
        [newId(), business.id]
      );
    }

    // Sessions from the old cookie flow cannot be mapped onto a staff row, so
    // anyone affected simply signs in again.
    await this.driver.run("DELETE FROM sessions WHERE staff_id IS NULL OR staff_id = ''");
  }

  // -------------------------------------------------------------- business

  async createBusiness(input: {
    name: string;
    ownerName: string;
    email: string;
    passwordHash: string;
    slug?: string;
  }): Promise<BusinessRow> {
    const id = newId();
    const base = input.slug ? slugify(input.slug) : slugify(input.name);
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${newId().slice(0, 4)}`;
      try {
        await this.driver.run(
          `INSERT INTO businesses (${BUSINESS_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, '', '', '', '', '', 0, $7)`,
          [id, slug, input.name, input.ownerName, input.email.toLowerCase(), input.passwordHash, Date.now()]
        );
        const row = await this.getBusinessById(id);
        if (row) return row;
      } catch (err) {
        lastError = err;
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Could not create the business.");
  }

  getBusinessById(id: string): Promise<BusinessRow | undefined> {
    return this.driver.get<BusinessRow>(`SELECT ${BUSINESS_COLUMNS} FROM businesses WHERE id = $1`, [id]);
  }

  getBusinessBySlug(slug: string): Promise<BusinessRow | undefined> {
    return this.driver.get<BusinessRow>(`SELECT ${BUSINESS_COLUMNS} FROM businesses WHERE slug = $1`, [slug]);
  }

  getBusinessByEmail(email: string): Promise<BusinessRow | undefined> {
    return this.driver.get<BusinessRow>(`SELECT ${BUSINESS_COLUMNS} FROM businesses WHERE lower(email) = lower($1)`, [
      email,
    ]);
  }

  async updateBusiness(id: string, patch: Partial<BusinessRow>): Promise<BusinessRow | undefined> {
    const fields: Record<string, unknown> = {
      name: patch.name,
      customer_note: patch.customer_note,
      brand_color: patch.brand_color,
      brand_accent: patch.brand_accent,
      logo_url: patch.logo_url,
      logo_data: patch.logo_data,
      paused: patch.paused === undefined ? undefined : patch.paused ? 1 : 0,
    };
    await this.applyPatch("businesses", "id", id, fields);
    return this.getBusinessById(id);
  }

  // --------------------------------------------------------------- branches

  async createBranch(
    businessId: string,
    input: { name: string; address?: string; phone?: string; note?: string }
  ): Promise<BranchRow> {
    const id = newId();
    const slug = await this.uniqueSlug("branches", businessId, slugify(input.name));
    const order = await this.nextSort("branches", "business_id", businessId);
    await this.driver.run(
      `INSERT INTO branches (${BRANCH_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)`,
      [id, businessId, slug, input.name, input.address ?? "", input.phone ?? "", input.note ?? "", order, Date.now()]
    );
    const row = await this.getBranch(id);
    if (!row) throw new Error("Could not create the branch.");
    return row;
  }

  getBranch(id: string): Promise<BranchRow | undefined> {
    return this.driver.get<BranchRow>(`SELECT ${BRANCH_COLUMNS} FROM branches WHERE id = $1`, [id]);
  }

  getBranchBySlug(businessId: string, slug: string): Promise<BranchRow | undefined> {
    return this.driver.get<BranchRow>(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE business_id = $1 AND slug = $2`,
      [businessId, slug]
    );
  }

  listBranches(businessId: string): Promise<BranchRow[]> {
    return this.driver.all<BranchRow>(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE business_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [businessId]
    );
  }

  async updateBranch(id: string, patch: Partial<BranchRow>): Promise<BranchRow | undefined> {
    await this.applyPatch("branches", "id", id, {
      name: patch.name,
      address: patch.address,
      phone: patch.phone,
      note: patch.note,
      paused: patch.paused === undefined ? undefined : patch.paused ? 1 : 0,
      sort_order: patch.sort_order,
    });
    return this.getBranch(id);
  }

  async deleteBranch(id: string): Promise<void> {
    const remaining = await this.driver.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM branches WHERE business_id = (SELECT business_id FROM branches WHERE id = $1)",
      [id]
    );
    if (Number(remaining?.n ?? 0) <= 1) throw new Error("A business needs at least one branch.");
    await this.driver.run("DELETE FROM branches WHERE id = $1", [id]);
  }

  // --------------------------------------------------------------- services

  async createService(
    businessId: string,
    branchId: string,
    input: {
      name: string;
      prefix?: string;
      description?: string;
      avgMinutes?: number;
      counters?: number;
      openFrom?: string;
      openTo?: string;
    }
  ): Promise<ServiceRow> {
    const id = newId();
    const slug = await this.uniqueSlug("services", branchId, slugify(input.name));
    const order = await this.nextSort("services", "branch_id", branchId);
    await this.driver.run(
      `INSERT INTO services (${SERVICE_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12)`,
      [
        id,
        businessId,
        branchId,
        slug,
        input.name,
        (input.prefix ?? "A").toUpperCase().slice(0, 2),
        input.description ?? "",
        input.avgMinutes ?? 5,
        order,
        input.openFrom ?? "",
        input.openTo ?? "",
        Date.now(),
      ]
    );
    const counters = Math.max(0, Math.min(8, Math.trunc(input.counters ?? 1)));
    for (let i = 0; i < counters; i++) {
      await this.createCounter(businessId, branchId, id, counters === 1 ? "Counter 1" : `Counter ${i + 1}`);
    }
    const row = await this.getService(id);
    if (!row) throw new Error("Could not create the service.");
    return row;
  }

  getService(id: string): Promise<ServiceRow | undefined> {
    return this.driver.get<ServiceRow>(`SELECT ${SERVICE_COLUMNS} FROM services WHERE id = $1`, [id]);
  }

  getServiceBySlug(branchId: string, slug: string): Promise<ServiceRow | undefined> {
    return this.driver.get<ServiceRow>(
      `SELECT ${SERVICE_COLUMNS} FROM services WHERE branch_id = $1 AND slug = $2`,
      [branchId, slug]
    );
  }

  listServices(branchId: string): Promise<ServiceRow[]> {
    return this.driver.all<ServiceRow>(
      `SELECT ${SERVICE_COLUMNS} FROM services WHERE branch_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [branchId]
    );
  }

  listServicesForBusiness(businessId: string): Promise<ServiceRow[]> {
    return this.driver.all<ServiceRow>(
      `SELECT ${SERVICE_COLUMNS} FROM services WHERE business_id = $1 ORDER BY branch_id ASC, sort_order ASC`,
      [businessId]
    );
  }

  async updateService(id: string, patch: Partial<ServiceRow>): Promise<ServiceRow | undefined> {
    await this.applyPatch("services", "id", id, {
      name: patch.name,
      prefix: patch.prefix,
      description: patch.description,
      avg_minutes: patch.avg_minutes,
      paused: patch.paused === undefined ? undefined : patch.paused ? 1 : 0,
      sort_order: patch.sort_order,
      open_from: patch.open_from,
      open_to: patch.open_to,
    });
    return this.getService(id);
  }

  async deleteService(id: string): Promise<void> {
    await this.driver.run("DELETE FROM services WHERE id = $1", [id]);
  }

  // --------------------------------------------------------------- counters

  async createCounter(
    businessId: string,
    branchId: string,
    serviceId: string,
    name: string
  ): Promise<CounterRow> {
    const id = newId();
    const order = await this.nextSort("counters", "service_id", serviceId);
    await this.driver.run(
      `INSERT INTO counters (${COUNTER_COLUMNS}) VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
      [id, businessId, branchId, serviceId, name, order, Date.now()]
    );
    const row = await this.getCounter(id);
    if (!row) throw new Error("Could not create the counter.");
    return row;
  }

  getCounter(id: string): Promise<CounterRow | undefined> {
    return this.driver.get<CounterRow>(`SELECT ${COUNTER_COLUMNS} FROM counters WHERE id = $1`, [id]);
  }

  listCounters(serviceId: string): Promise<CounterRow[]> {
    return this.driver.all<CounterRow>(
      `SELECT ${COUNTER_COLUMNS} FROM counters WHERE service_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [serviceId]
    );
  }

  listCountersForBranch(branchId: string): Promise<CounterRow[]> {
    return this.driver.all<CounterRow>(
      `SELECT ${COUNTER_COLUMNS} FROM counters WHERE branch_id = $1 ORDER BY service_id ASC, sort_order ASC`,
      [branchId]
    );
  }

  async updateCounter(id: string, patch: Partial<CounterRow>): Promise<CounterRow | undefined> {
    await this.applyPatch("counters", "id", id, {
      name: patch.name,
      paused: patch.paused === undefined ? undefined : patch.paused ? 1 : 0,
      sort_order: patch.sort_order,
    });
    return this.getCounter(id);
  }

  async deleteCounter(id: string): Promise<void> {
    await this.driver.run("DELETE FROM counters WHERE id = $1", [id]);
  }

  // ------------------------------------------------------------------ staff

  async createStaff(input: {
    businessId: string;
    email: string;
    name: string;
    role: StaffRole;
    passwordHash: string;
    branchId?: string;
  }): Promise<StaffRow> {
    const id = newId();
    await this.driver.run(
      `INSERT INTO staff (${STAFF_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)`,
      [
        id,
        input.businessId,
        input.email.toLowerCase(),
        input.name,
        input.role,
        input.passwordHash,
        input.branchId ?? "",
        Date.now(),
      ]
    );
    const row = await this.getStaff(id);
    if (!row) throw new Error("Could not create the staff account.");
    return row;
  }

  getStaff(id: string): Promise<StaffRow | undefined> {
    return this.driver.get<StaffRow>(`SELECT ${STAFF_COLUMNS} FROM staff WHERE id = $1`, [id]);
  }

  getStaffByEmail(email: string): Promise<StaffRow | undefined> {
    return this.driver.get<StaffRow>(`SELECT ${STAFF_COLUMNS} FROM staff WHERE lower(email) = lower($1) ORDER BY created_at ASC`, [
      email,
    ]);
  }

  /** The membership that matters: is this email already on this business's team. */
  getStaffInBusiness(email: string, businessId: string): Promise<StaffRow | undefined> {
    return this.driver.get<StaffRow>(
      `SELECT ${STAFF_COLUMNS} FROM staff WHERE lower(email) = lower($1) AND business_id = $2 ORDER BY created_at ASC`,
      [email, businessId]
    );
  }

  listStaff(businessId: string): Promise<StaffRow[]> {
    return this.driver.all<StaffRow>(
      `SELECT ${STAFF_COLUMNS} FROM staff WHERE business_id = $1 ORDER BY created_at ASC`,
      [businessId]
    );
  }

  async updateStaff(id: string, patch: Partial<StaffRow>): Promise<StaffRow | undefined> {
    await this.applyPatch("staff", "id", id, {
      name: patch.name,
      role: patch.role,
      branch_id: patch.branch_id,
      active: patch.active === undefined ? undefined : patch.active ? 1 : 0,
      password_hash: patch.password_hash,
    });
    return this.getStaff(id);
  }

  async deleteStaff(id: string): Promise<void> {
    await this.driver.run("DELETE FROM sessions WHERE staff_id = $1", [id]);
    await this.driver.run("DELETE FROM staff WHERE id = $1", [id]);
  }

  // ---------------------------------------------------------------- invites

  async createInvite(input: {
    businessId: string;
    email: string;
    name: string;
    role: StaffRole;
    branchId?: string;
    tokenHash: string;
    createdBy: string;
    expiresAt: number;
  }): Promise<InviteRow> {
    const id = newId();
    const now = Date.now();
    await this.driver.run(
      `INSERT INTO invites (${INVITE_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0)`,
      [
        id,
        input.businessId,
        input.email.toLowerCase(),
        input.name,
        input.role,
        input.branchId ?? "",
        input.tokenHash,
        input.createdBy,
        now,
        input.expiresAt,
      ]
    );
    const row = await this.getInvite(id);
    if (!row) throw new Error("Could not create the invitation.");
    return row;
  }

  getInvite(id: string): Promise<InviteRow | undefined> {
    return this.driver.get<InviteRow>(`SELECT ${INVITE_COLUMNS} FROM invites WHERE id = $1`, [id]);
  }

  getInviteByToken(tokenHash: string): Promise<InviteRow | undefined> {
    return this.driver.get<InviteRow>(`SELECT ${INVITE_COLUMNS} FROM invites WHERE token_hash = $1`, [
      tokenHash,
    ]);
  }

  listInvites(businessId: string): Promise<InviteRow[]> {
    return this.driver.all<InviteRow>(
      `SELECT ${INVITE_COLUMNS} FROM invites WHERE business_id = $1 ORDER BY created_at DESC`,
      [businessId]
    );
  }

  async acceptInvite(id: string): Promise<void> {
    await this.driver.run("UPDATE invites SET accepted_at = $1 WHERE id = $2", [Date.now(), id]);
  }

  async deleteInvite(id: string): Promise<void> {
    await this.driver.run("DELETE FROM invites WHERE id = $1", [id]);
  }

  // --------------------------------------------------------------- sessions

  async createSession(staffId: string, tokenHash: string, now: number, expiresAt: number, userAgent: string): Promise<void> {
    await this.driver.run(
      "INSERT INTO sessions (token_hash, staff_id, created_at, expires_at, last_seen_at, user_agent) VALUES ($1, $2, $3, $4, $5, $6)",
      [tokenHash, staffId, now, expiresAt, now, userAgent.slice(0, 200)]
    );
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.driver.run("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  deleteSessionsForStaff(staffId: string): Promise<void> {
    return this.driver.run("DELETE FROM sessions WHERE staff_id = $1", [staffId]);
  }

  async staffForToken(tokenHash: string, now: number): Promise<StaffRow | null> {
    const row = await this.driver.get<StaffRow>(
      `SELECT id, business_id, email, name, role, password_hash, branch_id, active, created_at
       FROM staff
       WHERE id = (SELECT staff_id FROM sessions WHERE token_hash = $1 AND expires_at > $2) AND active = 1`,
      [tokenHash, now]
    );
    return row ?? null;
  }

  pruneSessions(now: number): Promise<void> {
    return this.driver.run("DELETE FROM sessions WHERE expires_at < $1", [now]);
  }

  // ---------------------------------------------------------------- tickets

  /**
   * Numbers restart every day per service. The lock key keeps two phones
   * joining at the same instant from drawing the same number.
   */
  async createTicket(input: {
    businessId: string;
    branchId: string;
    serviceId: string;
    name: string;
    phone?: string;
    source?: string;
    deviceToken?: string;
    counterId?: string;
    note?: string;
  }): Promise<TicketRow> {
    const id = newId();
    const now = Date.now();
    const day = dayKey(now);
    const service = await this.getService(input.serviceId);
    return this.driver.tx(`ticket:${input.serviceId}:${day}`, async (tx) => {
      const maxRow = await tx.get<{ n: number }>(
        "SELECT COALESCE(MAX(number), 0) AS n FROM tickets WHERE service_id = $1 AND day = $2",
        [input.serviceId, day]
      );
      const number = Number(maxRow?.n ?? 0) + 1;
      await tx.run(
        `INSERT INTO tickets (${TICKET_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'waiting', 0, $11, $12, $13, 0, '', $14, $15, 0, 0, 0)`,
        [
          id,
          input.businessId,
          input.branchId,
          input.serviceId,
          input.counterId ?? "",
          day,
          number,
          service?.prefix ?? "A",
          input.name,
          input.phone ?? "",
          input.source ?? "qr",
          input.deviceToken ?? "",
          input.note ?? "",
          now,
          now,
        ]
      );
      await this.logEvent(
        {
          businessId: input.businessId,
          branchId: input.branchId,
          serviceId: input.serviceId,
          ticketId: id,
          type: "joined",
          actor: input.source === "desk" ? "staff" : "customer",
          detail: input.name,
          at: now,
        },
        tx
      );
      const row = await tx.get<TicketRow>(
        `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 AND business_id = $2`,
        [id, input.businessId]
      );
      if (!row) throw new Error("Could not create the ticket.");
      return row;
    });
  }

  /** Always takes the business first: a ticket id alone must never be enough. */
  getTicket(businessId: string, ticketId: string): Promise<TicketRow | undefined> {
    return this.driver.get<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 AND business_id = $2`,
      [ticketId, businessId]
    );
  }

  /** Stops a phone that refreshes, or double taps, from taking a second number. */
  findOpenTicketForDevice(serviceId: string, deviceToken: string): Promise<TicketRow | undefined> {
    if (!deviceToken) return Promise.resolve(undefined);
    return this.driver.get<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM tickets
       WHERE service_id = $1 AND device_token = $2 AND status IN ('waiting', 'called', 'on_hold')
       ORDER BY created_at DESC LIMIT 1`,
      [serviceId, deviceToken]
    );
  }

  async listQueue(businessId: string, branchId: string, serviceId: string): Promise<TicketRow[]> {
    return this.driver.all<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM tickets
       WHERE business_id = $1 AND branch_id = $2 AND service_id = $3
       ORDER BY created_at ASC, number ASC`,
      [businessId, branchId, serviceId]
    );
  }

  async listBranchTickets(businessId: string, branchId: string, limit = 200): Promise<TicketRow[]> {
    return this.driver.all<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM tickets
       WHERE business_id = $1 AND branch_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [businessId, branchId, limit]
    );
  }

  async peopleAhead(ticket: TicketRow): Promise<number> {
    const row = await this.driver.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tickets
       WHERE service_id = $1 AND status = 'waiting'
         AND (created_at < $2 OR (created_at = $3 AND number < $4))`,
      [ticket.service_id, ticket.created_at, ticket.created_at, ticket.number]
    );
    return Number(row?.n ?? 0);
  }

  /** Average minutes a served customer waited, over the last 30 completed jobs. */
  private async averageWait(serviceId: string): Promise<number> {
    const rows = await this.driver.all<{ created_at: number; called_at: number }>(
      `SELECT created_at, called_at FROM tickets
       WHERE service_id = $1 AND called_at > 0 AND created_at < called_at
       ORDER BY called_at DESC LIMIT 30`,
      [serviceId]
    );
    if (!rows.length) return 0;
    const total = rows.reduce((sum, row) => sum + minutesBetween(row.created_at, row.called_at), 0);
    return Math.round(total / rows.length);
  }

  async serviceSummaries(businessId: string, branchId: string): Promise<ServiceSummary[]> {
    const services = await this.listServices(branchId);
    const summaries: ServiceSummary[] = [];
    for (const service of services) {
      const tickets = await this.listQueue(businessId, branchId, service.id);
      const waiting = tickets.filter((ticket) => ticket.status === "waiting");
      const called = tickets.filter((ticket) => ticket.status === "called");
      const counters = await this.listCounters(service.id);
      summaries.push({
        service,
        waiting: waiting.length,
        called: called.length,
        nowServing: called.length ? called[called.length - 1] : null,
        counters: counters.filter((counter) => counter.paused !== 1).length || counters.length,
        averageWaitMinutes: await this.averageWait(service.id),
      });
    }
    return summaries;
  }

  async snapshot(businessId: string, branchId: string, serviceId: string): Promise<QueueSnapshot | null> {
    const business = await this.getBusinessById(businessId);
    const branch = await this.getBranch(branchId);
    const service = await this.getService(serviceId);
    if (!business || !branch || !service) return null;

    const tickets = await this.listQueue(businessId, branchId, serviceId);
    const waiting = tickets.filter((ticket) => ticket.status === "waiting");
    const called = tickets.filter((ticket) => ticket.status === "called");
    const held = tickets.filter((ticket) => ticket.status === "on_hold");
    const finished = tickets
      .filter((ticket) => !["waiting", "called", "on_hold"].includes(ticket.status))
      .slice(-30);
    const counters = await this.listCounters(serviceId);
    const averageWaitMinutes = await this.averageWait(serviceId);
    const servingCounters = Math.max(1, counters.filter((counter) => counter.paused !== 1).length || counters.length || 1);
    const nowServing = called.length ? called[called.length - 1] : null;
    const aheadForFirst = nowServing ? 1 : 0;
    const waitSamples = Math.max(1, Math.round(waiting.length / servingCounters));

    return {
      service,
      branch,
      business,
      counters,
      waiting,
      called,
      held,
      finished,
      nowServing,
      waitingCount: waiting.length,
      averageWaitMinutes,
      servingCounters,
      estimatedWaitMinutes:
        (averageWaitMinutes || service.avg_minutes) * (waitSamples + (aheadForFirst ? 1 : 0)),
    };
  }

  // ------------------------------------------------------------ queue moves

  /**
   * Every staff action on a ticket. The transaction plus the per-service lock
   * means two phones tapping at once can never double-serve a customer.
   */
  async actOnTicket(input: {
    businessId: string;
    ticketId: string;
    action: QueueAction;
    actor: string;
    counterId?: string;
    name?: string;
    note?: string;
    now?: number;
  }): Promise<TicketRow | null> {
    const now = input.now ?? Date.now();
    return this.driver.tx(`queue:${input.businessId}:${input.ticketId}`, async (tx) => {
      const ticket = (await tx.get<TicketRow>(
        `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 AND business_id = $2`,
        [input.ticketId, input.businessId]
      )) ?? null;
      if (!ticket) return null;
      const terminal = ["served", "no_show", "cancelled"];
      if (terminal.includes(ticket.status) && input.action !== "recall") return ticket;

      const set = async (fields: Record<string, unknown>) => {
        const keys = Object.keys(fields);
        const assignments = keys.map((key, index) => `${key} = $${index + 1}`).join(", ");
        await tx.run(
          `UPDATE tickets SET ${assignments}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`,
          [...keys.map((key) => fields[key]), now, input.ticketId]
        );
      };

      switch (input.action) {
        case "call":
        case "recall":
          await set({
            status: "called",
            called_at: now,
            closed_at: 0,
            served_at: 0,
            counter_id: input.counterId ?? ticket.counter_id,
          });
          break;
        case "serve":
        case "complete":
          await set({
            status: "served",
            called_at: ticket.called_at || now,
            served_at: ticket.served_at || now,
            closed_at: now,
            counter_id: input.counterId ?? ticket.counter_id,
          });
          break;
        case "no_show":
          await set({ status: "no_show", closed_at: now, counter_id: input.counterId ?? ticket.counter_id });
          break;
        case "cancel":
          await set({ status: "cancelled", closed_at: now });
          break;
        case "hold":
          await set({ status: "on_hold" });
          break;
        case "release":
          await set({ status: "waiting", called_at: 0 });
          break;
        case "skip":
          await set({
            status: "skipped",
            closed_at: now,
            skip_count: ticket.skip_count + 1,
            counter_id: input.counterId ?? ticket.counter_id,
          });
          break;
      }

      if (input.name) await set({ name: input.name });
      if (input.note !== undefined) await set({ note: input.note });

      await this.logEvent(
        {
          businessId: input.businessId,
          branchId: ticket.branch_id,
          serviceId: ticket.service_id,
          ticketId: ticket.id,
          type: input.action,
          actor: input.actor,
          detail: `#${ticket.number}`,
          at: now,
        },
        tx
      );
      const refreshed = (await tx.get<TicketRow>(
        `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 AND business_id = $2`,
        [input.ticketId, input.businessId]
      )) ?? null;
      return refreshed;
    });
  }

  /** Sends the waiting ticket at the head of the line to a counter. */
  async callNext(input: {
    businessId: string;
    branchId: string;
    serviceId: string;
    counterId?: string;
    actor: string;
  }): Promise<TicketRow | null> {
    const now = Date.now();
    return this.driver.tx(`queue:${input.businessId}:${input.serviceId}`, async (tx) => {
      // Whoever is at this counter finishes their job first.
      if (input.counterId) {
        let seated = await tx.get<{ id: string }>(
          "SELECT id FROM tickets WHERE service_id = $1 AND counter_id = $2 AND status = 'called' ORDER BY called_at DESC LIMIT 1",
          [input.serviceId, input.counterId]
        );
        // Nobody at that counter yet: finish whoever was called without one.
        if (!seated) {
          seated = await tx.get<{ id: string }>(
            "SELECT id FROM tickets WHERE service_id = $1 AND counter_id = '' AND status = 'called' ORDER BY called_at ASC LIMIT 1",
            [input.serviceId]
          );
        }
        if (seated) {
          await tx.run(
            `UPDATE tickets SET status = 'served', served_at = $1,
             called_at = CASE WHEN called_at = 0 THEN $2 ELSE called_at END,
             closed_at = $3, updated_at = $4
             WHERE id = $5`,
            [now, now, now, now, seated.id]
          );
          await this.logEvent(
            {
              businessId: input.businessId,
              branchId: input.branchId,
              serviceId: input.serviceId,
              ticketId: seated.id,
              type: "complete",
              actor: input.actor,
              detail: "Counter finished",
              at: now,
            },
            tx
          );
        }
      } else {
        const seated = await tx.get<{ id: string }>(
          "SELECT id FROM tickets WHERE service_id = $1 AND status = 'called' ORDER BY called_at DESC LIMIT 1",
          [input.serviceId]
        );
        if (seated) {
          await tx.run(
            `UPDATE tickets SET status = 'served', served_at = $1,
             called_at = CASE WHEN called_at = 0 THEN $2 ELSE called_at END,
             closed_at = $3, updated_at = $4
             WHERE id = $5`,
            [now, now, now, now, seated.id]
          );
        }
      }

      const next = await tx.get<{ id: string; number: number }>(
        `SELECT id, number FROM tickets WHERE service_id = $1 AND status = 'waiting'
         ORDER BY created_at ASC, number ASC LIMIT 1`,
        [input.serviceId]
      );
      if (!next) return null;

      await tx.run(
        "UPDATE tickets SET status = 'called', called_at = $1, counter_id = $2, updated_at = $3 WHERE id = $4",
        [now, input.counterId ?? "", now, next.id]
      );
      await this.logEvent(
        {
          businessId: input.businessId,
          branchId: input.branchId,
          serviceId: input.serviceId,
          ticketId: next.id,
          type: "call",
          actor: input.actor,
          detail: `#${next.number}`,
          at: now,
        },
        tx
      );
      return (await tx.get<TicketRow>(
        `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 AND business_id = $2`,
        [next.id, input.businessId]
      )) ?? null;
    });
  }

  /** Moves a customer to another queue, giving them a fresh number there. */
  async moveTicket(input: {
    businessId: string;
    ticketId: string;
    targetServiceId: string;
    targetCounterId?: string;
    actor: string;
  }): Promise<TicketRow | null> {
    const now = Date.now();
    const target = await this.getService(input.targetServiceId);
    if (!target || target.business_id !== input.businessId) return null;
    const original = await this.getTicket(input.businessId, input.ticketId);
    if (!original || terminal(original.status)) return null;

    const day = dayKey(now);
    return this.driver.tx(`ticket:${target.id}:${day}`, async (tx) => {
      const maxRow = await tx.get<{ n: number }>(
        "SELECT COALESCE(MAX(number), 0) AS n FROM tickets WHERE service_id = $1 AND day = $2",
        [target.id, day]
      );
      const number = Number(maxRow?.n ?? 0) + 1;
      await tx.run(
        `UPDATE tickets SET branch_id = $1, service_id = $2, counter_id = $3, day = $4, number = $5, prefix = $6,
         moved_from = $7, updated_at = $8, status = 'waiting', called_at = 0, served_at = 0, closed_at = 0
         WHERE id = $9 AND business_id = $10`,
        [
          target.branch_id,
          target.id,
          input.targetCounterId ?? "",
          day,
          number,
          target.prefix,
          original.service_id,
          now,
          input.ticketId,
          input.businessId,
        ]
      );
      await this.logEvent(
        {
          businessId: input.businessId,
          branchId: target.branch_id,
          serviceId: target.id,
          ticketId: input.ticketId,
          type: "move",
          actor: input.actor,
          detail: `${original.number} → ${number}`,
          at: now,
        },
        tx
      );
      return (await tx.get<TicketRow>(
        `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 AND business_id = $2`,
        [input.ticketId, input.businessId]
      )) ?? null;
    });
  }

  async confirmTicket(businessId: string, ticketId: string, confirmed: boolean): Promise<TicketRow | undefined> {
    const now = Date.now();
    await this.driver.run(
      "UPDATE tickets SET confirmed = $1, updated_at = $2 WHERE id = $3 AND business_id = $4",
      [confirmed ? 1 : 0, now, ticketId, businessId]
    );
    if (confirmed) {
      const ticket = await this.getTicket(businessId, ticketId);
      if (ticket) {
        await this.logEvent({
          businessId,
          branchId: ticket.branch_id,
          serviceId: ticket.service_id,
          ticketId,
          type: "confirmed",
          actor: "customer",
          detail: `#${ticket.number}`,
          at: now,
        });
      }
    }
    return this.getTicket(businessId, ticketId);
  }

  // --------------------------------------------------------------- history

  async listHistory(input: {
    businessId: string;
    branchId?: string;
    serviceId?: string;
    fromDay?: string;
    toDay?: string;
    limit?: number;
  }): Promise<HistoryRow[]> {
    const where: string[] = ["business_id = $1", "status NOT IN ('waiting', 'called', 'on_hold')"];
    const params: unknown[] = [input.businessId];
    if (input.branchId) {
      params.push(input.branchId);
      where.push(`branch_id = $${params.length}`);
    }
    if (input.serviceId) {
      params.push(input.serviceId);
      where.push(`service_id = $${params.length}`);
    }
    if (input.fromDay) {
      params.push(input.fromDay);
      where.push(`day >= $${params.length}`);
    }
    if (input.toDay) {
      params.push(input.toDay);
      where.push(`day <= $${params.length}`);
    }
    params.push(Math.min(500, Math.max(1, input.limit ?? 200)));
    const tickets = await this.driver.all<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM tickets WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC LIMIT $${params.length}`,
      params
    );
    return tickets.map((ticket) => ({
      ticket,
      waitMinutes: ticket.called_at ? minutesBetween(ticket.created_at, ticket.called_at) : 0,
      serviceMinutes:
        ticket.called_at && ticket.closed_at ? minutesBetween(ticket.called_at, ticket.closed_at) : 0,
    }));
  }

  async analytics(input: {
    businessId: string;
    branchId?: string;
    serviceId?: string;
    fromDay: string;
    toDay: string;
  }): Promise<AnalyticsReport> {
    const where: string[] = ["business_id = $1", "day >= $2", "day <= $3"];
    const params: unknown[] = [input.businessId, input.fromDay, input.toDay];
    if (input.branchId) {
      params.push(input.branchId);
      where.push(`branch_id = $${params.length}`);
    }
    if (input.serviceId) {
      params.push(input.serviceId);
      where.push(`service_id = $${params.length}`);
    }
    const rows = await this.driver.all<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM tickets WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 5000`,
      params
    );

    const served = rows.filter((row) => row.status === "served");
    const waitTimes = served
      .filter((row) => row.called_at > row.created_at)
      .map((row) => minutesBetween(row.created_at, row.called_at));
    const serviceTimes = served
      .filter((row) => row.closed_at > row.called_at)
      .map((row) => minutesBetween(row.called_at, row.closed_at));

    const dailyMap = new Map<string, { joined: number; served: number; waitTotal: number; waitCount: number }>();
    const hourMap = new Map<number, { joined: number; served: number }>();
    const serviceMap = new Map<string, { joined: number; served: number; waitTotal: number; waitCount: number }>();

    for (const row of rows) {
      const day = dailyMap.get(row.day) ?? { joined: 0, served: 0, waitTotal: 0, waitCount: 0 };
      day.joined += 1;
      if (row.status === "served") {
        day.served += 1;
        if (row.called_at > row.created_at) {
          day.waitTotal += minutesBetween(row.created_at, row.called_at);
          day.waitCount += 1;
        }
      }
      dailyMap.set(row.day, day);

      const joinHour = new Date(row.created_at).getHours();
      const hour = hourMap.get(joinHour) ?? { joined: 0, served: 0 };
      hour.joined += 1;
      if (row.status === "served") hour.served += 1;
      hourMap.set(joinHour, hour);

      const bucket = serviceMap.get(row.service_id) ?? { joined: 0, served: 0, waitTotal: 0, waitCount: 0 };
      bucket.joined += 1;
      if (row.status === "served") {
        bucket.served += 1;
        if (row.called_at > row.created_at) {
          bucket.waitTotal += minutesBetween(row.created_at, row.called_at);
          bucket.waitCount += 1;
        }
      }
      serviceMap.set(row.service_id, bucket);
    }

    const daily = [...dailyMap.entries()]
      .map(([day, value]) => ({
        day,
        joined: value.joined,
        served: value.served,
        averageWaitMinutes: value.waitCount ? Math.round(value.waitTotal / value.waitCount) : 0,
      }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));

    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      joined: hourMap.get(hour)?.joined ?? 0,
      served: hourMap.get(hour)?.served ?? 0,
    }));
    const busiest = hours.reduce<{ hour: number | null; joined: number }>(
      (best, entry) => (entry.joined > best.joined ? { hour: entry.hour, joined: entry.joined } : best),
      { hour: null, joined: 0 }
    );

    const services = await this.listServicesForBusiness(input.businessId);
    const names = new Map(services.map((service) => [service.id, service.name]));

    return {
      range: { from: input.fromDay, to: input.toDay },
      totals: {
        joined: rows.length,
        served: served.length,
        skipped: rows.filter((row) => row.status === "skipped").length,
        noShow: rows.filter((row) => row.status === "no_show").length,
        abandoned: rows.filter((row) => row.status === "cancelled").length,
        waiting: rows.filter((row) => ["waiting", "called", "on_hold"].includes(row.status)).length,
        averageWaitMinutes: waitTimes.length
          ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
          : 0,
        averageServiceMinutes: serviceTimes.length
          ? Math.round(serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length)
          : 0,
        busiestHour: busiest.joined > 0 ? busiest.hour : null,
      },
      daily,
      hours,
      services: [...serviceMap.entries()]
        .map(([serviceId, value]) => ({
          serviceId,
          name: names.get(serviceId) ?? "Queue",
          joined: value.joined,
          served: value.served,
          averageWaitMinutes: value.waitCount ? Math.round(value.waitTotal / value.waitCount) : 0,
        }))
        .sort((a, b) => b.joined - a.joined),
    };
  }

  // --------------------------------------------------------- events, audit

  async logEvent(
    input: {
      businessId: string;
      branchId: string;
      serviceId: string;
      ticketId: string;
      type: string;
      actor: string;
      detail?: string;
      at?: number;
    },
    driver: SqlDriver = this.driver
  ): Promise<void> {
    await driver.run(
      "INSERT INTO ticket_events (id, business_id, branch_id, service_id, ticket_id, type, actor, detail, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        newId(),
        input.businessId,
        input.branchId,
        input.serviceId,
        input.ticketId,
        input.type,
        input.actor,
        input.detail ?? "",
        input.at ?? Date.now(),
      ]
    );
  }

  async listEvents(input: { businessId: string; ticketId?: string; limit?: number }): Promise<EventRow[]> {
    if (input.ticketId) {
      return this.driver.all<EventRow>(
        "SELECT id, business_id, branch_id, service_id, ticket_id, type, actor, detail, at FROM ticket_events WHERE ticket_id = $1 ORDER BY at ASC",
        [input.ticketId]
      );
    }
    return this.driver.all<EventRow>(
      "SELECT id, business_id, branch_id, service_id, ticket_id, type, actor, detail, at FROM ticket_events WHERE business_id = $1 ORDER BY at DESC LIMIT $2",
      [input.businessId, Math.min(300, Math.max(1, input.limit ?? 100))]
    );
  }

  async logAudit(input: {
    businessId: string;
    branchId?: string;
    actorId?: string;
    actorName?: string;
    action: string;
    detail?: string;
  }): Promise<void> {
    await this.driver.run(
      "INSERT INTO audit_log (id, business_id, branch_id, actor_id, actor_name, action, detail, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        newId(),
        input.businessId,
        input.branchId ?? "",
        input.actorId ?? "",
        input.actorName ?? "",
        input.action,
        input.detail ?? "",
        Date.now(),
      ]
    );
  }

  async listAudit(input: {
    businessId: string;
    branchId?: string;
    limit?: number;
  }): Promise<AuditRow[]> {
    const where = ["business_id = $1"];
    const params: unknown[] = [input.businessId];
    if (input.branchId) {
      params.push(input.branchId);
      where.push(`branch_id = $${params.length}`);
    }
    params.push(Math.min(300, Math.max(1, input.limit ?? 100)));
    return this.driver.all<AuditRow>(
      `SELECT id, business_id, branch_id, actor_id, actor_name, action, detail, at
       FROM audit_log WHERE ${where.join(" AND ")} ORDER BY at DESC LIMIT $${params.length}`,
      params
    );
  }

  // --------------------------------------------------------------- helpers

  async uniqueSlug(table: "branches" | "services", scopeId: string, base: string): Promise<string> {
    const column = table === "branches" ? "business_id" : "branch_id";
    let candidate = base;
    for (let attempt = 0; attempt < 8; attempt++) {
      const clash = await this.driver.get<{ id: string }>(
        `SELECT id FROM ${table} WHERE ${column} = $1 AND slug = $2`,
        [scopeId, candidate]
      );
      if (!clash) return candidate;
      candidate = `${base}-${newId().slice(0, 4)}`;
    }
    return `${base}-${newId().slice(0, 6)}`;
  }

  private async nextSort(table: string, column: string, scopeId: string): Promise<number> {
    const row = await this.driver.get<{ n: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) AS n FROM ${table} WHERE ${column} = $1`,
      [scopeId]
    );
    return Number(row?.n ?? -1) + 1;
  }

  private async applyPatch(
    table: string,
    keyColumn: string,
    keyValue: string,
    fields: Record<string, unknown>
  ): Promise<void> {
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    const assignments = entries.map(([column], index) => `${column} = $${index + 1}`);
    await this.driver.run(
      `UPDATE ${table} SET ${assignments.join(", ")} WHERE ${keyColumn} = $${entries.length + 1}`,
      [...entries.map(([, value]) => value), keyValue]
    );
  }
}

function terminal(status: TicketStatus): boolean {
  return ["served", "no_show", "cancelled"].includes(status);
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === "23505" || /UNIQUE constraint failed/i.test((err as { message?: string })?.message ?? "");
}

/** Columns added to the original single-queue tables. */
const LEGACY_COLUMNS: Record<string, Record<string, string>> = {
  businesses: {
    brand_color: "TEXT NOT NULL DEFAULT ''",
    brand_accent: "TEXT NOT NULL DEFAULT ''",
    logo_url: "TEXT NOT NULL DEFAULT ''",
    logo_data: "TEXT NOT NULL DEFAULT ''",
  },
  tickets: {
    prefix: "TEXT NOT NULL DEFAULT ''",
    branch_id: "TEXT NOT NULL DEFAULT ''",
    service_id: "TEXT NOT NULL DEFAULT ''",
    counter_id: "TEXT NOT NULL DEFAULT ''",
    phone: "TEXT NOT NULL DEFAULT ''",
    source: "TEXT NOT NULL DEFAULT 'qr'",
    device_token: "TEXT NOT NULL DEFAULT ''",
    note: "TEXT NOT NULL DEFAULT ''",
    skip_count: "INTEGER NOT NULL DEFAULT 0",
    moved_from: "TEXT NOT NULL DEFAULT ''",
    called_at: "BIGINT NOT NULL DEFAULT 0",
    served_at: "BIGINT NOT NULL DEFAULT 0",
    closed_at: "BIGINT NOT NULL DEFAULT 0",
  },
  sessions: {
    staff_id: "TEXT NOT NULL DEFAULT ''",
    last_seen_at: "BIGINT NOT NULL DEFAULT 0",
    user_agent: "TEXT NOT NULL DEFAULT ''",
  },
};

/**
 * Every column this release expects on disk. A table that is missing one of
 * them came from an older build and is rebuilt at boot.
 */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  businesses: BUSINESS_COLUMNS.split(", "),
  branches: BRANCH_COLUMNS.split(", "),
  services: SERVICE_COLUMNS.split(", "),
  counters: COUNTER_COLUMNS.split(", "),
  staff: STAFF_COLUMNS.split(", "),
  invites: INVITE_COLUMNS.split(", "),
  sessions: ["token_hash", "staff_id", "created_at", "expires_at", "last_seen_at", "user_agent"],
  tickets: TICKET_COLUMNS.split(", "),
  ticket_events: ["id", "business_id", "branch_id", "service_id", "ticket_id", "type", "actor", "detail", "at"],
  audit_log: ["id", "business_id", "branch_id", "actor_id", "actor_name", "action", "detail", "at"],
};

export function createStore(): SqlStore {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return new SqlStore(new PgDriver(databaseUrl));
  return new SqlStore(
    new SqliteDriver(process.env.DATABASE_PATH || path.join(process.cwd(), "data", "lobby.db"))
  );
}

export const store = createStore();

export const usingPostgres = store.kind === "postgres";

export { can };
export type { Capability };
