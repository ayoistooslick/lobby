import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";

export default function Landing() {
  const { t } = useI18n();
  useDocumentTitle("Lobby, simple queues for local businesses");

  return (
    <main>
      <section className="hero shell-inner">
        <div className="hero-copy">
          <p className="eyebrow">{t("hero.eyebrow")}</p>
          <h1>
            {t("hero.h1a")}
            <br />
            {t("hero.h1b")}
          </h1>
          <p className="lede">{t("hero.lede")}</p>
          <div className="cta-row">
            <Link to="/auth?mode=signup" className="btn btn-primary btn-big">
              {t("nav.setup")}
            </Link>
            <Link to="/auth?mode=login" className="btn btn-secondary btn-big">
              {t("nav.signin")}
            </Link>
          </div>
          <p className="fine-print">{t("hero.fine")}</p>
        </div>

        <div className="hero-ticket" aria-hidden="true">
          <div className="hero-ticket-row">
            <span className="hero-ticket-label">{t("demo.nowServing")}</span>
            <span className="hero-ticket-big">#21</span>
          </div>
          <div className="hero-ticket-row">
            <span className="hero-ticket-label">{t("demo.yourNumber")}</span>
            <span className="hero-ticket-big">#24</span>
            <span className="hero-ticket-note">{t("cust.nAhead", { n: 3 })}</span>
          </div>
        </div>
      </section>

      <section className="section shell-inner" id="how">
        <h2 className="section-title">{t("how.title")}</h2>
        <ol className="steps">
          <li>
            <span className="step-num">01</span>
            <div>
              <h3>{t("how.t1")}</h3>
              <p>{t("how.d1")}</p>
            </div>
          </li>
          <li>
            <span className="step-num">02</span>
            <div>
              <h3>{t("how.t2")}</h3>
              <p>{t("how.d2")}</p>
            </div>
          </li>
          <li>
            <span className="step-num">03</span>
            <div>
              <h3>{t("how.t3")}</h3>
              <p>{t("how.d3")}</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="section shell-inner section-rule">
        <div className="split">
          <div>
            <h2 className="section-title">{t("see.title")}</h2>
            <p className="section-copy">{t("see.copy")}</p>
          </div>
          <ul className="demo-lines">
            <li>
              <span>{t("see.youreNumber")}</span>
              <strong>24</strong>
            </li>
            <li>
              <span>{t("see.peopleAhead")}</span>
              <strong>3</strong>
            </li>
            <li>
              <span>{t("demo.nowServing")}</span>
              <strong>21</strong>
            </li>
            <li className="demo-turn">
              <span>{t("see.when")}</span>
              <strong>{t("see.itsTurn")}</strong>
            </li>
          </ul>
        </div>
      </section>

      <section className="section shell-inner section-rule">
        <h2 className="section-title">{t("places.title")}</h2>
        <p className="use-list">{t("places.list")}</p>
      </section>

      <section className="band">
        <div className="shell-inner band-inner">
          <h2>{t("band.title")}</h2>
          <Link to="/auth?mode=signup" className="btn btn-invert btn-big">
            {t("nav.setup")}
          </Link>
        </div>
      </section>
    </main>
  );
}
