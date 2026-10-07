import { Link, Outlet } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { LangButton } from "./Language";
import ThemeToggle from "./ThemeToggle";

export default function PublicLayout() {
  const { t } = useI18n();

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="shell-inner header-inner">
          <Link to="/" className="wordmark">
            Lobby
          </Link>
          <nav className="site-nav" aria-label="Main">
            <Link to="/about">{t("nav.about")}</Link>
            <Link to="/demo">{t("nav.demo")}</Link>
          </nav>
          <div className="header-actions">
            <LangButton />
            <ThemeToggle />
            <Link to="/auth?mode=login" className="link-button">
              {t("nav.signin")}
            </Link>
            <Link to="/auth?mode=signup" className="btn btn-primary btn-small">
              {t("nav.setup")}
            </Link>
          </div>
        </div>
      </header>

      <Outlet />

      <footer className="site-footer">
        <div className="shell-inner footer-inner">
          <p>{t("foot.made", { name: "Ayodele Ayokunle David" })}</p>
          <p className="muted">{t("foot.mit")}</p>
        </div>
      </footer>
    </div>
  );
}
