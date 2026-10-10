<div align="center">

<p><sub><b>QUEUES FOR SHOPS, CLINICS AND SALONS</b></sub></p>

<img src="public/og.png" alt="Lobby — Queues, without the chaos." width="760">

**One QR code on the door. Customers scan it, take a number, and watch their
place in line from anywhere. Staff press one button, and the TV keeps everyone
informed.**

[![Set up your business](https://img.shields.io/badge/Set_up_your_business-101012?style=for-the-badge)](#quick-start)
[**Try the live demo →**](#try-the-live-demo)

✓ Works on any phone &nbsp;✓ Live by default &nbsp;✓ No app for customers, no sign-up for them. Open source, runs on your own server.

</div>

<div align="center">

[▶ Watch the launch film →](public/launch-video.mp4)

</div>

---

## From door to done in four steps

| Step | What happens |
| :---: | --- |
| **01** | **Customers join** — They scan the code, pick a service, and take a number. No app, no account. |
| **02** | **Staff call next** — One big button serves the next person and keeps the line fair. |
| **03** | **Everyone sees their status** — Each phone shows their place, who's ahead, and the wait, live, without refreshing. |
| **04** | **The display keeps order** — A TV in the waiting area shows who's being served and who's next. |

## Everything a queue needs, nothing it doesn't

Lobby does one job well. Every feature below is part of the product today.

|  |  |
| --- | --- |
| **One code, always current**<br>A permanent QR code for each location. Print it once, renaming the business never breaks it. | **Many queues, one screen**<br>Split the counter into services like consultation, pickup, or returns, each with its own numbers and counters. |
| **Roles that fit a shop**<br>Invite staff by link, pin them to a branch, and keep owners in charge of the keys. | **Looks like your business**<br>Your colours, logo, and note show up on every customer's phone and the TV. |
| **Close without confusion**<br>Pause a queue with one tap. The door sign says so, and no one takes a number into a closed counter. | **Facts for the quiet evening**<br>Wait times, busiest hours, and a full history, so next week's rota isn't a guess. |

## What your customers see

One screen with the same answers every time. It works in any phone browser,
and when you call their number it flips to *It's your turn*.

| | |
| --- | --- |
| You're number | **24** |
| People ahead of you | **3** |
| When it happens | **It's your turn!** |

## A display your waiting room deserves

Open the display on any TV browser. Huge numbers, the next five in line, and
other queues at a glance. It updates the second your staff do.

## Made for places with a counter

![Pharmacies](https://img.shields.io/badge/Pharmacies-101012?style=flat-square)
![Clinics](https://img.shields.io/badge/Clinics-101012?style=flat-square)
![Salons](https://img.shields.io/badge/Salons-101012?style=flat-square)
![Barbershops](https://img.shields.io/badge/Barbershops-101012?style=flat-square)
![Repair shops](https://img.shields.io/badge/Repair_shops-101012?style=flat-square)
![Banks](https://img.shields.io/badge/Banks-101012?style=flat-square)
![Post offices](https://img.shields.io/badge/Post_offices-101012?style=flat-square)
![Government offices](https://img.shields.io/badge/Government_offices-101012?style=flat-square)

> ### Your queue could be live in a minute.
>
> Start from a shop type (restaurant, clinic, salon, repair shop) and edit the
> names. Add more locations whenever you open another.
>
> [![Set up your business](https://img.shields.io/badge/Set_up_your_business-101012?style=for-the-badge)](#quick-start)
> [**Try the live demo →**](#try-the-live-demo)

---

## Try the live demo

A practice shop you can press buttons on. Join as a customer, call numbers as
staff, and watch the TV screen. Nothing here is real.

```bash
npm install
npm run dev
```

Open http://localhost:5173/demo — or start at http://localhost:5173 and click
**Set up your business** to make a real one.

## Quick start

Requires **Node.js 20.19+** (Node 22 or newer recommended).

```bash
git clone https://github.com/ayoistooslick/lobby.git lobby
cd lobby
npm install
npm run dev
```

- The Vite dev server runs at http://localhost:5173 and proxies `/api` to the API server.
- The API server runs at http://localhost:3000.

To run it the way production does:

```bash
npm run build     # builds the frontend into dist/ and the server into dist-server/
npm start         # serves the API and the built frontend on PORT (default 3000)
```

Other scripts: `npm run dev:server`, `npm run dev:client`, `npm run typecheck`.

## Tech stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Frontend   | React 19 + TypeScript, built with Vite, plain CSS              |
| Backend    | Node.js + Express 5 (TypeScript, compiled to CommonJS)         |
| Database   | PostgreSQL when `DATABASE_URL` is set, otherwise SQLite through `better-sqlite3` |
| Real-time  | Server-Sent Events (one tiny "something changed" signal)       |
| Auth       | `httpOnly` session cookie, scrypt-hashed passwords             |
| QR codes   | `qrcode`, generated in the browser                             |

There is no UI framework and no external service. `npm install` is all you need.

## Environment variables

All of them are optional, and none are secrets required to run locally.
Session tokens are random values created at login and stored server-side as hashes.

| Variable        | Default            | Purpose                                                                 |
| --------------- | ------------------ | ----------------------------------------------------------------------- |
| `PORT`          | `3000`             | Port the HTTP server listens on (hosts like Render inject this)         |
| `DATABASE_URL`  | unset              | PostgreSQL connection string. **When set, Lobby uses Postgres. When unset, it falls back to the SQLite file automatically** |
| `DATABASE_PATH` | `./data/lobby.db`  | SQLite file location (only used when `DATABASE_URL` is not set)         |
| `NODE_ENV`      | unset              | Set to `production` in production (HSTS, asset caching). Session cookies get `Secure` automatically whenever the request arrives over HTTPS, even without it |

### Choosing a database

Lobby supports two storage engines behind one interface:

- **PostgreSQL**. Set `DATABASE_URL`, e.g.
  `postgres://user:password@host:5432/dbname?sslmode=require`.
  Use this on any host without a persistent disk (Render, Railway, Fly, Koyeb…).
  Tables are created on first boot. TLS is enabled automatically when the URL
  asks for `sslmode=require`.
- **SQLite (default)**. With no `DATABASE_URL`, data goes to a single file at
  `DATABASE_PATH`. Zero setup, perfect for local development.

The active engine is printed at boot (`storage: PostgreSQL` / `storage: SQLite file`)
and reported by `GET /api/health` as `"store": "postgres" | "sqlite"`.

## How it works

```
Browser (React SPA)                      Express server
├─ /q/:slug   customer screen   ──GET──►  public queue snapshot
│                                        ├─ join / confirm / leave
├─ EventSource ────────────────────────►  SSE stream (change signals only)
│                                        └─ publish() on every queue change
└─ /dashboard staff screens      ──GET──►  /api/staff/* (session required)
                                          └─ every query scoped to the session's business
```

- **Screens stay fresh with SSE.** The server broadcasts a small `update` event whenever
  a queue changes. Each open screen refetches its own snapshot. No websockets, no
  third-party realtime service, and it survives normal mobile network hiccups
  (EventSource reconnects on its own).
- **The server owns the state.** Positions, "now serving", and turn order are computed
  from the database on every request. The client only ever displays them.
- **Call next is one transaction:** the person at the counter is marked served, and the
  oldest waiting number is promoted to "called". The same guarantee holds on Postgres,
  where row locks keep two staff taps from promoting the same ticket.

### Data model

| Table        | What it holds                                                            |
| ------------ | ------------------------------------------------------------------------ |
| `businesses` | name, owner, email, password hash, permanent slug, note, paused flag      |
| `sessions`   | hashed session token → business, expiry (pruned automatically)           |
| `tickets`    | one row per number: business, day, number, optional name, status, confirm |

Ticket statuses: `waiting` → `called` → `served` / `skipped` / `no_show`.
Numbers restart each day and are unique per business per day.

### Security notes

- Passwords hashed with scrypt. Login errors are identical for unknown emails and wrong
  passwords (and unknown emails still pay the hashing cost). Login is throttled per IP
  *and* per email address, and obvious passwords (`password123`, your own email, a
  repeated character) are refused at signup, invite and password change.
- Session cookies are `httpOnly`, `SameSite=Lax`, and `Secure` on any HTTPS request
  (HSTS is sent the same way), independent of `NODE_ENV`. Sessions and
  invite tokens are stored as SHA-256 hashes, never in the clear.
- Every staff endpoint requires a session and only touches rows belonging to that
  session's business. Customers can only act on their own ticket, which is referenced by
  an unguessable id.
- Queue order is server-owned: numbers are handed out inside one serialised transaction,
  and the one-number-per-device check runs in the *same* transaction as the insert, so a
  double tap or scripted parallel join can never take a second number, let alone a better
  place in line.
- Public queue/display payloads never include the owner's login email or name. Live
  update streams are capped per IP and globally so they cannot be used to exhaust
  connections.
- All input is validated on the server. Mutations expect JSON (which blocks simple
  cross-site form attacks), and there are per-IP and per-queue rate limits.

## Project structure

```
server/             Express API
  index.ts          app setup, static files, error handling
  store.ts          storage facade: Postgres when DATABASE_URL is set, else SQLite
  pg.ts             PostgreSQL engine (schema, queries, transactions)
  rows.ts           shared row types
  auth.ts           passwords, sessions, cookies
  events.ts         the SSE hub
  validate.ts       input checks and ApiError
  rateLimit.ts      small in-memory limiter
  routes/           auth, public queue, staff
src/                React app
  pages/            landing, about, auth, customer queue, dashboard screens
  components/       layout, route guard, language picker, shared states
  lib/              fetch wrapper, hooks, theme, i18n (20 languages), types
  styles.css        the whole visual system (light + dark tokens)
public/             favicon, social cards
```

## Deployment

Lobby is a single Node process. With `DATABASE_URL` set it needs no writable disk at
all, which makes it a fit for every long-lived Node host:

1. **Build command:** `npm install && npm run build`
2. **Start command:** `npm start`
3. **Environment variables:** `NODE_ENV=production` and `DATABASE_URL` pointing at
   your Postgres database. (`PORT` is provided by most hosts.)

### Render

1. Push this repository to GitHub, then in Render: **New → Web Service** and pick the repo.
2. Use these settings:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
3. Add the environment variables:

   | Key              | Value                                                      |
   | ---------------- | ---------------------------------------------------------- |
   | `NODE_ENV`       | `production`                                               |
   | `DATABASE_URL`   | your Postgres connection string (`sslmode=require` advised) |

   `PORT` is set by Render automatically.

Render gives the app a public HTTPS URL, and that's the URL your QR code will point to.
With `DATABASE_URL` there is no need for a persistent disk: the queue survives redeploys
and restarts because the data lives in Postgres, not on the instance.

### Railway, Fly.io, Koyeb (and similar PaaS)

Same shape as Render:

- **Build:** `npm install && npm run build`
- **Start:** `npm start`
- **Env vars:** `NODE_ENV=production` and `DATABASE_URL`. No volume required.
- `PORT` is injected by the platform. The server listens on it automatically.

Prefer SQLite instead? Attach a persistent volume and set `DATABASE_PATH` to a file on
that volume, then omit `DATABASE_URL` and the file engine takes over.

### A VPS (DigitalOcean, Hetzner, AWS EC2…)

Run it behind a reverse proxy:

```bash
# on the server, after cloning and npm install && npm run build
NODE_ENV=production DATABASE_URL='postgres://user:password@host:5432/dbname?sslmode=require' PORT=3000 npm start
```

Terminate TLS with Caddy or Nginx and proxy to `localhost:3000`. A tiny systemd unit
that runs `npm start` in the project directory keeps it alive. Caddy example:

```
queue.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### What doesn't work

Static-only hosts (GitHub Pages, Netlify static) can't run Lobby: it needs the Express
server. Serverless platforms (Vercel functions, Netlify functions) would need changes,
because they can't hold SSE connections open.

## License

[MIT](LICENSE) © Ayodele Ayokunle David
