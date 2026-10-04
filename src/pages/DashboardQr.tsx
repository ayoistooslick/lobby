import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import QRCode from "qrcode";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { DashboardContext } from "./DashboardLayout";

export default function DashboardQr() {
  const { snapshot } = useOutletContext<DashboardContext>();
  const { t } = useI18n();
  const business = snapshot.business;
  const url = `${window.location.origin}/q/${business.slug}`;

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useDocumentTitle("QR code, Lobby");

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    QRCode.toDataURL(url, {
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
  }, [url]);

  function download() {
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${business.slug}-qr.png`;
    link.click();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: select the link so it can be copied by hand.
      const field = document.getElementById("queue-url");
      if (field) {
        const range = document.createRange();
        range.selectNodeContents(field);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  return (
    <>
      <h1 className="page-title">{t("dash.navQr")}</h1>
      <p className="section-copy qr-intro">{t("qr.intro")}</p>

      <div className="qr-layout">
        <div className="qr-sheet">
          <p className="qr-sheet-name">{business.name}</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : dataUrl ? (
            <img src={dataUrl} alt={`QR code for ${url}`} width={320} height={320} />
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
            <input id="queue-url" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-secondary" onClick={download} disabled={!dataUrl}>
              {t("qr.download")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
              {t("qr.print")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void copyLink()}>
              {t("qr.copy")}
            </button>
          </div>
          <p className="hint" role="status">
            {copied ? t("qr.copied") : "\u00A0"}
          </p>
          <p className="fine-print">{t("qr.fine")}</p>
        </div>
      </div>
    </>
  );
}
