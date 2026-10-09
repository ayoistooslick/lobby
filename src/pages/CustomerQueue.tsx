import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDeviceToken, useDocumentTitle, useStoredValue, useStream } from "../lib/hooks";
import { applyBrand, clearBrand } from "../lib/theme";
import type { CustomerPayload, CustomerTicket } from "../lib/types";
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

function LeaveIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" aria-hidden="true">
      <path
        d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 12h11m0 0-3.5-3.5M20 12l-3.5 3.5M9 12l3.5 3.5M9 12 5.5 8.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CustomerQueue() {
  const { slug = "" } = useParams();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();

  const [branchSlug, setBranchSlug] = useStoredValue(`lobby.branch.${slug}`, params.get("branch") ?? "");
  const [serviceSlug, setServiceSlug] = useStoredValue(`lobby.service.${slug}`, params.get("service") ?? "");
  const [snapshot, setSnapshot] = useState<CustomerPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(
    () => params.get("t") || readStoredId(slug)
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const deviceToken = useDeviceToken(slug);

  const refresh = useCallback(async () => {
    if (!slug) return;
    try {
      const query = new URLSearchParams();
      if (branchSlug) query.set("branch", branchSlug);
      if (serviceSlug) query.set("service", serviceSlug);
      if (ticketId) query.set("ticket", ticketId);
      const data = await api<CustomerPayload>(
        `/api/queue/${encodeURIComponent(slug)}?${query.toString()}`
      );
      if (ticketId && !data.ticket) {
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
  }, [slug, branchSlug, serviceSlug, ticketId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const service = snapshot?.service ?? null;
  const connection = useStream(
    service ? `/api/queue/${encodeURIComponent(slug)}/stream?channel=service%3A${service.id}` : null,
    () => void refresh()
  );

  // Keep the link shareable: the number survives a refresh or a reopened tab.
  useEffect(() => {
    if (!ticketId) return;
    const next = new URLSearchParams();
    next.set("t", ticketId);
    if (branchSlug) next.set("branch", branchSlug);
    if (serviceSlug) next.set("service", serviceSlug);
    setParams(next, { replace: true });
  }, [ticketId, branchSlug, serviceSlug, setParams]);

  const queue = snapshot?.business ?? null;
  const ticket = snapshot?.ticket ?? null;

  useDocumentTitle(
    !queue
      ? "Lobby"
      : ticket?.status === "called"
        ? `${t("cust.turnT")}, ${queue.name}`
        : ticket
          ? `${t("cust.youreNumber")} ${ticket.label}, ${queue.name}`
          : `${queue.name}, Lobby`
  );

  const status = ticket?.status;
  useEffect(() => {
    if (status !== "called") return;
    if (typeof navigator.vibrate === "function") navigator.vibrate([180, 90, 180]);
  }, [status]);

  // The brand colours travel with the shop, so the page looks like the business.
  useEffect(() => {
    if (!snapshot) return;
    applyBrand(snapshot.business.brandColor, snapshot.business.brandAccent);
    return () => clearBrand();
  }, [snapshot]);

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      const data = await api<{ ticket: CustomerTicket }>(`/api/queue/${encodeURIComponent(slug)}/join`, {
        method: "POST",
        body: {
          branchSlug: snapshot?.branch?.slug ?? branchSlug,
          serviceSlug: snapshot?.service?.slug ?? serviceSlug,
          name,
          phone,
          deviceToken,
        },
      });
      storeId(slug, data.ticket.id);
      setTicketId(data.ticket.id);
      await refresh();
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

  const services = snapshot.services;
  const needsChoice = !ticket && services.length > 1 && !snapshot.service;

  return (
    <main className="customer-page">
      <div className="customer-top">
        <p className="customer-brand">
          {snapshot.business.logo ? (
            <img className="customer-logo" src={snapshot.business.logo} alt="" width={28} height={28} />
          ) : null}
          <Link to="/" className="link-button">
            Lobby
          </Link>
        </p>
        <div className="header-actions">
          {connection !== "live" && (
            <span className="conn conn-warn" role="status">
              {connection === "offline" ? t("common.offline") : t("common.reconnecting")}
            </span>
          )}
          <LangButton />
        </div>
      </div>

      <header className="customer-head">
        <h1>{queue.name}</h1>
        {snapshot.branch && <p className="muted">{snapshot.branch.name}</p>}
        {queue.note && <p className="customer-note">{queue.note}</p>}
      </header>

      {queue.paused && !ticket && (
        <div className="notice" role="status">
          <strong>{t("cust.pausedT")}</strong> {t("cust.pausedB")}
        </div>
      )}

      {!ticket && !needsChoice && (
        <section className="ticket-panel join-panel">
          <p className="stat-inline">
            {snapshot.nowServing ? (
              <>
                {t("demo.nowServing")} <strong>{snapshot.nowServing}</strong>
              </>
            ) : (
              t("cust.nobody")
            )}
            <span className="dot" aria-hidden="true">
              ·
            </span>
            {snapshot.peopleWaiting === 0 ? t("cust.noOneWaiting") : t("cust.waitingN", { n: snapshot.peopleWaiting })}
            {snapshot.estimatedWaitMinutes > 0 && (
              <>
                <span className="dot" aria-hidden="true">
                  ·
                </span>
                {t("cust.estWait", { n: snapshot.estimatedWaitMinutes })}
              </>
            )}
          </p>

          {snapshot.branches && snapshot.branches.length > 1 && (
            <div className="field">
              <label htmlFor="branch-pick">{t("cust.pickBranch")}</label>
              <select
                id="branch-pick"
                value={snapshot.branch?.slug ?? ""}
                onChange={(event) => {
                  setBranchSlug(event.target.value);
                  setServiceSlug("");
                }}
              >
                {snapshot.branches.map((branch) => (
                  <option key={branch.id} value={branch.slug}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {services.length > 1 && (
            <div className="field">
              <label htmlFor="service-pick">{t("cust.pickQueue")}</label>
              <select
                id="service-pick"
                value={snapshot.service?.slug ?? ""}
                onChange={(event) => setServiceSlug(event.target.value)}
              >
                <option value="">{t("cust.pickQueueHint")}</option>
                {services.map((entry) => (
                  <option key={entry.id} value={entry.slug}>
                    {entry.name}
                    {entry.description ? `, ${entry.description}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!queue.paused && snapshot.service && (
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
              <div className="field">
                <label htmlFor="join-phone">{t("cust.phoneLabel")}</label>
                <input
                  id="join-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={32}
                  inputMode="tel"
                  autoComplete="tel"
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
        <section className="cust-stack" aria-live="polite">
          <div className={`ticket-hero${ticket.peopleAhead === 0 ? " is-next" : ""}`}>
            <p className="ticket-number">{ticket.label}</p>
            <p className="ticket-ahead">
              {ticket.peopleAhead === 0
                ? t("cust.youreNext")
                : ticket.peopleAhead === 1
                  ? t("cust.oneAhead")
                  : t("cust.nAhead", { n: ticket.peopleAhead })}
            </p>
          </div>

          <div className="stat-card">
            <p className="stat-label">{t("demo.nowServing")}</p>
            <p className="stat-value">
              {snapshot.nowServing ?? <span className="dash-mark is-sm" />}
            </p>
          </div>

          <div className="stat-card">
            <p className="stat-label">{t("cust.peopleWaiting")}</p>
            <p className="stat-value">{snapshot.peopleWaiting}</p>
          </div>

          {snapshot.estimatedWaitMinutes > 0 && (
            <div className="stat-card">
              <p className="stat-label">{t("cust.waitEstimate")}</p>
              <p className="stat-value">{t("common.minutes", { n: snapshot.estimatedWaitMinutes })}</p>
            </div>
          )}

          <p className="reassure">
            <span className="reassure-dot" aria-hidden="true" />
            <span>{t("cust.reassure")}</span>
          </p>

          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}

          <button type="button" className="btn btn-secondary leave-btn btn-block" onClick={() => void leaveQueue()} disabled={busy}>
            <LeaveIcon />
            <span>{t("cust.leave")}</span>
          </button>
        </section>
      )}

      {ticket && ticket.status === "on_hold" && (
        <section className="ticket-panel is-turn" aria-live="polite">
          <p className="eyebrow">{t("cust.held")}</p>
          <p className="ticket-number">{ticket.label}</p>
          <p className="ticket-ahead">{t("cust.heldBody")}</p>
        </section>
      )}

      {ticket && ticket.status === "called" && (
        <section className="ticket-panel is-turn" aria-live="assertive">
          <p className="eyebrow">{t("cust.turnT")}</p>
          <p className="ticket-number">{ticket.label}</p>
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

      {ticket &&
        (ticket.status === "served" ||
          ticket.status === "skipped" ||
          ticket.status === "no_show" ||
          ticket.status === "cancelled") && (
          <section className="ticket-panel is-done">
            <p className="eyebrow">
              {ticket.status === "served"
                ? t("cust.done")
                : ticket.status === "cancelled"
                  ? t("dash.stCancelled")
                  : ticket.status === "skipped"
                    ? t("dash.stSkipped")
                    : t("dash.stNoShow")}
            </p>
            <p className="ticket-number">{ticket.label}</p>
            <p className="ticket-ahead">
              {ticket.status === "served"
                ? t("cust.servedBody")
                : ticket.status === "cancelled"
                  ? t("cust.noShowBody")
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