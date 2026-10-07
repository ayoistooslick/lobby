import { Router, type Request } from "express";
import { authed, newInviteToken, requireAuth, type AuthScope } from "../auth";
import { can, assignableRoles, mayManage, rank, ROLE_HELP, ROLE_LABELS } from "../permissions";
import { limit } from "../rateLimit";
import type { StaffRole, StaffRow } from "../rows";
import { store } from "../store";
import { ApiError, boolean, email, id as idParam, optionalText, role, text } from "../validate";
import { inviteView, publicBranch, staffView } from "../views";

export const teamRouter = Router();

teamRouter.use(requireAuth);

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

async function needManager(req: Request): Promise<AuthScope> {
  const scope = await authed(req);
  if (!can(scope.staff.role, "staff.manage")) {
    throw new ApiError(403, "Only a manager or the owner can change the team.");
  }
  return scope;
}

teamRouter.get("/team", async (req, res) => {
  const scope = await authed(req);
  const members = await store.listStaff(scope.business.id);
  const invites = await store.listInvites(scope.business.id);
  const branches = await store.listBranches(scope.business.id);
  const manage = can(scope.staff.role, "staff.manage");

  res.json({
    ok: true,
    team: members
      // Branch-pinned staff only see their own branch's people.
      .filter((member) => scope.staff.branch_id === "" || member.branch_id === scope.staff.branch_id)
      .map((member) => ({
        ...staffView(member, scope.staff.id),
        canEdit: manage && mayManage(scope.staff.role, member.role),
      })),
    invites: manage
      ? invites
          .filter((invite) => !invite.accepted_at)
          .filter((invite) => scope.staff.branch_id === "" || invite.branch_id === scope.staff.branch_id)
          .map(inviteView)
      : [],
    branches: branches.map(publicBranch),
    roles: roleOptions(scope.staff.role),
    yourRole: {
      key: scope.staff.role,
      label: ROLE_LABELS[scope.staff.role],
      help: ROLE_HELP[scope.staff.role],
    },
  });
});

function roleOptions(actor: StaffRole): Array<{ key: StaffRole; label: string; help: string }> {
  return assignableRoles(actor).map((key) => ({
    key,
    label: ROLE_LABELS[key],
    help: ROLE_HELP[key],
  }));
}

teamRouter.post("/team/invites", limit("invite-create", 30, 3_600_000), async (req, res) => {
  const scope = await needManager(req);
  const address = email(req.body?.email);
  const name = optionalText(req.body?.name, "Name", 60) || address.split("@")[0];
  const wanted = role(req.body?.role ?? "staff");
  const allowed = assignableRoles(scope.staff.role);
  if (!allowed.includes(wanted)) {
    throw new ApiError(403, "You cannot give that role out.");
  }
  if (scope.staff.branch_id && scope.staff.branch_id !== String(req.body?.branchId ?? "")) {
    throw new ApiError(403, "You can only invite people to your own branch.");
  }
  if (await store.getStaffInBusiness(address, scope.business.id)) {
    throw new ApiError(409, "That email already has an account here.");
  }

  const branchId = scope.staff.branch_id || String(req.body?.branchId ?? "");
  if (branchId) {
    const branch = await store.getBranch(branchId);
    if (!branch || branch.business_id !== scope.business.id) {
      throw new ApiError(400, "Choose a branch from this business.");
    }
  }

  // Only one live invitation per address, so links never pile up.
  const existing = (await store.listInvites(scope.business.id)).find(
    (invite) => invite.email === address && !invite.accepted_at
  );
  if (existing) await store.deleteInvite(existing.id);

  const { token, tokenHash } = newInviteToken();
  const invite = await store.createInvite({
    businessId: scope.business.id,
    email: address,
    name,
    role: wanted,
    branchId,
    tokenHash,
    createdBy: scope.staff.id,
    expiresAt: Date.now() + INVITE_TTL_MS,
  });
  await store.logAudit({
    businessId: scope.business.id,
    branchId,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "invite.created",
    detail: `${address} as ${wanted}`,
  });
  res.status(201).json({ ok: true, invite: inviteView(invite), token });
});

