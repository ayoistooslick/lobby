import { Router, type Request } from "express";
import { authed, requireAuth, requireBranch } from "../auth";
import { publishBranch, publishBusiness } from "../events";
import { can } from "../permissions";
import { limit } from "../rateLimit";
import type { BranchRow, CounterRow, ServiceRow } from "../rows";
import { store } from "../store";
import { findTemplate, normalisePrefix } from "../templates";
import {
  ApiError,
  boolean,
  colour,
  id as idParam,
  logoValue,
  optionalText,
  text,
  timeOfDay,
} from "../validate";
import { publicBranch, publicBusiness, publicService, staffCounter } from "../views";

export const setupRouter = Router();

setupRouter.use(requireAuth);

async function needSettings(req: Request): Promise<void> {
  const scope = await authed(req);
  if (!can(scope.staff.role, "queue.settings")) {
    throw new ApiError(403, "Only a manager or the owner can change these settings.");
  }
}

/** Every row below is checked against the session's business before it moves. */
async function ownService(req: Request, serviceId: unknown) {
  const scope = await authed(req);
  const service = await store.getService(idParam(serviceId, "Queue"));
  if (!service || service.business_id !== scope.business.id) {
    throw new ApiError(404, "We couldn't find that queue.");
  }
  if (scope.staff.branch_id && scope.staff.branch_id !== service.branch_id) {
    throw new ApiError(404, "We couldn't find that queue.");
  }
  return service;
}

async function ownCounter(req: Request, counterId: unknown) {
  const scope = await authed(req);
  const counter = await store.getCounter(idParam(counterId, "Counter"));
  if (!counter || counter.business_id !== scope.business.id) {
    throw new ApiError(404, "We couldn't find that counter.");
  }
  if (scope.staff.branch_id && scope.staff.branch_id !== counter.branch_id) {
    throw new ApiError(404, "We couldn't find that counter.");
  }
  return counter;
}

setupRouter.get("/branches", async (req, res) => {
  const scope = await authed(req);
  const all = await store.listBranches(scope.business.id);
  const branches = all.filter(
    (branch) => scope.staff.branch_id === "" || scope.staff.branch_id === branch.id
  );
  const withQueues = await Promise.all(
    branches.map(async (branch) => ({
      ...publicBranch(branch),
      services: (await store.listServices(branch.id)).map(publicService),
    }))
  );
  res.json({ ok: true, branches: withQueues });
});

setupRouter.post("/branches", limit("branch-create", 30, 3_600_000), async (req, res) => {
  await needSettings(req);
  const scope = await authed(req);
  const name = text(req.body?.name, { label: "Branch name", min: 2, max: 60 });
  const branch = await store.createBranch(scope.business.id, {
    name,
    address: optionalText(req.body?.address, "Address", 160),
    phone: optionalText(req.body?.phone, "Phone", 32),
  });
  publishBusiness(scope.business.id, branch.id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: branch.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "branch.created",
    detail: branch.name,
  });
  res.status(201).json({ ok: true, branch: publicBranch(branch) });
});

setupRouter.patch("/branches/:branchId", async (req, res) => {
  await needSettings(req);
  const scope = await authed(req);
  const branch = await store.getBranch(idParam(req.params.branchId, "Branch"));
  if (!branch || branch.business_id !== scope.business.id) {
    throw new ApiError(404, "We couldn't find that branch.");
  }
  if (scope.staff.branch_id && scope.staff.branch_id !== branch.id) {
    throw new ApiError(403, "You can only edit your own branch.");
  }

  const patch: Partial<BranchRow> = {};
  if (req.body?.name !== undefined) patch.name = text(req.body.name, { label: "Branch name", min: 2, max: 60 });
  if (req.body?.address !== undefined) patch.address = optionalText(req.body.address, "Address", 160);
  if (req.body?.phone !== undefined) patch.phone = optionalText(req.body.phone, "Phone", 32);
  if (req.body?.note !== undefined) patch.note = optionalText(req.body.note, "Note for customers", 200);
  if (req.body?.paused !== undefined) patch.paused = boolean(req.body.paused, "Paused") ? 1 : 0;
  if (!Object.keys(patch).length) throw new ApiError(400, "No changes were sent.");

  const updated = await store.updateBranch(branch.id, patch);
  publishBusiness(scope.business.id, branch.id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: branch.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "branch.updated",
    detail: branch.name,
  });
  res.json({ ok: true, branch: updated ? publicBranch(updated) : null });
});

