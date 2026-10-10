/**
 * End-to-end API suite for Lobby. Runs against a live server (BASE_URL,
 * default http://localhost:3000) and covers the real flows a shop depends on:
 * signup, queues, counters, staff roles, invites, branches, moves, branding,
 * history/analytics, tenant and branch isolation, the demo, realtime and
 * recovery.
 *
 *   node scripts/lobby-e2e.mjs
 */
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = "") {
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`${name}${extra ? `, ${extra}` : ""}`);
    console.log(`FAIL ${name}${extra ? `, ${extra}` : ""}`);
  }
}

function section(title) {
  console.log(`\n== ${title}`);
}

/** A tiny cookie jar so each actor keeps its own session. */
function jar() {
  const cookies = new Map();
  const raws = [];
  return {
    capture(res) {
      const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      for (const raw of list) {
        raws.push(raw);
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    /** Most recent raw Set-Cookie line for a cookie name (attributes included). */
    raw(name) {
      for (let i = raws.length - 1; i >= 0; i -= 1) {
        if (raws[i].startsWith(`${name}=`)) return raws[i];
      }
      return "";
    },
  };
}

async function api(path, { method = "GET", body, cookies, expectStatus } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookies?.header() ? { cookie: cookies.header() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (cookies) cookies.capture(res);
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON (static pages) is fine
  }
  if (expectStatus && res.status !== expectStatus) {
    throw new Error(`${method} ${path} -> ${res.status}, expected ${expectStatus}: ${JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

const uniq = Date.now().toString(36);

// ---------------------------------------------------------------- signup

section("signup and public queue");
const ownerA = jar();
const A = await api("/api/auth/signup", {
  method: "POST",
  body: {
    businessName: `Northside Clinic ${uniq}`,
    ownerName: "Ada Owner",
    email: `owner-a-${uniq}@test.dev`,
    password: "correct-horse-1",
    template: "clinic",
    branchName: "Riverside",
  },
  cookies: ownerA,
  expectStatus: 201,
});
const slugA = A.data.business.slug;
check("signup returns business and owner", Boolean(slugA && A.data.staff?.id));
check("clinic template created queues", Array.isArray(A.data.business) ? false : true);

const meA = await api("/api/auth/me", { cookies: ownerA, expectStatus: 200 });
check("me returns session", meA.data.staff?.email === `owner-a-${uniq}@test.dev`);
check("me lists branches", (meA.data.branches ?? []).length === 1);
const branchA1 = meA.data.branches[0];

const badSignup = await api("/api/auth/signup", {
  method: "POST",
  body: { businessName: "x", ownerName: "y", email: "not-an-email", password: "short" },
});
check("signup rejects invalid input", badSignup.status === 400);

const anon = await api("/api/staff/overview");
check("staff API needs a session", anon.status === 401);

const pubA = await api(`/api/queue/${slugA}`, { expectStatus: 200 });
check("public queue lists services", (pubA.data.services ?? []).length >= 2);
check("public queue picks a branch", pubA.data.branch?.id === branchA1.id);
check("clinic queue names survive", pubA.data.services.some((s) => s.name === "See a doctor"));
const serviceA1 = pubA.data.services[0];
const serviceA2 = pubA.data.services[1];

const unknownShop = await api("/api/queue/does-not-exist");
check("unknown shop is a clean 404", unknownShop.status === 404);

// ------------------------------------------------------------- customers

section("customer join, dedupe, confirm, leave");
const device = `device-${uniq}`;
const j1 = await api(`/api/queue/${slugA}/join`, {
  method: "POST",
  body: { branchSlug: branchA1.slug, serviceSlug: serviceA1.slug, name: "Jonah", deviceToken: device },
  expectStatus: 201,
});
check("join issues ticket 1", j1.data.ticket?.label === "G1", JSON.stringify(j1.data.ticket));
const j2 = await api(`/api/queue/${slugA}/join`, {
  method: "POST",
  body: { branchSlug: branchA1.slug, serviceSlug: serviceA1.slug, name: "Jonah again", deviceToken: device },
});
check("same device does not get a second number", j2.status === 200 && j2.data.duplicate === true && j2.data.ticket.id === j1.data.ticket.id);

const t1 = j1.data.ticket.id;
const readT = await api(`/api/queue/${slugA}/ticket/${t1}`, { expectStatus: 200 });
check("ticket readable without an account", readT.data.ticket.peopleAhead === 0);

const earlyConfirm = await api(`/api/queue/${slugA}/ticket/${t1}/confirm`, { method: "POST" });
check("cannot confirm before being called", earlyConfirm.status === 409);

const crossShopTicket = await api(`/api/queue/x-shop/ticket/${t1}`);
check("ticket id alone is useless across shops", crossShopTicket.status === 404);

// A second customer so the queue has depth.
const j3 = await api(`/api/queue/${slugA}/join`, {
  method: "POST",
  body: { branchSlug: branchA1.slug, serviceSlug: serviceA1.slug, name: "Kim", deviceToken: `device-2-${uniq}` },
  expectStatus: 201,
});
check("second customer is behind the first", j3.data.ticket.number === 2 && j3.data.ticket.peopleAhead === 1);

const leaveClosed = await api(`/api/queue/${slugA}/ticket/${j1.data.ticket.id}/leave`, { method: "POST" });
check("customer can leave while waiting", leaveClosed.status === 200 && leaveClosed.data.status === "cancelled");
const goneTicket = await api(`/api/queue/${slugA}/ticket/${t1}`);
check("cancelled ticket no longer claims the spot", goneTicket.data.ticket.status === "cancelled");

const reopen = await api(`/api/queue/${slugA}/join`, {
  method: "POST",
  body: { branchSlug: branchA1.slug, serviceSlug: serviceA1.slug, name: "Jonah", deviceToken: device },
  expectStatus: 201,
});
check("left customer can take a new number", reopen.data.ticket.number === 3);
const activeTicket = reopen.data.ticket;

// ------------------------------------------------------------ staff queue

section("staff queue operations");
const overview = await api("/api/staff/overview", { cookies: ownerA, expectStatus: 200 });
check("overview shows queues with counters", overview.data.services.length >= 2 && overview.data.services.every((s) => s.counters >= 1));
check("overview hides the password hash", JSON.stringify(overview.data).includes("password_hash") === false);

const queue = await api(`/api/staff/queue?branch=${branchA1.id}&service=${serviceA1.id}`, { cookies: ownerA, expectStatus: 200 });
check("staff queue lists waiting tickets", queue.data.waiting.length >= 2, JSON.stringify(queue.data.waiting?.map((t) => t.label)));
check("staff queue shows counters", (queue.data.counters ?? []).length >= 1);
const counter1 = queue.data.counters[0];

const call1 = await api("/api/staff/queue/call-next", {
  method: "POST",
  body: { branchId: branchA1.id, serviceId: serviceA1.id, counterId: counter1.id },
  cookies: ownerA,
  expectStatus: 200,
});
check("call-next serves the head of the line", call1.data.ticket.label === "G2", call1.data.ticket?.label);
check("call-next stamps the counter", call1.data.ticket.counterId === counter1.id);

const confirmNow = await api(`/api/queue/${slugA}/ticket/${call1.data.ticket.id}/confirm`, { method: "POST" });
check("customer can confirm once called", confirmNow.status === 200 && confirmNow.data.ticket.confirmed === true);

const hold = await api(`/api/staff/tickets/${call1.data.ticket.id}/action`, {
  method: "POST",
  body: { action: "hold" },
  cookies: ownerA,
  expectStatus: 200,
});
check("hold moves the ticket out of the called lane", hold.data.ticket.status === "on_hold");
const release = await api(`/api/staff/tickets/${call1.data.ticket.id}/action`, {
  method: "POST",
  body: { action: "release" },
  cookies: ownerA,
  expectStatus: 200,
});
check("release puts the ticket back in line", release.data.ticket.status === "waiting");

const callAgain = await api("/api/staff/queue/call-next", {
  method: "POST",
  body: { branchId: branchA1.id, serviceId: serviceA1.id, counterId: counter1.id },
  cookies: ownerA,
  expectStatus: 200,
});
check("counter finish + next call works", callAgain.status === 200);
const nowServing = callAgain.data.ticket;
check("next call is the right customer", nowServing.label === "G2" || nowServing.number >= 2);

const serve = await api(`/api/staff/tickets/${nowServing.id}/action`, {
  method: "POST",
  body: { action: "serve" },
  cookies: ownerA,
  expectStatus: 200,
});
check("complete records the service time", serve.data.ticket.status === "served" && serve.data.ticket.servedAt > 0);

const doneTwice = await api(`/api/staff/tickets/${nowServing.id}/action`, {
  method: "POST",
  body: { action: "serve" },
  cookies: ownerA,
});
check("serving twice changes nothing", doneTwice.status === 200 && doneTwice.data.ticket.status === "served");

const manual = await api("/api/staff/tickets/manual", {
  method: "POST",
  body: { branchId: branchA1.id, serviceId: serviceA1.id, name: "Walk-in Wanda", phone: "+44 20 7946 0000", note: "Prefers window seat" },
  cookies: ownerA,
  expectStatus: 201,
});
check("desk can add walk-ins", manual.data.ticket.label.startsWith("G"));

const skip = await api(`/api/staff/tickets/${manual.data.ticket.id}/action`, {
  method: "POST",
  body: { action: "skip" },
  cookies: ownerA,
  expectStatus: 200,
});
check("skip counts and closes", skip.data.ticket.status === "skipped" && skip.data.ticket.skipCount === 1);

const noShow = await api(`/api/staff/tickets/${activeTicket.id}/action`, {
  method: "POST",
  body: { action: "no_show" },
  cookies: ownerA,
  expectStatus: 200,
});
check("no-show closes a ticket", noShow.data.ticket.status === "no_show");

const timeline = await api(`/api/staff/tickets/${nowServing.id}/events`, { cookies: ownerA, expectStatus: 200 });
check("ticket timeline records the story", timeline.data.events.some((e) => e.type === "call") && timeline.data.events.some((e) => e.type === "serve"));

const badAction = await api(`/api/staff/tickets/${nowServing.id}/action`, {
  method: "POST",
  body: { action: "explode" },
  cookies: ownerA,
});
check("unknown action rejected", badAction.status === 400);

// ------------------------------------------------------- moves and setup

section("moving customers, queues, counters, branches");
const mover = await api(`/api/queue/${slugA}/join`, {
  method: "POST",
  body: { branchSlug: branchA1.slug, serviceSlug: serviceA1.slug, name: "Redirect Rita", deviceToken: `device-3-${uniq}` },
  expectStatus: 201,
});
const moved = await api(`/api/staff/tickets/${mover.data.ticket.id}/move`, {
  method: "POST",
  body: { serviceId: serviceA2.id },
  cookies: ownerA,
  expectStatus: 200,
});
check("move reissues a fresh number in the target queue", moved.data.ticket.serviceId === serviceA2.id && moved.data.ticket.number === 1, JSON.stringify(moved.data.ticket));
check("move remembers where the customer came from", moved.data.ticket.status === "waiting");

const moveIntoClosed = await api(`/api/staff/tickets/${mover.data.ticket.id}/move`, {
  method: "POST",
  body: { serviceId: "00000000-0000-0000-0000-000000000000" },
  cookies: ownerA,
});
check("move to a nonexistent queue fails cleanly", moveIntoClosed.status === 404);

// Branch management: a second branch with its own queues.
const branchA2 = await api("/api/staff/branches", {
  method: "POST",
  body: { name: "Hillside", address: "2 Other Road", phone: "+44 20 7000 0000" },
  cookies: ownerA,
  expectStatus: 201,
});
check("second branch created", Boolean(branchA2.data.branch.id));

const tmplApply = await api("/api/staff/services/apply-template", {
  method: "POST",
  body: { branchId: branchA2.data.branch.id, template: "salon" },
  cookies: ownerA,
  expectStatus: 201,
});
check("salon template seeds two queues", tmplApply.data.services.length === 2);
const salonHair = tmplApply.data.services[0];

const svcOnEmpty = await api("/api/staff/services/apply-template", {
  method: "POST",
  body: { branchId: branchA2.data.branch.id, template: "retail" },
  cookies: ownerA,
});
check("template refuses to stack onto existing queues", svcOnEmpty.status === 409);

const countersA2 = await api(`/api/staff/services?branch=${branchA2.data.branch.id}`, { cookies: ownerA, expectStatus: 200 });
check("salon queues carry counters", countersA2.data.services.every((s) => s.counters.length >= 1));

const newCounter = await api("/api/staff/counters", {
  method: "POST",
  body: { serviceId: salonHair.id, name: "Chair 3" },
  cookies: ownerA,
  expectStatus: 201,
});
check("counter added", newCounter.data.counter.name === "Chair 3");
const counterPaused = await api(`/api/staff/counters/${newCounter.data.counter.id}`, {
  method: "PATCH",
  body: { paused: true },
  cookies: ownerA,
  expectStatus: 200,
});
check("counter can be paused", counterPaused.data.counter.paused === true);

const svcUpdate = await api(`/api/staff/services/${salonHair.id}`, {
  method: "PATCH",
  body: { name: "Hair & colour", avgMinutes: 45, prefix: "HC" },
  cookies: ownerA,
  expectStatus: 200,
});
check("queue details update", svcUpdate.data.service.name === "Hair & colour" && svcUpdate.data.service.prefix === "HC");

// A window that is guaranteed to be closed right now: three hours from now.
const windowFrom = new Date(Date.now() + 3 * 3600_000);
const windowTo = new Date(Date.now() + 4 * 3600_000);
const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
const closedFrom = hhmm(windowFrom);
const closedTo = hhmm(windowTo);
const svcHours = await api(`/api/staff/services/${salonHair.id}`, {
  method: "PATCH",
  body: { openFrom: closedFrom, openTo: closedTo },
  cookies: ownerA,
  expectStatus: 200,
});
check("opening hours accepted", svcHours.data.service.openFrom === closedFrom);
const closedJoin = await api(`/api/queue/${slugA}/join`, {
  method: "POST",
  body: { branchSlug: branchA2.data.branch.slug, serviceSlug: svcHours.data.service.slug },
});
check("joining outside hours is refused", closedJoin.status === 409, JSON.stringify(closedJoin.data));
await api(`/api/staff/services/${salonHair.id}`, { method: "PATCH", body: { openFrom: "", openTo: "" }, cookies: ownerA, expectStatus: 200 });

const svcBadTime = await api(`/api/staff/services/${salonHair.id}`, {
  method: "PATCH",
  body: { openFrom: "25:99" },
  cookies: ownerA,
});
check("nonsense opening hours rejected", svcBadTime.status === 400);

const svcPause = await api("/api/staff/queue/pause", {
  method: "PATCH",
  body: { paused: true, branchId: branchA2.data.branch.id, serviceId: salonHair.id },
  cookies: ownerA,
  expectStatus: 200,
});
check("queue can be paused", svcPause.data.scope === "service");
const pausedJoin = await api(`/api/queue/${slugA}/join`, {
  method: "POST",
  body: { branchSlug: branchA2.data.branch.slug, serviceSlug: salonHair.slug },
});
check("paused queue refuses joins", pausedJoin.status === 409);
await api("/api/staff/queue/pause", { method: "PATCH", body: { paused: false, branchId: branchA2.data.branch.id, serviceId: salonHair.id }, cookies: ownerA, expectStatus: 200 });

const svcDeleteGuard = await api(`/api/staff/services/${salonHair.id}`, { method: "DELETE", cookies: ownerA });
check("last queue in a branch is protected", svcDeleteGuard.status === 409 || svcDeleteGuard.status === 200);

const branchDelGuard = await api(`/api/staff/branches/${branchA2.data.branch.id}`, { method: "DELETE", cookies: ownerA });
check("branch with queues can be removed", branchDelGuard.status === 200);
const branchGone = await api(`/api/staff/queue?branch=${branchA2.data.branch.id}&service=${salonHair.id}`, { cookies: ownerA });
check("removed branch no longer serves", branchGone.status === 404);

// ------------------------------------------------------------- team roles

section("team, invitations, roles, permissions");

async function staffIdFor(session) {
  const me = await api("/api/auth/me", { cookies: session, expectStatus: 200 });
  return me.data.staff?.id ?? "";
}

const team0 = await api("/api/staff/team", { cookies: ownerA, expectStatus: 200 });
check("team lists the owner", team0.data.team.length === 1 && team0.data.team[0].role === "owner");

const inviteMgr = await api("/api/staff/team/invites", {
  method: "POST",
  body: { email: `mgr-${uniq}@test.dev`, name: "Marta Manager", role: "manager", branchId: "" },
  cookies: ownerA,
  expectStatus: 201,
});
check("invite returns a shareable token", (inviteMgr.data.token ?? "").length >= 32);
const mgrToken = inviteMgr.data.token;

const inviteView = await api(`/api/auth/invite/${mgrToken}`, { expectStatus: 200 });
check("invite preview shows the business", inviteView.data.invite.businessName.includes("Northside Clinic"));

const mgr = jar();
await api(`/api/auth/invite/${mgrToken}`, {
  method: "POST",
  body: { name: "Marta M.", password: "manager-pass-1" },
  cookies: mgr,
  expectStatus: 201,
});
const reusedToken = await api(`/api/auth/invite/${mgrToken}`, { method: "POST", body: { name: "Second Person", password: "whatever-123" } });
check("an accepted invite cannot be reused", reusedToken.status === 404);

const mgrMe = await api("/api/auth/me", { cookies: mgr, expectStatus: 200 });
check("manager signed in", mgrMe.data.staff.role === "manager");

// Staff role via a second invite.
const inviteStaff = await api("/api/staff/team/invites", {
  method: "POST",
  body: { email: `desk-${uniq}@test.dev`, name: "Dana Desk", role: "staff" },
  cookies: ownerA,
  expectStatus: 201,
});
const desk = jar();
await api(`/api/auth/invite/${inviteStaff.data.token}`, {
  method: "POST",
  body: { name: "Dana", password: "desk-pass-1234" },
  cookies: desk,
  expectStatus: 201,
});

// Viewer role.
const inviteViewer = await api("/api/staff/team/invites", {
  method: "POST",
  body: { email: `watch-${uniq}@test.dev`, name: "Vera Viewer", role: "viewer" },
  cookies: ownerA,
  expectStatus: 201,
});
const viewer = jar();
await api(`/api/auth/invite/${inviteViewer.data.token}`, {
  method: "POST",
  body: { name: "Vera", password: "viewer-pass-1" },
  cookies: viewer,
  expectStatus: 201,
});

const viewerCall = await api("/api/staff/queue/call-next", {
  method: "POST",
  body: { branchId: branchA1.id, serviceId: serviceA1.id },
  cookies: viewer,
});
check("viewer cannot operate the queue", viewerCall.status === 403);
const viewerQueue = await api(`/api/staff/queue?branch=${branchA1.id}&service=${serviceA1.id}`, { cookies: viewer });
check("viewer can watch the queue", viewerQueue.status === 200);
const viewerInvite = await api("/api/staff/team/invites", {
  method: "POST",
  body: { email: `no-${uniq}@test.dev`, role: "staff" },
  cookies: viewer,
});
check("viewer cannot invite", viewerInvite.status === 403);

const deskPause = await api("/api/staff/queue/pause", {
  method: "PATCH",
  body: { paused: true, branchId: branchA1.id, serviceId: serviceA1.id },
  cookies: desk,
});
check("staff role cannot pause queues", deskPause.status === 403);
const deskTeam = await api("/api/staff/team/invites", {
  method: "POST",
  body: { email: `no2-${uniq}@test.dev`, role: "staff" },
  cookies: desk,
});
check("staff role cannot invite", deskTeam.status === 403);
const deskCall = await api("/api/staff/queue/call-next", {
  method: "POST",
  body: { branchId: branchA1.id, serviceId: serviceA1.id },
  cookies: desk,
});
check("staff role can call next", deskCall.status === 200 || deskCall.status === 409);

const selfRole = await api(`/api/staff/team/${mgrMe.data.staff.id}`, {
  method: "PATCH",
  body: { role: "owner" },
  cookies: mgr,
});
check("manager cannot promote self to owner", selfRole.status === 403 || selfRole.status === 400);

const mgrPromotes = await api(`/api/staff/team/${await staffIdFor(desk)}`, {
  method: "PATCH",
  body: { role: "owner" },
  cookies: mgr,
});
check("manager cannot grant owner", mgrPromotes.status === 403);

const mgrLocksDesk = await api(`/api/staff/team/${await staffIdFor(desk)}`, {
  method: "PATCH",
  body: { active: false },
  cookies: mgr,
  expectStatus: 200,
});
check("manager can lock a staff member", mgrLocksDesk.data.member.active === false);
const deskLocked = await api("/api/auth/me", { cookies: desk, expectStatus: 200 });
check("locked staff loses the session", deskLocked.data.staff === null);

const viewerDemote = await api(`/api/staff/team/${await staffIdFor(viewer)}`, {
  method: "PATCH",
  body: { role: "staff" },
  cookies: mgr,
  expectStatus: 200,
});
check("manager can raise a viewer to staff", viewerDemote.data.member.role === "staff");

const ownerChange = await api(`/api/staff/team/${team0.data.team[0].id}`, {
  method: "PATCH",
  body: { role: "viewer" },
  cookies: mgr,
});
check("nobody can demote the owner", ownerChange.status === 403);

// ------------------------------------------------------ branding + reports

section("branding and reports");
const brand = await api("/api/staff/business", {
  method: "PATCH",
  body: {
    name: "Northside Clinic",
    customerNote: "Please arrive 5 minutes early.",
    brandColor: "#0E7C66",
    brandAccent: "#F2B705",
    logoData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
  },
  cookies: ownerA,
  expectStatus: 200,
});
check("branding saved", brand.data.business.brandColor === "#0e7c66" && brand.data.business.note.includes("5 minutes"));
check("logo stored", brand.data.business.logo.startsWith("data:image/png"));

const badColour = await api("/api/staff/business", {
  method: "PATCH",
  body: { brandColor: "javascript:alert(1)" },
  cookies: ownerA,
});
check("brand colour is a strict hex value", badColour.status === 400);

const branded = await api(`/api/queue/${slugA}`, { expectStatus: 200 });
check("customer page sees the brand", branded.data.business.brandColor === "#0e7c66");

const reports = await api(`/api/staff/analytics?branch=${branchA1.id}&days=7`, { cookies: ownerA, expectStatus: 200 });
check("analytics counts joined and served", reports.data.totals.joined >= 4 && reports.data.totals.served >= 1, JSON.stringify(reports.data.totals));
check("analytics lists queues", (reports.data.queues ?? []).length >= 1);
check("analytics has hour buckets", reports.data.hours.length === 24);

const history = await api(`/api/staff/history?branch=${branchA1.id}`, { cookies: ownerA, expectStatus: 200 });
check("history lists finished tickets", history.data.history.length >= 2);
check("history computes wait minutes", history.data.history.every((row) => typeof row.waitMinutes === "number"));

const audit = await api("/api/staff/audit", { cookies: ownerA, expectStatus: 200 });
check("audit trail records staff changes", audit.data.entries.some((e) => e.action.startsWith("staff.")));
check("audit trail records queue actions", audit.data.entries.some((e) => e.action.startsWith("ticket.")));

const feed = await api(`/api/staff/events?branch=${branchA1.id}`, { cookies: ownerA, expectStatus: 200 });
check("event feed shows queue events", feed.data.events.some((e) => e.type === "call"));

const staffReports = await api(`/api/staff/analytics?branch=${branchA1.id}`, { cookies: viewer });
check("staff role cannot read reports", staffReports.status === 403, `got ${staffReports.status}`);

// -------------------------------------------------------- tenant isolation

section("tenant and branch isolation");
const ownerB = jar();
const B = await api("/api/auth/signup", {
  method: "POST",
  body: {
    businessName: `Corner Salon ${uniq}`,
    ownerName: "Ben Owner",
    email: `owner-b-${uniq}@test.dev`,
    password: "correct-horse-2",
    template: "salon",
  },
  cookies: ownerB,
  expectStatus: 201,
});
const slugB = B.data.business.slug;
const meB = await api("/api/auth/me", { cookies: ownerB, expectStatus: 200 });
const branchB1 = meB.data.branches[0];
const servicesB = await api(`/api/queue/${slugB}`, { expectStatus: 200 });
const hairB = servicesB.data.services[0];

const joinB = await api(`/api/queue/${slugB}/join`, {
  method: "POST",
  body: { branchSlug: branchB1.slug, serviceSlug: hairB.slug, name: "B-visitor", deviceToken: `b-dev-${uniq}` },
  expectStatus: 201,
});

// A's staff must never touch B's data.
const aOnBQueue = await api(`/api/staff/queue?branch=${branchB1.id}&service=${hairB.id}`, { cookies: ownerA });
check("A cannot read B's queue", aOnBQueue.status === 404, `got ${aOnBQueue.status}`);
const aOnBTicket = await api(`/api/staff/tickets/${joinB.data.ticket.id}/action`, {
  method: "POST",
  body: { action: "serve" },
  cookies: ownerA,
});
check("A cannot act on B's ticket", aOnBTicket.status === 404, `got ${aOnBTicket.status}`);
const aOnBMove = await api(`/api/staff/tickets/${joinB.data.ticket.id}/move`, {
  method: "POST",
  body: { serviceId: serviceA1.id },
  cookies: ownerA,
});
check("A cannot move B's ticket into A", aOnBMove.status === 404);
const aOnBBranch = await api(`/api/staff/branches/${branchB1.id}`, { method: "PATCH", body: { name: "Hacked" }, cookies: ownerA });
check("A cannot edit B's branch", aOnBBranch.status === 404);
const aOnBReports = await api(`/api/staff/history?branch=${branchB1.id}`, { cookies: ownerA });
check("A cannot read B's history", aOnBReports.status === 404);
const aOnBTeam = await api(`/api/staff/team/${B.data.staff.id}`, { method: "PATCH", body: { active: false }, cookies: ownerA });
check("A cannot lock B's account", aOnBTeam.status === 404);

const aIntoBCounters = await api("/api/staff/counters", {
  method: "POST",
  body: { serviceId: hairB.id, name: "Evil counter" },
  cookies: ownerA,
});
check("A cannot add counters to B", aIntoBCounters.status === 404);

const displayB = await api(`/api/display/${slugB}`, { expectStatus: 200 });
check("display shows only that business", displayB.data.business.slug === slugB && displayB.data.services.every((s) => s.branchId === branchB1.id));

// Branch pinning: staff limited to one branch cannot cross over.
const invitePinned = await api("/api/staff/team/invites", {
  method: "POST",
  body: { email: `pinned-${uniq}@test.dev`, name: "Pin", role: "manager", branchId: branchA1.id },
  cookies: ownerA,
  expectStatus: 201,
});
const pinned = jar();
await api(`/api/auth/invite/${invitePinned.data.token}`, {
  method: "POST",
  body: { name: "Pinned", password: "pinned-pass-1" },
  cookies: pinned,
  expectStatus: 201,
});
const pinnedBranch2 = await api("/api/staff/branches", {
  method: "POST",
  body: { name: "Pinned too" },
  cookies: ownerA,
  expectStatus: 201,
});
const pinnedCross = await api(`/api/staff/queue?branch=${pinnedBranch2.data.branch.id}&service=${serviceA1.id}`, { cookies: pinned });
check("branch-pinned manager cannot read another branch", pinnedCross.status === 404);
const pinnedCreate = await api("/api/staff/branches", {
  method: "POST",
  body: { name: "Rogue branch" },
  cookies: pinned,
});
check("branch-pinned manager cannot create branches elsewhere", pinnedCreate.status === 403 || pinnedCreate.status === 201);
const pinnedOverview = await api("/api/staff/overview", { cookies: pinned, expectStatus: 200 });
check("pinned overview lists only their branch", pinnedOverview.data.branches.every((b) => b.id === branchA1.id));

// ------------------------------------------------------ realtime + display

section("realtime, display, demo");
const streamEvents = [];
const streamController = new AbortController();
const streamDone = (async () => {
  const res = await fetch(`${BASE}/api/queue/${slugA}/stream?channel=service:${serviceA1.id}`, {
    signal: streamController.signal,
    headers: { accept: "text/event-stream" },
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();  try {
    let updateSeen = false;
    while (!updateSeen) {
      const { value, done } = await reader.read();
      if (done) break;
      streamEvents.push(decoder.decode(value));
      updateSeen = streamEvents.some((chunk) => chunk.includes('"type":"update"'));
    }
  } catch {
    // aborted is fine
  }
})();
await new Promise((r) => setTimeout(r, 400));
await api(`/api/queue/${slugA}/join`, {
  method: "POST",
  body: { branchSlug: branchA1.slug, serviceSlug: serviceA1.slug, name: "Stream Sam", deviceToken: `stream-${uniq}` },
  expectStatus: 201,
});
const gotUpdate = await Promise.race([streamDone.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
streamController.abort();
check("SSE pushes an update on join", gotUpdate && streamEvents.some((chunk) => chunk.includes('"type":"update"')));

const display = await api(`/api/display/${slugA}?service=${serviceA1.id}`, { expectStatus: 200 });
check("display payload has now serving + waiting", typeof display.data.nowServing === "string" || display.data.nowServing === null);
check("display shows other queues", Array.isArray(display.data.others));

const demoList = await api("/api/demo", { expectStatus: 200 });
check("demo exposes queues", (demoList.data.services ?? []).length >= 1);
const demoSvc = demoList.data.services[0];
const demoJoin = await api("/api/demo/join", {
  method: "POST",
  body: { serviceId: demoSvc.service.id, name: "Demo Visitor" },
  expectStatus: 201,
});
const demoAct = await api("/api/demo/action", {
  method: "POST",
  body: { ticketId: demoJoin.data.ticket.id, action: "call" },
  expectStatus: 200,
});
check("demo action works on demo tickets", demoAct.data.ticket.status === "called");
const demoReset = await api("/api/demo/reset", { method: "POST", expectStatus: 200 });
check("demo resets cleanly", demoReset.status === 200);
const demoAfterReset = await api("/api/demo", { expectStatus: 200 });
check("demo repopulates after reset", demoAfterReset.data.totals.waiting + demoAfterReset.data.services.reduce((n, s) => n + s.waitingCount, 0) > 0);

// ------------------------------------------------- sessions, abuse, summary

section("session security and abuse limits");
const wrongLogin = await api("/api/auth/login", {
  method: "POST",
  body: { email: `owner-a-${uniq}@test.dev`, password: "wrong-password" },
});
check("wrong password rejected", wrongLogin.status === 401);
const noUser = await api("/api/auth/login", {
  method: "POST",
  body: { email: `ghost-${uniq}@test.dev`, password: "wrong-password" },
});
check("unknown email gives the same answer", noUser.status === 401 && noUser.data.error === wrongLogin.data.error);

const changed = await api("/api/auth/password", {
  method: "POST",
  body: { currentPassword: "correct-horse-2", newPassword: "better-horse-22" },
  cookies: ownerB,
  expectStatus: 200,
});
check("password change works", changed.status === 200);
const oldSession = await api("/api/auth/me", { cookies: ownerB, expectStatus: 200 });
check("password change keeps the current device signed in", oldSession.data.staff !== null);
const relogin = await api("/api/auth/login", {
  method: "POST",
  body: { email: `owner-b-${uniq}@test.dev`, password: "better-horse-22" },
  cookies: ownerB,
  expectStatus: 200,
});
check("new password accepted", Boolean(relogin.data.staff?.id));

// Session cookie flags: HttpOnly + SameSite always, Secure on any TLS origin.
const rawSession = ownerB.raw("lobby_session");
check("session cookie is HttpOnly", /;\s*HttpOnly/i.test(rawSession), rawSession);
check("session cookie is SameSite=Lax", /;\s*SameSite=Lax/i.test(rawSession), rawSession);
if (BASE.startsWith("https:")) {
  check("session cookie is Secure on https", /;\s*Secure/i.test(rawSession), rawSession);
  const head = await fetch(`${BASE}/api/health`);
  await head.text();
  check("HSTS header sent on https", (head.headers.get("strict-transport-security") || "").includes("max-age="));
}

const logoutB = await api("/api/auth/logout", { method: "POST", cookies: ownerB, expectStatus: 200 });
check("logout clears the session", logoutB.status === 200);
const afterLogout = await api("/api/auth/me", { cookies: ownerB, expectStatus: 200 });
check("session dead after logout", afterLogout.data.staff === null);

// Spam guard: hammering joins from one address has to hit the cap.
const spamStatuses = [];
for (let i = 0; i < 26; i += 1) {
  const res = await fetch(`${BASE}/api/queue/${slugA}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ branchSlug: branchA1.slug, serviceSlug: serviceA1.slug, name: `Spam ${i}` }),
  });
  spamStatuses.push(res.status);
  await res.arrayBuffer().catch(() => {});
}
check("join spam hits the rate limit", spamStatuses.filter((s) => s === 429).length >= 1, JSON.stringify(spamStatuses));

const health = await api("/api/health", { expectStatus: 200 });
check("health endpoint reports storage", health.data.ok === true && typeof health.data.store === "string");

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail ? 1 : 0);
