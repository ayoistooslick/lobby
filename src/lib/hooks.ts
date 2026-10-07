import { useEffect, useRef, useState } from "react";

const DEFAULT_TITLE = "Lobby, simple queues for local businesses";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}

export type Connection = "connecting" | "live" | "offline";

/**
 * Keeps a screen in step with the server.
 *
 * The stream is only a "something changed" signal, so every update refetches
 * the page's own data. EventSource reconnects on its own, but a phone that
 * wakes up after a long sleep can stay "connected" while carrying nothing, so
 * a slow poll runs underneath and the status is reported honestly.
 */
export function useStream(path: string | null, onChange: () => void, pollMs = 30_000): Connection {
  const [connection, setConnection] = useState<Connection>("connecting");
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    if (!path) {
      setConnection("offline");
      return;
    }
    let cancelled = false;
    let debounce: number | undefined;
    let source: EventSource | null = null;
    let retry: number | undefined;

    const open = () => {
      if (cancelled) return;
      setConnection(navigator.onLine ? "connecting" : "offline");
      source = new EventSource(path);
      source.onopen = () => {
        if (!cancelled) setConnection("live");
      };
      source.onmessage = () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => change.current(), 120);
      };
      source.onerror = () => {
        if (cancelled) return;
        setConnection(navigator.onLine ? "connecting" : "offline");
        // EventSource retries by itself; this is only a safety net for
        // browsers that give up after a long outage.
        window.clearTimeout(retry);
        retry = window.setTimeout(open, 5_000);
      };
    };

    const onOnline = () => {
      if (cancelled) return;
      setConnection("connecting");
      change.current();
    };
    const onOffline = () => {
      if (!cancelled) setConnection("offline");
    };

    open();
    const poller = pollMs > 0 ? window.setInterval(() => change.current(), pollMs) : undefined;
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      window.clearTimeout(retry);
      if (poller) window.clearInterval(poller);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      source?.close();
    };
  }, [path, pollMs]);

  return connection;
}

/** Stable per-device id, so a refresh cannot take a second number. */
export function useDeviceToken(scope: string): string {
  const key = `lobby.device.${scope}`;
  const [token, setToken] = useState(() => readToken(key));
  useEffect(() => {
    setToken(readToken(key));
  }, [key]);
  return token;
}

function readToken(key: string): string {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Private browsing: the page still works, it just can't remember itself.
    return "anonymous";
  }
}

/** A value kept in localStorage, handy for the last branch or service used. */
export function useStoredValue(key: string, fallback = ""): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });

  const set = (next: string) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Storage is optional; the choice lasts for this page only.
    }
  };

  return [value, set];
}