setupRouter.delete("/branches/:branchId", async (req, res) => {
  const scope = await authed(req);
  if (!can(scope.staff.role, "queue.settings")) {
    throw new ApiError(403, "Only a manager or the owner can remove a branch.");
  }
  const branch = await store.getBranch(idParam(req.params.branchId, "Branch"));
  if (!branch || branch.business_id !== scope.business.id) {
    throw new ApiError(404, "We couldn't find that branch.");
  }
  const open = await store.listBranchTickets(scope.business.id, branch.id, 1);
  if (open.some((ticket) => ["waiting", "called", "on_hold"].includes(ticket.status))) {
    throw new ApiError(409, "Clear this queue before removing the branch.");
  }
  try {
    await store.deleteBranch(branch.id);
  } catch (err) {
    throw new ApiError(409, err instanceof Error ? err.message : "That branch cannot be removed.");
  }
  await store.logAudit({
    businessId: scope.business.id,
    branchId: branch.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "branch.deleted",
    detail: branch.name,
  });
  publishBusiness(scope.business.id);
  res.json({ ok: true });
});

setupRouter.get("/services", async (req, res) => {
  const branch = await requireBranch(req, req.query.branch);
  const services = await store.listServices(branch.id);
  const withCounters = await Promise.all(
    services.map(async (service) => ({
      ...publicService(service),
      counters: (await store.listCounters(service.id)).map(staffCounter),
    }))
  );
  res.json({ ok: true, branch: publicBranch(branch), services: withCounters });
});

setupRouter.post("/services", limit("service-create", 60, 3_600_000), async (req, res) => {
  await needSettings(req);
  const scope = await authed(req);
  const branch = await requireBranch(req, req.body?.branchId);
  const name = text(req.body?.name, { label: "Queue name", min: 2, max: 60 });
  const service = await store.createService(scope.business.id, branch.id, {
    name,
    prefix: normalisePrefix(String(req.body?.prefix ?? ""), "A"),
    description: optionalText(req.body?.description, "Description", 160),
    avgMinutes: Number(req.body?.avgMinutes ?? 5) || 5,
    counters: Number(req.body?.counters ?? 1) || 1,
    openFrom: timeOfDay(req.body?.openFrom, "Opens at"),
    openTo: timeOfDay(req.body?.openTo, "Closes at"),
  });
  publishBranch(branch.id, service.id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: branch.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "service.created",
    detail: service.name,
  });
  res.status(201).json({
    ok: true,
    service: publicService(service),
    counters: (await store.listCounters(service.id)).map(staffCounter),
  });
});

setupRouter.patch("/services/:serviceId", async (req, res) => {
  await needSettings(req);
  const scope = await authed(req);
  const service = await ownService(req, req.params.serviceId);
  const patch: Partial<ServiceRow> = {};
  if (req.body?.name !== undefined) patch.name = text(req.body.name, { label: "Queue name", min: 2, max: 60 });
  if (req.body?.prefix !== undefined) {
    patch.prefix = normalisePrefix(String(req.body.prefix), service.prefix);
  }
  if (req.body?.description !== undefined) {
    patch.description = optionalText(req.body.description, "Description", 160);
  }
  if (req.body?.avgMinutes !== undefined) {
    const minutes = Number(req.body.avgMinutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) {
      throw new ApiError(400, "Typical service time must be between 1 and 240 minutes.");
    }
    patch.avg_minutes = Math.round(minutes);
  }
  if (req.body?.paused !== undefined) patch.paused = boolean(req.body.paused, "Paused") ? 1 : 0;
  if (req.body?.openFrom !== undefined) patch.open_from = timeOfDay(req.body.openFrom, "Opens at");
  if (req.body?.openTo !== undefined) patch.open_to = timeOfDay(req.body.openTo, "Closes at");
  if (!Object.keys(patch).length) throw new ApiError(400, "No changes were sent.");

  const updated = await store.updateService(service.id, patch);
  publishBranch(service.branch_id, service.id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: service.branch_id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "service.updated",
    detail: service.name,
  });
  res.json({ ok: true, service: updated ? publicService(updated) : null });
});

setupRouter.delete("/services/:serviceId", async (req, res) => {
  await needSettings(req);
  const scope = await authed(req);
  const service = await ownService(req, req.params.serviceId);
  const siblings = await store.listServices(service.branch_id);
  if (siblings.length <= 1) {
    throw new ApiError(409, "A branch needs at least one queue.");
  }
  const open = (await store.listQueue(scope.business.id, service.branch_id, service.id)).filter(
    (ticket) => ["waiting", "called", "on_hold"].includes(ticket.status)
  );
  if (open.length) throw new ApiError(409, "Clear this queue before removing it.");
  await store.deleteService(service.id);
  publishBranch(service.branch_id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: service.branch_id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "service.deleted",
    detail: service.name,
  });
  res.json({ ok: true });
});

