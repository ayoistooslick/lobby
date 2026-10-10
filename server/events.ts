import type { Response } from "express";

/**
 * One tiny signal per change: listeners refetch their own snapshot.
 *
 * Channels are plain strings. A customer on a service listens on
 * `service:<id>`, a TV in a branch on `branch:<id>`, and the staff dashboard
 * on `business:<id>`. Publishing walks every channel that touches the change.
 */
const subscribers = new Map<string, Set<Response>>();

const MAX_PER_RESPONSE = 200_000;

// Connection caps: streams are held open indefinitely, so one client must not
// be able to pin thousands of them (memory/fd exhaustion) or open more than
// its fair share of the whole server's budget.
const MAX_STREAMS_PER_IP = 64;
const MAX_STREAMS_TOTAL = 4_000;
// A stream is also closed by the server itself after this long. EventSource
// reconnects on its own (retry hint below), so this bounds every leak even
// when a proxy swallows the client's disconnect without closing upstream.
const MAX_STREAM_AGE_MS = Number(process.env.STREAM_MAX_AGE_MS) || 300_000;
const streamsByIp = new Map<string, number>();
let totalStreams = 0;

function channelOf(serviceId: string): string {
  return `service:${serviceId}`;
}

export function branchChannel(branchId: string): string {
  return `branch:${branchId}`;
}

export function businessChannel(businessId: string): string {
  return `business:${businessId}`;
}

/** Returns false when a cap is hit; the caller should answer 429 instead.
 *  `maxAgeMs` exists for tests; production uses the configured stream age. */
export function subscribe(channel: string, res: Response, ip = "unknown", maxAgeMs = MAX_STREAM_AGE_MS): boolean {
  if (totalStreams >= MAX_STREAMS_TOTAL) return false;
  if ((streamsByIp.get(ip) ?? 0) >= MAX_STREAMS_PER_IP) return false;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 3000\n\n");

  let set = subscribers.get(channel);
  if (!set) {
    set = new Set();
    subscribers.set(channel, set);
  }
  set.add(res);
  totalStreams += 1;
  streamsByIp.set(ip, (streamsByIp.get(ip) ?? 0) + 1);

  // Idempotent: the socket's close event and the age timer may both fire, and
  // a double release would corrupt the counters.
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    clearTimeout(expire);
    const current = subscribers.get(channel);
    if (current) {
      current.delete(res);
      if (current.size === 0) subscribers.delete(channel);
    }
    totalStreams = Math.max(0, totalStreams - 1);
    const remaining = (streamsByIp.get(ip) ?? 1) - 1;
    if (remaining <= 0) streamsByIp.delete(ip);
    else streamsByIp.set(ip, remaining);
    if (!res.writableEnded) {
      try {
        res.end();
      } catch {
        // The socket is already gone; the counters above are what matter.
      }
    }
  };

  const heartbeat = setInterval(() => {
    if (released) return;
    if (res.destroyed || res.writableEnded) {
      release();
      return;
    }
    try {
      res.write(": keep-alive\n\n");
    } catch {
      release();
    }
  }, 25_000);
  heartbeat.unref();

  const expire = setTimeout(release, maxAgeMs);
  expire.unref();

  res.on("close", release);
  return true;
}

function send(channel: string): void {
  const set = subscribers.get(channel);
  if (!set) return;
  for (const res of set) {
    if (res.destroyed || res.writableEnded) continue;
    try {
      res.write(`data: {"type":"update","channel":"${channel}"}\n\n`);
    } catch {
      set.delete(res);
    }
  }
}

/** Fired after anything that changes one queue. */
export function publishService(serviceId: string): void {
  if (!serviceId) return;
  send(channelOf(serviceId));
}

/** Fired after branch-wide changes such as new counters or services. */
export function publishBranch(branchId: string, serviceId?: string): void {
  if (serviceId) send(channelOf(serviceId));
  if (branchId) send(branchChannel(branchId));
}

/** Fired after business-wide changes such as branding or pausing. */
export function publishBusiness(businessId: string, branchId?: string, serviceId?: string): void {
  if (serviceId) send(channelOf(serviceId));
  if (branchId) send(branchChannel(branchId));
  if (businessId) send(businessChannel(businessId));
}

export function openStreams(): number {
  return totalStreams;
}

export { MAX_PER_RESPONSE };