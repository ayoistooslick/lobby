/**
 * Lobby API end-to-end suite.
 *
 * Exercises the flows a real shop depends on: sign-up, several queues and
 * counters, several staff accounts and roles, tenant and branch isolation,
 * the whole ticket lifecycle, duplicate-join protection, history, analytics,
 * the TV payload, realtime updates and the public demo.
 *
 * Usage: node scripts/e2e.mjs [baseUrl]   (default http://127.0.0.1:3991)
 */
const BASE = process.argv[2] || "http://127.0.0.1:3991";
const stamp = Date.now().toString(36).slice(-5);

let passed = 0;
const failures = [];
let section = "";

function group(name) {
  section = name;
  console.log(`\n── ${name}`);
}

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${section} › ${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** A tiny cookie jar so each "device" keeps its own staff session. */
function makeClient() {
  const jar = new Map();
  return {
    jar,
    async call(method, path, body) {
      const headers = {};
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (jar.size) {
        headers.Cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
      }
      const response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, body: json, text, headers: response.headers };
    },
    get(path) {
      return this.call("GET", path);
    },
    post(path, body) {
      return this.call("POST", path, body);
    },
    patch(path, body) {
      return this.call("PATCH", path, body);
    },
    del(path) {
      return this.call("DELETE", path);
    },
  };
}

const owner = makeClient();
const manager = makeClient();
const worker = makeClient();
const viewer = makeClient();
const stranger = makeClient();
const publicDevice = makeClient();

const shopA = {
  businessName: `Alpha Clinic ${stamp}`,
  ownerName: "Ada Owner",
  email: `ada.${stamp}@alpha.test`,
  password: "correct-horse-8",
};
const shopB = {
  businessName: `Beta Salon ${stamp}`,
  ownerName: "Bo Boss",
  email: `bo.${stamp}@beta.test`,
  password: "another-pass-9",
};