teamRouter.delete("/team/invites/:inviteId", async (req, res) => {
  const scope = await needManager(req);
  const invite = await store.getInvite(idParam(req.params.inviteId, "Invitation"));
  if (!invite || invite.business_id !== scope.business.id) {
    throw new ApiError(404, "We couldn't find that invitation.");
  }
  await store.deleteInvite(invite.id);
  await store.logAudit({
    businessId: scope.business.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "invite.cancelled",
    detail: invite.email,
  });
  res.json({ ok: true });
});

teamRouter.patch("/team/:staffId", async (req, res) => {
  const scope = await needManager(req);
  const target = await store.getStaff(idParam(req.params.staffId, "Team member"));
  if (!target || target.business_id !== scope.business.id) {
    throw new ApiError(404, "We couldn't find that team member.");
  }
  if (!mayManage(scope.staff.role, target.role)) {
    throw new ApiError(403, "You cannot change someone at that level.");
  }
  if (target.role === "owner" && rank(target.role) >= rank(scope.staff.role)) {
    throw new ApiError(403, "The owner cannot be changed by this account.");
  }

  const patch: Partial<StaffRow> = {};
  if (req.body?.name !== undefined) patch.name = text(req.body.name, { label: "Name", min: 2, max: 60 });
  if (req.body?.role !== undefined) {
    const wanted = role(req.body.role);
    if (!assignableRoles(scope.staff.role).includes(wanted)) {
      throw new ApiError(403, "You cannot give that role out.");
    }
    if (!mayManage(scope.staff.role, wanted)) {
      throw new ApiError(403, "You cannot give someone a role above your own.");
    }
    if (target.id === scope.staff.id) {
      throw new ApiError(400, "You cannot change your own role.");
    }
    patch.role = wanted;
  }
  if (req.body?.branchId !== undefined) {
    const branchId = String(req.body.branchId);
    if (scope.staff.branch_id && scope.staff.branch_id !== branchId) {
      throw new ApiError(403, "You can only assign your own branch.");
    }
    if (branchId) {
      const branch = await store.getBranch(branchId);
      if (!branch || branch.business_id !== scope.business.id) {
        throw new ApiError(400, "Choose a branch from this business.");
      }
    }
    patch.branch_id = branchId;
  }
  if (req.body?.active !== undefined) {
    if (target.id === scope.staff.id) {
      throw new ApiError(400, "You cannot lock yourself out.");
    }
    patch.active = boolean(req.body.active, "Active") ? 1 : 0;
  }
  if (!Object.keys(patch).length) throw new ApiError(400, "No changes were sent.");

  const updated = await store.updateStaff(target.id, patch);
  if (patch.active === 0) await store.deleteSessionsForStaff(target.id);
  await store.logAudit({
    businessId: scope.business.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "staff.updated",
    detail: `${target.email}${patch.role ? ` → ${patch.role}` : ""}${patch.active === 0 ? " (locked)" : ""}`,
  });
  res.json({ ok: true, member: updated ? staffView(updated, scope.staff.id) : null });
});

teamRouter.delete("/team/:staffId", async (req, res) => {
  const scope = await needManager(req);
  const target = await store.getStaff(idParam(req.params.staffId, "Team member"));
  if (!target || target.business_id !== scope.business.id) {
    throw new ApiError(404, "We couldn't find that team member.");
  }
  if (target.id === scope.staff.id) {
    throw new ApiError(400, "You cannot remove yourself.");
  }
  if (!mayManage(scope.staff.role, target.role)) {
    throw new ApiError(403, "You cannot remove someone at that level.");
  }

  const owners = (await store.listStaff(scope.business.id)).filter((member) => member.role === "owner");
  if (target.role === "owner" && owners.length <= 1) {
    throw new ApiError(409, "A business needs at least one owner.");
  }

  await store.deleteStaff(target.id);
  await store.logAudit({
    businessId: scope.business.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "staff.removed",
    detail: target.email,
  });
  res.json({ ok: true });
});