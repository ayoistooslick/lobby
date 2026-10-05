import { Maximize2, MonitorPlay, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle, useQueueStream } from "../lib/hooks";
import type { QueueSnapshot } from "../lib/types";
import { ErrorState, LoadingState } from "../components/states";

export default function Display() {
  const { slug = "" } = useParams();
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<QueueSnapshot>(`/api/queue/${encodeURIComponent(slug)}`);
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setReady(true);
    }
  }, [slug]);

  const connected = useQueueStream(slug || null, refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useDocumentTitle(snapshot ? `Display, ${snapshot.queue.name}` : "Lobby display");

  if (!ready) return <LoadingState label="Opening display…" />;
  if (!snapshot) return <ErrorState message={error ?? "This display could not be opened."} onRetry={() => void refresh()} />;

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Fullscreen can be blocked until a user gesture; the display still works.
    }
  }

  return (
    <main className="display-page">
      <header className="display-header">
        <div>
          <p className="display-kicker"><MonitorPlay size={18} aria-hidden="true" /> Lobby display</p>
          <h1>{snapshot.queue.name}</h1>
        </div>
        <div className="display-tools">
          <span className={`display-connection${connected ? " is-connected" : ""}`} role="status">
            {connected ? <Wifi size={17} aria-hidden="true" /> : <WifiOff size={17} aria-hidden="true" />}
            <span>{connected ? "Live" : "Reconnecting"}</span>
          </span>
          <button type="button" className="display-fullscreen" onClick={() => void enterFullscreen()} aria-label="Enter fullscreen">
            <Maximize2 size={20} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="display-now" aria-live="polite">
        <p className="display-label">{t("demo.nowServing")}</p>
        <p className="display-number">{snapshot.nowServing === null ? "—" : `#${snapshot.nowServing}`}</p>
        <p className="display-callout">{snapshot.nowServing === null ? t("dash.nobodyCounter") : "Please proceed to the counter"}</p>
      </section>

      <section className="display-next" aria-label="Next customers">
        <p className="display-label">Next</p>
        <div className="display-next-list">
          {snapshot.nextWaiting.length > 0 ? snapshot.nextWaiting.map((number) => <span key={number}>#{number}</span>) : <span className="display-muted">No customers waiting</span>}
        </div>
      </section>

      {!connected && <p className="display-offline" role="alert">Connection interrupted. Showing the last known queue state.</p>}
    </main>
  );
}
