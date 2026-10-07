import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { Branch, ServiceWithCounters, TemplateInfo } from "../lib/types";
import type { DashboardContext } from "./DashboardLayout";

export default function DashboardSetup() {
  const { overview, branchId, setBranchId, refresh } = useOutletContext<DashboardContext>();
  const { t } = useI18n();
  useDocumentTitle("Queues, Lobby");

  const [queues, setQueues] = useState<ServiceWithCounters[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newQueue, setNewQueue] = useState({
    name: "",
    prefix: "",
    description: "",
    avgMinutes: "5",
    counters: "1",
  });
  const [newBranch, setNewBranch] = useState({ name: "", address: "", phone: "" });

  const canEdit = overview.capabilities.includes("queue.settings");

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      const [list, allBranches] = await Promise.all([
        api<{ services: ServiceWithCounters[] }>(`/api/staff/services?branch=${encodeURIComponent(branchId)}`),
        api<{ branches: Branch[] }>("/api/staff/branches"),
      ]);
      setQueues(list.services);
      setBranches(allBranches.branches);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canEdit || templates.length) return;
    api<{ templates: TemplateInfo[] }>("/api/auth/templates")
      .then((data) => setTemplates(data.templates))
      .catch(() => {
        // Templates are a shortcut; the form below still works without them.
      });
  }, [canEdit, templates.length]);

  async function call(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, note?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await api(path, { method, body });
      await load();
      refresh();
      if (note) setSaved(note);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function createQueue(event: FormEvent) {
    event.preventDefault();
    await call(
      "/api/staff/services",
      "POST",
      {
        branchId,
        name: newQueue.name,
        prefix: newQueue.prefix,
        description: newQueue.description,
        avgMinutes: Number(newQueue.avgMinutes) || 5,
        counters: Number(newQueue.counters) || 1,
      },
      t("common.saved")
    );
    setNewQueue({ name: "", prefix: "", description: "", avgMinutes: "5", counters: "1" });
  }

  async function createBranch(event: FormEvent) {
    event.preventDefault();
    await call("/api/staff/branches", "POST", newBranch, t("common.saved"));
    setNewBranch({ name: "", address: "", phone: "" });
  }

  if (!canEdit) {
    return <p className="empty-line">{t("dash.noPermission")}</p>;
  }

  return (
    <>
      <p className="section-copy">{t("sq.sub")}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="saved-line" role="status">
          {saved}
        </p>
      )}

      <section className="settings-section">
        <h2>{t("sq.locations")}</h2>
        {branches.length === 0 && <p className="empty-line">{t("sq.noLocations")}</p>}
        <ul className="card-list">
          {branches.map((branch) => (
            <li className="card-row" key={branch.id}>
              <div>
                <p className="card-title">{branch.name}</p>
                <p className="muted">{branch.address || branch.slug}</p>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={busy || branch.id === branchId}
                  onClick={() => setBranchId(branch.id)}
                >
                  {branch.id === branchId ? t("dash.pickQueue") : t("common.branch")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={busy}
                  onClick={() =>
                    void call(
                      `/api/staff/branches/${encodeURIComponent(branch.id)}`,
                      "PATCH",
                      { paused: !branch.paused }
                    )
                  }
                >
                  {branch.paused ? t("sq.open") : t("sq.paused")}
                </button>
                {branches.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(t("common.remove") + "?")) return;
                      void call(`/api/staff/branches/${encodeURIComponent(branch.id)}`, "DELETE");
                    }}
                  >
                    {t("common.remove")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <form className="inline-form" onSubmit={(event) => void createBranch(event)}>
          <div className="field">
            <label htmlFor="branch-name">{t("sq.locationName")}</label>
            <input
              id="branch-name"
              value={newBranch.name}
              maxLength={60}
              onChange={(event) => setNewBranch({ ...newBranch, name: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="branch-address">{t("sq.address")}</label>
            <input
              id="branch-address"
              value={newBranch.address}
              maxLength={160}
              onChange={(event) => setNewBranch({ ...newBranch, address: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="branch-phone">{t("sq.phone")}</label>
            <input
              id="branch-phone"
              value={newBranch.phone}
              maxLength={32}
              onChange={(event) => setNewBranch({ ...newBranch, phone: event.target.value })}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("sq.addLocation")}
          </button>
        </form>
      </section>

      <section className="settings-section">
        <h2>{t("sq.queues")}</h2>
        {queues.length === 0 && <p className="empty-line">{t("sq.noQueues")}</p>}

        {templates.length > 0 && queues.length === 0 && (
          <div className="template-row">
            <p className="section-copy">{t("sq.startFrom")}</p>
            <div className="chip-row">
              {templates.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() =>
                    void call(
                      "/api/staff/services/apply-template",
                      "POST",
                      { branchId, template: template.key },
                      t("common.saved")
                    )
                  }
                >
                  <strong>{template.label}</strong>
                  <span className="muted">{template.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <ul className="card-list">
          {queues.map((service) => (
            <li className="card-row" key={service.id}>
              <div>
                <p className="card-title">
                  {service.name} <span className="prefix-chip">{service.prefix}</span>
                </p>
                <p className="muted">
                  {service.description || ""} · {t("common.minutes", { n: service.averageMinutes })}
                </p>
                <ul className="counter-row">
                  {service.counters.map((counter) => (
                    <li key={counter.id} className="counter-chip">
                      <span>{counter.name}</span>
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        onClick={() =>
                          void call(
                            `/api/staff/counters/${encodeURIComponent(counter.id)}`,
                            "PATCH",
                            { paused: !counter.paused }
                          )
                        }
                      >
                        {counter.paused ? t("sq.open") : t("sq.paused")}
                      </button>
                      {service.counters.length > 1 && (
                        <button
                          type="button"
                          className="link-button"
                          disabled={busy}
                          onClick={() =>
                            void call(`/api/staff/counters/${encodeURIComponent(counter.id)}`, "DELETE")
                          }
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy}
                      onClick={() =>
                        void call("/api/staff/counters", "POST", {
                          serviceId: service.id,
                          name: `${t("dash.counterLabel")} ${service.counters.length + 1}`,
                        })
                      }
                    >
                      + {t("sq.addCounter")}
                    </button>
                  </li>
                </ul>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={busy}
                  onClick={() =>
                    void call(
                      `/api/staff/services/${encodeURIComponent(service.id)}`,
                      "PATCH",
                      { paused: !service.paused }
                    )
                  }
                >
                  {service.paused ? t("sq.open") : t("sq.paused")}
                </button>
                {queues.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(t("sq.deleteQueue") + "?")) return;
                      void call(`/api/staff/services/${encodeURIComponent(service.id)}`, "DELETE");
                    }}
                  >
                    {t("common.remove")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <form className="inline-form" onSubmit={(event) => void createQueue(event)}>
          <div className="field">
            <label htmlFor="queue-name">{t("sq.queueName")}</label>
            <input
              id="queue-name"
              value={newQueue.name}
              maxLength={60}
              onChange={(event) => setNewQueue({ ...newQueue, name: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="queue-prefix">{t("sq.prefix")}</label>
            <input
              id="queue-prefix"
              value={newQueue.prefix}
              maxLength={2}
              placeholder="A"
              onChange={(event) => setNewQueue({ ...newQueue, prefix: event.target.value.toUpperCase() })}
            />
            <p className="field-hint">{t("sq.prefixHint")}</p>
          </div>
          <div className="field">
            <label htmlFor="queue-desc">{t("sq.description")}</label>
            <input
              id="queue-desc"
              value={newQueue.description}
              maxLength={160}
              onChange={(event) => setNewQueue({ ...newQueue, description: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="queue-minutes">{t("sq.avgTime")}</label>
            <input
              id="queue-minutes"
              type="number"
              min={1}
              max={240}
              value={newQueue.avgMinutes}
              onChange={(event) => setNewQueue({ ...newQueue, avgMinutes: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="queue-counters">{t("sq.counters")}</label>
            <input
              id="queue-counters"
              type="number"
              min={1}
              max={8}
              value={newQueue.counters}
              onChange={(event) => setNewQueue({ ...newQueue, counters: event.target.value })}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("sq.addQueue")}
          </button>
        </form>
      </section>
    </>
  );
}