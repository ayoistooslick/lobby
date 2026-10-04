import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle, useQueueStream } from "../lib/hooks";
import type { CustomerTicket, QueueSnapshot } from "../lib/types";
import { ErrorState, LoadingState } from "../components/states";
import { LangButton } from "../components/Language";

const STORAGE_PREFIX = "lobby.ticket.";

function readStoredId(slug: string): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + slug);
  } catch {
    return null;
  }
}

function storeId(slug: string, id: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + slug, id);
  } catch {
    // Private browsing: the ticket still works for this page load.
  }
}

function clearId(slug: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + slug);
  } catch {
    // Nothing to clean up.
  }
}

export default function CustomerQueue() {
  const { slug = "" } = useParams();
  const { t } = useI18n();

  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(() => readStoredId(slug));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const query = ticketId ? `?ticket=${encodeURIComponent(ticketId)}` : "";
      const data = await api<QueueSnapshot>(`/api/queue/${encodeURIComponent(slug)}${query}`);
      if (ticketId && !data.ticket) {
        // The saved number is gone, so start fresh.
        clearId(slug);
        setTicketId(null);
      }
      setSnapshot(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(messageOf(err));
    } finally {
      setReady(true);
    }
  }, [slug, ticketId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useQueueStream(slug || null, refresh);

  const queue = snapshot?.queue ?? null;
  const ticket = snapshot?.ticket ?? null;
  const nowServing = snapshot?.nowServing ?? null;
  const waitingCount = snapshot?.waitingCount ?? 0;

  useDocumentTitle(
    !queue
      ? "Lobby"
      : ticket?.status === "called"
        ? `It's your turn, ${queue.name}`
        : ticket
          ? `You're number ${ticket.number}, ${queue.name}`
          : `${queue.name}, Lobby`
  );

  const status = ticket?.status;
  useEffect(() => {
    if (status !== "called") return;
    if (typeof navigator.vibrate === "function") navigator.vibrate([180, 90, 180]);
  }, [status]);

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      const data = await api<{ ticket: CustomerTicket }>(`/api/queue/${encodeURIComponent(slug)}/join`, {
        method: "POST",
        body: { name },
      });
      storeId(slug, data.ticket.id);
      setTicketId(data.ticket.id);
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPresent() {
    if (!ticketId) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/queue/${encodeURIComponent(slug)}/ticket/${encodeURIComponent(ticketId)}/confirm`, {
        method: "POST",
      });
      await refresh();
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function leaveQueue() {
    if (!ticketId) return;
    if (!window.confirm(t("cust.leaveConfirm"))) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/queue/${encodeURIComponent(slug)}/ticket/${encodeURIComponent(ticketId)}/leave`, {
        method: "POST",
      });
      clearId(slug);
      setTicketId(null);
      setName("");
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  function joinAgain() {
    clearId(slug);
    setTicketId(null);
    setName("");
    setActionError(null);
  }

  if (!ready) return <LoadingState label={t("cust.opening")} />;
  if (!snapshot || !queue) {
    return <ErrorState message={loadError ?? t("cust.wrong")} onRetry={() => void refresh()} />;
  }

  return (
    <main className="customer-page">
      <div className="customer-top">
        <p className="customer-brand">
          <Link to="/" className="link-button">
            Lobby
          </Link>
        </p>
        <LangButton />
      </div>
      <header className="customer-head">
        <h1>{queue.name}</h1>
        {queue.note && <p className="customer-note">{queue.note}</p>}
      </header>

      {queue.paused && !ticket && (
        <div className="notice" role="status">
          <strong>{t("cust.pausedT")}</strong> {t("cust.pausedB")}
        </div>
      )}

      {!ticket && snapshot && (
        <section className="ticket-panel join-panel">
          <p className="stat-inline">
            {nowServing !== null ? (
              <>
                {t("demo.nowServing")} <strong>#{nowServing}</strong>
              </>
            ) : (
              t("cust.nobody")
            )}
            <span className="dot" aria-hidden="true">
              ·
            </span>
            {waitingCount === 0 ? t("cust.noOneWaiting") : t("cust.waitingN", { n: waitingCount })}
          </p>

          {!queue.paused && (
            <form onSubmit={join}>
              <h2>{t("cust.joinT")}</h2>
              <div className="field">
                <label htmlFor="join-name">{t("cust.nameLabel")}</label>
                <input
                  id="join-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={40}
                  placeholder="e.g. Ada"
                  autoComplete="given-name"
                  enterKeyHint="go"
                />
              </div>
              {actionError && (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              )}
              <button type="submit" className="btn btn-primary btn-big btn-block" disabled={busy}>
                {busy ? t("cust.joinBusy") : t("cust.joinT")}
              </button>
              <p className="reassure">{t("cust.joinReassure")}</p>
            </form>
          )}
        </section>
      )}

      {ticket && ticket.status === "waiting" && (
        <section
          className={`ticket-panel${ticket.peopleAhead === 0 ? " is-next" : ""}`}
          aria-live="polite"
        >
          <p className="eyebrow">{t("cust.youreNumber")}</p>
          <p className="ticket-number">{ticket.number}</p>
          <p className="ticket-ahead">
            {ticket.peopleAhead === 0
              ? t("cust.youreNext")
              : ticket.peopleAhead === 1
                ? t("cust.oneAhead")
                : t("cust.nAhead", { n: ticket.peopleAhead })}
          </p>
          <div className="ticket-split">
            <div>
              <p className="eyebrow">{t("demo.nowServing")}</p>
              <p className="split-number">{nowServing !== null ? `#${nowServing}` : "·"}</p>
            </div>
            <div>
              <p className="eyebrow">{t("cust.peopleWaiting")}</p>
              <p className="split-number">{waitingCount}</p>
            </div>
          </div>
          <p className="reassure">{t("cust.reassure")}</p>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="ticket-foot">
            <button
              type="button"
              className="link-button"
              onClick={() => void leaveQueue()}
              disabled={busy}
            >
              {t("cust.leave")}
            </button>
          </div>
        </section>
      )}

      {ticket && ticket.status === "called" && (
        <section className="ticket-panel is-turn" aria-live="assertive">
          <p className="eyebrow">{t("cust.turnT")}</p>
          <p className="ticket-number">{ticket.number}</p>
          <p className="ticket-ahead">{t("cust.turnB")}</p>
          {!ticket.confirmed ? (
            <>
              {actionError && (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary btn-big btn-block"
                onClick={() => void confirmPresent()}
                disabled={busy}
              >
                {busy ? t("cust.sending") : t("cust.imHere")}
              </button>
            </>
          ) : (
            <p className="confirmed-line" role="status">
              {t("cust.confirmed")}
            </p>
          )}
        </section>
      )}

      {ticket && (ticket.status === "served" || ticket.status === "skipped" || ticket.status === "no_show") && (
        <section className="ticket-panel is-done">
          <p className="eyebrow">
            {ticket.status === "served" ? t("cust.done") : ticket.status === "skipped" ? t("dash.stSkipped") : t("dash.stNoShow")}
          </p>
          <p className="ticket-number">{ticket.number}</p>
          <p className="ticket-ahead">
            {ticket.status === "served"
              ? t("cust.servedBody")
              : ticket.status === "skipped"
                ? t("cust.skippedBody")
                : t("cust.noShowBody")}
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={joinAgain}>
            {t("cust.joinAgain")}
          </button>
        </section>
      )}

      <footer className="customer-foot">
        <p>
          {t("cust.poweredBy")}{" "}
          <Link to="/" className="link-button">
            Lobby
          </Link>
        </p>
      </footer>
    </main>
  );
}
