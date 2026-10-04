import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";

export default function NotFound() {
  const { t } = useI18n();
  useDocumentTitle("Page not found, Lobby");

  return (
    <main className="page narrow center">
      <p className="eyebrow">404</p>
      <h1>{t("nf.title")}</h1>
      <p className="section-copy">{t("nf.body")}</p>
      <p>
        <Link to="/" className="btn btn-primary">
          {t("nf.cta")}
        </Link>
      </p>
    </main>
  );
}
