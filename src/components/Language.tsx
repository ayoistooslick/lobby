import { Globe2, Languages } from "lucide-react";
import { useState } from "react";
import { LANGS } from "../lib/langs";
import { useI18n } from "../lib/i18n";

const FLAG_CDN = "https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/flags/4x3";

export function FlagIcon({ code, label }: { code: string; label?: string }) {
  return (
    <img
      className="flag-icon"
      src={`${FLAG_CDN}/${code}.svg`}
      alt={label ? `${label} flag` : ""}
      aria-hidden={label ? undefined : true}
    />
  );
}

function LanguageOptions({ onClose }: { onClose?: () => void }) {
  const { lang, choose } = useI18n();
  return (
    <div className="lang-grid">
      {LANGS.map((entry) => (
        <button
          key={entry.code}
          type="button"
          className={entry.code === lang.code ? "lang-option active" : "lang-option"}
          data-code={entry.code}
          aria-pressed={entry.code === lang.code}
          onClick={() => {
            choose(entry.code);
            onClose?.();
          }}
        >
          <FlagIcon code={entry.flag} label={entry.label} />
          <span className="lang-names">
            <span className="lang-native">{entry.native}</span>
            <span className="lang-label">{entry.label}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// Shown on the very first visit, before the visitor can do anything else.
export function LanguageGate() {
  const { chosen, t } = useI18n();
  if (chosen) return null;
  return (
    <div className="lang-gate" role="dialog" aria-modal="true" aria-label={t("lang.title")}>
      <div className="lang-card">
        <p className="lang-wordmark">Lobby</p>
        <h1 className="lang-title">{t("lang.title")}</h1>
        <p className="lang-sub">{t("lang.sub")}</p>
        <LanguageOptions />
      </div>
    </div>
  );
}

// The picked language's flag, top right of every header.
export function LangButton() {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="lang-button"
        aria-label={t("lang.change")}
        title={t("lang.change")}
        onClick={() => setOpen(true)}
      >
        <FlagIcon code={lang.flag} />
        <Globe2 size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div className="lang-overlay" role="dialog" aria-modal="true" aria-label={t("lang.change")}>
          <div className="lang-card">
            <div className="lang-head">
              <h2><Languages size={19} aria-hidden="true" /> {t("lang.change")}</h2>
              <button type="button" className="link-button" onClick={() => setOpen(false)}>
                {t("lang.done")}
              </button>
            </div>
            <LanguageOptions onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
