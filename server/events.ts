import type { Response } from "express";

// One tiny signal per change: listeners refetch the snapshot themselves.
const subscribers = new Map<string, Set<Response>>();

export function subscribe(slug: string, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write("retry: 3000\n\n");

  let set = subscribers.get(slug);
  if (!set) {
    set = new Set();
    subscribers.set(slug, set);
  }
  set.add(res);

  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": keep-alive\n\n");
  }, 25_000);
  heartbeat.unref();

  res.on("close", () => {
    clearInterval(heartbeat);
    const current = subscribers.get(slug);
    if (current) {
      current.delete(res);
      if (current.size === 0) subscribers.delete(slug);
    }
  });
}

export function publish(slug: string): void {
  const set = subscribers.get(slug);
  if (!set) return;
  for (const res of set) {
    if (res.destroyed || res.writableEnded) continue;
    res.write('data: {"type":"update"}\n\n');
  }
}
