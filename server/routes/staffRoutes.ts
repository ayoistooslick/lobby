import { Router, type Request, type Response } from "express";
import { publish } from "../events";
import { authed, requireAuth } from "../auth";
import { db, listTickets, type TicketStatus } from "../db";
import { limit } from "../rateLimit";
import { ApiError, optionalText, text } from "../validate";
import { publicBusiness, staffTicketView } from "../views";

export const staffRouter = Router();

staffRouter.use(requireAuth);

staffRouter.get("/queue", (req, res) => {
  const business = authed(req);
  res.json({
    ok: true,
    business: publicBusiness(business),
    tickets: listTickets(business.id).map(staffTicketView),
  });
});

staffRouter.post("/queue/call-next", limit("call-next", 60, 60_000), (req, res) => {
  const business = authed(req);

  const calledId = db.transaction(() => {
    const now = Date.now();

    const current = db
      .prepare("SELECT id FROM tickets WHERE business_id = ? AND status = 'called'")
      .get(business.id) as { id: string } | undefined;
    if (current) {
      db.prepare("UPDATE tickets SET status = 'served', updated_at = ? WHERE id = ?").run(now, current.id);
    }

    const next = db
      .prepare(
        "SELECT id FROM tickets WHERE business_id = ? AND status = 'waiting' ORDER BY day ASC, number ASC LIMIT 1"
      )
      .get(business.id) as { id: string } | undefined;
    if (!next) return null;

    db.prepare("UPDATE tickets SET status = 'called', updated_at = ? WHERE id = ?").run(now, next.id);
    return next.id;
  })();

  if (!calledId) throw new ApiError(409, "Nobody is waiting right now.");
  publish(business.slug);
  res.json({ ok: true, ticketId: calledId });
});

staffRouter.post("/queue/pause", (req, res) => {
  const business = authed(req);
  const paused = req.body?.paused;
  if (typeof paused !== "boolean") {
    throw new ApiError(400, "Choose whether the queue is open or paused.");
  }

  db.prepare("UPDATE businesses SET paused = ? WHERE id = ?").run(paused ? 1 : 0, business.id);
  publish(business.slug);
  res.json({ ok: true, business: publicBusiness({ ...business, paused: paused ? 1 : 0 }) });
});

function ticketAction(status: TicketStatus) {
  return (req: Request, res: Response) => {
    const business = authed(req);
    const ticket = getTicketFor(business.id, req.params.ticketId);
    if (ticket.status !== "waiting" && ticket.status !== "called") {
      throw new ApiError(409, "That number is already finished.");
    }

    db.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?").run(
      status,
      Date.now(),
      ticket.id,
      business.id
    );
    publish(business.slug);
    res.json({ ok: true });
  };
}

function getTicketFor(businessId: string, ticketId: string) {
  const ticket = db
    .prepare("SELECT * FROM tickets WHERE id = ? AND business_id = ?")
    .get(ticketId, businessId) as { id: string; status: TicketStatus } | undefined;
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  return ticket;
}

staffRouter.post("/tickets/:ticketId/served", ticketAction("served"));
staffRouter.post("/tickets/:ticketId/skipped", ticketAction("skipped"));
staffRouter.post("/tickets/:ticketId/no-show", ticketAction("no_show"));

staffRouter.patch("/business", (req, res) => {
  const business = authed(req);
  const hasName = req.body?.name !== undefined;
  const hasNote = req.body?.customerNote !== undefined;
  if (!hasName && !hasNote) throw new ApiError(400, "No changes were sent.");

  const name = hasName ? text(req.body.name, { label: "Business name", min: 2, max: 80 }) : business.name;
  const note = hasNote ? optionalText(req.body.customerNote, "Note for customers", 200) : business.customer_note;

  db.prepare("UPDATE businesses SET name = ?, customer_note = ? WHERE id = ?").run(name, note, business.id);
  publish(business.slug);
  res.json({ ok: true, business: publicBusiness({ ...business, name, customer_note: note }) });
});
