import { Router, type Request, type Response } from "express";
import { publish } from "../events";
import { authed, requireAuth } from "../auth";
import { store, today, type TicketStatus } from "../store";
import { limit } from "../rateLimit";
import { ApiError, optionalText, text } from "../validate";
import { publicBusiness, staffTicketView } from "../views";

export const staffRouter = Router();

staffRouter.use(requireAuth);

staffRouter.get("/queue", async (req, res) => {
  const business = await authed(req);
  const tickets = await store.listTickets(business.id, today());
  res.json({
    ok: true,
    business: publicBusiness(business),
    tickets: tickets.map(staffTicketView),
  });
});

staffRouter.post("/queue/call-next", limit("call-next", 60, 60_000), async (req, res) => {
  const business = await authed(req);
  const calledId = await store.callNext(business.id);
  if (!calledId) throw new ApiError(409, "Nobody is waiting right now.");
  publish(business.slug);
  res.json({ ok: true, ticketId: calledId });
});

staffRouter.post("/queue/pause", async (req, res) => {
  const business = await authed(req);
  const paused = req.body?.paused;
  if (typeof paused !== "boolean") {
    throw new ApiError(400, "Choose whether the queue is open or paused.");
  }

  await store.updateBusinessPaused(business.id, paused);
  publish(business.slug);
  res.json({ ok: true, business: publicBusiness({ ...business, paused: paused ? 1 : 0 }) });
});

function ticketAction(status: TicketStatus) {
  return async (req: Request, res: Response) => {
    const business = await authed(req);
    const ticket = await getTicketFor(business.id, String(req.params.ticketId));
    if (ticket.status !== "waiting" && ticket.status !== "called") {
      throw new ApiError(409, "That number is already finished.");
    }

    await store.setTicketStatus(ticket.id, business.id, status, Date.now());
    publish(business.slug);
    res.json({ ok: true });
  };
}

async function getTicketFor(businessId: string, ticketId: string) {
  const ticket = await store.getTicket(ticketId, businessId);
  if (!ticket) throw new ApiError(404, "We couldn't find that number.");
  return ticket;
}

staffRouter.post("/tickets/:ticketId/served", ticketAction("served"));
staffRouter.post("/tickets/:ticketId/skipped", ticketAction("skipped"));
staffRouter.post("/tickets/:ticketId/no-show", ticketAction("no_show"));

staffRouter.patch("/business", async (req, res) => {
  const business = await authed(req);
  const hasName = req.body?.name !== undefined;
  const hasNote = req.body?.customerNote !== undefined;
  if (!hasName && !hasNote) throw new ApiError(400, "No changes were sent.");

  const name = hasName ? text(req.body.name, { label: "Business name", min: 2, max: 80 }) : business.name;
  const note = hasNote ? optionalText(req.body.customerNote, "Note for customers", 200) : business.customer_note;

  await store.updateBusinessProfile(business.id, name, note);
  publish(business.slug);
  res.json({ ok: true, business: publicBusiness({ ...business, name, customer_note: note }) });
});
