import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle, useStream } from "../lib/hooks";
import { applyBrand, clearBrand } from "../lib/theme";
import { IconFullscreen } from "../components/icons";
import type { DisplayPayload } from "../lib/types";

export default function Display() {
  const { slug = "" } = useParams();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();

  const branchSlug = params.get("branch") ?? "";
  const serviceSlug = params.get("service") ?? "";
  const [data, setData] = useState<DisplayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());

  const query = new URLSearchParams();
  if (branchSlug) query.set("branch", branchSlug);
  if (serviceSlug) query.set("service", serviceSlug);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const payload = await api<DisplayPayload>(
        `/api/display/${encodeURIComponent(slug)}?${query.toString()}`
      );
      setData(payload);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [slug, branchSlug, serviceSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const service = data?.service ?? null;
  const connection = useStream(
    service ? `/api/display/${encodeURIComponent(slug)}/stream?channel=service%3A${service.id}` : null,
    () => void load(),
    20_000
  );

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useDocumentTitle(data ? `${data.business.name} — ${t("disp.nowServing")}` : "Lobby display");

  useEffect(() => {
    if (!data) return;
    applyBrand(data.business.brandColor, data.business.brandAccent);
    return () => clearBrand();
  }, [data]);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void document.documentElement.requestFullscreen?.();
  }

  if (error) {
    return (
      <main className="display-shell" style={{ justifyContent: "center", alignItems: "center" }}>
        <p className="form-error">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="display-shell" style={{ justifyContent: "center", alignItems: "center" }}>
        <p className="muted">…</p>
      </main>
    );
  }

  const nextUp = data.waiting.slice(0, 5);

  return (
    <main className="display-shell">
      <header className="display-top">
        <div className="display-brand">
          {data.business.logo ? (
            <img src={data.business.logo} alt="" width={46} height={46} />
          ) : null}
          <div>
            <h1>{data.business.name}</h1>
            <p className="sub">
              {[data.branch?.name, service?.name].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="display-tools">
          <span className={connection === "live" ? "tv-badge conn conn-live" : "tv-badge conn conn-warn"}>
            <span className="conn-dot" aria-hidden="true" />
            {connection === "live"
              ? t("common.live")
              : connection === "offline"
                ? t("common.offline")
                : t("common.reconnecting")}
          </span>
          <span className="display-clock">
            {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleFullscreen}
            aria-label={t("disp.fullscreen")}
            title={t("disp.fullscreen")}
          >
            <IconFullscreen />
          </button>
        </div>
      </header>

      {data.services.length > 1 && (
        <nav className="display-switch" aria-label={t("disp.others")}>
          {data.services.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === service?.id ? "chip active" : "chip"}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("service", entry.slug);
                setParams(next, { replace: true });
              }}
            >
              {entry.name}
            </button>
          ))}
        </nav>
      )}

      <section className="tvnow">
        <div className="tv-card">
          <p className="eyebrow">{t("disp.nowServing")}</p>
          <p className="tvnow-num">{data.nowServing ?? "—"}</p>
          {data.nowServing ? null : <p className="eyebrow">{t("disp.awaiting")}</p>}
          {data.called.length > 0 && (
            <ul className="display-list">
              {data.called
                .slice(-4)
                .map((entry) => (
                  <li key={`${entry.label}-${entry.at}`}>{entry.label}</li>
                ))}
            </ul>
          )}
        </div>
        <aside className="tvnow-side">
          <h2>{t("dash.nextUp")}</h2>
          {nextUp.length === 0 ? (
            <p className="muted">{t("cust.noOneWaiting")}</p>
          ) : (
            <ul className="tvnext">
              {nextUp.map((label) => (
                <li key={label}>
                  <span className="n">{label}</span>
                </li>
              ))}
            </ul>
          )}
          {data.averageWaitMinutes > 0 && (
            <p className="tvnext-wait">{t("dash.avgWait", { n: data.averageWaitMinutes })}</p>
          )}
        </aside>
      </section>

      {data.others.length > 0 && (
        <section>
          <h2 className="eyebrow">{t("disp.others")}</h2>
          <div className="tvgrid">
            {data.others.map((entry) => (
              <div className="tvcard" key={entry.service.id}>
                <span className="name">{entry.service.name}</span>
                <span className="num">{entry.nowServing ?? "—"}</span>
                <span className="wait">{t("cust.waitingN", { n: entry.waiting })}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
