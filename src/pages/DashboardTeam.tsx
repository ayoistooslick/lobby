import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { StaffRole, TeamPayload } from "../lib/types";
import type { DashboardContext } from "./DashboardLayout";

export default function DashboardTeam() {
  const { refresh } = useOutletContext<DashboardContext>();
  const { t } = useI18n();
  useDocumentTitle("Team, Lobby");

  const [data, setData] = useState<TeamPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ email: "", name: "", role: "staff" as StaffRole, branchId: "" });
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api<TeamPayload>("/api/staff/team");
      setData(payload);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ token?: string }>(path, { method, body });
      if (result?.token) {
        setLink(`${window.location.origin}/join/${result.token}`);
        setNotice(t("team.linkCopied"));
      } else {
        setNotice(t("team.invited"));
      }
      await load();
      refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    await call("/api/staff/team/invites", "POST", invite);
    setInvite({ email: "", name: "", role: "staff", branchId: "" });
  }

  if (!data) {
    return error ? <p className="form-error">{error}</p> : null;
  }

  const roleName = (role: StaffRole) =>
    role === "owner"
      ? t("team.roleOwner")
      : role === "manager"
        ? t("team.roleManager")
        : role === "staff"
          ? t("team.roleStaff")
          : t("team.roleViewer");

  const branchName = (id: string) =>
    id ? data.branches.find((branch) => branch.id === id)?.name ?? id : t("team.allBranches");

  return (
    <>
      <p className="section-copy">{t("team.sub")}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="saved-line" role="status">
          {notice}
        </p>
      )}
      {link && (
        <div className="field">
          <label htmlFor="invite-link">{t("team.invite")}</label>
          <input id="invite-link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
        </div>
      )}

      <section className="settings-section">
        <h2>{t("team.title")}</h2>
        {data.team.length === 0 && <p className="empty-line">{t("team.noTeam")}</p>}
        <ul className="card-list">
          {data.team.map((member) => (
            <li className="card-row" key={member.id}>
              <div>
                <p className="card-title">
                  {member.name} {member.isYou && <span className="prefix-chip">{t("set.signedInAs")}</span>}
                </p>
                <p className="muted">
                  {member.email} · {roleName(member.role)} · {branchName(member.branchId)}
                  {!member.active && !member.isYou ? ` · ${t("team.lock")}` : ""}
                </p>
              </div>
              {member.canEdit && !member.isYou && (
                <div className="row-actions">
                  <label className="sr-only" htmlFor={`role-${member.id}`}>
                    {t("team.role")}
                  </label>
                  <select
                    id={`role-${member.id}`}
                    value={member.role}
                    disabled={busy}
                    onChange={(event) =>
                      void call(`/api/staff/team/${encodeURIComponent(member.id)}`, "PATCH", {
                        role: event.target.value,
                      })
                    }
                  >
                    {data.roles.map((role) => (
                      <option key={role.key} value={role.key}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={busy}
                    onClick={() =>
                      void call(`/api/staff/team/${encodeURIComponent(member.id)}`, "PATCH", {
                        active: !member.active,
                      })
                    }
                  >
                    {member.active ? t("team.lock") : t("team.unlock")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`${t("team.remove")}?`)) return;
                      void call(`/api/staff/team/${encodeURIComponent(member.id)}`, "DELETE");
                    }}
                  >
                    {t("common.remove")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="hint">{data.yourRole.help}</p>
      </section>

      <section className="settings-section">
        <h2>{t("team.pending")}</h2>
        {data.invites.length === 0 && <p className="empty-line">{t("team.noPending")}</p>}
        {data.invites.length > 0 && (
          <ul className="card-list">
            {data.invites.map((entry) => (
              <li className="card-row" key={entry.id}>
                <div>
                  <p className="card-title">{entry.email}</p>
                  <p className="muted">
                    {roleName(entry.role)} · {branchName(entry.branchId)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={busy}
                  onClick={() =>
                    void call(`/api/staff/team/invites/${encodeURIComponent(entry.id)}`, "DELETE")
                  }
                >
                  {t("team.revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="inline-form" onSubmit={(event) => void sendInvite(event)}>
          <div className="field">
            <label htmlFor="invite-email">{t("team.inviteEmail")}</label>
            <input
              id="invite-email"
              type="email"
              value={invite.email}
              onChange={(event) => setInvite({ ...invite, email: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="invite-name">{t("auth.yourName")}</label>
            <input
              id="invite-name"
              value={invite.name}
              onChange={(event) => setInvite({ ...invite, name: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="invite-role">{t("team.inviteRole")}</label>
            <select
              id="invite-role"
              value={invite.role}
              onChange={(event) => setInvite({ ...invite, role: event.target.value as StaffRole })}
            >
              {data.roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="invite-branch">{t("team.pickBranch")}</label>
            <select
              id="invite-branch"
              value={invite.branchId}
              onChange={(event) => setInvite({ ...invite, branchId: event.target.value })}
            >
              <option value="">{t("team.allBranches")}</option>
              {data.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("team.invite")}
          </button>
        </form>
        {data.roles.map((role) => (
          <p className="hint" key={role.key}>
            <strong>{role.label}</strong>, {role.help}
          </p>
        ))}
      </section>
    </>
  );
}