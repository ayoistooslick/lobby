import { Check, Clock3, Pause, Play, SkipForward, UserX } from "lucide-react";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { DashboardContext } from "./DashboardLayout";
import type { StaffTicket, TicketStatus } from "../lib/types";
import type { StringKey } from "../lib/langs/en";

const STATUS_KEY: Record<TicketStatus, StringKey> = {
  waiting: "dash.stWait",
  called: "dash.stCalled",
  served: "dash.stServed",
  skipped: "dash.stSkipped",
  no_show: "dash.stNoShow",
};

function timeOf(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DashboardQueue() {
  const { snapshot, refresh } = useOutletContext<DashboardContext>();
  const { t } = useI18n();

  useDocumentTitle("Queue, Lobby");
  const { business, tickets } = snapshot;

  const current = tickets.find((ticket) => ticket.status === "called") ?? null;
  const waiting = tickets.filter((ticket) => ticket.status === "waiting");
  const finished = tickets.filter((ticket) => ticket.status !== "waiting" && ticket.status !== "called");
  const servedCount = finished.filter((ticket) => ticket.status === "served").length;
  const skippedCount = finished.filter((ticket) => ticket.status === "skipped").length;
  const noShowCount = finished.filter((ticket) => ticket.status === "no_show").length;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, path: string, body?: unknown) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await api(path, { method: "POST", body });
      refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  function actionsFor(ticket: StaffTicket) {
    const id = encodeURIComponent(ticket.id);
    return (
      <div className="row-actions">
        <button type="button" className="btn btn-secondary btn-small" disabled={busy !== null} onClick={() => void run(`served:${ticket.id}`, `/api/staff/tickets/${id}/served`)}>
          <Check size={17} strokeWidth={2} aria-hidden="true" />
          <span>{t("dash.markServed")}</span>
        </button>
        <button type="button" className="btn btn-secondary btn-small" disabled={busy !== null} onClick={() => void run(`skipped:${ticket.id}`, `/api/staff/tickets/${id}/skipped`)}>
          <SkipForward size={17} strokeWidth={2} aria-hidden="true" />
          <span>{t("dash.skip")}</span>
        </button>
        <button type="button" className="btn btn-secondary btn-small" disabled={busy !== null} onClick={() => void run(`noshow:${ticket.id}`, `/api/staff/tickets/${id}/no-show`)}>
          <UserX size={17} strokeWidth={2} aria-hidden="true" />
          <span>{t("dash.stNoShow")}</span>
        </button>
      </div>
    );
  }

  return (
    <>
      {business.paused && (
        <div className="notice" role="status">
          <strong>{t("cust.pausedT")}</strong> {t("dash.pausedB")}
        </div>
      )}

      <section className="now-section" aria-live="polite">
        <div className="now-main">
          <p className="eyebrow">{t("demo.nowServing")}</p>
          <p className="now-number">{current ? `#${current.number}` : <span className="dash-mark" />}</p>
          <p className="now-detail">
            {current ? current.name || t("dash.noNameGiven") : t("dash.nobodyCounter")}
            {current && <span className="muted">{current.confirmed ? t("dash.confirmedHere") : t("dash.notConfirmed")}</span>}
          </p>
        </div>
        <div className="now-side">
          <button type="button" className="btn btn-primary btn-big btn-block" disabled={busy !== null || waiting.length === 0} onClick={() => void run("call-next", "/api/staff/queue/call-next")}>
            <Clock3 size={20} strokeWidth={2} aria-hidden="true" />
            <span>{busy === "call-next" ? t("dash.calling") : t("dash.callNext")}</span>
          </button>
          <button type="button" className="btn btn-secondary btn-big btn-block" disabled={busy !== null} onClick={() => void run("pause", "/api/staff/queue/pause", { paused: !business.paused })}>
            {business.paused ? <Play size={20} strokeWidth={2} aria-hidden="true" /> : <Pause size={20} strokeWidth={2} aria-hidden="true" />}
            <span>{business.paused ? t("dash.resume") : t("dash.pause")}</span>
          </button>
          {waiting.length === 0 && <p className="hint">{t("dash.noWaitingHint")}</p>}
        </div>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}

      {current && (
        <section className="queue-section">
          <h2>{t("dash.atCounter")}</h2>
          <ul className="queue-list">
            <li className="queue-row is-current">
              <span className="q-num">#{current.number}</span>
              <span className="q-meta">
                <span className="q-name">{current.name || <span className="muted">{t("dash.noName")}</span>}</span>
                <span className="q-time">{timeOf(current.createdAt)}</span>
              </span>
              {actionsFor(current)}
            </li>
          </ul>
        </section>
      )}

      <section className="queue-section">
        <h2>{t("dash.waitingTitle")} <span className="count">{waiting.length}</span></h2>
        {tickets.length === 0 ? (
          <div className="first-run">
            <p className="section-copy">{t("dash.firstRun")}</p>
            <ol className="steps steps-small">
              <li><span className="step-num">01</span><div><p><strong>{t("how.t1")}.</strong> {t("how.d1")} <Link to="/dashboard/qr">{t("dash.step1link")}</Link></p></div></li>
              <li><span className="step-num">02</span><div><p><strong>{t("how.t2")}.</strong> {t("how.d2")}</p></div></li>
              <li><span className="step-num">03</span><div><p><strong>{t("how.t3")}.</strong> {t("how.d3")}</p></div></li>
            </ol>
          </div>
        ) : waiting.length === 0 ? (
          <p className="empty-line">{t("dash.emptyWaiting")}</p>
        ) : (
          <>
            {waiting[0] && <p className="next-up"><span className="eyebrow">{t("dash.nextUp")}</span> <strong>#{waiting[0].number}{waiting[0].name ? ` · ${waiting[0].name}` : ""}</strong></p>}
            <ul className="queue-list">
              {waiting.map((ticket) => (
                <li className="queue-row" key={ticket.id}>
                  <span className="q-num">#{ticket.number}</span>
                  <span className="q-meta">
                    <span className="q-name">{ticket.name || <span className="muted">{t("dash.noName")}</span>}</span>
                    <span className="q-time">{timeOf(ticket.createdAt)}</span>
                  </span>
                  {actionsFor(ticket)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {finished.length > 0 && (
        <section className="queue-section">
          <details className="finished-list">
            <summary>{t("dash.finished")} <span className="count">{finished.length}</span></summary>
            <ul className="queue-list queue-list-quiet">
              {finished.map((ticket) => (
                <li className="queue-row" key={ticket.id}>
                  <span className="q-num">#{ticket.number}</span>
                  <span className="q-meta"><span className="q-name">{ticket.name || <span className="muted">{t("dash.noName")}</span>}</span><span className="q-time">{timeOf(ticket.createdAt)}</span></span>
                  <span className={`q-status status-${ticket.status.replace("_", "-")}`}>{t(STATUS_KEY[ticket.status])}</span>
                </li>
              ))}
            </ul>
          </details>
          <p className="counts">{t("dash.counts", { s: servedCount, k: skippedCount, n: noShowCount })}</p>
        </section>
      )}
    </>
  );
}
