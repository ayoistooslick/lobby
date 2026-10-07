import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { AnalyticsPayload, AuditEntry, HistoryEntry } from "../lib/types";
import type { DashboardContext } from "./DashboardLayout";

const RANGES = [7, 30, 90];

function timeOf(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DashboardReports() {
  const { overview, branchId, serviceId } = useOutletContext<DashboardContext>();
  const { t } = useI18n();
  useDocumentTitle("History, Lobby");

  const [days, setDays] = useState(7);
  const [scopeQueue, setScopeQueue] = useState("");
  const [report, setReport] = useState<AnalyticsPayload | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeQueue = scopeQueue || serviceId;

  const load = useCallback(async () => {
    if (!branchId) return;
    const common = `branch=${encodeURIComponent(branchId)}${activeQueue ? `&service=${encodeURIComponent(activeQueue)}` : ""}`;
    try {
      const [stats, list, entries] = await Promise.all([
        api<AnalyticsPayload>(`/api/staff/analytics?${common}&days=${days}`),
        api<{ history: HistoryEntry[] }>(`/api/staff/history?${common}&limit=100`),
        api<{ entries: AuditEntry[] }>(`/api/staff/audit?branch=${encodeURIComponent(branchId)}&limit=40`),
      ]);
      setReport(stats);
      setHistory(list.history);
      setAudit(entries.entries);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [branchId, activeQueue, days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!overview.capabilities.includes("reports.read")) {
    return <p className="empty-line">{t("rep.noReports")}</p>;
  }

  const totals = report?.totals;
  const peak = totals?.busiestHour ?? null;

  return (
    <>
      <p className="section-copy">{t("rep.sub")}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="filter-row">
        <label className="pick">
          <span className="pick-label">{t("dash.navSetup")}</span>
          <select value={scopeQueue} onChange={(event) => setScopeQueue(event.target.value)}>
            <option value="">{t("common.allBranches")}</option>
            {overview.services.map((entry) => (
              <option key={entry.service.id} value={entry.service.id}>
                {entry.service.name}
              </option>
            ))}
          </select>
        </label>
        <div className="chip-row">
          {RANGES.map((span) => (
            <button
              key={span}
              type="button"
              className={days === span ? "chip active" : "chip"}
              onClick={() => setDays(span)}
            >
              {span === 7 ? t("rep.days7") : span === 30 ? t("rep.days30") : t("rep.days90")}
            </button>
          ))}
        </div>
      </div>

      {totals && (
        <section className="stat-grid">
          <div className="stat-card">
            <p className="stat-label">{t("rep.joined")}</p>
            <p className="stat-value">{totals.joined}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">{t("rep.served")}</p>
            <p className="stat-value">{totals.served}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">{t("rep.avgWait")}</p>
            <p className="stat-value">{t("common.minutes", { n: totals.averageWaitMinutes })}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">{t("rep.avgService")}</p>
            <p className="stat-value">{t("common.minutes", { n: totals.averageServiceMinutes })}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">{t("rep.abandoned")}</p>
            <p className="stat-value">{totals.abandoned}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">{t("rep.peak")}</p>
            <p className="stat-value">{peak === null ? t("common.noneYet") : `${String(peak).padStart(2, "0")}:00`}</p>
          </div>
        </section>
      )}

      {report && report.hours.some((hour) => hour.joined > 0) && (
        <section className="settings-section">
          <h2>{t("rep.byHour")}</h2>
          <div className="bar-chart" role="img" aria-label={t("rep.byHour")}>
            {report.hours.map((hour) => {
              const max = Math.max(...report.hours.map((entry) => entry.joined), 1);
              return (
                <div className="bar-col" key={hour.hour} title={`${hour.hour}:00 · ${hour.joined}`}>
                  <span className="bar" style={{ height: `${Math.round((hour.joined / max) * 100)}%` }} />
                  <span className="bar-label">{hour.hour % 3 === 0 ? hour.hour : ""}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {report && report.services.length > 1 && (
        <section className="settings-section">
          <h2>{t("rep.byQueue")}</h2>
          <ul className="card-list">
            {report.services.map((entry) => (
              <li className="card-row" key={entry.serviceId}>
                <div>
                  <p className="card-title">{entry.name}</p>
                  <p className="muted">
                    {entry.joined} {t("rep.joined").toLowerCase()} · {entry.served} {t("rep.served").toLowerCase()}
                  </p>
                </div>
                <span className="stat-value sm">{t("common.minutes", { n: entry.averageWaitMinutes })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="settings-section">
        <h2>{t("rep.history")}</h2>
        {history.length === 0 ? (
          <p className="empty-line">{t("rep.noHistory")}</p>
        ) : (
          <ul className="queue-list queue-list-quiet">
            {history.map((entry) => (
              <li className="queue-row" key={entry.id}>
                <span className="q-num">{entry.label}</span>
                <span className="q-meta">
                  <span className="q-name">{entry.name || <span className="muted">{t("dash.noName")}</span>}</span>
                  <span className="q-time">
                    {timeOf(entry.createdAt)}
                    {entry.waitMinutes ? ` · ${t("rep.waited", { n: entry.waitMinutes })}` : ""}
                    {entry.serviceMinutes ? ` · ${t("rep.servedIn", { n: entry.serviceMinutes })}` : ""}
                  </span>
                </span>
                <span className={`q-status status-${entry.status.replace("_", "-")}`}>{entry.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section">
        <h2>{t("rep.audit")}</h2>
        {audit.length === 0 ? (
          <p className="empty-line">{t("rep.noAudit")}</p>
        ) : (
          <ul className="queue-list queue-list-quiet">
            {audit.map((entry) => (
              <li className="queue-row" key={entry.id}>
                <span className="q-meta">
                  <span className="q-name">
                    {entry.actorName} · {entry.detail || entry.action}
                  </span>
                  <span className="q-time">{timeOf(entry.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}