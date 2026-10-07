import { Router } from "express";
import { subscribe } from "../events";
import { limit } from "../rateLimit";
import { store } from "../store";
import { ApiError, isSlug } from "../validate";
import { publicBranch, publicBusiness, publicService, staffCounter } from "../views";

export const displayRouter = Router();

/**
 * The TV payload. Read-only, no customer names beyond what staff entered, and
 * shaped so one screen needs a single request to draw everything.
 */
displayRouter.get("/:slug", limit("display", 600, 60_000), async (req, res) => {
  const slug = String(req.params.slug);
  if (!isSlug(slug)) throw new ApiError(404, "We couldn't find that shop.");
  const business = await store.getBusinessBySlug(slug);
  if (!business) throw new ApiError(404, "We couldn't find that shop.");

  const branches = (await store.listBranches(business.id)).filter((branch) => branch.paused !== 1);
  const branch = branches.find((entry) => entry.slug === String(req.query.branch ?? "")) ?? branches[0] ?? null;
  const services = branch
    ? (await store.listServices(branch.id)).filter((service) => service.paused !== 1)
    : [];
  const service =
    services.find((entry) => entry.slug === String(req.query.service ?? "")) ?? services[0] ?? null;

  const snapshot = business && branch && service
    ? await store.snapshot(business.id, branch.id, service.id)
    : null;
  const counters = service ? await store.listCounters(service.id) : [];

  const others = [];
  if (branch) {
    const summaries = await store.serviceSummaries(business.id, branch.id);
    for (const summary of summaries) {
      if (service && summary.service.id === service.id) continue;
      others.push({
        service: publicService(summary.service),
        nowServing: summary.nowServing
          ? `${summary.nowServing.prefix || ""}${summary.nowServing.number}`
          : null,
        waiting: summary.waiting,
      });
    }
  }

  res.json({
    ok: true,
    business: publicBusiness(business),
    branches: branches.map(publicBranch),
    branch: branch ? publicBranch(branch) : null,
    services: services.map(publicService),
    service: service ? publicService(service) : null,
    counters: counters.map(staffCounter),
    nowServing: snapshot?.nowServing
      ? `${snapshot.nowServing.prefix || ""}${snapshot.nowServing.number}`
      : null,
    called: (snapshot?.called ?? [])
      .map((ticket) => ({ label: `${ticket.prefix || ""}${ticket.number}`, at: ticket.called_at }))
      .slice(-8),
    waiting: (snapshot?.waiting ?? [])
      .slice(0, 12)
      .map((ticket) => `${ticket.prefix || ""}${ticket.number}`),
    waitingCount: snapshot?.waitingCount ?? 0,
    averageWaitMinutes: snapshot?.averageWaitMinutes ?? 0,
    updatedAt: Date.now(),
    others,
  });
});

/** TV screens stay open on one channel and repaint when the queue changes. */
displayRouter.get("/:slug/stream", async (req, res) => {
  const slug = String(req.params.slug);
  if (!isSlug(slug)) throw new ApiError(404, "We couldn't find that shop.");
  const business = await store.getBusinessBySlug(slug);
  if (!business) throw new ApiError(404, "We couldn't find that shop.");

  // The channel is only honoured when the id inside it belongs to this shop,
  // so one business's screen can never wait on another's updates.
  const wanted = typeof req.query.channel === "string" ? req.query.channel : "";
  const [kind, id] = wanted.split(":");
  let channel = `business:${business.id}`;
  if (kind === "service" && id) {
    const service = await store.getService(id);
    if (service && service.business_id === business.id) channel = `service:${service.id}`;
  } else if (kind === "branch" && id) {
    const branch = await store.getBranch(id);
    if (branch && branch.business_id === business.id) channel = `branch:${branch.id}`;
  }
  subscribe(channel, res);
});