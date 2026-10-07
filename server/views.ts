import { can } from "./permissions";
import type {
  AuditRow,
  BranchRow,
  BusinessRow,
  Capability,
  CounterRow,
  EventRow,
  InviteRow,
  ServiceRow,
  StaffRow,
  TicketRow,
} from "./rows";
import type { HistoryRow } from "./store";

export function publicBusiness(business: BusinessRow) {
  return {
    slug: business.slug,
    name: business.name,
    ownerName: business.owner_name,
    email: business.email,
    note: business.customer_note,
    brandColor: business.brand_color,
    brandAccent: business.brand_accent,
    logo: business.logo_data || business.logo_url,
    paused: business.paused === 1,
  };
}

export function publicBranch(branch: BranchRow) {
  return {
    id: branch.id,
    slug: branch.slug,
    name: branch.name,
    address: branch.address,
    phone: branch.phone,
    note: branch.note,
    paused: branch.paused === 1,
    sortOrder: branch.sort_order,
  };
}

export function staffBranch(branch: BranchRow) {
  return { ...publicBranch(branch), locked: branch.paused === 1 };
}

export function publicService(service: ServiceRow) {
  return {
    id: service.id,
    slug: service.slug,
    branchId: service.branch_id,
    name: service.name,
    prefix: service.prefix,
    description: service.description,
    averageMinutes: service.avg_minutes,
    paused: service.paused === 1,
    sortOrder: service.sort_order,
    openFrom: service.open_from,
    openTo: service.open_to,
  };
}

export function staffCounter(counter: CounterRow) {
  return {
    id: counter.id,
    serviceId: counter.service_id,
    name: counter.name,
    paused: counter.paused === 1,
    sortOrder: counter.sort_order,
  };
}

/** Never leaks the password hash or the invite token hash. */
export function staffView(staff: StaffRow, currentId?: string) {
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    branchId: staff.branch_id,
    allBranches: staff.branch_id === "",
    active: staff.active === 1,
    createdAt: staff.created_at,
    isYou: staff.id === currentId,
  };
}

export function inviteView(invite: InviteRow) {
  return {
    id: invite.id,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    branchId: invite.branch_id,
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
    acceptedAt: invite.accepted_at,
    expired: invite.expires_at > 0 && invite.expires_at < Date.now() && !invite.accepted_at,
  };
}

export function capabilitiesOf(role: StaffRow["role"]): Capability[] {
  const all: Capability[] = [
    "queue.read",
    "queue.operate",
    "queue.settings",
    "staff.manage",
    "reports.read",
  ];
  return all.filter((capability) => can(role, capability));
}

export function staffTicketView(ticket: TicketRow, peopleAhead: number) {
  return {
    id: ticket.id,
    number: ticket.number,
    label: `${ticket.prefix || ""}${ticket.number}`,
    name: ticket.name,
    phone: ticket.phone,
    note: ticket.note,
    status: ticket.status,
    confirmed: ticket.confirmed === 1,
    source: ticket.source,
    counterId: ticket.counter_id,
    serviceId: ticket.service_id,
    branchId: ticket.branch_id,
    skipCount: ticket.skip_count,
    peopleAhead,
    createdAt: ticket.created_at,
    calledAt: ticket.called_at,
    servedAt: ticket.served_at,
    closedAt: ticket.closed_at,
  };
}

export function customerTicketView(ticket: TicketRow, peopleAhead: number) {
  return {
    id: ticket.id,
    number: ticket.number,
    label: `${ticket.prefix || ""}${ticket.number}`,
    name: ticket.name,
    status: ticket.status,
    confirmed: ticket.confirmed === 1,
    peopleAhead,
    skipCount: ticket.skip_count,
    serviceId: ticket.service_id,
    branchId: ticket.branch_id,
    createdAt: ticket.created_at,
  };
}

export function historyView(row: HistoryRow) {
  return {
    ...staffTicketView(row.ticket, 0),
    waitMinutes: row.waitMinutes,
    serviceMinutes: row.serviceMinutes,
  };
}

export function eventView(event: EventRow) {
  return {
    id: event.id,
    ticketId: event.ticket_id,
    serviceId: event.service_id,
    branchId: event.branch_id,
    type: event.type,
    actor: event.actor,
    detail: event.detail,
    at: event.at,
  };
}

export function auditView(entry: AuditRow) {
  return {
    id: entry.id,
    actorName: entry.actor_name || "Someone",
    action: entry.action,
    detail: entry.detail,
    branchId: entry.branch_id,
    at: entry.at,
  };
}

export function serviceSummaryView(summary: {
  service: ServiceRow;
  waiting: number;
  called: number;
  nowServing: TicketRow | null;
  counters: number;
  averageWaitMinutes: number;
}) {
  return {
    service: publicService(summary.service),
    waiting: summary.waiting,
    called: summary.called,
    nowServing: summary.nowServing ? summary.nowServing.number : null,
    counters: summary.counters,
    averageWaitMinutes: summary.averageWaitMinutes,
  };
}