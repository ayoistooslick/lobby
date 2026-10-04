import { useEffect } from "react";

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
export function useQueueStream(slug: string | null, onChange: () => void): void {
  useEffect(() => {
    if (!slug) return;

    const source = new EventSource(`/api/queue/${encodeURIComponent(slug)}/stream`);
    let debounce: number | undefined;

    source.onmessage = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(onChange, 120);
    };

    return () => {
      window.clearTimeout(debounce);
      source.close();
    };
  }, [slug, onChange]);
}
