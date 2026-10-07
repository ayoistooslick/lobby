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

function channelOf(serviceId: string): string {
  return `service:${serviceId}`;
}

export function branchChannel(branchId: string): string {
  return `branch:${branchId}`;
}

export function businessChannel(businessId: string): string {
  return `business:${businessId}`;
}

export function subscribe(channel: string, res: Response): void {
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

  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": keep-alive\n\n");
  }, 25_000);
  heartbeat.unref();

  res.on("close", () => {
    clearInterval(heartbeat);
    const current = subscribers.get(channel);
    if (current) {
      current.delete(res);
      if (current.size === 0) subscribers.delete(channel);
    }
  });
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
  let total = 0;
  for (const set of subscribers.values()) total += set.size;
  return total;
}

export { MAX_PER_RESPONSE };