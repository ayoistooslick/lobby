import { Router } from "express";
import { authed, requireAuth, requireBranch } from "../auth";
import { can } from "../permissions";
import { dayKey, dayRange, isDayKey } from "../rows";
import { limit } from "../rateLimit";
import { store } from "../store";
import { ApiError, id as idParam } from "../validate";
import { auditView, eventView, historyView, publicBranch, publicService } from "../views";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

function dayQuery(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback;
  if (!isDayKey(raw)) throw new ApiError(400, "Dates must look like 2026-01-31.");
  return raw;
}

/** Today for the last `days` days, capped so a typo cannot scan the table. */
function rangeOf(days: unknown): { from: string; to: string } {
  const asked = Number(days ?? 7);
  const span = Number.isFinite(asked) ? Math.min(90, Math.max(1, Math.trunc(asked))) : 7;
  return dayRange(span);
}

reportsRouter.get("/history", limit("history", 120, 60_000), async (req, res) => {
  const scope = await authed(req);
  if (!can(scope.staff.role, "reports.read")) {
    throw new ApiError(403, "Your role cannot see reports.");
  }
  const branch = await requireBranch(req, req.query.branch);
  const serviceId = req.query.service ? idParam(req.query.service, "Queue") : undefined;
  if (serviceId) {
    const service = await store.getService(serviceId);
    if (!service || service.branch_id !== branch.id) {
      throw new ApiError(404, "We couldn't find that queue.");
    }
  }
  const today = dayKey();
  const from = dayQuery(req.query.from, dayRange(7).from);
  const to = dayQuery(req.query.to, today);
  if (from > to) throw new ApiError(400, "The start date must come before the end date.");

  const rows = await store.listHistory({
    businessId: scope.business.id,
    branchId: branch.id,
    serviceId,
    fromDay: from,
    toDay: to,
    limit: Number(req.query.limit ?? 200),
  });

  res.json({
    ok: true,
    branch: publicBranch(branch),
    range: { from, to },
    history: rows.map(historyView),
  });
});

reportsRouter.get("/analytics", limit("analytics", 120, 60_000), async (req, res) => {
  const scope = await authed(req);
  if (!can(scope.staff.role, "reports.read")) {
    throw new ApiError(403, "Your role cannot see reports.");
  }
  const branch = await requireBranch(req, req.query.branch);
  const serviceId = req.query.service ? idParam(req.query.service, "Queue") : undefined;
  if (serviceId) {
    const service = await store.getService(serviceId);
    if (!service || service.branch_id !== branch.id) {
      throw new ApiError(404, "We couldn't find that queue.");
    }
  }
  const { from, to } = rangeOf(req.query.days);
  const report = await store.analytics({
    businessId: scope.business.id,
    branchId: branch.id,
    serviceId,
    fromDay: from,
    toDay: to,
  });

  const queues = serviceId ? [] : (await store.listServices(branch.id)).map((service) => publicService(service));
  res.json({ ok: true, branch: publicBranch(branch), queues, ...report });
});

/** Who changed what: settings, team changes and queue overrides. */
reportsRouter.get("/audit", limit("audit", 60, 60_000), async (req, res) => {
  const scope = await authed(req);
  if (!can(scope.staff.role, "reports.read")) {
    throw new ApiError(403, "Your role cannot see reports.");
  }
  const branchId = req.query.branch ? idParam(req.query.branch, "Branch") : undefined;
  if (branchId) await requireBranch(req, branchId);
  const entries = await store.listAudit({
    businessId: scope.business.id,
    branchId,
    limit: Number(req.query.limit ?? 60),
  });
  res.json({ ok: true, entries: entries.map(auditView) });
});

/** Raw queue events, newest first. Powers the activity feed and the tests. */
reportsRouter.get("/events", limit("events", 120, 60_000), async (req, res) => {
  const scope = await authed(req);
  const branchId = req.query.branch ? idParam(req.query.branch, "Branch") : undefined;
  if (branchId) await requireBranch(req, branchId);
  const businessId = scope.business.id;
  const events = await store.listEvents({
    businessId,
    limit: Number(req.query.limit ?? 60),
  });
  const filtered = branchId ? events.filter((event) => event.branch_id === branchId) : events;
  res.json({ ok: true, events: filtered.map(eventView) });
});