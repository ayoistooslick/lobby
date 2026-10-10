import { Router, type Request } from "express";
import { authed, requireAuth, requireBranch } from "../auth";
import { publishBranch, publishBusiness, publishService } from "../events";
import { can } from "../permissions";
import { limit } from "../rateLimit";
import type { ServiceRow, TicketRow } from "../rows";
import { store, type QueueAction } from "../store";
import {
  ApiError,
  boolean,
  id as idParam,
  oneOf,
  optionalText,
  phone as phoneNumber,
} from "../validate";
import {
  capabilitiesOf,
  eventView,
  publicBranch,
  publicBusiness,
  serviceSummaryView,
  staffTicketView,
  staffView,
} from "../views";

export const staffRouter = Router();

staffRouter.use(requireAuth);

const ACTIONS: QueueAction[] = [
  "call",
  "serve",
  "complete",
  "skip",
  "no_show",
  "hold",
  "release",
  "cancel",
  "recall",
];

/** Read-only helper: what a ticket number renders as on screen. */
function labelOf(ticket: TicketRow): string {
  return `${ticket.prefix || ""}${ticket.number}`;
}

async function requireService(req: Request, branchId: string, serviceId: unknown): Promise<ServiceRow> {
  const scope = await authed(req);
  const wanted = idParam(serviceId, "Queue");
  const service = await store.getService(wanted);
  if (!service || service.branch_id !== branchId || service.business_id !== scope.business.id) {
    throw new ApiError(404, "We couldn't find that queue.");
  }
  return service;
}

async function counterFor(serviceId: string, counterId: unknown): Promise<string> {
  const raw = typeof counterId === "string" ? counterId.trim() : "";
  if (!raw) return "";
  const counter = await store.getCounter(raw);
  if (!counter || counter.service_id !== serviceId) {
    throw new ApiError(400, "That counter does not belong to this queue.");
  }
  return counter.id;
}

/** Every service in a branch with its live numbers, for the dashboard picker. */
staffRouter.get("/overview", async (req, res) => {
  const scope = await authed(req);
  const branches = await store.listBranches(scope.business.id);
  const allowed = branches.filter((branch) => scope.staff.branch_id === "" || scope.staff.branch_id === branch.id);
  const branchId = String(req.query.branch ?? scope.staff.branch_id ?? allowed[0]?.id ?? "");
  const branch = allowed.find((entry) => entry.id === branchId) ?? allowed[0] ?? null;
  const summaries = branch ? await store.serviceSummaries(scope.business.id, branch.id) : [];

  res.json({
    ok: true,
    business: publicBusiness(scope.business),
    staff: staffView(scope.staff, scope.staff.id),
    capabilities: capabilitiesOf(scope.staff.role),
    branches: allowed.map(publicBranch),
    branch: branch ? publicBranch(branch) : null,
    services: summaries.map(serviceSummaryView),
  });
});

staffRouter.get("/queue", async (req, res) => {
  const scope = await authed(req);
  const branch = await requireBranch(req, req.query.branch);
  const service = await requireService(req, branch.id, req.query.service);
  const snapshot = await store.snapshot(scope.business.id, branch.id, service.id);
  if (!snapshot) throw new ApiError(404, "We couldn't find that queue.");

  const counters = snapshot.counters;
  const [waiting, called, held, finished] = await Promise.all([
    Promise.all(snapshot.waiting.map(async (ticket) => staffTicketView(ticket, 0))),
    Promise.all(snapshot.called.map(async (ticket) => staffTicketView(ticket, 0))),
    Promise.all(snapshot.held.map(async (ticket) => staffTicketView(ticket, 0))),
    Promise.all(snapshot.finished.map(async (ticket) => staffTicketView(ticket, 0))),
  ]);

  res.json({
    ok: true,
    branch: publicBranch(snapshot.branch),
    service: snapshot.service,
    counters: counters.map((counter) => ({
      id: counter.id,
      name: counter.name,
      paused: counter.paused === 1,
      sortOrder: counter.sort_order,
    })),
    waiting,
    called,
    held,
    finished,
    nowServing: snapshot.nowServing ? staffTicketView(snapshot.nowServing, 0) : null,
    waitingCount: snapshot.waitingCount,
    averageWaitMinutes: snapshot.averageWaitMinutes,
    estimatedWaitMinutes: snapshot.estimatedWaitMinutes,
    servingCounters: snapshot.servingCounters,
  });
});

/** The one button staff use most: finish whoever is here, call the next. */
staffRouter.post("/queue/call-next", limit("call-next", 240, 60_000), async (req, res) => {
  const scope = await authed(req);
  if (!can(scope.staff.role, "queue.operate")) {
    throw new ApiError(403, "Your role cannot change the queue.");
  }
  const branch = await requireBranch(req, req.body?.branchId);
  const service = await requireService(req, branch.id, req.body?.serviceId);
  const counterId = await counterFor(service.id, req.body?.counterId);

  const ticket = await store.callNext({
    businessId: scope.business.id,
    branchId: branch.id,
    serviceId: service.id,
    counterId,
    actor: scope.staff.name,
  });
  if (!ticket) throw new ApiError(409, "Nobody is waiting in this queue right now.");
  publishBranch(branch.id, service.id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: branch.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "queue.call_next",
    detail: `${labelOf(ticket)} · ${service.name}`,
  });
  res.json({ ok: true, ticket: staffTicketView(ticket, 0) });
});

