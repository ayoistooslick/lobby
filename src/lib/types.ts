export type TicketStatus =
  | "waiting"
  | "called"
  | "on_hold"
  | "served"
  | "skipped"
  | "no_show"
  | "cancelled";

export type StaffRole = "owner" | "manager" | "staff" | "viewer";

export type Capability =
  | "queue.read"
  | "queue.operate"
  | "queue.settings"
  | "staff.manage"
  | "reports.read";

export interface PublicBusiness {
  slug: string;
  name: string;
  ownerName: string;
  email: string;
  note: string;
  brandColor: string;
  brandAccent: string;
  logo: string;
  paused: boolean;
}

export interface Branch {
  id: string;
  slug: string;
  name: string;
  address: string;
  phone: string;
  note: string;
  paused: boolean;
  sortOrder: number;
}

export interface Service {
  id: string;
  slug: string;
  branchId: string;
  name: string;
  prefix: string;
  description: string;
  averageMinutes: number;
  paused: boolean;
  sortOrder: number;
  openFrom: string;
  openTo: string;
}

export interface Counter {
  id: string;
  serviceId: string;
  name: string;
  paused: boolean;
  sortOrder: number;
}

export interface ServiceWithCounters extends Service {
  counters: Counter[];
}

export interface CustomerTicket {
  id: string;
  number: number;
  label: string;
  name: string;
  status: TicketStatus;
  confirmed: boolean;
  peopleAhead: number;
  skipCount: number;
  serviceId: string;
  branchId: string;
  createdAt: number;
}

export interface StaffTicket {
  id: string;
  number: number;
  label: string;
  name: string;
  phone: string;
  note: string;
  status: TicketStatus;
  confirmed: boolean;
  source: string;
  counterId: string;
  serviceId: string;
  branchId: string;
  skipCount: number;
  peopleAhead: number;
  createdAt: number;
  calledAt: number;
  servedAt: number;
  closedAt: number;
}

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  branchId: string;
  allBranches: boolean;
  active: boolean;
  createdAt: number;
  isYou: boolean;
  canEdit?: boolean;
}

export interface Invite {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  branchId: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number;
  expired: boolean;
}

export interface SessionPayload {
  business: PublicBusiness | null;
  staff: StaffMember | null;
  capabilities: Capability[];
  branches?: Branch[];
}

export interface ServiceSummary {
  service: Service;
  waiting: number;
  called: number;
  nowServing: number | null;
  counters: number;
  averageWaitMinutes: number;
}

export interface OverviewPayload {
  business: PublicBusiness;
  staff: StaffMember;
  capabilities: Capability[];
  branches: Branch[];
  branch: Branch | null;
  services: ServiceSummary[];
}

export interface QueuePayload {
  branch: Branch;
  service: Service;
  counters: Counter[];
  waiting: StaffTicket[];
  called: StaffTicket[];
  held: StaffTicket[];
  finished: StaffTicket[];
  nowServing: StaffTicket | null;
  waitingCount: number;
  averageWaitMinutes: number;
  estimatedWaitMinutes: number;
  servingCounters: number;
}

/** What the customer's own page receives. */
export interface CustomerPayload {
  business: PublicBusiness;
  branches: Branch[];
  branch: Branch | null;
  services: Service[];
  service: Service | null;
  nowServing: string | null;
  nowServingNumber: number | null;
  peopleWaiting: number;
  /** The next few numbers in line, so a stale page can still show the order. */
  nextWaiting: number[];
  estimatedWaitMinutes: number;
  ticket: CustomerTicket | null;
}

/** What a TV screen receives. */
export interface DisplayPayload {
  business: PublicBusiness;
  branches: Branch[];
  branch: Branch | null;
  services: Service[];
  service: Service | null;
  counters: Counter[];
  nowServing: string | null;
  called: Array<{ label: string; at: number }>;
  waiting: string[];
  waitingCount: number;
  averageWaitMinutes: number;
  updatedAt: number;
  others: Array<{ service: Service; nowServing: string | null; waiting: number }>;
}

export interface HistoryEntry extends StaffTicket {
  waitMinutes: number;
  serviceMinutes: number;
}

export interface AnalyticsPayload {
  branch: Branch;
  queues: Service[];
  range: { from: string; to: string };
  totals: {
    joined: number;
    served: number;
    skipped: number;
    noShow: number;
    abandoned: number;
    waiting: number;
    averageWaitMinutes: number;
    averageServiceMinutes: number;
    busiestHour: number | null;
  };
  daily: Array<{ day: string; joined: number; served: number; averageWaitMinutes: number }>;
  hours: Array<{ hour: number; joined: number; served: number }>;
  services: Array<{
    serviceId: string;
    name: string;
    joined: number;
    served: number;
    averageWaitMinutes: number;
  }>;
}

export interface AuditEntry {
  id: string;
  actorName: string;
  action: string;
  detail: string;
  branchId: string;
  at: number;
}

export interface TeamPayload {
  team: StaffMember[];
  invites: Invite[];
  branches: Branch[];
  roles: Array<{ key: StaffRole; label: string; help: string }>;
  yourRole: { key: StaffRole; label: string; help: string };
}

export interface TemplateInfo {
  key: string;
  label: string;
  blurb: string;
  services: Array<{ name: string; description: string; prefix: string; counters: number }>;
}

export interface DemoCard {
  service: Service;
  counters: Counter[];
  waiting: StaffTicket[];
  waitingCount: number;
  nowServing: StaffTicket | null;
  finished: StaffTicket[];
  servedCount: number;
}

export interface DemoPayload {
  business: PublicBusiness;
  branch: { id: string; slug: string; name: string };
  services: DemoCard[];
  totals: { waiting: number; served: number };
  capacity: number;
}