import { Router } from "express";
import { publish, subscribe } from "../events";
import { currentNumber, db, getBusinessBySlug, getTicket, createTicket, waitingCount, type BusinessRow } from "../db";
import { limit } from "../rateLimit";
import { ApiError, isSlug, optionalText, QUEUE_NOT_FOUND } from "../validate";
import { queueView, ticketView } from "../views";

export const queueRouter = Router();

function findQueue(slug: string): BusinessRow {
  if (!isSlug(slug)) throw new ApiError(404, QUEUE_NOT_FOUND);
  const business = getBusinessBySlug(slug);
  if (!business) throw new ApiError(404, QUEUE_NOT_FOUND);
  return business;
}

queueRouter.get("/:slug", limit("queue", 240, 60_000), (req, res) => {
  const business = findQueue(req.params.slug);
  const requested = typeof req.query.ticket === "string" ? req.query.ticket : "";
  const ticket = requested ? getTicket(requested, business.id) : undefined;

  res.json({
    ok: true,
    queue: queueView(business),
    nowServing: currentNumber(business.id),
    waitingCount: waitingCount(business.id),
    ticket: ticket ? ticketView(ticket) : null,
  });
});

// Two caps: per visitor IP, and per queue so one busy shop can't be flooded.
const joinLimits = [
  limit("join-ip", 30, 60_000),
  limit("join-queue", 20, 60_000, (req) => req.params.slug ?? "unknown"),
];

queueRouter.post("/:slug/join", ...joinLimits, (req, res) => {
  const business = findQueue(req.params.slug);
  if (business.paused === 1) {
    throw new ApiError(409, "This queue is paused right now. Please check back later.");
  }
  const name = optionalText(req.body?.name, "Name", 40);
  const ticket = createTicket(business.id, name);
  publish(business.slug);
  res.status(201).json({ ok: true, ticket: ticketView(ticket) });
});

queueRouter.get("/:slug/ticket/:ticketId", limit("ticket", 240, 60_000), (req, res) => {
  const business = findQueue(req.params.slug);
  const ticket = getTicket(req.params.ticketId, business.id);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  res.json({ ok: true, ticket: ticketView(ticket) });
});

queueRouter.post("/:slug/ticket/:ticketId/confirm", limit("confirm", 30, 60_000), (req, res) => {
  const business = findQueue(req.params.slug);
  const ticket = getTicket(req.params.ticketId, business.id);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  if (ticket.status !== "called") throw new ApiError(409, "It's not your turn yet.");

  if (ticket.confirmed !== 1) {
    db.prepare("UPDATE tickets SET confirmed = 1, updated_at = ? WHERE id = ?").run(Date.now(), ticket.id);
    publish(business.slug);
  }
  res.json({ ok: true, ticket: ticketView({ ...ticket, confirmed: 1 }) });
});

queueRouter.post("/:slug/ticket/:ticketId/leave", limit("leave", 30, 60_000), (req, res) => {
  const business = findQueue(req.params.slug);
  const ticket = getTicket(req.params.ticketId, business.id);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  if (ticket.status !== "waiting") {
    throw new ApiError(409, "This number can't leave the queue anymore.");
  }

  db.prepare("DELETE FROM tickets WHERE id = ?").run(ticket.id);
  publish(business.slug);
  res.json({ ok: true });
});

queueRouter.get("/:slug/stream", (req, res) => {
  const business = findQueue(req.params.slug);
  subscribe(business.slug, res);
});
