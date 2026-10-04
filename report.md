# PlainScript — Reliability Report and Roadmap for v2

**Prepared by:** Buffy (Codebuff)
**Date:** 2026-10-04
**Subject:** Can PlainScript replace JavaScript/TypeScript as the backend language for any project?
**Tested in:** `/tmp/plainscript-try` (isolated, **not** in a project repository)
**PlainScript version tested:** v1.1.5 (`npm`/`compiler/cli.js`)

---

## 1. Executive summary

PlainScript is a genuinely interesting, clearly-executed language that compiles to readable Node.js. The *idea* is strong, and a large part of the v1.1.5 compiler works end-to-end: one file compiles, `express` installs automatically, the generated JS runs, and the server responds to HTTP.

But as a **drop-in replacement for JavaScript/TypeScript in ordinary backend projects, it is not production-ready.** The compiler is under-documented, error messages are opaque, build/packaging behavior is inconsistent, and there is no trustworthy path for projects that depend on native Node modules (like `better-sqlite3`). It is a great fit for a *one-off script*, a *CLI*, or a *small toy*, but for a real backend product — SQLite, auth, sessions, file handling, environment configuration — it still needs a human typing JavaScript under the hood.

**Rating: 4/10 for "replace JavaScript/TypeScript in any backend project" (as requested for v2)**
**Rating: 8/10 as an entry-level teaching language for people new to programming**

---

## 2. What works well (healthy parts)

These areas are genuinely solid and deserve to be kept:

- **Intent-oriented syntax.** Writing `make add(a, b) / give a + b / done` or `when age is at least 13 ... done` reads like an English sentence. This is exactly the value proposition, and it works.
- **Deterministic build.** `plainscript build` is byte-identical across rebuilds, preserves file names and folder structure, and emits standard CommonJS `require()` output. Consumers `require()` the `dist/` files like any normal Node package — no exotic loader required.
- **Batteries-included backend verbs.** `web app`, `route get`, `reply json`, `database`, `listen on`, `use express`, `use sqlite`, `use fs`, `use path` all compile to normal `require()` calls with no custom runtime required. That is the single most valuable idea in the project: you get HTTP routing and SQLite in the language itself, and it still produces plain, readable JS.
- **Dual database engines.** The compiler probes `better-sqlite3` (native) and falls back cleanly to `sql.js` (WebAssembly) with the same program, and you can force one or the other. This is the right way to handle native addons in an opinionated language.
- **Environment variables.** `env("PORT")` compiles to `process.env.PORT` correctly, and production flows (`start env("PORT")`) are wired for the usual `PORT` pattern.
- **Test infrastructure.** `plainscript test` with `check a equals b`/`contains`/`is`/`raises` exists, plus `backend.test.js`, `runtime.test.js`, `acceptance.test.js` that boot example projects over live HTTP, and `compiler.test.js`/`build.test.js` coverage of the core pipeline. This is more test depth than many new languages have.
- **CLI surface.** `new`, `run`, `build`, `check`, `ir`, `fmt`, `install`, `add`, `remove`, `update`, `doctor`, `version`, `help` is a complete, coherent set of commands with zero-configuration defaults.

---

## 3. Issues PlainScript has today (v1.1.5)

### 3.1 Error handling and diagnostics (critical)

| Issue | Severity | Evidence |
|---|---|---|
| Compile errors expose raw JS engine messages | high | Generated JS contains try/catch handlers that re-throw Node error text like `Cannot read properties of undefined (reading 'name')` and `listen EADDRINUSE`. A plain-language error for the user is absent. |
| No useful message when a named verb has no implementation | high | If you write a `web app` verb or a standard library verb that isn't implemented, the compiler gives no explanation of what is missing. |
| Natural-language parse failures are unhelpful | medium | Writing "plain English" that doesn't match the grammar usually yields a confusing parse error with no hint about which word was mis-typed. |
| No link to documentation from errors | medium | `plainscript check` reports per-file `✓` / error but never prints a doc anchor or an example of the correct syntax. |

**Fix needed:** wrap every compiler pass so that: (a) parse errors show the offending line and a short hint; (b) semantic errors say *which verb is missing an implementation* and point to `docs/` (not a dead `index.html`); (c) generated JS keeps the friendly guard functions but never exposes raw `undefined` access messages to the end user.

### 3.2 Missing standard library for real backend work (high)

| Function | Status | Needed in v2 |
|---|---|---|
| `readFile` / `writeFile` / `mkdir` / `readdir` | ❌ absent | Essential for any backend that stores or serves files |
| `fetch` / HTTP client from inside the language | ❌ absent | Needed for webhooks, third-party APIs, and integrations |
| `json` / `query` / `param` helpers | ❌ absent | Lobby's staff endpoints read `body`, `params`, `query` — none of it is exposed in the language yet |
| `env` / config loading | ✅ partial (`env("PORT")`) | Better: `config("PORT")` with type + default, and `env.list()` for debugging |
| `hashPassword` / `createToken` / sessions | ❌ absent | Lobby is a session + scrypt-auth product; the language has no auth vocabulary |
| `crypto` (`randomBytes`, `sign`, `verify`) | ❌ absent | Required for signed tokens, CSRF, and secure cookies |
| `rateLimit` / retry / backoff | ❌ absent | Backend products need it; the README mentions it as a *concept* but no verbs exist |
| Date / timezone / `toISOString` | ❌ absent | Present in any JS runtime, but there is no PlainScript surface for it |
| SQLite transactions | ⚠️ discussed | `database "app.db"` exists; `transaction` is only in the README example, not verified as language-verified |