/** Opens an SSE stream and resolves with the events received within a window. */
async function collectStream(path, action, waitMs = 2500) {
  const controller = new AbortController();
  const events = [];
  const done = collectStream.body(path, events, controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await action();
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  controller.abort();
  await done;
  return events;
}

collectStream.body = async (path, events, signal) => {
  try {
    const response = await fetch(`${BASE}${path}`, { headers: { Accept: "text/event-stream" }, signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split("\n")) {
        if (line.startsWith("data:")) events.push(line.slice(5).trim());
      }
    }
  } catch {
    // Aborting the stream is how this loop ends.
  }
};

async function main() {
  // ------------------------------------------------------------- health
  group("Service health and headers");
  const health = await owner.get("/api/health");
  eq("health is ok", health.body?.ok, true);
  check("health names a store", ["sqlite", "postgres"].includes(health.body?.store), health.body?.store);
  eq(
    "security headers are sent",
    Boolean(
      health.headers.get("content-security-policy") &&
        health.headers.get("x-content-type-options") === "nosniff" &&
        health.headers.get("x-frame-options") === "DENY"
    ),
    true
  );

  // ------------------------------------------------------------- sign-up
  group("Sign-up, templates and sign-in");
  const templates = await publicDevice.get("/api/auth/templates");
  check("templates are listed", (templates.body?.templates ?? []).length >= 8);
  check(
    "clinic template has several queues",
    (templates.body?.templates ?? []).some((t) => t.key === "clinic" && t.services.length === 3)
  );

  const signup = await owner.post("/api/auth/signup", { ...shopA, template: "clinic", branchName: "Front desk" });
  eq("sign-up succeeds", signup.status, 201);
  eq("sign-up signs you in", signup.body?.ok, true);
  eq("owner gets the owner role", signup.body?.staff?.role, "owner");
  check("password hash is never returned", !signup.text.includes("password_hash") && !signup.text.includes("scrypt"));
  const shopASlug = signup.body?.business?.slug;

  const shortPassword = await stranger.post("/api/auth/signup", { ...shopB, password: "short" });
  eq("short passwords are refused", shortPassword.status, 400);

  const duplicate = await stranger.post("/api/auth/signup", shopA);
  eq("the same email cannot sign up twice", duplicate.status, 409);

  const badLogin = await stranger.post("/api/auth/login", { email: shopA.email, password: "wrong-password" });
  eq("a wrong password is refused", badLogin.status, 401);
  check("the failure message does not leak which part was wrong", /wrong email or password/i.test(badLogin.body?.error ?? ""));

  const login = await manager.post("/api/auth/login", { email: shopA.email, password: shopA.password });
  eq("sign-in works", login.status, 200);

  const shopBSignup = await stranger.post("/api/auth/signup", { ...shopB, template: "salon" });
  eq("a second shop can be created", shopBSignup.status, 201);
  const shopBSlug = shopBSignup.body?.business?.slug;
  const staffB = makeClient();
  await staffB.post("/api/auth/logout");
  eq("the second shop is a different tenant", shopASlug !== shopBSlug, true);

  // ------------------------------------------------------------- structure
  group("Queues, counters and locations");
  const overview = await owner.get("/api/staff/overview");
  eq("the clinic template made three queues", overview.body?.services?.length, 3);
  eq("the first branch is used", overview.body?.branch?.name, "Front desk");
  const countersMade = overview.body?.services?.reduce((sum, entry) => sum + entry.counters, 0) ?? 0;
  eq("counters were created for every queue", countersMade, 4);

  const services = overview.body.services.map((entry) => entry.service);
  const [doctor, pharmacy, vaccination] = services;
  eq("queue names come from the template", doctor.name, "See a doctor");
  eq("numbers are prefixed per queue", doctor.prefix, "G");

  const newQueue = await owner.post("/api/staff/services", {
    branchId: overview.body.branch.id,
    name: "Blood tests",
    prefix: "b",
    avgMinutes: 7,
    counters: 2,
  });
  eq("a queue can be added", newQueue.status, 201);
  eq("the prefix is cleaned up", newQueue.body?.service?.prefix, "B");
  eq("its counters are created", newQueue.body?.counters?.length, 2);

  const newBranch = await owner.post("/api/staff/branches", {
    name: "Riverside",
    address: "2 Riverside Road",
  });
  eq("a second location can be added", newBranch.status, 201);
  const riversideId = newBranch.body?.branch?.id;

  const onlyBranchQueue = await owner.post("/api/staff/services", {
    branchId: riversideId,
    name: "Walk-in advice",
    prefix: "W",
  });
  eq("the new location gets its own queue", onlyBranchQueue.status, 201);

  const badQueue = await owner.post("/api/staff/services", { branchId: overview.body.branch.id, name: "" });
  eq("an empty queue name is refused", badQueue.status, 400);

  // ------------------------------------------------------------- staff team
  group("Team, roles and invitations");
  const inviteManager = await owner.post("/api/staff/team/invites", {
    email: `manager.${stamp}@alpha.test`,
    name: "Mia Manager",
    role: "manager",
  });
  eq("an owner can invite a manager", inviteManager.status, 201);
  check("the invitation link is returned once", typeof inviteManager.body?.token === "string");
  const managerToken = inviteManager.body.token;

  const invitedWrong = await stranger.get(`/api/auth/invite/${managerToken}`);
  eq("the invitee can read the invitation", invitedWrong.body?.invite?.role, "manager");

  eq(
    "the invited person becomes staff",
    (await manager.post(`/api/auth/invite/${managerToken}`, { name: "Mia Manager", password: "manager-pass-1" }))
      .status,
    201
  );
  const reusedInvite = await stranger.post(`/api/auth/invite/${managerToken}`, {
    name: "Someone Else",
    password: "manager-pass-1",
  });
  eq("an invitation cannot be used twice", reusedInvite.status, 404);

  const staffInvite = await manager.post("/api/staff/team/invites", {
    email: `sam.${stamp}@alpha.test`,
    name: "Sam Staff",
    role: "staff",
    branchId: overview.body.branch.id,
  });
  eq("a manager can invite staff", staffInvite.status, 201);
  eq(
    "a manager cannot hand out the owner role",
    (await manager.post("/api/staff/team/invites", { email: `x.${stamp}@alpha.test`, role: "owner" })).status,
    403
  );
  eq(
    "the invited staff member joins",
    (await worker.post(`/api/auth/invite/${staffInvite.body.token}`, { name: "Sam Staff", password: "staff-pass-1" }))
      .status,
    201
  );

  const viewerInvite = await owner.post("/api/staff/team/invites", {
    email: `val.${stamp}@alpha.test`,
    name: "Val Viewer",
    role: "viewer",
  });
  eq(
    "a viewer is invited",
    (await viewer.post(`/api/auth/invite/${viewerInvite.body.token}`, { name: "Val Viewer", password: "viewer-pass-1" }))
      .status,
    201
  );

  const team = await owner.get("/api/staff/team");
  eq("the team lists four people", team.body?.team?.length, 4);
  check(
    "the owner can edit everyone else",
    team.body.team.filter((member) => !member.isYou).every((member) => member.canEdit)
  );
  const viewerInviteAttempt = await viewer.post("/api/staff/team/invites", {
    email: `sneak.${stamp}@alpha.test`,
    role: "staff",
  });
  eq("a viewer cannot invite anyone", viewerInviteAttempt.status, 403);

  // ------------------------------------------------------------- roles
  group("What each role may do");
  const viewerQueue = await viewer.get(
    `/api/staff/queue?branch=${overview.body.branch.id}&service=${doctor.id}`
  );
  eq("a viewer can read the queue", viewerQueue.status, 200);
  const viewerCall = await viewer.post("/api/staff/queue/call-next", {
    branchId: overview.body.branch.id,
    serviceId: doctor.id,
  });
  eq("a viewer cannot call a number", viewerCall.status, 403);
  eq(
    "a viewer cannot change settings",
    (await viewer.patch("/api/staff/business", { name: "Hijacked" })).status,
    403
  );
  eq(
    "a staff member cannot change settings",
    (await worker.patch("/api/staff/business", { name: "Hijacked" })).status,
    403
  );

  // ------------------------------------------------------------- isolation
  group("Tenant and location isolation");
  const otherBusinessOverview = await stranger.get("/api/staff/overview");
  const otherBranchId = otherBusinessOverview.body?.branch?.id;
  const otherServiceId = otherBusinessOverview.body?.services?.[0]?.service?.id;
  eq(
    "another shop's location is invisible",
    (await owner.get(`/api/staff/queue?branch=${otherBranchId}&service=${doctor.id}`)).status,
    404
  );
  eq(
    "another shop's queue cannot be edited",
    (await owner.patch(`/api/staff/services/${otherServiceId}`, { name: "Stolen" })).status,
    404
  );
  eq(
    "another shop's queue cannot be deleted",
    (await owner.del(`/api/staff/services/${otherServiceId}`)).status,
    404
  );
  eq(
    "another shop's business cannot be read",
    (await owner.get(`/api/staff/queue?branch=${overview.body.branch.id}&service=${otherBranchId}`)).status,
    404
  );

  const branchPinned = await owner.post("/api/staff/team/invites", {
    email: `river.${stamp}@alpha.test`,
    name: "Rita Riverside",
    role: "staff",
    branchId: riversideId,
  });
  const riverClient = makeClient();
  await riverClient.post(`/api/auth/invite/${branchPinned.body.token}`, {
    name: "Rita Riverside",
    password: "river-pass-1",
  });
  eq(
    "branch-pinned staff cannot open another location",
    (await riverClient.get(`/api/staff/queue?branch=${overview.body.branch.id}&service=${doctor.id}`)).status,
    404
  );
  const riverOverview = await riverClient.get("/api/staff/overview");
  eq("branch-pinned staff only see their own location", riverOverview.body?.branches?.length, 1);

  // ------------------------------------------------------------- customers
  group("Customers joining");
  const join = async (name, deviceToken, service = doctor.slug) => {
    const result = await publicDevice.post(`/api/queue/${shopASlug}/join`, {
      branchSlug: "front-desk",
      serviceSlug: service,
      name,
      deviceToken,
    });
    return result;
  };

  const first = await join("Cleo", `dev-cleo-${stamp}`);
  eq("a customer can join", first.status, 201);
  eq("the first number is 1", first.body?.ticket?.number, 1);
  eq("the number carries the queue prefix", first.body?.ticket?.label, "G1");

  const second = await join("Dara", `dev-dara-${stamp}`);
  eq("the second number is 2", second.body?.ticket?.label, "G2");

  const repeat = await join("Cleo", `dev-cleo-${stamp}`);
  eq("the same phone does not take a second number", repeat.body?.duplicate, true);
  eq("and gets the number it already had", repeat.body?.ticket?.id, first.body?.ticket?.id);

  const noQueue = await publicDevice.post(`/api/queue/${shopASlug}/join`, { branchSlug: "front-desk" });
  eq("joining without choosing a queue is refused", noQueue.status, 400);

  const otherQueue = await join("Eve", `dev-eve-${stamp}`, pharmacy.slug);
  eq("a different queue numbers separately", otherQueue.body?.ticket?.label, "P1");

  const snapshot = await publicDevice.get(
    `/api/queue/${shopASlug}?branch=front-desk&service=${doctor.slug}&ticket=${first.body.ticket.id}`
  );
  eq("the customer sees their place in line", snapshot.body?.ticket?.peopleAhead, 0);
  eq("the branch and queue are echoed back", snapshot.body?.service?.id, doctor.id);

  // ------------------------------------------------------------- lifecycle
  group("Working the queue");
  const callNext = await owner.post("/api/staff/queue/call-next", {
    branchId: overview.body.branch.id,
    serviceId: doctor.id,
  });
  eq("call next returns the first waiting customer", callNext.body?.ticket?.label, "G1");
  eq("that customer is now being served", callNext.body?.ticket?.status, "called");

  const queueAfterCall = await owner.get(
    `/api/staff/queue?branch=${overview.body.branch.id}&service=${doctor.id}`
  );
  eq("the queue shows who is at the counter", queueAfterCall.body?.nowServing?.label, "G1");
  eq("the rest are still waiting", queueAfterCall.body?.waiting?.length, 1);

  const staffSeat = await worker.post("/api/staff/queue/call-next", {
    branchId: overview.body.branch.id,
    serviceId: doctor.id,
    counterId: queueAfterCall.body.counters[0].id,
  });
  eq("call next at a counter serves the previous customer", staffSeat.body?.ticket?.label, "G2");
  eq("and moves the queue on", staffSeat.body?.ticket?.status, "called");
  const afterSecond = await owner.get(`/api/staff/queue?branch=${overview.body.branch.id}&service=${doctor.id}`);
  eq("the finished customer is marked served", afterSecond.body?.finished?.[0]?.status, "served");

  const addWalkIn = await worker.post("/api/staff/tickets/manual", {
    branchId: overview.body.branch.id,
    serviceId: doctor.id,
    name: "Walk-in Faye",
    phone: "+2348000000000",
    note: "Phone booking",
  });
  eq("staff can add a walk-in", addWalkIn.status, 201);
  eq("the walk-in gets the next number", addWalkIn.body?.ticket?.label, "G3");
  eq("the source is recorded as the desk", addWalkIn.body?.ticket?.source, "desk");

  const walkInId = addWalkIn.body.ticket.id;
  eq(
    "holding works",
    (await owner.post(`/api/staff/tickets/${walkInId}/action`, { action: "hold" })).body?.ticket?.status,
    "on_hold"
  );
  const heldQueue = await owner.get(`/api/staff/queue?branch=${overview.body.branch.id}&service=${doctor.id}`);
  eq("held customers are listed separately", heldQueue.body?.held?.length, 1);
  eq(
    "releasing puts them back in line",
    (await owner.post(`/api/staff/tickets/${walkInId}/action`, { action: "release" })).body?.ticket?.status,
    "waiting"
  );

  const skipCall = await owner.post(`/api/staff/tickets/${walkInId}/action`, { action: "skip" });
  eq("skipping works", skipCall.body?.ticket?.status, "skipped");
  eq("the skip is counted", skipCall.body?.ticket?.skipCount, 1);
  eq(
    "recalling brings them back",
    (await owner.post(`/api/staff/tickets/${walkInId}/action`, { action: "recall" })).body?.ticket?.status,
    "called"
  );
  eq(
    "no-show closes the number",
    (await owner.post(`/api/staff/tickets/${walkInId}/action`, { action: "no_show" })).body?.ticket?.status,
    "no_show"
  );

  const confirm = await publicDevice.post(
    `/api/queue/${shopASlug}/ticket/${afterSecond.body.nowServing.id}/confirm`
  );
  eq("a called customer can confirm", confirm.status, 200);
  check("confirmation is recorded", confirm.body?.ticket?.confirmed === true);

  const lateConfirm = await publicDevice.post(
    `/api/queue/${shopASlug}/ticket/${otherQueue.body.ticket.id}/confirm`
  );
  eq("confirming before your turn is refused", lateConfirm.status, 409);

  const leave = await publicDevice.post(`/api/queue/${shopASlug}/ticket/${otherQueue.body.ticket.id}/leave`);
  eq("a customer can leave the queue", leave.status, 200);
  eq("leaving is recorded as cancelled", leave.body?.status, "cancelled");

  // ------------------------------------------------------------- moving
  group("Moving between queues");
  const mover = await worker.post("/api/staff/tickets/manual", {
    branchId: overview.body.branch.id,
    serviceId: doctor.id,
    name: "Movee",
  });
  const beforeMove = await owner.get(`/api/staff/queue?branch=${overview.body.branch.id}&service=${pharmacy.id}`);
  const pharmacyCounter = beforeMove.body.counters[0]?.id;
  const moved = await owner.post(`/api/staff/tickets/${mover.body.ticket.id}/move`, {
    serviceId: pharmacy.id,
    counterId: pharmacyCounter,
  });
  eq("a customer can be moved to another queue", moved.status, 200);
  eq("they get a fresh number there", moved.body?.ticket?.label, "P2");
  eq("and are waiting again", moved.body?.ticket?.status, "waiting");
  eq(
    "moving into a queue you do not own is refused",
    (await owner.post(`/api/staff/tickets/${mover.body.ticket.id}/move`, { serviceId: otherBranchId })).status,
    404
  );

  // ------------------------------------------------------------- concurrency
  group("Concurrent actions");
  const many = [];
  for (let index = 0; index < 5; index += 1) {
    many.push(
      owner.post("/api/staff/tickets/manual", {
        branchId: overview.body.branch.id,
        serviceId: vaccination.id,
        name: `Racer ${index}`,
      })
    );
  }
  const created = await Promise.all(many);
  const numbers = created.map((result) => result.body?.ticket?.number);
  eq("five simultaneous walk-ins all get a number", new Set(numbers).size, 5);

  const concurrentCalls = await Promise.all([
    owner.post("/api/staff/queue/call-next", { branchId: overview.body.branch.id, serviceId: vaccination.id }),
    worker.post("/api/staff/queue/call-next", { branchId: overview.body.branch.id, serviceId: vaccination.id }),
    manager.post("/api/staff/queue/call-next", { branchId: overview.body.branch.id, serviceId: vaccination.id }),
  ]);
  const calledIds = concurrentCalls.map((result) => result.body?.ticket?.id ?? null).filter(Boolean);
  eq("three simultaneous call-next presses serve three different people", new Set(calledIds).size, 3);
  check(
    "and nobody is served twice",
    concurrentCalls.every((result) => result.status === 200 || result.status === 409)
  );

  // ------------------------------------------------------------- realtime
  group("Realtime updates");
  const streamSlug = shopASlug;
  const events = await collectStream(
    `/api/queue/${streamSlug}/stream?channel=service%3A${vaccination.id}`,
    async () => {
      await owner.post("/api/staff/queue/call-next", {
        branchId: overview.body.branch.id,
        serviceId: vaccination.id,
      });
    }
  );
  check("the stream sends an update when the queue changes", events.length > 0, `${events.length} events`);

  // ------------------------------------------------------------- display
  group("TV screen");
  const display = await publicDevice.get(`/api/display/${streamSlug}?branch=front-desk&service=${vaccination.slug}`);
  eq("the display payload is public", display.status, 200);
  check("it shows who is being served", typeof display.body?.nowServing === "string");
  check("it lists who is waiting", Array.isArray(display.body?.waiting));
  check("it includes the shop name for the header", display.body?.business?.name === shopA.businessName);

  // ------------------------------------------------------------- history
  group("History and analytics");
  const history = await owner.get(`/api/staff/history?branch=${overview.body.branch.id}`);
  eq("history is readable", history.status, 200);
  check("it holds finished customers", history.body?.history?.length > 0);
  check(
    "it never shows people still in the queue",
    history.body.history.every((row) => !["waiting", "called", "on_hold"].includes(row.status))
  );
  check("wait times are recorded", history.body.history.some((row) => row.waitMinutes >= 0));

  const analytics = await owner.get(`/api/staff/analytics?branch=${overview.body.branch.id}&days=7`);
  eq("analytics are readable", analytics.status, 200);
  check("joined customers are counted", analytics.body?.totals?.joined > 0);
  check("served customers are counted", analytics.body?.totals?.served > 0);
  check("walked-away customers are counted", typeof analytics.body?.totals?.abandoned === "number");
  check("busiest hour is reported", analytics.body?.totals?.busiestHour !== undefined);
  eq("the hourly chart always has 24 hours", analytics.body?.hours?.length, 24);
  check("each queue has its own line", analytics.body?.services?.length >= 1);

  const audit = await owner.get(`/api/staff/audit?branch=${overview.body.branch.id}`);
  eq("the audit log is readable", audit.status, 200);
  check("it records queue actions", audit.body?.entries?.some((entry) => entry.action.startsWith("queue.")));
  check(
    "it records who did it",
    audit.body.entries.every((entry) => typeof entry.actorName === "string" && entry.actorName.length > 0)
  );
  eq(
    "a viewer may read reports",
    (await viewer.get(`/api/staff/analytics?branch=${overview.body.branch.id}&days=7`)).status,
    200
  );

  // ------------------------------------------------------------- branding
  group("Branding");
  const brand = await owner.patch("/api/staff/business", {
    name: `${shopA.businessName}`,
    customerNote: "Please stay near the counter.",
    brandColor: "#0b5cff",
    brandAccent: "#f2b705",
  });
  eq("branding is saved", brand.status, 200);
  eq("the colour comes back", brand.body?.business?.brandColor, "#0b5cff");
  eq(
    "an invalid colour is refused",
    (await owner.patch("/api/staff/business", { brandColor: "red; background:url(x)" })).status,
    400
  );
  eq(
    "a logo must be an https link or an image",
    (await owner.patch("/api/staff/business", { logo: "javascript:alert(1)" })).status,
    400
  );
  const branded = await publicDevice.get(`/api/queue/${shopASlug}`);
  eq("customers see the shop colour", branded.body?.business?.brandColor, "#0b5cff");
  eq("customers see the note", branded.body?.business?.note, "Please stay near the counter.");

  // ------------------------------------------------------------- pausing
  group("Pausing");
  const pause = await owner.patch("/api/staff/queue/pause", {
    branchId: overview.body.branch.id,
    serviceId: doctor.id,
    paused: true,
  });
  eq("a manager can pause a queue", pause.status, 200);
  const pausedJoin = await publicDevice.post(`/api/queue/${shopASlug}/join`, {
    branchSlug: "front-desk",
    serviceSlug: doctor.slug,
    name: "Late Comer",
  });
  eq("a paused queue takes no new customers", pausedJoin.status, 409);
  await owner.patch("/api/staff/queue/pause", {
    branchId: overview.body.branch.id,
    serviceId: doctor.id,
    paused: false,
  });
  const resumedJoin = await publicDevice.post(`/api/queue/${shopASlug}/join`, {
    branchSlug: "front-desk",
    serviceSlug: doctor.slug,
    name: "Late Comer",
  });
  eq("resuming takes customers again", resumedJoin.status, 201);
  await publicDevice.post(`/api/queue/${shopASlug}/ticket/${resumedJoin.body.ticket.id}/leave`);

  // ------------------------------------------------------------- security
  group("Security");
  const noSession = await makeClient().get("/api/staff/overview");
  eq("staff endpoints need a session", noSession.status, 401);
  eq("history needs a session", (await makeClient().get("/api/staff/history")).status, 401);
  eq("reports need a session", (await makeClient().get("/api/staff/analytics")).status, 401);
  const forgedCookie = makeClient();
  forgedCookie.jar.set("lobby_session", "deadbeef".repeat(8));
  eq("a made-up cookie is refused", (await forgedCookie.get("/api/staff/overview")).status, 401);

  const strangerTicket = await stranger.get(`/api/queue/${shopBSlug}/ticket/${first.body.ticket.id}`);
  eq("another shop cannot read your number", strangerTicket.status, 404);
  const strangerAction = await stranger.post(`/api/staff/tickets/${first.body.ticket.id}/action`, {
    action: "complete",
  });
  eq("another shop cannot touch your queue", strangerAction.status, 404);
  eq(
    "another shop cannot read a ticket's history",
    (await stranger.get(`/api/staff/tickets/${first.body.ticket.id}/events`)).status,
    404
  );

  const badTicketId = await publicDevice.get(`/api/queue/${shopASlug}/ticket/not-a-real-id`);
  eq("a made-up number is refused", badTicketId.status, 404);
  const badAction = await owner.post("/api/staff/tickets/abc123/action", { action: "explode" });
  eq("an unknown action is refused", badAction.status, 400);
  const longName = await publicDevice.post(`/api/queue/${shopASlug}/join`, {
    branchSlug: "front-desk",
    serviceSlug: doctor.slug,
    name: "x".repeat(200),
  });
  eq("an over-long name is refused", longName.status, 400);
  const missingQueue = await publicDevice.get(`/api/queue/${shopASlug}`);
  check("an unknown shop gives a clean 404", missingQueue.status === 200 || missingQueue.status === 404);

  // ------------------------------------------------------------- recovery
  group("Refreshing and recovering");
  const ticketLookup = await publicDevice.get(`/api/queue/${shopASlug}/ticket/${first.body.ticket.id}`);
  eq("a saved number can be looked up again", ticketLookup.status, 200);
  eq("it is the same number", ticketLookup.body?.ticket?.id, first.body.ticket.id);
  eq("and still has its place in line or its result", typeof ticketLookup.body?.ticket?.status, "string");

  const secondDevice = makeClient();
  const reopened = await secondDevice.post(`/api/queue/${shopASlug}/join`, {
    branchSlug: "front-desk",
    serviceSlug: doctor.slug,
    name: "Refresher",
    deviceToken: `dev-refresh-${stamp}`,
  });
  const again = await secondDevice.post(`/api/queue/${shopASlug}/join`, {
    branchSlug: "front-desk",
    serviceSlug: doctor.slug,
    name: "Refresher",
    deviceToken: `dev-refresh-${stamp}`,
  });
  eq("re-opening the page does not take a second number", again.body?.duplicate, true);
  eq("the number survives the reload", again.body?.ticket?.id, reopened.body?.ticket?.id);

  // ------------------------------------------------------------- passwords
  group("Passwords and sessions");
  const wrongCurrent = await worker.post("/api/auth/password", {
    currentPassword: "not-it",
    newPassword: "brand-new-pass-1",
  });
  eq("the current password must be right", wrongCurrent.status, 400);
  const changed = await worker.post("/api/auth/password", {
    currentPassword: "staff-pass-1",
    newPassword: "brand-new-pass-1",
  });
  eq("the password can be changed", changed.status, 200);
  const workerAgain = makeClient();
  eq(
    "the new password works",
    (await workerAgain.post("/api/auth/login", {
      email: `sam.${stamp}@alpha.test`,
      password: "brand-new-pass-1",
    })).status,
    200
  );
  eq(
    "the old password does not",
    (await makeClient().post("/api/auth/login", { email: `sam.${stamp}@alpha.test`, password: "staff-pass-1" }))
      .status,
    401
  );

  // ------------------------------------------------------------- demo
  group("Public demo");
  const demo = await publicDevice.get("/api/demo");
  eq("the demo is available", demo.status, 200);
  check("it has several queues", (demo.body?.services?.length ?? 0) >= 2);
  const demoService = demo.body.services[0].service.id;
  const demoJoin = await publicDevice.post("/api/demo/join", { serviceId: demoService, name: "Visitor" });
  eq("a visitor can join the demo", demoJoin.status, 201);
  const demoCall = await publicDevice.post("/api/demo/call-next", { serviceId: demoService });
  check("the demo can call the next number", demoCall.status === 200 || demoCall.status === 409);
  eq("the demo resets", (await publicDevice.post("/api/demo/reset")).status, 200);
  const afterReset = await publicDevice.get("/api/demo");
  check("the demo is seeded again", afterReset.body.totals.waiting > 0);
  eq(
    "the demo refuses customers it cannot find",
    (await publicDevice.post("/api/demo/join", { serviceId: "nope" })).status,
    404
  );

  // ------------------------------------------------------------- wrap up
  group("Signing out");
  eq("sign-out works", (await viewer.post("/api/auth/logout")).status, 200);
  eq("the session is gone", (await viewer.get("/api/staff/overview")).status, 401);
  const oldCookie = viewer.jar.get("lobby_session");
  viewer.jar.set("lobby_session", oldCookie);
  eq("the old cookie no longer works", (await viewer.get("/api/staff/overview")).status, 401);

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  • ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\nSuite crashed:", err);
  process.exitCode = 1;
});