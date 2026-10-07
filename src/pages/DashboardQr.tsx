import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import QRCode from "qrcode";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { DashboardContext } from "./DashboardLayout";

export default function DashboardQr() {
  const { overview, serviceId, setServiceId } = useOutletContext<DashboardContext>();
  const { t } = useI18n();
  useDocumentTitle("QR code, Lobby");

  const branch = overview.branch;
  const services = overview.services.map((entry) => entry.service);
  const service = services.find((entry) => entry.id === serviceId) ?? services[0] ?? null;

  const joinUrl = `${window.location.origin}/q/${overview.business.slug}`;
  const link = useMemo(() => {
    const query = new URLSearchParams();
    if (branch) query.set("branch", branch.slug);
    if (service) query.set("service", service.slug);
    const suffix = query.toString();
    return `${joinUrl}${suffix ? `?${suffix}` : ""}`;
  }, [joinUrl, branch, service]);

  const displayUrl = useMemo(() => {
    if (!branch || !service) return "";
    return `${window.location.origin}/display/${overview.business.slug}?branch=${encodeURIComponent(
      branch.slug
    )}&service=${encodeURIComponent(service.slug)}`;
  }, [overview.business.slug, branch, service]);

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    QRCode.toDataURL(link, {
      width: 640,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((generated) => {
        if (!cancelled) setDataUrl(generated);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't create the QR code. Try refreshing the page.");
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  function download() {
    if (!dataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `${overview.business.slug}-${service?.slug ?? "queue"}-qr.png`;
    anchor.click();
  }

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      // Clipboard blocked: the link is on screen and selectable.
    }
  }

  if (!service || !branch) return <p className="empty-line">{t("dash.noQueue")}</p>;

  return (
    <>
      <p className="section-copy qr-intro">{t("qr.intro")}</p>

      {services.length > 1 && (
        <label className="pick">
          <span className="pick-label">{t("qr.pickQueue")}</span>
          <select value={service.id} onChange={(event) => setServiceId(event.target.value)}>
            {services.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="qr-layout">
        <div className="qr-sheet">
          <p className="qr-sheet-name">{overview.business.name}</p>
          <p className="muted">
            {branch.name} · {service.name}
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : dataUrl ? (
            <img src={dataUrl} alt={`QR code for ${link}`} width={320} height={320} />
          ) : (
            <div className="qr-placeholder" role="status">
              {t("qr.making")}
            </div>
          )}
          <p className="qr-sheet-cta">{t("qr.sheetCta")}</p>
        </div>

        <div className="qr-side">
          <div className="field">
            <label htmlFor="queue-url">{t("qr.linkLabel")}</label>
            <input id="queue-url" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-secondary" onClick={download} disabled={!dataUrl}>
              {t("qr.download")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
              {t("qr.print")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void copy(link, "join")}>
              {t("qr.copy")}
            </button>
          </div>
          <p className="hint" role="status">
            {copied === "join" ? t("qr.copied") : "\u00A0"}
          </p>

          <div className="field">
            <label htmlFor="display-url">{t("qr.displayLink")}</label>
            <input
              id="display-url"
              readOnly
              value={displayUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          <div className="row-actions">
            <a className="btn btn-secondary" href={displayUrl} target="_blank" rel="noreferrer">
              {t("dash.tvLink")}
            </a>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void copy(displayUrl, "display")}
            >
              {t("qr.copy")}
            </button>
          </div>
          <p className="hint" role="status">
            {copied === "display" ? t("qr.copied") : "\u00A0"}
          </p>
          <p className="fine-print">{t("qr.fine")}</p>
        </div>
      </div>
    </>
  );
}