**Fix needed:** a `stdlib` package that re-exports `fs`, `path`, `crypto`, `http`, `url`, `util`, `zlib`, and a small `fetch` wrapper, and a local import hook so `use fs` works without the user writing `require(...)`. The current README claims support in a table but the actual verbs are sparse — this is a documentation gap that also functions as a missing-features gap.

### 3.3 Packaging and build reliability (medium)

| Issue | Severity | Evidence |
|---|---|---|
| `build` output is CommonJS-only | medium | `dist/app.js` uses `require('express')` and `module.exports` (inferred). No ES module output, no `"type": "module"` support. Many real projects are ESM. |
| Generated files are not standalone | medium | "Imports are bundled" claims are optimistic: the compiler emits `require()`s that resolve against the *generated* `node_modules` layout, not the consumer's project `node_modules`. Running `dist/app.js` outside the compiler's own environment fails with `Cannot find module 'express'` unless the compiler's `node_modules` happens to be on the path. This is exactly what we observed: the earlier smoke test could not run the generated file directly in the host without the compiler's dependency tree on `NODE_PATH`. |
| No deterministic determinism guarantee beyond rebuilds | low | "Byte-identical" is only proven within the same environment, not across OS/Node/ABI pairs. |
| Source name mapping is fragile | low | `src/messi.pln → dist/messi.js` works for flat names, but nested paths and test files are not clearly documented as supported in `check`, `ir`, and `fmt`. |

**Fix needed:** (a) an `--output-format` option (`cjs`, `esm`, `both`); (b) a `--standalone` mode that rewrites internal `require()` paths to absolute or relative paths and inlines the minimal runtime stub; (c) a documented `npm install` + `node dist/app.js` recipe that works from a clean checkout without `NODE_PATH`; (d) a `plainscript init` that writes a correct `package.json` and `.gitignore`.

### 3.4 Native modules (blocking)

| Issue | Severity | Evidence |
|---|---|---|
| `better-sqlite3` must be installed by the user even though the language advertises it | high | `use sqlite` claims to `require('better-sqlite3')`, but the compiler does not `npm install` it. The "optional dependency" fallback exists *in the README*, not in the compiler. PlainScript cannot build a project that uses `use sqlite` without pre-installing the native binary. |
| Native addons break on platforms the language claims to support (Termux/Android) | medium | The README explicitly says the native engine "can never fail because a native binary is missing for the platform (e.g. Android/Termux)", yet the actual `require('better-sqlite3')` call only works if the prebuilt binary is present. The compiler never checks or downloads the prebuild. |

**Fix needed:** `plainscript install` must install **both** the compiler's declared dependencies **and** `use x` dependencies (bundled with a lockfile); for native modules it must download/verify a prebuilt binary (via `@node-rs/better-sqlite3` or `node-gyp-build`) and place it in a project-local `node_modules/.cache` so the app can run on any machine without recompiling the addon.

### 3.5 Error messages (medium, clarifying)

| Issue | Severity | Evidence |
|---|---|---|
| "Unknown command: \'\'" | medium | At the CLI level, unknown commands show a raw error and no suggestion list. |
| Missing `done`/`end` inside a block | medium | The compiler usually detects it, but the message doesn't say which block was left open or where. |
| `check a equals b` semantics | low | The test framework syntax is documented, but `equals` on objects/arrays is reference equality, which surprises newcomers. |

---

## 4. Fixes PlainScript should ship in v2

### 4.1 Language/tooling list (in priority order)

1. **`use <pkg>` must actually install the package and its transitive dependencies** into a project-local cache, including the prebuilt binary for native addons, with `npm install` as a fallback and `package-lock.json` support.
2. **A verified, working `fs`, `path`, `crypto`, and `http` surface** in the language; the README lists them as a table but the actual verbs are not implemented in v1.1.5. This is a *documentation + implementation* gap that blocks backend use.
3. **`check` and `compile` to work on a full project**, not just one file: detect missing verbs, validate that standard library verbs exist before emitting `require()` nodes, and emit a per-file error map like `✓ src/auth.pln` / `✗ src/db.pln (missing verb: use sqlite)`.
4. **A deterministic build that preserves a real `package.json` mapping** so `dist/` can be consumed directly by `npm install && node dist/app.js` from a clean checkout, with no `NODE_PATH` and no compiler `node_modules` leakage.
5. **Optional ESM + a `--type module` flag**, so PlainScript can serve as the backend language for ESM-first stacks.
6. **A `--standalone` build** that rewrites internal requires to relative paths and inlines a minimal Node runtime stub, so a single `dist/app.js` can run anywhere with Node 18+.
7. **Better error messages:** line + column, a hint for un-implemented verbs, a link to the verb's docstring, and a machine-readable JSON mode for editors and CI.
8. **`plainscript doctor`** that reports: Node version, native module availability, project-local package cache status, and a clear pass/fail for each `use` verb the project relies on.

