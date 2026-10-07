import { Router } from "express";
import { publishBranch, subscribe } from "../events";
import { limit } from "../rateLimit";
import { DEMO_CAPACITY, clearDemoQueue, demoHandle, seedDemoQueue } from "../demo";
import { ApiError, id as idParam, oneOf, optionalText } from "../validate";
import { staffTicketView, publicBusiness, publicService, staffCounter } from "../views";
import { store } from "../store";
import type { QueueAction } from "../store";

export const demoRouter = Router();

/** The demo is a real shop in the database, so it uses the real code paths. */
async function handle() {
  const demo = demoHandle();
  if (!demo) throw new ApiError(503, "The demo is still starting. Try again in a moment.");
  const business = await store.getBusinessById(demo.businessId);
  const branch = await store.getBranch(demo.branchId);
  if (!business || !branch) throw new ApiError(503, "The demo is still starting. Try again in a moment.");
  return { demo, business, branch };
}

demoRouter.get("/", async (_req, res) => {
  const { business, branch } = await handle();
  const services = await store.listServices(branch.id);
  const cards = [];
  let waitingTotal = 0;
  let servedTotal = 0;

  for (const service of services) {
    const tickets = await store.listQueue(business.id, branch.id, service.id);
    const waiting = tickets.filter((ticket) => ticket.status === "waiting");
    const called = tickets.filter((ticket) => ticket.status === "called");
    const finished = tickets.filter((ticket) => !["waiting", "called", "on_hold"].includes(ticket.status));
    waitingTotal += waiting.length;
    servedTotal += finished.filter((ticket) => ticket.status === "served").length;
    cards.push({
      service: publicService(service),
      counters: (await store.listCounters(service.id)).map(staffCounter),
      waiting: waiting.slice(0, 10).map((ticket) => staffTicketView(ticket, 0)),
      waitingCount: waiting.length,
      nowServing: called.length
        ? staffTicketView(called[called.length - 1], 0)
        : null,
      finished: finished
        .slice(-6)
        .map((ticket) => staffTicketView(ticket, 0)),
      servedCount: finished.filter((ticket) => ticket.status === "served").length,
    });
  }

  res.json({
    ok: true,
    business: publicBusiness(business),
    branch: { id: branch.id, slug: branch.slug, name: branch.name },
    services: cards,
    totals: { waiting: waitingTotal, served: servedTotal },
    capacity: DEMO_CAPACITY,
  });
});

const DEMO_ACTIONS: QueueAction[] = ["call", "serve", "complete", "skip", "no_show", "hold", "recall"];

demoRouter.post("/join", limit("demo-join", 20, 60_000), async (req, res) => {
  const { demo, business, branch } = await handle();
  const serviceId = idParam(req.body?.serviceId, "Queue");
  if (!demo.serviceIds.includes(serviceId)) throw new ApiError(404, "We couldn't find that queue.");

  const open = (await store.listQueue(business.id, branch.id, serviceId)).filter((ticket) =>
    ["waiting", "called", "on_hold"].includes(ticket.status)
  );
  if (open.length >= 12) {
    throw new ApiError(409, "This demo queue is full. Press Reset to start again.");
  }

  const name = optionalText(req.body?.name, "Name", 24);
  const ticket = await store.createTicket({
    businessId: business.id,
    branchId: branch.id,
    serviceId,
    name: name || `Visitor ${open.length + 1}`,
    source: "demo",
  });
  publishBranch(branch.id, serviceId);
  res.status(201).json({ ok: true, ticket: staffTicketView(ticket, 0) });
});

demoRouter.post("/action", limit("demo-action", 120, 60_000), async (req, res) => {
  const { business, branch } = await handle();
  const ticketId = idParam(req.body?.ticketId, "Number");
  const ticket = await store.getTicket(business.id, ticketId);
  if (!ticket || ticket.source !== "demo" || ticket.branch_id !== branch.id) {
    throw new ApiError(404, "We couldn't find that demo number.");
  }
  const action = oneOf<QueueAction>(req.body?.action, DEMO_ACTIONS, "Action");

  const updated = await store.actOnTicket({
    businessId: business.id,
    ticketId,
    action,
    actor: "Demo",
  });
  if (!updated) throw new ApiError(404, "We couldn't find that demo number.");
  publishBranch(branch.id, ticket.service_id);
  res.json({ ok: true, ticket: staffTicketView(updated, 0) });
});

/** Call-next on a demo queue, exactly as staff would from the phone. */
demoRouter.post("/call-next", limit("demo-call", 60, 60_000), async (req, res) => {
  const { demo, business, branch } = await handle();
  const serviceId = idParam(req.body?.serviceId, "Queue");
  if (!demo.serviceIds.includes(serviceId)) throw new ApiError(404, "We couldn't find that queue.");
  const counterId = typeof req.body?.counterId === "string" ? req.body.counterId : "";
  if (counterId) {
    const counter = await store.getCounter(counterId);
    if (!counter || counter.service_id !== serviceId) throw new ApiError(400, "Unknown counter.");
  }

  const ticket = await store.callNext({
    businessId: business.id,
    branchId: branch.id,
    serviceId,
    counterId,
    actor: "Demo",
  });
  if (!ticket) throw new ApiError(409, "Nobody is waiting in this demo queue.");
  publishBranch(branch.id, serviceId);
  res.json({ ok: true, ticket: staffTicketView(ticket, 0) });
});

demoRouter.post("/reset", limit("demo-reset", 30, 60_000), async (_req, res) => {
  const { branch } = await handle();
  await clearDemoQueue();
  await seedDemoQueue();
  publishBranch(branch.id);
  res.json({ ok: true });
});

demoRouter.get("/stream", async (_req, res) => {
  const { branch } = await handle();
  subscribe(`branch:${branch.id}`, res);
});