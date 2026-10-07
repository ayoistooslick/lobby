import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { startSessionPruner } from "./auth";
import { ensureDemo } from "./demo";
import { openStreams } from "./events";
import { authRouter } from "./routes/authRoutes";
import { demoRouter } from "./routes/demoRoutes";
import { displayRouter } from "./routes/displayRoutes";
import { queueRouter } from "./routes/queueRoutes";
import { reportsRouter } from "./routes/reportsRoutes";
import { setupRouter } from "./routes/setupRoutes";
import { staffRouter } from "./routes/staffRoutes";
import { teamRouter } from "./routes/teamRoutes";
import { store, usingPostgres } from "./store";
import { ApiError } from "./validate";

// The built app only loads its own bundle and its own images: no third-party
// scripts, no framing, no plugin content of any kind.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "upgrade-insecure-requests",
].join("; ");

async function main(): Promise<void> {
  // Postgres schema lives on the managed database; SQLite lives on local disk.
  await store.init();
  startSessionPruner();

  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.disable("etag");

  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  // Mutations only accept JSON, which blocks simple cross-site form posts.
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, store: store.kind, streams: openStreams() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/queue", queueRouter);
  app.use("/api/display", displayRouter);
  app.use("/api/demo", demoRouter);
  app.use("/api/staff", staffRouter);
  app.use("/api/staff", teamRouter);
  app.use("/api/staff", setupRouter);
  app.use("/api/staff", reportsRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ ok: false, error: "We couldn't find that page." });
  });

  // Everything else is the React app.
  const distDir = path.join(__dirname, "..", "dist");
  app.use(
    express.static(distDir, {
      index: false,
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
      },
    })
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    res.sendFile(path.join(distDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ ok: false, error: err.message });
      return;
    }

    const status = typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 0;
    if (status === 400) {
      res.status(400).json({ ok: false, error: "That request wasn't formatted correctly." });
      return;
    }
    if (status === 413) {
      res.status(413).json({ ok: false, error: "That request was too large." });
      return;
    }

    console.error(err);
    res.status(500).json({ ok: false, error: "Something went wrong on our end. Please try again." });
  });

  // The demo is optional: a failed seed must never stop the real product.
  void ensureDemo()
    .then(() => console.log("demo: ready at /demo"))
    .catch((err) => console.error("demo: unavailable", err));

  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => {
    console.log(
      `Lobby is running at http://0.0.0.0:${port} (storage: ${usingPostgres ? "PostgreSQL" : "SQLite file"})`
    );
  });
}

main().catch((err) => {
  console.error("Lobby failed to start:", err);
  process.exit(1);
});