/** Adds a whole set of queues at once, from a ready-made shop type. */
setupRouter.post("/services/apply-template", limit("template", 20, 3_600_000), async (req, res) => {
  await needSettings(req);
  const scope = await authed(req);
  const branch = await requireBranch(req, req.body?.branchId);
  const template = findTemplate(String(req.body?.template ?? "generic"));
  const existing = await store.listServices(branch.id);
  if (existing.length) {
    throw new ApiError(409, "This branch already has queues. Remove them first, or edit them instead.");
  }
  const created = [];
  for (const entry of template.services) {
    created.push(
      await store.createService(scope.business.id, branch.id, {
        name: entry.name,
        prefix: entry.prefix,
        description: entry.description,
        avgMinutes: entry.avgMinutes,
        counters: entry.counters.length,
      })
    );
  }
  publishBranch(branch.id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: branch.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "template.applied",
    detail: template.label,
  });
  res.status(201).json({ ok: true, services: created.map(publicService) });
});

setupRouter.post("/counters", limit("counter-create", 120, 3_600_000), async (req, res) => {
  await needSettings(req);
  const scope = await authed(req);
  const service = await ownService(req, req.body?.serviceId);
  const name = text(req.body?.name, { label: "Counter name", min: 1, max: 40 });
  const counters = await store.listCounters(service.id);
  if (counters.length >= 8) throw new ApiError(409, "Eight counters per queue is the limit.");
  const counter = await store.createCounter(scope.business.id, service.branch_id, service.id, name);
  publishBranch(service.branch_id, service.id);
  await store.logAudit({
    businessId: scope.business.id,
    branchId: service.branch_id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "counter.created",
    detail: `${service.name} · ${counter.name}`,
  });
  res.status(201).json({ ok: true, counter: staffCounter(counter) });
});

setupRouter.patch("/counters/:counterId", async (req, res) => {
  await needSettings(req);
  const counter = await ownCounter(req, req.params.counterId);
  const patch: Partial<CounterRow> = {};
  if (req.body?.name !== undefined) patch.name = text(req.body.name, { label: "Counter name", min: 1, max: 40 });
  if (req.body?.paused !== undefined) patch.paused = boolean(req.body.paused, "Paused") ? 1 : 0;
  if (!Object.keys(patch).length) throw new ApiError(400, "No changes were sent.");
  const updated = await store.updateCounter(counter.id, patch);
  publishBranch(counter.branch_id, counter.service_id);
  res.json({ ok: true, counter: updated ? staffCounter(updated) : null });
});

setupRouter.delete("/counters/:counterId", async (req, res) => {
  await needSettings(req);
  const scope = await authed(req);
  const counter = await ownCounter(req, req.params.counterId);
  const siblings = await store.listCounters(counter.service_id);
  if (siblings.length <= 1) throw new ApiError(409, "A queue needs at least one counter.");
  const seated = (await store.listQueue(scope.business.id, counter.branch_id, counter.service_id)).some(
    (ticket) => ticket.counter_id === counter.id && ticket.status === "called"
  );
  if (seated) throw new ApiError(409, "Nobody is at that counter right now.");
  await store.deleteCounter(counter.id);
  publishBranch(counter.branch_id, counter.service_id);
  res.json({ ok: true });
});

/** Name, note for customers, logo and brand colours. */
setupRouter.patch("/business", async (req, res) => {
  await needSettings(req);
  const scope = await authed(req);
  const patch: Record<string, unknown> = {};
  if (req.body?.name !== undefined) patch.name = text(req.body.name, { label: "Business name", min: 2, max: 80 });
  if (req.body?.customerNote !== undefined) {
    patch.customer_note = optionalText(req.body.customerNote, "Note for customers", 200);
  }
  if (req.body?.brandColor !== undefined) {
    patch.brand_color = colour(req.body.brandColor, "Brand colour");
  }
  if (req.body?.brandAccent !== undefined) {
    patch.brand_accent = colour(req.body.brandAccent, "Highlight colour");
  }
  if (req.body?.logo !== undefined) {
    patch.logo_url = logoValue(req.body.logo, "Logo", 500_000);
    patch.logo_data = "";
  }
  if (req.body?.logoData !== undefined) {
    patch.logo_data = logoValue(req.body.logoData, "Logo", 500_000);
    patch.logo_url = "";
  }
  if (req.body?.paused !== undefined) patch.paused = boolean(req.body.paused, "Paused") ? 1 : 0;
  if (!Object.keys(patch).length) throw new ApiError(400, "No changes were sent.");

  const updated = await store.updateBusiness(scope.business.id, patch);
  publishBusiness(scope.business.id);
  await store.logAudit({
    businessId: scope.business.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "business.updated",
    detail: String(patch.name ?? "details"),
  });
  res.json({ ok: true, business: updated ? publicBusiness(updated) : null });
});