import { Router } from "express";
import { subscribe } from "../events";
import { publishBranch, publishService } from "../events";
import { limit } from "../rateLimit";
import type { BranchRow, BusinessRow, ServiceRow } from "../rows";
import { store } from "../store";
import {
  ApiError,
  QUEUE_NOT_FOUND,
  id as idParam,
  isSlug,
  optionalText,
  phone as phoneNumber,
} from "../validate";
import { customerTicketView, publicBranch, publicBusiness, publicService } from "../views";

export const queueRouter = Router();

async function findBusiness(slug: string): Promise<BusinessRow> {
  if (!isSlug(slug)) throw new ApiError(404, QUEUE_NOT_FOUND);
  const business = await store.getBusinessBySlug(slug);
  if (!business) throw new ApiError(404, QUEUE_NOT_FOUND);
  return business;
}

/** Picks the branch the visitor means, defaulting to the first open one. */
async function resolveBranch(businessId: string, wanted: unknown): Promise<BranchRow> {
  const branches = (await store.listBranches(businessId)).filter((branch) => branch.paused !== 1);
  if (!branches.length) throw new ApiError(409, "This shop has no open branch right now.");
  const slug = typeof wanted === "string" ? wanted.trim() : "";
  if (!slug) return branches[0];
  const branch = branches.find((entry) => entry.slug === slug);
  if (!branch) throw new ApiError(404, "We couldn't find that branch.");
  return branch;
}

async function resolveService(branch: BranchRow, wanted: unknown): Promise<ServiceRow> {
  const all = await store.listServices(branch.id);
  const services = all.filter((service) => service.paused !== 1);
  const slug = typeof wanted === "string" ? wanted.trim() : "";
  if (!slug) {
    if (!services.length) throw new ApiError(409, "This branch has no open queue right now.");
    if (services.length === 1) return services[0];
    throw new ApiError(400, "Choose which queue you need.");
  }
  const service = services.find((entry) => entry.slug === slug);
  if (service) return service;
  // A closed queue is a different answer from a queue that never existed.
  if (all.some((entry) => entry.slug === slug)) {
    throw new ApiError(409, "This queue is closed right now. Please ask a member of staff.");
  }
  throw new ApiError(404, "We couldn't find that queue.");
}

/** Everything the customer screen needs, whether or not they hold a number. */
queueRouter.get("/:slug", limit("queue-read", 300, 60_000), async (req, res) => {
  const business = await findBusiness(String(req.params.slug));
  const branches = (await store.listBranches(business.id)).filter((branch) => branch.paused !== 1);
  const branch = branches.find((entry) => entry.slug === String(req.query.branch ?? "")) ?? branches[0] ?? null;
  const services = branch
    ? (await store.listServices(branch.id)).filter((service) => service.paused !== 1)
    : [];
  const service =
    services.find((entry) => entry.slug === String(req.query.service ?? "")) ?? services[0] ?? null;

  const requested = typeof req.query.ticket === "string" ? req.query.ticket : "";
  const ticket = requested ? await store.getTicket(business.id, requested) : undefined;

  const snapshot = business && branch && service ? await store.snapshot(business.id, branch.id, service.id) : null;

  res.json({
    ok: true,
    business: publicBusiness(business),
    branches: branches.map((branch) => publicBranch(branch)),
    branch: branch ? publicBranch(branch) : null,
    services: services.map((service) => publicService(service)),
    service: service ? publicService(service) : null,
    nowServing: snapshot?.nowServing ? `${snapshot.nowServing.prefix || ""}${snapshot.nowServing.number}` : null,
    nowServingNumber: snapshot?.nowServing?.number ?? null,
    peopleWaiting: snapshot?.waitingCount ?? 0,
    nextWaiting: (snapshot?.waiting ?? []).slice(0, 3).map((ticket) => ticket.number),
    estimatedWaitMinutes: snapshot?.estimatedWaitMinutes ?? 0,
    ticket: ticket ? customerTicketView(ticket, await store.peopleAhead(ticket)) : null,
  });
});

// Two caps: per visitor IP, and per queue so one busy shop can't be flooded.
const joinLimits = [
  limit("join-ip", 30, 60_000),
  limit("join-queue", 25, 60_000, (req) => String(req.params.slug ?? "unknown")),
];

