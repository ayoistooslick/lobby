import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useStream, useStoredValue, type Connection } from "../lib/hooks";
import type { OverviewPayload } from "../lib/types";
import { LangButton } from "../components/Language";
import {
  IconChart,
  IconLogout,
  IconQueue,
  IconQr,
  IconSliders,
  IconTv,
  IconUsers,
} from "../components/icons";
import { ConnectionBar, ErrorState, LoadingState } from "../components/states";

export interface DashboardContext {
  overview: OverviewPayload;
  branchId: string;
  setBranchId: (id: string) => void;
  serviceId: string;
  setServiceId: (id: string) => void;
  refresh: () => void;
  connection: Connection;
}

function navClass(isActive: boolean) {
  return isActive ? "nav-link active" : "nav-link";
}

export default function DashboardLayout() {
  const { t } = useI18n();
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [branchId, setBranchId] = useStoredValue("lobby.branch");
  const [serviceId, setServiceId] = useStoredValue("lobby.service");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const query = branchId ? `?branch=${encodeURIComponent(branchId)}` : "";
      const data = await api<OverviewPayload>(`/api/staff/overview${query}`);
      setOverview(data);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const connection = useStream(
    overview ? `/api/queue/${overview.business.slug}/stream?channel=${channelFor(overview.branch)}` : null,
    refresh
  );

  // Remember the last location, but never keep one the account cannot open.
  useEffect(() => {
    if (!overview) return;
    if (branchId && overview.branches.some((branch) => branch.id === branchId)) return;
    const first = overview.branch?.id ?? overview.branches[0]?.id ?? "";
    if (first && first !== branchId) setBranchId(first);
  }, [overview, branchId, setBranchId]);

  useEffect(() => {
    if (!overview) return;
    const services = overview.services.map((entry) => entry.service);
    if (serviceId && services.some((service) => service.id === serviceId)) return;
    const first = services[0]?.id ?? "";
    if (first && first !== serviceId) setServiceId(first);
  }, [overview, serviceId, setServiceId]);

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Signing out locally is enough even if the request fails.
    }
    navigate("/", { replace: true });
  }

  if (!overview) {
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

  const can = overview.capabilities;
  const roleLabel =
    overview.staff.role === "owner"
      ? t("team.roleOwner")
      : overview.staff.role === "manager"
        ? t("team.roleManager")
        : overview.staff.role === "staff"
          ? t("team.roleStaff")
          : t("team.roleViewer");

  const context: DashboardContext = {
    overview,
    branchId: overview.branch?.id ?? branchId,
    setBranchId,
    serviceId,
    setServiceId,
    refresh,
    connection,
  };

  const showTv =
    overview.services.length > 0 && overview.branch && overview.services[0]?.service;

  return (
    <div className="dash-shell">
      <aside className="dash-side">
        <div className="side-brand">
          <Link to="/" className="wordmark">
            Lobby
          </Link>
          <span className="side-biz">{overview.business.name}</span>
        </div>

        <nav className="side-nav" aria-label="Dashboard">
          <NavLink to="/dashboard" end className={({ isActive }) => navClass(isActive)}>
            <IconQueue />
            {t("dash.navQueue")}
          </NavLink>
          <NavLink to="/dashboard/qr" className={({ isActive }) => navClass(isActive)}>
            <IconQr />
            {t("dash.navQr")}
          </NavLink>
          <NavLink to="/dashboard/setup" className={({ isActive }) => navClass(isActive)}>
            <IconTv />
            {t("dash.navSetup")}
          </NavLink>
          {can.includes("reports.read") && (
            <NavLink to="/dashboard/reports" className={({ isActive }) => navClass(isActive)}>
              <IconChart />
              {t("dash.navReports")}
            </NavLink>
          )}
          {can.includes("staff.manage") && (
            <NavLink to="/dashboard/team" className={({ isActive }) => navClass(isActive)}>
              <IconUsers />
              {t("dash.navTeam")}
            </NavLink>
          )}
          {can.includes("queue.settings") && (
            <NavLink to="/dashboard/settings" className={({ isActive }) => navClass(isActive)}>
              <IconSliders />
              {t("dash.navSettings")}
            </NavLink>
          )}
        </nav>

        <div className="side-foot">
          <span className="side-role role-tag">{t("dash.roleTag", { role: roleLabel })}</span>
          <div className="side-user">
            <span className="who">{overview.staff.name || overview.staff.email}</span>
            <button
              type="button"
              className="icon-btn"
              title={t("dash.signOut")}
              aria-label={t("dash.signOut")}
              onClick={() => void signOut()}
            >
              <IconLogout size={17} />
            </button>
          </div>
        </div>
      </aside>

      <div className="dash-main">
        <header className="dash-top">
          {overview.branches.length > 1 ? (
            <label className="pick">
              <span className="pick-label">{t("common.branch")}</span>
              <select value={context.branchId} onChange={(event) => setBranchId(event.target.value)}>
                {overview.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="pick-static">{overview.branch?.name ?? ""}</span>
          )}
          <div className="spacer" />
          <ConnectionBar state={connection} />
          <LangButton />
        </header>

        <main className="dash-page">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Outlet context={context} />
        </main>

        {/* Thumb-reach navigation on phones. */}
        <nav className="tabbar" aria-label="Dashboard">
          <NavLink to="/dashboard" end className={({ isActive }) => navClass(isActive)}>
            <IconQueue />
            {t("dash.navQueue")}
          </NavLink>
          {showTv && (
            <NavLink to="/dashboard/qr" className={({ isActive }) => navClass(isActive)}>
              <IconQr />
              {t("dash.navQr")}
            </NavLink>
          )}
          {can.includes("reports.read") && (
            <NavLink to="/dashboard/reports" className={({ isActive }) => navClass(isActive)}>
              <IconChart />
              {t("dash.navReports")}
            </NavLink>
          )}
          {can.includes("staff.manage") && (
            <NavLink to="/dashboard/team" className={({ isActive }) => navClass(isActive)}>
              <IconUsers />
              {t("dash.navTeam")}
            </NavLink>
          )}
          {can.includes("queue.settings") && (
            <NavLink to="/dashboard/settings" className={({ isActive }) => navClass(isActive)}>
              <IconSliders />
              {t("dash.navSettings")}
            </NavLink>
          )}
        </nav>
      </div>
    </div>
  );
}

/** The staff screen follows its branch, so new queues and counters appear live. */
function channelFor(branch: OverviewPayload["branch"] | null): string {
  return branch ? `branch:${branch.id}` : "";
}
