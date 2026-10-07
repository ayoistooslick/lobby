import type { Capability, StaffRole } from "./rows";

const MATRIX: Record<StaffRole, Capability[]> = {
  owner: ["queue.read", "queue.operate", "queue.settings", "staff.manage", "reports.read"],
  manager: ["queue.read", "queue.operate", "queue.settings", "staff.manage", "reports.read"],
  staff: ["queue.read", "queue.operate"],
  viewer: ["queue.read", "reports.read"],
};

/** Owners manage the whole business. Everyone else is bounded by the matrix. */
export function can(role: StaffRole, capability: Capability): boolean {
  return MATRIX[role]?.includes(capability) ?? false;
}

/** Roles a given actor is allowed to hand out. */
export function assignableRoles(actor: StaffRole): StaffRole[] {
  if (actor === "owner") return ["owner", "manager", "staff", "viewer"];
  if (actor === "manager") return ["staff", "viewer"];
  return [];
}

export function rank(role: StaffRole): number {
  return ["viewer", "staff", "manager", "owner"].indexOf(role);
}

/** True when `actor` may change the role of, or remove, a member with `target`. */
export function mayManage(actor: StaffRole, target: StaffRole): boolean {
  if (actor === "owner") return true;
  if (actor === "manager") return rank(target) < rank("manager");
  return false;
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  viewer: "Viewer",
};

export const ROLE_HELP: Record<StaffRole, string> = {
  owner: "Everything, including people and business details.",
  manager: "Runs the queues and can invite staff.",
  staff: "Calls and serves customers.",
  viewer: "Sees the queue and reports, cannot change anything.",
};