queueRouter.post("/:slug/join", ...joinLimits, async (req, res) => {
  const business = await findBusiness(String(req.params.slug));
  if (business.paused === 1) {
    throw new ApiError(409, "This shop is not taking numbers right now. Please check back later.");
  }
  const branch = await resolveBranch(business.id, req.body?.branchSlug);
  const service = await resolveService(branch, req.body?.serviceSlug);
  const name = optionalText(req.body?.name, "Name", 40);
  const phone = phoneNumber(req.body?.phone);
  const deviceToken = optionalText(req.body?.deviceToken, "Device", 64);

  if (service.open_from && service.open_to) {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const [fromH, fromM] = service.open_from.split(":").map(Number);
    const [toH, toM] = service.open_to.split(":").map(Number);
    const from = fromH * 60 + fromM;
    const to = toH * 60 + toM;
    const open = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    if (!open) {
      throw new ApiError(409, `This queue is open from ${service.open_from} to ${service.open_to}.`);
    }
  }

  // A refresh, a double tap or a reopened tab must not take a second number.
  const existing = await store.findOpenTicketForDevice(service.id, deviceToken);
  if (existing) {
    res.status(200).json({
      ok: true,
      duplicate: true,
      ticket: customerTicketView(existing, await store.peopleAhead(existing)),
    });
    return;
  }

  const ticket = await store.createTicket({
    businessId: business.id,
    branchId: branch.id,
    serviceId: service.id,
    name,
    phone,
    source: "qr",
    deviceToken,
  });
  publishBranch(branch.id, service.id);
  res.status(201).json({
    ok: true,
    duplicate: false,
    ticket: customerTicketView(ticket, await store.peopleAhead(ticket)),
  });
});

queueRouter.get("/:slug/ticket/:ticketId", limit("ticket-read", 300, 60_000), async (req, res) => {
  const business = await findBusiness(String(req.params.slug));
  const ticketId = idParam(req.params.ticketId, "Number");
  const ticket = await store.getTicket(business.id, ticketId);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  res.json({ ok: true, ticket: customerTicketView(ticket, await store.peopleAhead(ticket)) });
});

queueRouter.post("/:slug/ticket/:ticketId/confirm", limit("confirm", 40, 60_000), async (req, res) => {
  const business = await findBusiness(String(req.params.slug));
  const ticketId = idParam(req.params.ticketId, "Number");
  const ticket = await store.getTicket(business.id, ticketId);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  if (ticket.status !== "called" && ticket.status !== "on_hold") {
    throw new ApiError(409, "It's not your turn yet.");
  }

  if (ticket.confirmed !== 1) {
    const updated = await store.confirmTicket(business.id, ticket.id, true);
    publishBranch(ticket.branch_id, ticket.service_id);
    res.json({ ok: true, ticket: updated ? customerTicketView(updated, 0) : null });
    return;
  }
  res.json({ ok: true, ticket: customerTicketView(ticket, 0) });
});

queueRouter.post("/:slug/ticket/:ticketId/leave", limit("leave", 40, 60_000), async (req, res) => {
  const business = await findBusiness(String(req.params.slug));
  const ticketId = idParam(req.params.ticketId, "Number");
  const ticket = await store.getTicket(business.id, ticketId);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  if (!["waiting", "called", "on_hold"].includes(ticket.status)) {
    throw new ApiError(409, "That number can't leave the queue anymore.");
  }

  // Kept as a cancelled row so the shop's history stays truthful.
  const updated = await store.actOnTicket({
    businessId: business.id,
    ticketId: ticket.id,
    action: "cancel",
    actor: "customer",
  });
  publishBranch(ticket.branch_id, ticket.service_id);
  res.json({ ok: true, status: updated?.status ?? "cancelled" });
});

queueRouter.get("/:slug/stream", async (req, res) => {
  const business = await findBusiness(String(req.params.slug));
  subscribe(await channelFor(business, req.query.channel), res);
});

/**
 * A channel is only honoured when the id inside it belongs to this business,
 * so one shop can never listen to another's changes.
 */
async function channelFor(business: BusinessRow, wanted: unknown): Promise<string> {
  const raw = typeof wanted === "string" ? wanted : "";
  const [kind, id] = raw.split(":");
  if (id) {
    if (kind === "business" && id === business.id) return `business:${business.id}`;
    if (kind === "service") {
      const service = await store.getService(id);
      if (service && service.business_id === business.id) return `service:${service.id}`;
    }
    if (kind === "branch") {
      const branch = await store.getBranch(id);
      if (branch && branch.business_id === business.id) return `branch:${branch.id}`;
    }
  }
  return `business:${business.id}`;
}

export { findBusiness, resolveBranch, resolveService, publishService };