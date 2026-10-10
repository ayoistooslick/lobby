import { Router } from "express";
import {
  DUMMY_PASSWORD_HASH,
  assertPasswordStrength,
  authed,
  clearSessionCookie,
  createSession,
  deleteSession,
  hashPassword,
  readSessionToken,
  requireAuth,
  setSessionCookie,
  userAgentOf,
  verifyPassword,
} from "../auth";
import { limit } from "../rateLimit";
import { store } from "../store";
import { TEMPLATES, findTemplate } from "../templates";
import { STAFF_ROLES, hashToken } from "../rows";
import { ApiError, email, text } from "../validate";
import { capabilitiesOf, publicBusiness, staffView } from "../views";
import { ROLE_HELP, ROLE_LABELS, can } from "../permissions";

export const authRouter = Router();

authRouter.post("/signup", limit("signup", 5, 60 * 60_000), async (req, res) => {
  const name = text(req.body?.businessName, { label: "Business name", min: 2, max: 80 });
  const ownerName = text(req.body?.ownerName, { label: "Your name", min: 2, max: 80 });
  const emailAddress = email(req.body?.email);
  const password = text(req.body?.password, { label: "Password", min: 8, max: 128 });
  const template = findTemplate(typeof req.body?.template === "string" ? req.body.template : "generic");
  const branchName =
    typeof req.body?.branchName === "string" && req.body.branchName.trim()
      ? text(req.body.branchName, { label: "Branch name", max: 60 })
      : "Main branch";

  assertPasswordStrength(password, { email: emailAddress, name: ownerName });

  if (await store.getBusinessByEmail(emailAddress)) {
    throw new ApiError(409, "An account with this email already exists. Try signing in instead.");
  }

  const business = await store.createBusiness({
    name,
    ownerName,
    email: emailAddress,
    passwordHash: hashPassword(password),
  });

  const branch = await store.createBranch(business.id, { name: branchName });
  for (const entry of template.services) {
    await store.createService(business.id, branch.id, {
      name: entry.name,
      prefix: entry.prefix,
      description: entry.description,
      avgMinutes: entry.avgMinutes,
      counters: entry.counters.length,
    });
  }

  const staff = await store.createStaff({
    businessId: business.id,
    email: emailAddress,
    name: ownerName,
    role: "owner",
    passwordHash: hashPassword(password),
  });
  await store.logAudit({
    businessId: business.id,
    branchId: branch.id,
    actorId: staff.id,
    actorName: staff.name,
    action: "business.created",
    detail: `${business.name} · ${template.label}`,
  });

  const { token, expiresAt } = await createSession(staff.id, userAgentOf(req));
  setSessionCookie(req, res, token, expiresAt);
  res.status(201).json({ ok: true, business: publicBusiness(business), staff: staffView(staff, staff.id) });
});

// Two buckets: one per address (stops a distributed spread against one
// account) and one per IP (already enforced further down for every route).
const loginByEmail = limit("login-email", 10, 15 * 60_000, (req) =>
  `email:${String(req.body?.email ?? "").toLowerCase().trim().slice(0, 254)}`
);

authRouter.post("/login", loginByEmail, limit("login", 15, 300_000), async (req, res) => {
  const emailAddress = email(req.body?.email);
  const password = req.body?.password;
  if (typeof password !== "string" || password.length === 0) {
    throw new ApiError(400, "Enter your password.");
  }

  const staff = await store.getStaffByEmail(emailAddress);
  const business = staff ? await store.getBusinessById(staff.business_id) : undefined;
  if (!staff || !business || staff.active !== 1) {
    verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw new ApiError(401, "Wrong email or password.");
  }
  if (!verifyPassword(password, staff.password_hash)) {
    throw new ApiError(401, "Wrong email or password.");
  }

  const { token, expiresAt } = await createSession(staff.id, userAgentOf(req));
  setSessionCookie(req, res, token, expiresAt);
  res.json({
    ok: true,
    business: publicBusiness(business),
    staff: staffView(staff, staff.id),
    capabilities: capabilitiesOf(staff.role),
  });
});

authRouter.get("/me", async (req, res) => {
  const token = readSessionToken(req);
  const scope = token ? await authed(req).catch(() => null) : null;
  if (!scope) {
    res.json({ ok: true, business: null, staff: null, capabilities: [] });
    return;
  }
  const branches = await store.listBranches(scope.business.id);
  res.json({
    ok: true,
    business: publicBusiness(scope.business),
    staff: staffView(scope.staff, scope.staff.id),
    capabilities: capabilitiesOf(scope.staff.role),
    branches: branches.map((branch) => ({ id: branch.id, slug: branch.slug, name: branch.name })),
  });
});

