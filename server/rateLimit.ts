import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "./validate";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 20_000;

function allow(key: string, limit: number, windowMs: number, now: number): Bucket | null {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    buckets.set(key, fresh);
    return fresh;
  }
  if (bucket.count >= limit) return null;
  bucket.count += 1;
  return bucket;
}

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still oversized: drop the oldest half rather than growing without bound.
  if (buckets.size >= MAX_BUCKETS) {
    const keys = [...buckets.keys()].slice(0, Math.floor(MAX_BUCKETS / 2));
    for (const key of keys) buckets.delete(key);
  }
}

const sweeper = setInterval(() => sweep(Date.now()), 60_000);
sweeper.unref();

export interface LimitOptions {
  /** Second key so one shop cannot flood a shared IP's budget, or vice versa. */
  keyOf?: (req: Request) => string;
  message?: string;
  onLimit?: (req: Request, res: Response, retryAfterSeconds: number) => void;
}

export function limit(
  scope: string,
  max: number,
  windowMs: number,
  options: LimitOptions | ((req: Request) => string) = {}
): RequestHandler {
  const opts: LimitOptions = typeof options === "function" ? { keyOf: options } : options;
  return (req: Request, res: Response, next: NextFunction) => {
    const which = opts.keyOf ? opts.keyOf(req) : (req.ip ?? "unknown");
    const key = `${scope}:${which}`;
    const bucket = allow(key, max, windowMs, Date.now());
    if (bucket) {
      next();
      return;
    }
    // Seconds until this bucket resets, not an absolute timestamp.
    const retryAfter = Math.max(1, Math.ceil(((buckets.get(key)?.resetAt ?? Date.now()) - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    if (opts.onLimit) {
      opts.onLimit(req, res, retryAfter);
      return;
    }
    next(
      new ApiError(
        429,
        opts.message ??
          (scope === "join" || scope === "join-ip" || scope === "join-queue"
            ? "Too many customers just joined from this device. Please ask them to wait a moment."
            : "Too many attempts. Wait a minute and try again.")
      )
    );
  };
}

/** Clears every bucket. Used by the test harness between suites. */
export function resetLimits(): void {
  buckets.clear();
}