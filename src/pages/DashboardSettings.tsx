import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { DashboardContext } from "./DashboardLayout";

export default function DashboardSettings() {
  const { snapshot, refresh } = useOutletContext<DashboardContext>();
  const { t } = useI18n();
  const business = snapshot.business;

  const [name, setName] = useState(business.name);
  const [note, setNote] = useState(business.note);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useDocumentTitle("Settings, Lobby");

  useEffect(() => {
    setName(business.name);
    setNote(business.note);
  }, [business.name, business.note]);

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
      await api("/api/staff/business", { method: "PATCH", body: { name, customerNote: note } });
      refresh();
      setSaved(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">{t("dash.navSettings")}</h1>

      <form className="settings-form" onSubmit={(event) => void save(event)}>
        <div className="field">
          <label htmlFor="biz-name">{t("auth.bizName")}</label>
          <input
            id="biz-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
          />
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
              {business.ownerName} · {business.email}
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}
