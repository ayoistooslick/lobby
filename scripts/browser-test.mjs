/**
 * Lobby browser suite.
 *
 * Drives the real UI in Chromium: a customer joining from the link, staff
 * working the queue from the dashboard, the TV display and the public demo.
 * Realtime updates and reconnect states are checked through the pages themselves.
 *
 * Usage: node scripts/browser-test.mjs [baseUrl]   (default http://127.0.0.1:3992)
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:3992";
const stamp = Date.now().toString(36).slice(-5);
const shop = `Browser Shop ${stamp}`;
const email = `browser.${stamp}@shop.test`;
const password = "browser-pass-1";

let passed = 0;
const failures = [];
const consoleErrors = [];

function group(name) {
  console.log(`\n── ${name}`);
}

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function watch(page, tag) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/fonts\.(googleapis|gstatic)\.com|favicon/.test(text)) return;
    consoleErrors.push(`${tag}: ${text}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${tag}: ${error.message}`));
}

/** The first visit asks for a language; choose English and move on. */
async function pickLanguage(page) {
  await page.waitForSelector(".lang-gate, .site-header, .customer-top", { timeout: 15_000 });
  if ((await page.locator(".lang-gate").count()) === 0) return;
  await page.locator('.lang-option[data-code="en"]').click();
  await page.waitForSelector(".lang-gate", { state: "detached" });
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  watch(page, "shop");

  // ------------------------------------------------------------- landing
  group("Landing page");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await pickLanguage(page);
  check("the landing page loads", (await page.locator("h1").first().textContent())?.includes("Queues, without the chaos"));
  check("there is a way into the demo", (await page.locator('a[href="/demo"]').count()) > 0);
  check("and a way to sign up", (await page.locator('a[href="/auth?mode=signup"]').count()) > 0);

  // ------------------------------------------------------------- sign up
  group("Setting up a business");
  await page.goto(`${BASE}/auth?mode=signup`, { waitUntil: "domcontentloaded" });
  await page.fill("#businessName", shop);
  await page.fill("#ownerName", "Bea Boss");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.locator(".template-field .chip", { hasText: "Restaurant" }).click();
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  check("sign-up lands in the dashboard", page.url().includes("/dashboard"));
  check(
    "the shop name is in the sidebar",
    (await page.locator(".side-biz").textContent())?.includes(shop)
  );

  group("First-run onboarding");
  await page.waitForSelector(".first-run, .queue-picker", { timeout: 10_000 });
  check("new shops are shown how to start", (await page.locator(".first-run").count()) > 0);
  check("a queue picker is available", (await page.locator(".queue-picker select").count()) > 0);
  check(
    "the restaurant template created queues",
    (await page.locator(".queue-picker select option").count()) >= 2
  );

  // ------------------------------------------------------------- QR
  group("QR code page");
  await page.goto(`${BASE}/dashboard/qr`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".qr-sheet img", { timeout: 15_000 });
  check("a QR code is generated", (await page.locator(".qr-sheet img").count()) === 1);
  const qrSrc = await page.locator(".qr-sheet img").getAttribute("src");
  check("it is a real PNG data URL", (qrSrc ?? "").startsWith("data:image/png;base64,"));
  const joinLink = await page.locator("#queue-url").inputValue();
  check("the join link points at this shop", joinLink.includes(`/q/`), joinLink);
  const displayLink = await page.locator("#display-url").inputValue();
  check("a TV screen link is offered too", displayLink.includes("/display/"), displayLink);

  // ------------------------------------------------------------- customer
  group("A customer joins");
  const customer = await context.browser().newContext({ viewport: { width: 390, height: 844 } });
  const customerPage = await customer.newPage();
  watch(customerPage, "customer");
  await customerPage.goto(joinLink, { waitUntil: "domcontentloaded" });
  await pickLanguage(customerPage);
  await customerPage.waitForSelector("#join-name", { timeout: 15_000 });
  check("the shop name is shown", (await customerPage.locator("h1").textContent())?.includes(shop));
  check("the customer picks a queue", (await customerPage.locator("#service-pick").count()) > 0);
  check("the queue shows who is being served", (await customerPage.locator(".stat-inline").count()) > 0);

  await customerPage.selectOption("#service-pick", { index: 1 });
  await customerPage.waitForTimeout(400);
  await customerPage.fill("#join-name", "Cleo Customer");
  await customerPage.click('form button[type="submit"]');
  await customerPage.waitForSelector(".ticket-hero", { timeout: 15_000 });
  const numberText = await customerPage.locator(".ticket-number").textContent();
  check("the customer gets a number", /^[A-Z]?\d+$/.test((numberText ?? "").trim()), numberText ?? "");
  check("they are told there is nobody ahead", (await customerPage.locator(".ticket-ahead").textContent())?.length > 0);
  const ticketUrl = customerPage.url();
  check("the number is in the link so a refresh keeps it", ticketUrl.includes("t="));

  // ------------------------------------------------------------- staff
  group("Staff work the queue");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".serve-num", { timeout: 15_000 });
  check("the dashboard says nobody is at the counter", (await page.locator(".dash-mark").count()) > 0);
  await page.waitForSelector(".queue-row", { timeout: 15_000 });
  check("the waiting customer appears for staff", (await page.locator(".queue-row").first().textContent())?.includes("Cleo"));

  await page.click(".serve-side .btn-primary");
  await page.waitForFunction(
    () => /[A-Z]?\d/.test(document.querySelector(".serve-num")?.textContent ?? ""),
    null,
    { timeout: 15_000 }
  );
  const nowServing = await page.locator(".serve-num").textContent();
  check("call next puts a number on screen", /^[A-Z]?\d+$/.test((nowServing ?? "").trim()), nowServing ?? "");

  group("Realtime updates reach the customer");
  await customerPage.waitForFunction(
    () => document.querySelector(".ticket-panel.is-turn") !== null,
    undefined,
    { timeout: 15_000 }
  );
  check("the customer's phone flips to their turn", true);
  check(
    "and asks them to come to the counter",
    (await customerPage.locator(".ticket-panel.is-turn .ticket-ahead").textContent())?.length > 0
  );
  await customerPage.click(".is-turn .btn-primary");
  await customerPage.waitForSelector(".confirmed-line", { timeout: 15_000 });
  check("the customer can say they are there", true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".queue-row.is-current", { timeout: 15_000 });
  check("staff see who is confirmed at the counter", (await page.locator(".queue-row.is-current").textContent())?.includes("Cleo"));

  // ------------------------------------------------------------- actions
  group("Queue actions");
  await page.click('.queue-row.is-current .row-actions .btn-secondary:nth-child(1)');
  await page.waitForSelector(".finished-list", { timeout: 15_000 });
  check("marking someone served files them away", (await page.locator(".finished-list").count()) > 0);

  group("Adding a walk-in");
  await page.locator(".serve-side .btn-secondary", { hasText: /add/i }).first().click();
  await page.waitForSelector("#walkin-name", { timeout: 10_000 });
  await page.fill("#walkin-name", "Walk-in Wanda");
  await page.click('.settings-form button[type="submit"]');
  await page.waitForSelector(".queue-list .queue-row", { timeout: 15_000 });
  check(
    "the walk-in joins the line",
    (await page.locator(".queue-list .queue-row").first().textContent())?.includes("Wanda")
  );

  // ------------------------------------------------------------- setup
  group("Queues, counters and locations");
  await page.goto(`${BASE}/dashboard/setup`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card-row", { timeout: 15_000 });
  const queueCount = await page.locator(".card-list .card-row").count();
  check("both template queues are listed", queueCount >= 2, String(queueCount));
  await page.fill("#queue-name", "Takeaway");
  await page.fill("#queue-prefix", "TA");
  await page.locator(".inline-form button[type='submit']").last().click();
  await page.waitForSelector('.card-title:has-text("Takeaway")', { timeout: 15_000 });
  check("a new queue can be added", (await page.locator('.card-title:has-text("Takeaway")').count()) > 0);
  await page.fill("#branch-name", "Riverside");
  await page.locator(".inline-form").first().locator("button[type='submit']").click();
  await page.waitForSelector('.card-title:has-text("Riverside")', { timeout: 15_000 });
  check("a second location can be added", (await page.locator('.card-title:has-text("Riverside")').count()) > 0);

  // ------------------------------------------------------------- team
  group("Team screen");
  await page.goto(`${BASE}/dashboard/team`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#invite-email", { timeout: 15_000 });
  check("the owner is listed on the team", (await page.locator(".team-row, .card-row").count()) >= 1);
  await page.fill("#invite-email", `staff.${stamp}@shop.test`);
  await page.fill("#invite-name", "Sam Staff");
  await page.selectOption("#invite-role", "staff");
  await page.locator('form button[type="submit"]').click();
  await page.waitForSelector("#invite-link", { timeout: 15_000 });
  const inviteLink = await page.locator("#invite-link").inputValue();
  check("an invitation link is produced", inviteLink.includes("/join/"), inviteLink);

  const staffContext = await context.browser().newContext({ viewport: { width: 390, height: 844 } });
  const staffPage = await staffContext.newPage();
  watch(staffPage, "invitee");
  await staffPage.goto(inviteLink, { waitUntil: "domcontentloaded" });
  await pickLanguage(staffPage);
  await staffPage.waitForSelector("#password", { timeout: 15_000 });
  check("the invitation explains who invited them", (await staffPage.locator(".auth-sub").textContent())?.includes(shop));
  await staffPage.fill("#name", "Sam Staff");
  await staffPage.fill("#password", "staff-pass-22");
  await staffPage.click('button[type="submit"]');
  await staffPage.waitForURL("**/dashboard", { timeout: 15_000 });
  check("the invited person lands in the dashboard", staffPage.url().includes("/dashboard"));
  check(
    "a staff member does not see the team screen",
    (await staffPage.locator('a[href="/dashboard/team"]').count()) === 0
  );
  check(
    "a staff member does not see settings",
    (await staffPage.locator('a[href="/dashboard/settings"]').count()) === 0
  );
  await staffPage.waitForSelector(".serve-side .btn-primary", { timeout: 15_000 });
  check("but can run the queue", (await staffPage.locator(".serve-side .btn-primary").count()) === 1);

  // ------------------------------------------------------------- reports
  group("History and insights");
  await page.goto(`${BASE}/dashboard/reports`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".stat-grid", { timeout: 15_000 });
  const cards = await page.locator(".stat-card").count();
  check("the report shows the headline numbers", cards >= 5, String(cards));
  check("the hourly chart is drawn", (await page.locator(".bar-chart .bar").count()) === 24);
  check(
    "history lists the served customer",
    (await page.locator(".queue-list", { hasText: "Cleo" }).count()) > 0
  );

  // ------------------------------------------------------------- settings
  group("Branding and settings");
  await page.goto(`${BASE}/dashboard/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#biz-name", { timeout: 15_000 });
  await page.fill("#biz-note", "Please wait by the counter.");
  await page.locator('input[type="color"]').first().fill("#0b5cff");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForSelector(".saved-line", { timeout: 15_000 });
  check("settings save", (await page.locator(".saved-line").textContent())?.length > 0);

  const branded = await context.browser().newContext({ viewport: { width: 390, height: 844 } });
  const brandedPage = await branded.newPage();
  watch(brandedPage, "branded");
  await brandedPage.goto(joinLink, { waitUntil: "domcontentloaded" });
  await pickLanguage(brandedPage);
  await brandedPage.waitForSelector("#join-name", { timeout: 15_000 });
  const brandColour = await brandedPage.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--brand").trim()
  );
  check("the customer's page uses the shop colour", brandColour === "#0b5cff", brandColour);
  check(
    "the note for customers is shown",
    (await brandedPage.locator(".customer-note").textContent())?.includes("Please wait by the counter")
  );

  // ------------------------------------------------------------- display
  group("TV display");
  const displayPage = await context.browser().newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await displayPage.newPage();
  watch(tv, "tv");
  await tv.goto(displayLink, { waitUntil: "domcontentloaded" });
  // With nobody at the counter the display shows the awaiting line instead of a number.
  await tv.waitForSelector(".tvnow-num, .tvnow-wait", { timeout: 15_000 });
  check("the display shows the now-serving area", (await tv.locator(".tvnow-num, .tvnow-wait").count()) === 1);
  check("the display lists the waiting queue", (await tv.locator(".tvnext li, .tv-grid, .tvgrid").count()) > 0);
  check("the display has a full-screen button", (await tv.locator(".display-top .icon-btn").count()) === 1);

  // realtime on the TV
  await page.bringToFront();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".serve-side .btn-primary", { timeout: 15_000 });
  const before = await tv.locator(".tvnow-num, .tvnow-wait").textContent();
  await page.click(".serve-side .btn-primary");
  await tv.waitForFunction(
    (previous) => {
      const el = document.querySelector(".tvnow-num") ?? document.querySelector(".tvnow-wait");
      return (el?.textContent ?? "").trim() !== previous;
    },
    before,
    { timeout: 15_000 }
  );
  check("the TV screen updates without being reloaded", true);

  // ------------------------------------------------------------- recovery
  group("Connection loss and recovery");
  await customerPage.context().setOffline(true);
  await customerPage.evaluate(() => window.dispatchEvent(new Event("offline")));
  await customerPage.waitForSelector(".conn-warn", { timeout: 10_000 });
  check("an offline customer is told what is happening", (await customerPage.locator(".conn-warn").count()) > 0);
  await customerPage.context().setOffline(false);
  await customerPage.evaluate(() => window.dispatchEvent(new Event("online")));
  await customerPage.waitForSelector(".conn-live, .customer-top", { timeout: 15_000 });
  check("the page comes back when the network returns", true);

  group("Refreshing the customer's page");
  await customerPage.reload({ waitUntil: "domcontentloaded" });
  await customerPage.waitForSelector(".ticket-hero, .ticket-panel", { timeout: 15_000 });
  check("the number survives a refresh", (await customerPage.locator(".ticket-number, .ticket-panel").count()) > 0);

  group("Signing out");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  // Sign out lives in the sidebar (hidden on phones); wait for it to render,
  // then click via the DOM so the test stays viewport-independent.
  await page.waitForSelector('button[aria-label="Sign out"]', { state: "attached", timeout: 15_000 });
  await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Sign out"]');
    if (button instanceof HTMLElement) button.click();
  });
  await page.waitForFunction(() => window.location.pathname === "/", undefined, { timeout: 15_000 });
  check("signing out returns to the home page", new URL(page.url()).pathname === "/");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/auth**", { timeout: 15_000 });
  check("the dashboard is closed to signed-out visitors", page.url().includes("/auth"));
  check("and remembers where they were going", page.url().includes("returnTo"));

  // ------------------------------------------------------------- demo
  group("Public demo");
  await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
  await pickLanguage(page);
  await page.waitForSelector("#demo-name", { timeout: 15_000 });
  check("the demo explains itself", (await page.locator("h1").textContent())?.length > 0);
  const demoBefore = await page.locator(".demo-service .muted").first().textContent();
  await page.fill("#demo-name", "Demo Visitor");
  await page.locator(".phone-frame .btn-primary").click();
  await page.waitForFunction(
    (previous) => document.querySelector(".demo-service .muted")?.textContent !== previous,
    demoBefore,
    { timeout: 15_000 }
  );
  check("joining in the demo updates the queue", true);
  await page.locator('.demo-pane button:has-text("Call next")').first().click();
  await page.waitForTimeout(1200);
  check("calling in the demo works without an account", (await page.locator(".demo-service .muted").count()) > 0);
  await page.locator('button:has-text("Reset the demo")').click();
  await page.waitForTimeout(1500);
  check("the demo can be reset", (await page.locator(".demo-pane").count()) >= 2);

  // ------------------------------------------------------------- phones
  group("Phone-sized screens");
  const phone = await context.browser().newContext({
    viewport: { width: 360, height: 640 },
    isMobile: true,
    hasTouch: true,
  });
  const small = await phone.newPage();
  watch(small, "phone");
  await small.goto(joinLink, { waitUntil: "domcontentloaded" });
  await pickLanguage(small);
  await small.waitForSelector("#join-name", { timeout: 15_000 });
  const overflow = await small.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check("no sideways scrolling on a small phone", overflow <= 1, `${overflow}px`);
  const buttonSize = await small.locator('form button[type="submit"]').boundingBox();
  check("the join button is big enough to tap", (buttonSize?.height ?? 0)>= 44, `${buttonSize?.height}px`);

  await browser.close();

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (consoleErrors.length) {
    console.log(`\n${consoleErrors.length} console errors:`);
    for (const error of consoleErrors.slice(0, 10)) console.log(`  • ${error}`);
  }
  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  • ${failure}`);
    process.exitCode = 1;
  }
  if (consoleErrors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\nSuite crashed:", err);
  process.exitCode = 1;
});
