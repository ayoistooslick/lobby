# Lobby

Lobby is a small queue management system for local businesses: pharmacies, clinics, salons,
barbershops, repair shops, banks, and anyone else who calls people one at a time.

Customers scan a permanent QR code, take a number in their phone browser, and watch their
position update live. Staff get one obvious button: **Call next**.

No app to install. No account for customers. No subscriptions, no analytics, no chatbots,
just a queue that works.

## Why

Small shops usually end up with a crowd at the counter or a paper system that breaks down.
Lobby is the digital version of the paper number slip: simple enough that a shop owner
understands it in ten seconds, and small enough that one developer can read the whole
codebase in an afternoon.

## What's inside

- A permanent QR code per business: view it, download it as a PNG, print it
- Joining from any phone browser: no app, no account, just a number
- Live position, "now serving", people ahead, "You're next"
- A clear turn notification on the customer's screen, with an "I'm here" confirmation
- Staff actions: **Call next**, **Mark as served**, **Skip**, **No show**
- Pause and resume the queue
- Light and dark theme, mobile-first layout, high contrast
- Business settings (name, optional note shown to customers)
- Real-time updates: when staff tap a button, open screens change by themselves

## Tech stack

| Layer      | Choice                                                       |
| ---------- | ------------------------------------------------------------ |
| Frontend   | React 19 + TypeScript, built with Vite, plain CSS             |
| Backend    | Node.js + Express 5 (TypeScript, compiled to CommonJS)         |
| Database   | PostgreSQL when `DATABASE_URL` is set, otherwise SQLite through `better-sqlite3` |
| Real-time  | Server-Sent Events (one tiny "something changed" signal)      |
| Auth       | `httpOnly` session cookie, scrypt-hashed passwords            |
| QR codes   | `qrcode`, generated in the browser                            |

There is no UI framework and no external service. `npm install` is all you need.

## Quick start

Requires **Node.js 20.19+** (Node 22 or newer recommended).

```bash
git clone <your-fork-url> lobby
cd lobby
npm install
npm run dev
```

- The Vite dev server runs at http://localhost:5173 and proxies `/api` to the API server.
- The API server runs at http://localhost:3000.

Open http://localhost:5173, click **Set up your business**, and you're away.

To run it the way production does:

```bash
npm run build     # builds the frontend into dist/ and the server into dist-server/
npm start         # serves the API and the built frontend on PORT (default 3000)
```

Other scripts: `npm run dev:server`, `npm run dev:client`, `npm run typecheck`.

## Environment variables

All of them are optional, and none are secrets required to run locally.
Session tokens are random values created at login and stored server-side as hashes.

| Variable        | Default            | Purpose                                                                 |
| --------------- | ------------------ | ----------------------------------------------------------------------- |
| `PORT`          | `3000`             | Port the HTTP server listens on (hosts like Render inject this)         |
| `DATABASE_URL`  | unset              | PostgreSQL connection string. **When set, Lobby uses Postgres; when unset, it falls back to the SQLite file automatically** |
| `DATABASE_PATH` | `./data/lobby.db`  | SQLite file location (only used when `DATABASE_URL` is not set)         |
| `NODE_ENV`      | unset              | Set to `production` in production so session cookies get the `Secure` flag |

### Choosing a database

Lobby supports two storage engines behind one interface:

- **PostgreSQL** — set `DATABASE_URL`, e.g.
  `postgres://user:password@host:5432/dbname?sslmode=require`.
  Use this on any host without a persistent disk (Render, Railway, Fly, Koyeb…).
  Tables are created on first boot; TLS is enabled automatically when the URL
  asks for `sslmode=require`.
- **SQLite (default)** — with no `DATABASE_URL`, data goes to a single file at
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
  a queue changes; each open screen refetches its own snapshot. No websockets, no
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

- Passwords hashed with scrypt; login errors are identical for unknown emails and wrong
  passwords (and unknown emails still pay the hashing cost).
- Session cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production.
- Every staff endpoint requires a session and only touches rows belonging to that
  session's business; customers can only act on their own ticket, which is referenced by
  an unguessable id.
- All input is validated on the server; mutations expect JSON (which blocks simple
  cross-site form attacks), and there are basic per-IP and per-queue rate limits.

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
public/             favicon
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
- `PORT` is injected by the platform; the server listens on it automatically.

Prefer SQLite instead? Attach a persistent volume and set `DATABASE_PATH` to a file on
that volume — then omit `DATABASE_URL` and the file engine takes over.

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
