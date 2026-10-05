import { store, type BusinessRow, type TicketRow } from "./store";

export function publicBusiness(business: BusinessRow) {
  return {
    slug: business.slug,
    name: business.name,
    ownerName: business.owner_name,
    email: business.email,
    note: business.customer_note,
    paused: business.paused === 1,
  };
}

export function queueView(business: BusinessRow) {
  return {
    slug: business.slug,
    name: business.name,
    note: business.customer_note,
    paused: business.paused === 1,
  };
}

export async function ticketView(ticket: TicketRow) {
  return {
    id: ticket.id,
    number: ticket.number,
    name: ticket.name,
    status: ticket.status,
    confirmed: ticket.confirmed === 1,
    peopleAhead: ticket.status === "waiting" ? await store.peopleAhead(ticket) : 0,
    createdAt: ticket.created_at,
  };
}

export function staffTicketView(ticket: TicketRow) {
  return {
    id: ticket.id,
    number: ticket.number,
    name: ticket.name,
    status: ticket.status,
    confirmed: ticket.confirmed === 1,
    createdAt: ticket.created_at,
  };
}
