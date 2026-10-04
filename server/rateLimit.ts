import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "./validate";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

export function limit(scope: string, max: number, windowMs: number, keyOf?: (req: Request) => string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const which = keyOf ? keyOf(req) : (req.ip ?? "unknown");
    const key = `${scope}:${which}`;
    if (!allow(key, max, windowMs)) {
      next(new ApiError(429, "Too many attempts. Wait a minute and try again."));
      return;
    }
    next();
  };
}
