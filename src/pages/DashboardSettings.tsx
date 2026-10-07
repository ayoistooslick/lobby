import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import { applyBrand } from "../lib/theme";
import type { DashboardContext } from "./DashboardLayout";

const DEFAULT_COLOUR = "#1f6feb";
const DEFAULT_ACCENT = "#f2b705";

export default function DashboardSettings() {
  const { overview, refresh } = useOutletContext<DashboardContext>();
  const { t } = useI18n();
  const business = overview.business;
  useDocumentTitle("Settings, Lobby");

  const [name, setName] = useState(business.name);
  const [note, setNote] = useState(business.note);
  const [brandColor, setBrandColor] = useState(business.brandColor || DEFAULT_COLOUR);
  const [brandAccent, setBrandAccent] = useState(business.brandAccent || DEFAULT_ACCENT);
  const [logoUrl, setLogoUrl] = useState(business.logo);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordNote, setPasswordNote] = useState<string | null>(null);

  const canEdit = overview.capabilities.includes("queue.settings");

  useEffect(() => {
    setName(business.name);
    setNote(business.note);
    setBrandColor(business.brandColor || DEFAULT_COLOUR);
    setBrandAccent(business.brandAccent || DEFAULT_ACCENT);
    setLogoUrl(business.logo);
  }, [business.name, business.note, business.brandColor, business.brandAccent, business.logo]);

  // Brand colours are applied live so the staff can see the change immediately.
  useEffect(() => {
    applyBrand(brandColor, brandAccent);
  }, [brandColor, brandAccent]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError(t("err.bizName"));
      return;
    }
    if (note.length > 200) {
      setError(t("set.errNote"));
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/staff/business", {
        method: "PATCH",
        body: {
          name,
          customerNote: note,
          brandColor,
          brandAccent,
          logo: logoUrl,
        },
      });
      refresh();
      setSaved(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  function onLogoFile(file: File) {
    if (file.size > 300_000) {
      setError(t("set.logoHint"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoUrl(String(reader.result ?? ""));
      setError(null);
    };
    reader.readAsDataURL(file);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setPasswordNote(null);
    setError(null);
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setPasswordNote(t("set.passwordChanged"));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return <p className="empty-line">{t("dash.noPermission")}</p>;
  }

  return (
    <>
      <form className="settings-form" onSubmit={(event) => void save(event)}>
        <div className="field">
          <label htmlFor="biz-name">{t("auth.bizName")}</label>
          <input id="biz-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
        </div>

        <div className="field">
          <label htmlFor="biz-note">{t("set.noteLabel")}</label>
          <textarea
            id="biz-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            rows={3}
            placeholder="e.g. Please stay near the counter until your number is called."
          />
          <p className="field-hint">{t("set.noteHint")}</p>
        </div>

        <section className="settings-section">
          <h2>{t("set.brand")}</h2>
          <p className="section-copy">{t("set.brandHint")}</p>

          <div className="colour-row">
            <label className="colour-field">
              <span>{t("set.mainColour")}</span>
              <input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} />
            </label>
            <label className="colour-field">
              <span>{t("set.accentColour")}</span>
              <input
                type="color"
                value={brandAccent}
                onChange={(event) => setBrandAccent(event.target.value)}
              />
            </label>
            <span className="swatch" style={{ background: brandColor }} aria-hidden="true" />
            <span className="swatch" style={{ background: brandAccent }} aria-hidden="true" />
          </div>

          <div className="field">
            <label htmlFor="logo-url">{t("set.logo")}</label>
            <input
              id="logo-url"
              value={logoUrl.startsWith("data:") ? "" : logoUrl}
              placeholder="https://…"
              onChange={(event) => setLogoUrl(event.target.value)}
            />
            <p className="field-hint">{t("set.logoHint")}</p>
          </div>
          <div className="field">
            <label htmlFor="logo-file">{t("set.logo")}</label>
            <input
              id="logo-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onLogoFile(file);
              }}
            />
          </div>
          {logoUrl && (
            <div className="logo-preview">
              <img src={logoUrl} alt="" width={72} height={72} />
              <button
                type="button"
                className="link-button"
                onClick={() => setLogoUrl("")}
                disabled={busy}
              >
                {t("set.removeLogo")}
              </button>
            </div>
          )}
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="row-actions settings-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("set.saving") : t("set.save")}
          </button>
          <span className="saved-line" role="status">
            {saved ? t("set.saved") : ""}
          </span>
        </div>
      </form>

      <section className="settings-section">
        <h2>{t("set.security")}</h2>
        <form className="inline-form" onSubmit={(event) => void changePassword(event)}>
          <div className="field">
            <label htmlFor="current-password">{t("set.currentPassword")}</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">{t("set.newPassword")}</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-secondary" disabled={busy}>
            {t("set.changePassword")}
          </button>
        </form>
        {passwordNote && (
          <p className="saved-line" role="status">
            {passwordNote}
          </p>
        )}
      </section>

      <section className="settings-section">
        <h2>{t("set.goodToKnow")}</h2>
        <dl className="settings-facts">
          <div>
            <dt>{t("qr.linkLabel")}</dt>
            <dd>
              <code>/q/{business.slug}</code>, {t("set.linkBody")}
            </dd>
          </div>
          <div>
            <dt>{t("set.signedInAs")}</dt>
            <dd>
              {overview.staff.name} · {overview.staff.email}
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}