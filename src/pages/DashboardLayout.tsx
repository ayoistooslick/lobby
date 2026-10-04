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
      .then((data) => {
        setSnapshot(data);
        setError(null);
      })
      .catch((err) => setError(messageOf(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, attempt]);

  useQueueStream(snapshot?.business.slug ?? null, refresh);

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Signing out locally is enough even if the request fails.
    }
    navigate("/", { replace: true });
  }

  if (!snapshot) {
    if (error) {
      return (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      );
    }
    return <LoadingState label={t("dash.opening")} />;
  }

  return (
    <div className="app-shell">
      <header className="site-header dash-header">
        <div className="shell-inner header-inner">
          <div className="dash-brand">
            <Link to="/dashboard" className="wordmark dash-eyebrow">
              Lobby
            </Link>
            <span className="dash-biz">{snapshot.business.name}</span>
          </div>
          <div className="header-actions">
            <LangButton />
            <button type="button" className="link-button dash-signout" onClick={() => void signOut()}>
              {t("dash.signOut")}
            </button>
          </div>
        </div>
        <div className="dash-controls">
          <ThemeToggle />
        </div>
        <nav className="dash-nav" aria-label="Dashboard">
          <NavLink to="/dashboard" end className={({ isActive }) => navClass(isActive)}>
            {t("dash.navQueue")}
          </NavLink>
          <NavLink to="/dashboard/qr" className={({ isActive }) => navClass(isActive)}>
            {t("dash.navQr")}
          </NavLink>
          <NavLink to="/dashboard/settings" className={({ isActive }) => navClass(isActive)}>
            {t("dash.navSettings")}
          </NavLink>
        </nav>
      </header>

      <main className="page dash-page">
        <Outlet context={{ snapshot, refresh }} />
      </main>
    </div>
  );
}
