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
| Backend    | Node.js + Express (TypeScript, compiled to CommonJS)          |
| Database   | SQLite through `better-sqlite3`, one file, nothing to set up  |
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

Only three, and all of them have sensible local defaults. **No secrets are required**,
session tokens are random values created at login and stored server-side as hashes.

| Variable        | Default            | Purpose                                                                 |
| --------------- | ------------------ | ----------------------------------------------------------------------- |
| `PORT`          | `3000`             | Port the HTTP server listens on (hosts like Render inject this)         |
| `DATABASE_PATH` | `./data/lobby.db`  | Where the SQLite file lives. Point this at a persistent disk in prod    |
| `NODE_ENV`      | unset              | Set to `production` in production so session cookies get the `Secure` flag |

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
  oldest waiting number is promoted to "called".

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
  db.ts             SQLite connection, schema, queries
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

Lobby is a single Node process plus a SQLite file, so any host that runs a long-lived
Node app with a writable disk will do. In every case you need:

1. **Build command:** `npm install && npm run build`
2. **Start command:** `npm start`
3. **Environment variables:** `NODE_ENV=production` and a `DATABASE_PATH` on a
   persistent disk/volume. (`PORT` is provided by most hosts.)

### Render

1. Push this repository to GitHub, then in Render: **New → Web Service** and pick the repo.
2. Use these settings:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
3. Add a **persistent disk** (e.g.1 GB) and mount it at `/var/data`.
4. Add the environment variables:

   | Key              | Value                  |
   | ---------------- | ---------------------- |
   | `NODE_ENV`       | `production`           |
   | `DATABASE_PATH`  | `/var/data/lobby.db`   |

   `PORT` is set by Render automatically.

Render gives the app a public HTTPS URL, and that's the URL your QR code will point to.
Without a disk, the queue still runs but the database is wiped on redeploy, so add one.

### Railway, Fly.io, Koyeb (and similar PaaS)

Same shape as Render:

- **Build:** `npm install && npm run build`
- **Start:** `npm start`
- **Env vars:** `NODE_ENV=production`, `DATABASE_PATH=/data/lobby.db` (or any path
  inside the volume you attach), plus a mounted volume at `/data`.
- `PORT` is injected by the platform; the server listens on it automatically.

### A VPS (DigitalOcean, Hetzner, AWS EC2…)

Run it behind a reverse proxy:

```bash
# on the server, after cloning and npm install && npm run build
NODE_ENV=production DATABASE_PATH=/srv/lobby/lobby.db PORT=3000 npm start
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
server and a writable disk. Serverless platforms (Vercel functions, Netlify functions)
would need changes, because they can't hold SSE connections or write to a file-backed
SQLite database.

## License

[MIT](LICENSE) © Ayodele Ayokunle David
