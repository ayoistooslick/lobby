import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { startSessionPruner } from "./auth";
import { authRouter } from "./routes/authRoutes";
import { queueRouter } from "./routes/queueRoutes";
import { staffRouter } from "./routes/staffRoutes";
import { store, usingPostgres } from "./store";
import { ApiError } from "./validate";

async function main(): Promise<void> {
  // Postgres schema lives on the managed database; SQLite lives on local disk.
  await store.init();
  startSessionPruner();

  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, store: store.kind });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/queue", queueRouter);
  app.use("/api/staff", staffRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ ok: false, error: "We couldn't find that page." });
  });

  // Everything else is the React app.
  const distDir = path.join(__dirname, "..", "dist");
  app.use(express.static(distDir));
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
