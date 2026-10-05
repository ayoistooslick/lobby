import { List, LogOut, QrCode, Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useQueueStream } from "../lib/hooks";
import type { StaffSnapshot } from "../lib/types";
import { LangButton } from "../components/Language";
import ThemeToggle from "../components/ThemeToggle";
import { ErrorState, LoadingState } from "../components/states";

export interface DashboardContext {
  snapshot: StaffSnapshot;
  refresh: () => void;
}

function navClass(isActive: boolean) {
  return isActive ? "nav-link active" : "nav-link";
}

export default function DashboardLayout() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<StaffSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    api<StaffSnapshot>("/api/staff/queue")
      .then((data) => { setSnapshot(data); setError(null); })
      .catch((err) => setError(messageOf(err)));
  }, []);

  useEffect(() => { refresh(); }, [refresh, attempt]);
  const connected = useQueueStream(snapshot?.business.slug ?? null, refresh);

  async function signOut() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* local navigation still signs out */ }
    navigate("/", { replace: true });
  }

  if (!snapshot) {
    if (error) {
      return <ErrorState message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />;
    }
    return <LoadingState label={t("dash.opening")} />;
  }

  return (
    <div className="app-shell">
      <header className="site-header dash-header">
        <div className="shell-inner header-inner">
          <div className="dash-brand">
            <Link to="/dashboard" className="wordmark dash-eyebrow">Lobby</Link>
            <span className="dash-biz">{snapshot.business.name}</span>
          </div>
          <div className="header-actions">
            <LangButton />
            <button type="button" className="link-button dash-signout" onClick={() => void signOut()}>
              <LogOut size={17} strokeWidth={1.9} aria-hidden="true" />
              <span>{t("dash.signOut")}</span>
            </button>
          </div>
        </div>
        <div className="dash-controls"><ThemeToggle /></div>
        <nav className="dash-nav" aria-label="Dashboard">
          <NavLink to="/dashboard" end className={({ isActive }) => navClass(isActive)}>
            <List size={18} strokeWidth={1.9} aria-hidden="true" /><span>{t("dash.navQueue")}</span>
          </NavLink>
          <NavLink to="/dashboard/qr" className={({ isActive }) => navClass(isActive)}>
            <QrCode size={18} strokeWidth={1.9} aria-hidden="true" /><span>{t("dash.navQr")}</span>
          </NavLink>
          <NavLink to="/dashboard/settings" className={({ isActive }) => navClass(isActive)}>
            <Settings2 size={18} strokeWidth={1.9} aria-hidden="true" /><span>{t("dash.navSettings")}</span>
          </NavLink>
        </nav>
      </header>

      <main className="page dash-page">
        {!connected && <div className="offline-banner" role="status">Connection interrupted. Showing the last known queue state while Lobby reconnects.</div>}
        <Outlet context={{ snapshot, refresh }} />
      </main>
    </div>
  );
}
