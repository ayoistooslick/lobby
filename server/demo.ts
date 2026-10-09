import { dayKey } from "./rows";
import { store } from "./store";

/**
 * A self-contained shop that anyone can press buttons on without touching real
 * data. It is created once, reset on demand, and only ever holds made-up names.
 */
export const DEMO_SLUG = "demo";
const DEMO_EMAIL = "demo@lobby.local";

const DEMO_SERVICES = [
  { name: "Advice", prefix: "A", description: "Ask us anything", avgMinutes: 8, counters: 2 },
  { name: "Payments", prefix: "P", description: "Bills and top-ups", avgMinutes: 4, counters: 1 },
  { name: "Collection", prefix: "C", description: "Orders ready to collect", avgMinutes: 3, counters: 1 },
];

const DEMO_PEOPLE = [
  "Amara", "Ben", "Chidi", "Dalia", "Eve", "Femi", "Grace", "Hana", "Ismail", "Joy",
  "Kai", "Lena", "Milo", "Nia", "Omar", "Priya", "Quinn", "Rosa", "Sam", "Tara",
];

/** How many customers the demo queue holds before it refuses more joins. */
export const DEMO_CAPACITY = 40;

export interface DemoHandle {
  businessId: string;
  branchId: string;
  serviceIds: string[];
}

let handle: DemoHandle | null = null;

export async function ensureDemo(): Promise<DemoHandle> {
  // Older builds seeded the demo under a slug made from its display name.
  // Either record is the same shop, so adopt whichever exists.
  const existing = (await store.getBusinessBySlug(DEMO_SLUG)) ?? (await store.getBusinessByEmail(DEMO_EMAIL));
  if (existing) {
    const branches = await store.listBranches(existing.id);
    const branch = branches[0];
    const services = branch ? await store.listServices(branch.id) : [];
    if (branch && services.length) {
      handle = { businessId: existing.id, branchId: branch.id, serviceIds: services.map((s) => s.id) };
      return handle;
    }
  }

  const business =
    existing ??
    (await store.createBusiness({
      name: "Lobby Demo Shop",
      ownerName: "Demo Owner",
      email: DEMO_EMAIL,
      passwordHash: "",
      slug: DEMO_SLUG,
    }));

  let branch = (await store.listBranches(business.id))[0];
  if (!branch) {
    branch = await store.createBranch(business.id, {
      name: "Front counter",
      address: "1 Example Street",
      note: "This is a practice shop. Nothing here is real.",
    });
  }
  await store.updateBusiness(business.id, {
    customer_note: "Practice queue. Have a go, then press Reset.",
    brand_color: "#1f6feb",
    brand_accent: "#f2b705",
  });

  const services = await store.listServices(branch.id);
  for (const entry of services.length ? [] : DEMO_SERVICES) {
    await store.createService(business.id, branch.id, {
      name: entry.name,
      prefix: entry.prefix,
      description: entry.description,
      avgMinutes: entry.avgMinutes,
      counters: entry.counters,
    });
  }

  handle = {
    businessId: business.id,
    branchId: branch.id,
    serviceIds: (await store.listServices(branch.id)).map((service) => service.id),
  };
  await seedDemoQueue();
  return handle;
}

export function demoHandle(): DemoHandle | null {
  return handle;
}

export async function seedDemoQueue(): Promise<void> {
  if (!handle) return;
  const { businessId, branchId, serviceIds } = handle;
  await clearDemoQueue();

  const plan: Array<{ service: number; count: number }> = [
    { service: 0, count: 5 },
    { service: 1, count: 3 },
    { service: 2, count: 2 },
  ];

  let person = 0;
  for (const entry of plan) {
    const serviceId = serviceIds[entry.service];
    if (!serviceId) continue;
    for (let i = 0; i < entry.count; i += 1) {
      const name = DEMO_PEOPLE[person % DEMO_PEOPLE.length];
      person += 1;
      await store.createTicket({
        businessId,
        branchId,
        serviceId,
        name,
        source: "demo",
        deviceToken: `seed-${serviceId}-${i}`,
      });
    }
  }

  // Put somebody at each counter so the TV screen has something to show.
  const called: string[] = [];
  for (const serviceId of serviceIds) {
    const ticket = await store.callNext({
      businessId,
      branchId,
      serviceId,
      actor: "Demo",
    });
    if (ticket) called.push(ticket.id);
  }
  void called;
}

/** Removes every demo ticket from today so the demo starts fresh. */
export async function clearDemoQueue(): Promise<void> {
  if (!handle) return;
  const today = dayKey();
  const tickets = await store.listBranchTickets(handle.businessId, handle.branchId, 500);
  for (const ticket of tickets) {
    if (ticket.day !== today) continue;
    await store.driver.run("DELETE FROM ticket_events WHERE ticket_id = $1", [ticket.id]);
    await store.driver.run("DELETE FROM tickets WHERE id = $1 AND business_id = $2", [
      ticket.id,
      handle.businessId,
    ]);
  }
}