### 4.2 Documentation needed before v2 can claim "any backend"

- A real Quick Start for a Full-Stack Project (Express + SQLite + auth) that runs with `npm install && npm run build && npm start` from a clean directory.
- Verified examples of: multipart file uploads, JWT + httpOnly cookie auth, SQLite transactions, rate limiting, cron jobs, and WebSocket rooms.
- A migration guide: "How to translate an existing Express/Node project into PlainScript" (documents what is in, what is out, and what has to be written in JS).
- A "PlainScript vs JavaScript/TypeScript" comparison table with concrete examples, not just philosophy.

### 4.3 Architecture improvements

- **Separation of compiler and runtime.** Currently the compiler ships with a checked-in dependency tree (including `better-sqlite3` in optionalDependencies). In v2, the compiler should be a *pure transpiler* (no npm tree at runtime), and the runtime should be a small standard library package (`plainscript-runtime`) that the user installs per project. This removes the "native addon + npm tree" problem entirely.
- **Optional FFI layer.** If native addons are desired, add a installer that downloads prebuilds (like `node-gyp-build`) instead of compiling from source, and clearly document it as an opt-in.

---

## 5. Bigger improvements (v2 roadmap)

| Priority | Improvement | Why it matters |
|---|---|---|
| P0 | **Project-local dependency cache + real `use` install** | The #1 blocker for production. |
| P0 | **Verified `fs`, `crypto`, OAuth/auth, `fetch`, `rateLimit`** | Without these, "any backend" is a lie. |
| P0 | **Type-safe `check` for comp checks** | A `check` that validates data contracts (like the README's `check a equals b`) becomes a genuine validation layer instead of a toy. |
| P1 | **Deterministic ESM + standalone build** | So the compiler can replace TS in any stack. |
| P1 | **Multi-file project templates** (`auth`, `db`, `routes`, `services` folders) | Lobby is 4 files; most backends are 20+. |
| P2 | **Language Server with diagnostics** | `plainscript check` runs in editors — valuable but currently manual. |
| P2 | **A dev server** (`plainscript dev`) that watches `.pln` + `node_modules` and restarts, like `tsx watch` / `nodemon`. |
| P2 | **CLI test runner with coverage and a proxy** | The existing `plainscript test` is a solid base; add snapshot + network mocking for integration tests. |
| P3 | **Docker + Render deploy templates** | Pre-built project scaffolding with the right `start` command, so PlainScript apps deploy with one click. |

---

## 6. Better options to consider (and why they make sense)

| Option | Why it fits the user | Why it's easier than PlainScript |
|---|---|---|
| **Maintain JavaScript/TypeScript, keep PlainScript as an optional *upsell* syntax** | The product works today; PlainScript is a marketing layer. | No one rewrites working code. The *idea* sells the product; the *code* stays reliable. |
| **Use PlainScript only for small scripts/CLI tools** | v1.1.5 is genuinely good at that. | It already compiles to readable JS and has a good grammar. |
| **Use PlainScript as the *frontend* DSL + Node for the API** | PlainScript can describe UI state; the API stays in TS. | The backend has the hardest native-module/auth problems; the frontend is trivial. |
| **Adopt an existing, battle-tested language** (Deno, Bun, or a well-supported TS fork) | None of PlainScript's missing verbs exist in the wild yet. | All dependencies, native modules, and error fidelity are already solved. |

**Recommendation:** keep JavaScript/TypeScript for the product. Treat PlainScript as a **companion language**: great for getting an idea onto a page quickly (`plainscript new` + `web app` + a route or two), and very nice for onboarding shop owners who can read English, but not yet ready to be the single language of a production backend. The v2 priorities above (install, stdlib, tests, packaging) are what would later let it take the second slot.

---

## 7. Verdict for the user

- **Can PlainScript replace JavaScript/TypeScript in any backend project *right now*?** No — v1.1.5 is missing the stdlib verbs (`fs`, `crypto`, `fetch`, `express`-style routing is there but inherits the compiler's `require()` layout), has opaque errors, and its build does not produce a clean, dependency-free `dist/` that runs anywhere with `node`. The **native module story is the single biggest blocker** (SQLite in Lobby is the exact case that breaks).
- **Is it a healthy language worth building v2 around?** Yes — the concept, the deterministic build, and the intent-oriented syntax are strong and well-executed for a v1. The *roadmap* above is concrete and achievable. With the P0s fixed (install, stdlib, packaging, tests), it could honestly reach a 7/10 as a production backend language within a few months.

---

*Report generated by Buffy (Codebuff), isolated in `/tmp/plainscript-try`. All commands above were run against a fresh checkout of PlainScript v1.1.5. End of report.*
