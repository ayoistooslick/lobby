import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle, useStream } from "../lib/hooks";
import type { DemoPayload } from "../lib/types";

export default function Demo() {
  const { t } = useI18n();
  useDocumentTitle(`${t("demo.title")}, Lobby`);

  const [data, setData] = useState<DemoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [myTicket, setMyTicket] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api<DemoPayload>("/api/demo");
      setData(payload);
      setError(null);
      setServiceId((current) => current || payload.services[0]?.service.id || "");
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useStream("/api/demo/stream", () => void load(), 20_000);

  async function join() {
    if (!serviceId || busy) return;
    setBusy(true);
    try {
      const result = await api<{ ticket: { id: string } }>("/api/demo/join", {
        method: "POST",
        body: { serviceId, name },
      });
      setMyTicket(result.ticket.id);
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(ticketId: string, action: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/demo/action", { method: "POST", body: { ticketId, action } });
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function callNext(currentServiceId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/demo/call-next", { method: "POST", body: { serviceId: currentServiceId } });
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await api("/api/demo/reset", { method: "POST" });
      setMyTicket(null);
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <main className="page">
        <p className="form-error">{error}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          {t("common.retry")}
        </button>
      </main>
    );
  }

  if (!data) return <main className="page">…</main>;

  const selected = data.services.find((card) => card.service.id === serviceId) ?? data.services[0];
  const mine = data.services
    .flatMap((card) => [card.nowServing, ...card.waiting].filter(Boolean))
    .find((ticket) => ticket?.id === myTicket);

  return (
    <main className="page demo-page">
      <h1>{t("demo.title")}</h1>
      <p className="lede">{t("demo.sub")}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="demo-grid">
        <section className="demo-pane" aria-label={t("demo.paneCustomer")}>
          <h2>{t("demo.paneCustomer")}</h2>
          <div className="phone-frame">
            <div className="phone-bar">
              <strong>{data.business.name}</strong>
              <span className="muted">{selected?.service.name}</span>
            </div>
            <div className="phone-body">
              <p className="stat-inline">
                {t("demo.nowServing")}{" "}
                <strong>{selected?.nowServing ? selected.nowServing.label : "—"}</strong>
                <span className="dot" aria-hidden="true">
                  ·
                </span>
                {t("cust.waitingN", { n: selected?.waitingCount ?? 0 })}
              </p>

              {mine ? (
                <div className="ticket-hero is-next">
                  <p className="ticket-number">{mine.label}</p>
                  <p className="ticket-ahead">
                    {mine.status === "called" ? t("cust.turnT") : t("cust.youreNumber")}
                  </p>
                </div>
              ) : (
                <p className="muted">{t("cust.youreNumber")} —</p>
              )}

              <div className="field">
                <label htmlFor="demo-name">{t("demo.joinName")}</label>
                <input
                  id="demo-name"
                  value={name}
                  maxLength={24}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <button type="button" className="btn btn-primary btn-block" onClick={() => void join()} disabled={busy}>
                {t("demo.join")}
              </button>
            </div>
          </div>
        </section>

        <section className="demo-pane" aria-label={t("demo.paneStaff")}>
          <h2>{t("demo.paneStaff")}</h2>
          {data.services.map((card) => (
            <div className="demo-service" key={card.service.id}>
              <p className="card-title">{card.service.name}</p>
              <p className="muted">
                {t("demo.nowServing")} {card.nowServing ? card.nowServing.label : "—"} ·{" "}
                {t("cust.waitingN", { n: card.waitingCount })}
              </p>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={busy || card.waitingCount === 0}
                  onClick={() => void callNext(card.service.id)}
                >
                  {t("demo.callNext")}
                </button>
                {card.nowServing && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={busy}
                    onClick={() => void act(card.nowServing!.id, "complete")}
                  >
                    {t("demo.serve")}
                  </button>
                )}
                {card.waiting[0] && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={busy}
                    onClick={() => void act(card.waiting[0].id, "skip")}
                  >
                    {t("demo.skip")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>

        <section className="demo-pane demo-tv" aria-label={t("demo.paneTv")}>
          <h2>{t("demo.paneTv")}</h2>
          <div className="tv-frame">
            <p className="muted">{data.business.name}</p>
            <p className="display-number">{selected?.nowServing?.label ?? "—"}</p>
            <p className="eyebrow">{t("disp.nowServing")}</p>
            <div className="display-list inline">
              {selected?.waiting.slice(0, 8).map((ticket) => (
                <span key={ticket.id}>{ticket.label}</span>
              ))}
            </div>
          </div>
          <Link
            className="link-button"
            to={`/display/${data.business.slug}?service=${encodeURIComponent(selected?.service.slug ?? "")}`}
          >
            {t("dash.tvLink")} →
          </Link>
        </section>
      </div>

      <p className="hint">{t("demo.hint")}</p>

      <div className="row-actions settings-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void reset()} disabled={busy}>
          {t("demo.reset")}
        </button>
        <Link to="/auth?mode=signup" className="btn btn-primary">
          {t("nav.setup")}
        </Link>
      </div>
    </main>
  );
}