staffRouter.post("/tickets/:ticketId/action", limit("ticket-action", 240, 60_000), async (req, res) => {
  const scope = await authed(req);
  if (!can(scope.staff.role, "queue.operate")) {
    throw new ApiError(403, "Your role cannot change the queue.");
  }
  const ticketId = idParam(req.params.ticketId, "Number");
  const action = oneOf<QueueAction>(req.body?.action, ACTIONS, "Action");

  const ticket = await store.getTicket(scope.business.id, ticketId);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  if (ticket.branch_id && scope.staff.branch_id && ticket.branch_id !== scope.staff.branch_id) {
    throw new ApiError(404, "We couldn't find that number.");
  }
  const counterId = await counterFor(ticket.service_id, req.body?.counterId);

  const updated = await store.actOnTicket({
    businessId: scope.business.id,
    ticketId,
    action,
    actor: scope.staff.name,
    counterId,
    note: req.body?.note === undefined ? undefined : optionalText(req.body.note, "Note", 140),
  });
  if (!updated) throw new ApiError(404, "We couldn't find that number.");
  publishBranch(ticket.branch_id, ticket.service_id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: ticket.branch_id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: `ticket.${action}`,
    detail: labelOf(updated),
  });
  res.json({ ok: true, ticket: staffTicketView(updated, 0) });
});

/** Sends a customer to a different queue, with a fresh number there. */
staffRouter.post("/tickets/:ticketId/move", limit("ticket-move", 60, 60_000), async (req, res) => {
  const scope = await authed(req);
  if (!can(scope.staff.role, "queue.operate")) {
    throw new ApiError(403, "Your role cannot change the queue.");
  }
  const ticketId = idParam(req.params.ticketId, "Number");
  const ticket = await store.getTicket(scope.business.id, ticketId);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  if (ticket.branch_id && scope.staff.branch_id && ticket.branch_id !== scope.staff.branch_id) {
    throw new ApiError(404, "We couldn't find that number.");
  }

  const target = await requireService(req, ticket.branch_id, req.body?.serviceId);
  const counterId = await counterFor(target.id, req.body?.counterId);
  const moved = await store.moveTicket({
    businessId: scope.business.id,
    ticketId,
    targetServiceId: target.id,
    targetCounterId: counterId,
    actor: scope.staff.name,
  });
  if (!moved) throw new ApiError(409, "That number cannot be moved any more.");
  publishBranch(ticket.branch_id, ticket.service_id);
  publishService(target.id);
  res.json({ ok: true, ticket: staffTicketView(moved, 0) });
});

/** Walk-ins and phone bookings, added straight onto the queue. */
staffRouter.post("/tickets/manual", limit("manual-ticket", 120, 60_000), async (req, res) => {
  const scope = await authed(req);
  if (!can(scope.staff.role, "queue.operate")) {
    throw new ApiError(403, "Your role cannot change the queue.");
  }
  const branch = await requireBranch(req, req.body?.branchId);
  const service = await requireService(req, branch.id, req.body?.serviceId);
  const name = optionalText(req.body?.name, "Name", 40);
  const note = optionalText(req.body?.note, "Note", 140);
  const phone = phoneNumber(req.body?.phone);
  const counterId = await counterFor(service.id, req.body?.counterId);

  const ticket = await store.createTicket({
    businessId: scope.business.id,
    branchId: branch.id,
    serviceId: service.id,
    name,
    phone,
    note,
    counterId,
    source: "desk",
  });
  publishBranch(branch.id, service.id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: branch.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "ticket.added_at_desk",
    detail: `${labelOf(ticket)} · ${name || "(no name)"}`,
  });
  res.status(201).json({ ok: true, ticket: staffTicketView(ticket, 0) });
});

/** Opens or closes a queue for new arrivals. */
staffRouter.patch("/queue/pause", async (req, res) => {
  const scope = await authed(req);
  if (!can(scope.staff.role, "queue.settings")) {
    throw new ApiError(403, "Only a manager or the owner can pause a queue.");
  }
  const paused = boolean(req.body?.paused, "Paused");

  if (req.body?.serviceId) {
    const branch = await requireBranch(req, req.body?.branchId);
    const service = await requireService(req, branch.id, req.body?.serviceId);
    await store.updateService(service.id, { paused: paused ? 1 : 0 });
    publishBranch(branch.id, service.id);
    await store.logAudit({
      businessId: scope.business.id,
      branchId: branch.id,
      actorId: scope.staff.id,
      actorName: scope.staff.name,
      action: paused ? "service.paused" : "service.resumed",
      detail: service.name,
    });
    res.json({ ok: true, scope: "service", paused });
    return;
  }

  await store.updateBusiness(scope.business.id, { paused: paused ? 1 : 0 });
  publishBusiness(scope.business.id);
  await store.logAudit({
    businessId: scope.business.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: paused ? "business.paused" : "business.resumed",
  });
  res.json({ ok: true, scope: "business", paused });
});

/** Full timeline for one number, for the history screen and support. */
staffRouter.get("/tickets/:ticketId/events", async (req, res) => {
  const scope = await authed(req);
  const ticketId = idParam(req.params.ticketId, "Number");
  const ticket = await store.getTicket(scope.business.id, ticketId);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  // Branch-pinned staff cannot read another branch's history either.
  if (ticket.branch_id && scope.staff.branch_id && ticket.branch_id !== scope.staff.branch_id) {
    throw new ApiError(404, "We couldn't find that number.");
  }
  const events = await store.listEvents({ businessId: scope.business.id, ticketId });
  res.json({ ok: true, ticket: staffTicketView(ticket, 0), events: events.map(eventView) });
});