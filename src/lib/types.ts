export type TicketStatus = "waiting" | "called" | "served" | "skipped" | "no_show";

export interface PublicBusiness {
  slug: string;
  name: string;
  ownerName: string;
  email: string;
  note: string;
  paused: boolean;
}

export interface QueueInfo {
  slug: string;
  name: string;
  note: string;
  paused: boolean;
}

export interface CustomerTicket {
  id: string;
  number: number;
  name: string;
  status: TicketStatus;
  confirmed: boolean;
  peopleAhead: number;
  createdAt: number;
}

export interface StaffTicket {
  id: string;
  number: number;
  name: string;
  status: TicketStatus;
  confirmed: boolean;
  createdAt: number;
}

export interface QueueSnapshot {
  queue: QueueInfo;
  nowServing: number | null;
  waitingCount: number;
  nextWaiting: number[];
  ticket: CustomerTicket | null;
}

export interface StaffSnapshot {
  business: PublicBusiness;
  tickets: StaffTicket[];
}
