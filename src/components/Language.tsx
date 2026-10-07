import { Check, Globe2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  const { lang, choose, t } = useI18n();
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return LANGS;
    return LANGS.filter((entry) =>
      [entry.native, entry.label, entry.code].some((field) => field.toLowerCase().includes(needle))
    );
  }, [query]);

  return (
    <>
      <label className="lang-search">
        <Search size={15} strokeWidth={1.8} aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("lang.search")}
          aria-label={t("lang.search")}
          enterKeyHint="search"
          autoComplete="off"
        />
      </label>
      <div className="lang-grid">
        {matches.map((entry) => (
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
            {entry.code === lang.code && <Check className="lang-check" size={16} aria-hidden="true" />}
          </button>
        ))}
        {matches.length === 0 && <p className="lang-empty">{t("lang.noMatch")}</p>}
      </div>
    </>
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

// One globe icon in the header; it opens the language picker.
export function LangButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="icon-btn lang-button"
        aria-label={t("lang.change")}
        title={t("lang.change")}
        onClick={() => setOpen(true)}
      >
        <Globe2 size={17} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="lang-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t("lang.change")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="lang-card">
            <div className="lang-head">
              <h2>{t("lang.change")}</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label={t("lang.close")}
                title={t("lang.close")}
                onClick={() => setOpen(false)}
              >
                <X size={16} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
            <LanguageOptions onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
