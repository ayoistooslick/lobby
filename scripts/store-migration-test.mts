import fs from "node:fs";
import { SqliteDriver } from "../server/sqlite";
import { SqlStore } from "../server/store";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`  ok ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const TMP = "/tmp/store-test";
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// --- 1. Legacy single-queue database (the released v1 schema) ---------------
const legacyPath = `${TMP}/legacy.db`;
{
  const driver = new SqliteDriver(legacyPath);
  await driver.exec(`CREATE TABLE businesses (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, owner_name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
    customer_note TEXT NOT NULL DEFAULT '', paused INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, business_id TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL);
  CREATE TABLE tickets (
    id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    day TEXT NOT NULL, number INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'waiting',
    confirmed INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE (business_id, day, number));`);
  await driver.run(
    "INSERT INTO businesses (id, slug, name, owner_name, email, password_hash, created_at) VALUES ('b1','acme','Acme','Owner','a@x.com','salt:hash', 100)");
  await driver.run(
    `INSERT INTO tickets (id, business_id, day, number, name, status, created_at, updated_at)
     VALUES ('t1','b1','2026-01-01',1,'Ana','served', 1000, 2000)`);
  await driver.run(
    `INSERT INTO tickets (id, business_id, day, number, name, status, created_at, updated_at)
     VALUES ('t2','b1','2026-01-01',2,'Bo','waiting', 1500, 1500)`);
  await driver.run("INSERT INTO sessions VALUES ('s1','b1',1,99999999999999)");

  const store = new SqlStore(driver);
  await store.init();

  const branches = await store.listBranches("b1");
  check("legacy: branch backfilled", branches.length === 1, JSON.stringify(branches));
  const services = await store.listServices(branches[0]?.id ?? "");
  check("legacy: service backfilled", services.length === 1);
  const tickets = await store.listBranchTickets("b1", branches[0]?.id ?? "", 10);
  check("legacy: tickets kept and repointed", tickets.length === 2 && tickets.every(t => t.service_id === services[0]?.id));
  const staff = await store.listStaff("b1");
  check("legacy: owner staff created", staff.length === 1 && staff[0].role === "owner" && staff[0].email === "a@x.com");
  const t1 = await store.getTicket("b1", "t1");
  check("legacy: served ticket still served", t1?.status === "served" && t1?.number === 1);
  await driver.close();

  // Idempotent second boot.
  const driver2 = new SqliteDriver(legacyPath);
  const store2 = new SqlStore(driver2);
  let booted = true;
  try { await store2.init(); } catch (err) { booted = false; console.log(err); }
  check("legacy: second boot is clean", booted);
  const branches2 = await store2.listBranches("b1");
  check("legacy: no duplicate branch on reboot", branches2.length === 1);
  await driver2.close();
}

// --- 2. Stale intermediate schema (earlier build of this rewrite) -----------
const stalePath = `${TMP}/stale.db`;
{
  const driver = new SqliteDriver(stalePath);
  await driver.exec(`CREATE TABLE businesses (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, owner_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL, password_hash TEXT NOT NULL DEFAULT '', customer_note TEXT NOT NULL DEFAULT '',
    brand_color TEXT NOT NULL DEFAULT '', brand_accent TEXT NOT NULL DEFAULT '', logo_url TEXT NOT NULL DEFAULT '',
    logo_data TEXT NOT NULL DEFAULT '', paused INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL);
  CREATE TABLE branches (
    id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', paused INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL);
  CREATE TABLE tickets (
    id TEXT PRIMARY KEY, business_id TEXT NOT NULL, branch_id TEXT NOT NULL DEFAULT '', service_id TEXT NOT NULL DEFAULT '',
    counter_id TEXT NOT NULL DEFAULT '', day TEXT NOT NULL, number INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'waiting', confirmed INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'qr', device_token TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
    skip_count INTEGER NOT NULL DEFAULT 0, moved_from TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL, called_at BIGINT NOT NULL DEFAULT 0, served_at BIGINT NOT NULL DEFAULT 0, closed_at BIGINT NOT NULL DEFAULT 0,
    UNIQUE (business_id, day, number));`);
  await driver.run("INSERT INTO businesses (id, slug, name, email, created_at) VALUES ('b1','one','One','o1@x.com',1), ('b2','two','Two','o2@x.com',2)");
  await driver.run("INSERT INTO branches (id, business_id, slug, name, sort_order, created_at) VALUES ('br1','b1','main','Main',0,1)");
  await driver.run("INSERT INTO tickets (id, business_id, branch_id, day, number, created_at, updated_at) VALUES ('t1','b1','br1','2026-01-01',3, 10, 10)");

  const store = new SqlStore(driver);
  await store.init();

  const b1 = await store.listBranches("b1");
  const b2 = await store.listBranches("b2");
  check("stale: both businesses got a branch", b1.length === 1 && b2.length === 1, JSON.stringify({b1: b1.length, b2: b2.length}));
  const extra = await store.createBranch("b1", { name: "Main" });
  check("stale: second same-named branch allowed", Boolean(extra.id));
  const t1 = await store.getTicket("b1", "t1");
  check("stale: ticket survived rebuild", t1?.number === 3);
  check("stale: ticket repointed to fresh branch", t1?.branch_id === b1[0]?.id);
  const t = await store.createTicket({ businessId: "b1", branchId: b1[0]!.id, serviceId: (await store.listServices(b1[0]!.id))[0]!.id, name: "New", source: "qr", deviceToken: "d1" });
  check("stale: new ticket numbers from 1", t.number === 1, `got ${t.number}`);
  await driver.close();
}

// --- 3. Concurrency: 30 simultaneous joins must number without gaps/dupes ---
{
  const driver = new SqliteDriver(`${TMP}/conc.db`);
  const store = new SqlStore(driver);
  await store.init();
  const biz = await store.createBusiness({ name: "Concurrent", ownerName: "O", email: "c@x.com", passwordHash: "h" });
  const branch = await store.createBranch(biz.id, { name: "Main" });
  const service = await store.createService(biz.id, branch.id, { name: "Queue", prefix: "K", counters: 1 });
  const joins = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      store.createTicket({ businessId: biz.id, branchId: branch.id, serviceId: service.id, name: `P${i}`, deviceToken: `dev-${i}` })
    )
  );
  const numbers = joins.map(t => t.number).sort((a, b) => a - b);
  const unique = new Set(numbers);
  check("concurrent: 30 unique numbers", unique.size === 30, numbers.join(","));
  check("concurrent: numbers are 1..30", numbers[0] === 1 && numbers[29] === 30);
  const callNext = await Promise.all(
    Array.from({ length: 5 }, () =>
      store.callNext({ businessId: biz.id, branchId: branch.id, serviceId: service.id, actor: "s" })
    )
  );
  const calledIds = new Set(callNext.filter(Boolean).map(t => t!.id));
  check("concurrent: callNext handed out 5 distinct tickets", calledIds.size === 5);
  await driver.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
