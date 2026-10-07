import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { DashboardContext } from "./DashboardLayout";
import type { QueuePayload, StaffTicket, TicketStatus } from "../lib/types";
import type { StringKey } from "../lib/langs/en";

const STATUS_KEY: Record<TicketStatus, StringKey> = {
  waiting: "dash.stWait",
  called: "dash.stCalled",
  on_hold: "dash.stHold",
  served: "dash.stServed",
  skipped: "dash.stSkipped",
  no_show: "dash.stNoShow",
  cancelled: "dash.stCancelled",
};

function timeOf(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DashboardQueue() {
  const { overview, branchId, serviceId, setServiceId, refresh, connection } =
    useOutletContext<DashboardContext>();
  const { t } = useI18n();
  useDocumentTitle("Queue, Lobby");

  const [queue, setQueue] = useState<QueuePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [counterId, setCounterId] = useState("");
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkIn, setWalkIn] = useState({ name: "", phone: "", note: "" });
  const [moving, setMoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branchId || !serviceId) {
      setQueue(null);
      return;
    }
    try {
      const data = await api<QueuePayload>(
        `/api/staff/queue?branch=${encodeURIComponent(branchId)}&service=${encodeURIComponent(serviceId)}`
      );
      setQueue(data);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [branchId, serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The layout already listens for changes; this screen refetches with them.
  useEffect(() => {
    if (connection === "live") void load();
  }, [connection, load]);

  const canOperate = overview.capabilities.includes("queue.operate");
  const canSettings = overview.capabilities.includes("queue.settings");

  async function run(key: string, path: string, body?: unknown) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await api(path, { method: "POST", body });
      await load();
      refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  async function act(ticket: StaffTicket, action: string) {
    await run(`${action}:${ticket.id}`, `/api/staff/tickets/${encodeURIComponent(ticket.id)}/action`, {
      action,
      counterId: counterId || undefined,
    });
  }

  async function move(ticket: StaffTicket, targetServiceId: string) {
    setMoving(ticket.id);
    await run(`move:${ticket.id}`, `/api/staff/tickets/${encodeURIComponent(ticket.id)}/move`, {
      serviceId: targetServiceId,
    });
    setMoving(null);
  }

  async function togglePause() {
    if (!queue) return;
    await run("pause", "/api/staff/queue/pause", {
      branchId: queue.branch.id,
      serviceId: queue.service.id,
      paused: !queue.service.paused,
    });
    refresh();
  }

  async function addWalkIn(event: FormEvent) {
    event.preventDefault();
    if (!branchId || !serviceId) return;
    setBusy("walkin");
    setError(null);
    try {
      await api("/api/staff/tickets/manual", {
        method: "POST",
        body: {
          branchId,
          serviceId,
          name: walkIn.name,
          phone: walkIn.phone,
          note: walkIn.note,
          counterId: counterId || undefined,
        },
      });
      setWalkIn({ name: "", phone: "", note: "" });
      setWalkInOpen(false);
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  if (!queue) {
    return (
      <>
        {overview.services.length === 0 ? (
          <p className="empty-line">{t("dash.noQueue")}</p>
        ) : (
          <p className="empty-line">{t("dash.pickQueue")}</p>
        )}
        <Link to="/dashboard/setup" className="btn btn-secondary">
          {t("sq.title")}
        </Link>
      </>
    );
  }

  const otherQueues = overview.services.map((entry) => entry.service).filter((s) => s.id !== queue.service.id);
  const current = queue.nowServing;
  const counters = queue.counters;

  function actionsFor(ticket: StaffTicket) {
    if (!canOperate) return null;
    return (
      <div className="row-actions">
        {ticket.status === "waiting" && (
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={busy !== null}
            onClick={() => void act(ticket, "call")}
          >
            {t("dash.call")}
          </button>
        )}
        {(ticket.status === "called" || ticket.status === "on_hold") && (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={busy !== null}
              onClick={() => void act(ticket, "complete")}
            >
              {t("dash.markServed")}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={busy !== null}
              onClick={() => void act(ticket, "hold")}
            >
              {t("dash.hold")}
            </button>
          </>
        )}
        {ticket.status === "skipped" && (
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={busy !== null}
            onClick={() => void act(ticket, "recall")}
          >
            {t("dash.recall")}
          </button>
        )}
        {ticket.status === "on_hold" && (
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={busy !== null}
            onClick={() => void act(ticket, "release")}
          >
            {t("dash.release")}
          </button>
        )}
        {ticket.status === "waiting" && (
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={busy !== null}
            onClick={() => void act(ticket, "skip")}
          >
            {t("dash.skip")}
          </button>
        )}
        {otherQueues.length > 0 && (
          <label className="move-pick">
            <span className="sr-only">{t("dash.moveTo")}</span>
            <select
              value={moving === ticket.id ? "moving" : ""}
              disabled={busy !== null}
              onChange={(event) => {
                if (event.target.value === "moving") return;
                void move(ticket, event.target.value);
              }}
            >
              <option value="">{t("dash.move")}</option>
              {otherQueues.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="qhead">
        <div>
          <h1>{queue.service.name}</h1>
          <p className="sub">
            {queue.branch.name}
            {queue.service.paused ? ` · ${t("sq.paused")}` : ""}
          </p>
        </div>
        <div className="qhead-actions">
          <div className="queue-picker" style={{ margin: 0 }}>
            <label className="pick">
              <span className="pick-label">{t("dash.navSetup")}</span>
              <select value={queue.service.id} onChange={(event) => setServiceId(event.target.value)}>
                {overview.services.map((entry) => (
                  <option key={entry.service.id} value={entry.service.id}>
                    {entry.service.name} · {entry.waiting} {t("dash.waitingTitle").toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <a
            className="link-button"
            style={{ paddingBottom: 9 }}
            href={`/display/${overview.business.slug}?branch=${encodeURIComponent(queue.branch.slug)}&service=${encodeURIComponent(queue.service.slug)}`}
            target="_blank"
            rel="noreferrer"
          >
            {t("dash.tvLink")}
          </a>
        </div>
      </div>

      {queue.service.paused && (
        <div className="notice" role="status">
          <strong>{t("sq.paused")}</strong> {t("sq.pausedBody")}
        </div>
      )}

      {counters.length > 0 && canOperate && (
        <div className="filter-row" style={{ margin: "0 0 16px" }}>
          <label className="pick" style={{ minWidth: 220 }}>
            <span className="pick-label">{t("dash.counterLabel")}</span>
            <select value={counterId} onChange={(event) => setCounterId(event.target.value)}>
              <option value="">{t("dash.anyCounter")}</option>
              {counters.map((counter) => (
                <option key={counter.id} value={counter.id}>
                  {counter.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* ---------------------------------------------------- now serving */}
      <section className="serve-card" aria-live="polite">
        <div className="serve-grid">
          <div>
            <p className="eyebrow">
              {t("demo.nowServing")} · {queue.service.name}
            </p>
            <p className="serve-num">{current ? current.label : <span className="dash-mark" />}</p>
            <div className="serve-meta">
              {current ? (
                <>
                  <span className="who">{current.name || t("dash.noNameGiven")}</span>
                  <span>
                    {current.confirmed ? t("dash.confirmedHere") : t("dash.notConfirmed")}
                    {current.status === "skipped" ? ` · ${t("dash.stSkipped")}` : ""}
                  </span>
                </>
              ) : (
                <span>{t("dash.nobodyCounter")}</span>
              )}
            </div>
          </div>
          <div className="serve-side">
            {canOperate && (
              <button
                type="button"
                className="btn btn-primary btn-big btn-block"
                disabled={busy !== null || queue.waiting.length === 0}
                onClick={() =>
                  void run("call-next", "/api/staff/queue/call-next", {
                    branchId: queue.branch.id,
                    serviceId: queue.service.id,
                    counterId: counterId || undefined,
                  })
                }
              >
                {busy === "call-next" ? t("dash.calling") : t("dash.callNext")}
              </button>
            )}
            {canOperate && (
              <button
                type="button"
                className="btn btn-secondary btn-big btn-block"
                disabled={busy !== null}
                onClick={() => setWalkInOpen(true)}
              >
                {t("dash.addWalkIn")}
              </button>
            )}
            {canSettings && (
              <button
                type="button"
                className="btn btn-secondary btn-big btn-block"
                disabled={busy !== null}
                onClick={() => void togglePause()}
              >
                {queue.service.paused ? t("dash.resume") : t("dash.pause")}
              </button>
            )}
            {queue.waiting.length === 0 && <p className="hint">{t("dash.noWaitingHint")}</p>}
          </div>
        </div>
        <div className="metric-row">
          <div>
            <span className="k">{t("dash.peopleWaiting", { n: queue.waitingCount }).replace(/^[\d]+\s*/, "")}</span>
            <span className="v">{queue.waitingCount}</span>
          </div>
          <div>
            <span className="k">{t("dash.avgWait", { n: "" }).trim().replace(/[:\s]*$/, "")}</span>
            <span className="v">
              {queue.averageWaitMinutes ? t("common.minutes", { n: queue.averageWaitMinutes }) : t("common.noneYet")}
            </span>
          </div>
          <div>
            <span className="k">{t("dash.servingCounters", { n: queue.servingCounters }).replace(/^[\d]+\s*/, "")}</span>
            <span className="v">{queue.servingCounters}</span>
          </div>
        </div>
      </section>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {walkInOpen || busy === "walkin" ? (
        <form className="settings-form" onSubmit={(event) => void addWalkIn(event)}>
          <h2>{t("dash.addWalkIn")}</h2>
          <p className="section-copy">{t("dash.addWalkInBody")}</p>
          <div className="field">
            <label htmlFor="walkin-name">{t("cust.nameLabel")}</label>
            <input
              id="walkin-name"
              value={walkIn.name}
              maxLength={40}
              onChange={(event) => setWalkIn({ ...walkIn, name: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="walkin-phone">{t("cust.phoneLabel")}</label>
            <input
              id="walkin-phone"
              value={walkIn.phone}
              inputMode="tel"
              maxLength={32}
              onChange={(event) => setWalkIn({ ...walkIn, phone: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="walkin-note">{t("dash.noteLabel")}</label>
            <input
              id="walkin-note"
              value={walkIn.note}
              maxLength={140}
              onChange={(event) => setWalkIn({ ...walkIn, note: event.target.value })}
            />
          </div>
          <div className="row-actions settings-actions">
            <button type="submit" className="btn btn-primary" disabled={busy !== null}>
              {t("common.add")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setWalkInOpen(false);
                setBusy(null);
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {/* ---------------------------------------------------- lists */}
      <div className="qstack" style={{ marginTop: 22 }}>
        {queue.held.length > 0 && (
          <section className="qcard">
            <h2>
              {t("dash.holdTitle")} <span className="count">{queue.held.length}</span>
            </h2>
            <ul className="queue-list">
              {queue.held.map((ticket) => (
                <li className="queue-row" key={ticket.id}>
                  <span className="q-num">{ticket.label}</span>
                  <span className="q-meta">
                    <span className="q-name">{ticket.name || <span className="muted">{t("dash.noName")}</span>}</span>
                    <span className="q-time">{timeOf(ticket.createdAt)}</span>
                  </span>
                  {actionsFor(ticket)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {current && (
          <section className="qcard">
            <h2>{t("dash.atCounter")}</h2>
            <ul className="queue-list">
              <li className="queue-row is-current">
                <span className="q-num">{current.label}</span>
                <span className="q-meta">
                  <span className="q-name">
                    {current.name || <span className="muted">{t("dash.noName")}</span>}
                  </span>
                  <span className="q-time">{timeOf(current.createdAt)}</span>
                </span>
                {actionsFor(current)}
              </li>
            </ul>
          </section>
        )}

        <section className="qcard">
          <h2>
            {t("dash.waitingTitle")} <span className="count">{queue.waiting.length}</span>
          </h2>

          {queue.finished.length === 0 && queue.waiting.length === 0 && queue.called.length === 0 ? (
            <div className="first-run">
              <p className="section-copy">{t("dash.firstRun")}</p>
              <ol className="steps steps-small">
                <li>
                  <span className="step-num">01</span>
                  <div>
                    <p>
                      <strong>{t("how.t1")}.</strong> {t("how.d1")} <Link to="/dashboard/qr">{t("dash.step1link")}</Link>
                    </p>
                  </div>
                </li>
                <li>
                  <span className="step-num">02</span>
                  <div>
                    <p>
                      <strong>{t("how.t2")}.</strong> {t("how.d2")}
                    </p>
                  </div>
                </li>
                <li>
                  <span className="step-num">03</span>
                  <div>
                    <p>
                      <strong>{t("how.t3")}.</strong> {t("how.d3")}
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          ) : queue.waiting.length === 0 ? (
            <p className="empty-line">{t("dash.emptyWaiting")}</p>
          ) : (
            <>
              {queue.waiting[0] && (
                <p className="next-up">
                  <span className="eyebrow">{t("dash.nextUp")}</span>{" "}
                  <strong>
                    {queue.waiting[0].label}
                    {queue.waiting[0].name ? ` · ${queue.waiting[0].name}` : ""}
                  </strong>
                </p>
              )}
              <ul className="queue-list">
                {queue.waiting.map((ticket) => (
                  <li className="queue-row" key={ticket.id}>
                    <span className="q-num">{ticket.label}</span>
                    <span className="q-meta">
                      <span className="q-name">
                        {ticket.name || <span className="muted">{t("dash.noName")}</span>}
                      </span>
                      <span className="q-time">{timeOf(ticket.createdAt)}</span>
                    </span>
                    {actionsFor(ticket)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {queue.finished.length > 0 && (
          <section className="qcard">
            <details className="finished-list">
              <summary>
                {t("dash.finished")} <span className="count">{queue.finished.length}</span>
              </summary>
              <ul className="queue-list queue-list-quiet">
                {queue.finished
                  .slice()
                  .reverse()
                  .map((ticket) => (
                    <li className="queue-row" key={ticket.id}>
                      <span className="q-num">{ticket.label}</span>
                      <span className="q-meta">
                        <span className="q-name">
                          {ticket.name || <span className="muted">{t("dash.noName")}</span>}
                        </span>
                        <span className="q-time">{timeOf(ticket.createdAt)}</span>
                      </span>
                      <span className={`q-status status-${ticket.status.replace("_", "-")}`}>
                        {t(STATUS_KEY[ticket.status])}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
            <p className="counts">
              {t("dash.counts", {
                s: queue.finished.filter((ticket) => ticket.status === "served").length,
                k: queue.finished.filter((ticket) => ticket.status === "skipped").length,
                n: queue.finished.filter((ticket) => ticket.status === "no_show").length,
              })}
            </p>
          </section>
        )}
      </div>
    </>
  );
}