authRouter.post("/logout", async (req, res) => {
  const token = readSessionToken(req);
  if (token) await deleteSession(token);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

/** Lets an invitee see who invited them before choosing a password. */
authRouter.get("/invite/:token", limit("invite-read", 60, 60_000), async (req, res) => {
  const token = text(req.params.token, { label: "Invitation", min: 16, max: 200 });
  const invite = await store.getInviteByToken(hashToken(token));
  if (!invite || invite.accepted_at || invite.expires_at < Date.now()) {
    throw new ApiError(404, "This invitation is no longer valid. Ask your manager for a new one.");
  }
  const business = await store.getBusinessById(invite.business_id);
  const branches = await store.listBranches(invite.business_id);
  const branch = branches.find((entry) => entry.id === invite.branch_id) ?? null;
  res.json({
    ok: true,
    invite: {
      email: invite.email,
      name: invite.name,
      role: invite.role,
      businessName: business?.name ?? "",
      branchName: branch?.name ?? "",
    },
  });
});

authRouter.post("/invite/:token", limit("invite-accept", 10, 300_000), async (req, res) => {
  const token = text(req.params.token, { label: "Invitation", min: 16, max: 200 });
  const password = text(req.body?.password, { label: "Password", min: 8, max: 128 });
  const name = text(req.body?.name, { label: "Your name", min: 2, max: 80 });

  const invite = await store.getInviteByToken(hashToken(token));
  if (!invite || invite.accepted_at || invite.expires_at < Date.now()) {
    throw new ApiError(404, "This invitation is no longer valid. Ask your manager for a new one.");
  }
  const business = await store.getBusinessById(invite.business_id);
  if (!business) throw new ApiError(404, "This shop no longer exists.");

  assertPasswordStrength(password, { email: invite.email, name });

  // Same email may work at another shop. Only this business's team blocks it.
  const existing = await store.getStaffInBusiness(invite.email, invite.business_id);
  if (existing) {
    throw new ApiError(409, "That email already has an account here. Sign in instead.");
  }

  const staff = await store.createStaff({
    businessId: invite.business_id,
    email: invite.email,
    name,
    role: invite.role,
    passwordHash: hashPassword(password),
    branchId: invite.branch_id,
  });
  await store.acceptInvite(invite.id);
  await store.logAudit({
    businessId: invite.business_id,
    branchId: invite.branch_id,
    actorId: staff.id,
    actorName: staff.name,
    action: "invite.accepted",
    detail: `${staff.email} joined as ${staff.role}`,
  });

  const { token: sessionToken, expiresAt } = await createSession(staff.id, userAgentOf(req));
  setSessionCookie(req, res, sessionToken, expiresAt);
  res.status(201).json({
    ok: true,
    business: publicBusiness(business),
    staff: staffView(staff, staff.id),
    capabilities: capabilitiesOf(staff.role),
  });
});

/** Password change for the signed-in account only. */
authRouter.post("/password", requireAuth, limit("password", 10, 300_000), async (req, res) => {
  const scope = await authed(req);
  const current = text(req.body?.currentPassword, { label: "Current password", max: 128 });
  const next = text(req.body?.newPassword, { label: "New password", min: 8, max: 128 });
  if (!verifyPassword(current, scope.staff.password_hash)) {
    throw new ApiError(400, "That current password isn't right.");
  }
  assertPasswordStrength(next, { email: scope.staff.email, name: scope.staff.name });
  await store.updateStaff(scope.staff.id, { password_hash: hashPassword(next) });
  // Every other device has to sign in again with the new password.
  await store.deleteSessionsForStaff(scope.staff.id);
  const { token, expiresAt } = await createSession(scope.staff.id, userAgentOf(req));
  setSessionCookie(req, res, token, expiresAt);
  await store.logAudit({
    businessId: scope.business.id,
    actorId: scope.staff.id,
    actorName: scope.staff.name,
    action: "account.password_changed",
  });
  res.json({ ok: true, capabilities: capabilitiesOf(scope.staff.role) });
});

/** Reference data for the signup screen, safe to call signed out. */
authRouter.get("/templates", (_req, res) => {
  res.json({
    ok: true,
    templates: TEMPLATES.map((entry) => ({
      key: entry.key,
      label: entry.label,
      blurb: entry.blurb,
      services: entry.services.map((service) => ({
        name: service.name,
        description: service.description,
        prefix: service.prefix,
        counters: service.counters.length,
      })),
    })),
  });
});

/** Reference data for the team screen, safe to call signed out. */
authRouter.get("/roles", (_req, res) => {
  res.json({
    ok: true,
    roles: STAFF_ROLES.map((role) => ({
      key: role,
      label: ROLE_LABELS[role],
      help: ROLE_HELP[role],
      capabilities: capabilitiesOf(role),
      canOperate: can(role, "queue.operate"),
      canManageStaff: can(role, "staff.manage"),
    })),
  });
});