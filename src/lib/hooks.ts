import { useEffect, useState } from "react";

const DEFAULT_TITLE = "Lobby, simple queues for local businesses";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}

// Subscribes to a queue's change signal; the caller refetches its own data.
export function useQueueStream(slug: string | null, onChange: () => void): boolean {
  const [connected, setConnected] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    if (!slug) return;

    const source = new EventSource(`/api/queue/${encodeURIComponent(slug)}/stream`);
    let debounce: number | undefined;
    const markOnline = () => setConnected(true);
    const markOffline = () => setConnected(false);

    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    source.onopen = markOnline;
    source.onerror = markOffline;

    source.onmessage = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(onChange, 120);
    };

    return () => {
      window.clearTimeout(debounce);
      source.close();
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [slug, onChange]);

  return connected;
}
