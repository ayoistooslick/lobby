import { Link } from "react-router-dom";
import LaunchVideo from "../components/LaunchVideo";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import {
  IconArrow,
  IconBell,
  IconCheck,
  IconClock,
  IconPhone,
  IconQr,
  IconQueue,
  IconShield,
  IconTv,
  IconUserCheck,
  IconUsers,
} from "../components/icons";

export default function Landing() {
  const { t } = useI18n();
  useDocumentTitle("Lobby, simple queues for local businesses");

  return (
    <main className="landing">
      {/* ------------------------------------------------ hero */}
      <section className="hero shell-inner">
        <div className="hero-copy">
          <p className="eyebrow">{t("hero.eyebrow")}</p>
          <h1>{t("hero.h1a")}</h1>
          <p className="lede">{t("hero.lede")}</p>
          <div className="cta-row">
            <Link to="/auth?mode=signup" className="btn btn-primary btn-big">
              {t("nav.setup")}
            </Link>
            <Link to="/demo" className="btn btn-secondary btn-big">
              {t("band.try")}
            </Link>
          </div>
          <div className="hero-badges">
            <span>
              <IconCheck size={16} /> {t("hero.statPhone")}
            </span>
            <span>
              <IconCheck size={16} /> {t("hero.statLive")}
            </span>
            <span>
              <IconCheck size={16} /> {t("hero.fine")}
            </span>
          </div>
        </div>

        {/* Product mock: the staff counter screen, drawn in CSS */}
        <div className="hero-shot" aria-hidden="true">
          <div className="hero-shot-bar">
            <i />
            <i />
            <i />
            <b>Lobby</b>
            <span style={{ marginInline: "auto" }}>Northside Clinic · Front desk</span>
          </div>
          <div className="hero-shot-body">
            <div className="mock-serve">
              <p className="eyebrow">{t("demo.nowServing")}</p>
              <p className="mock-num">A21</p>
              <p className="mock-name">Amara O.</p>
              <span className="mock-btn">{t("how.t3")}</span>
            </div>
            <div className="mock-aside">
              <h3>{t("dash.waitingTitle")}</h3>
              <div className="mock-row is-now">
                <span>A21</span>
                <b>{t("demo.nowServing")}</b>
              </div>
              <div className="mock-row">
                <span>A22</span>
                <b>{t("dash.nextUp")}</b>
              </div>
              <div className="mock-row">
                <span>A23</span>
                <b>2 min</b>
              </div>
              <div className="mock-row">
                <span>A24</span>
                <b>7 min</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ launch film */}
      <section className="section launch-section">
        <div className="shell-inner">
          <LaunchVideo />
        </div>
      </section>

      {/* ------------------------------------------------ workflow */}
      <section className="section tone-soft" id="how">
        <div className="shell-inner">
        <h2 className="section-title">{t("flow.title")}</h2>
        <div className="flow-grid">
          <div className="flow-step">
            <span className="icon-bubble">
              <IconPhone />
            </span>
            <span className="step-num">01</span>
            <h3>{t("flow.s1.t")}</h3>
            <p>{t("flow.s1.d")}</p>
          </div>
          <div className="flow-step">
            <span className="icon-bubble">
              <IconBell />
            </span>
            <span className="step-num">02</span>
            <h3>{t("flow.s2.t")}</h3>
            <p>{t("flow.s2.d")}</p>
          </div>
          <div className="flow-step">
            <span className="icon-bubble">
              <IconClock />
            </span>
            <span className="step-num">03</span>
            <h3>{t("flow.s3.t")}</h3>
            <p>{t("flow.s3.d")}</p>
          </div>
          <div className="flow-step">
            <span className="icon-bubble">
              <IconTv />
            </span>
            <span className="step-num">04</span>
            <h3>{t("flow.s4.t")}</h3>
            <p>{t("flow.s4.d")}</p>
          </div>
        </div>
        </div>
      </section>

      {/* ------------------------------------------------ features */}
      <section className="section">
        <div className="shell-inner">
        <h2 className="section-title">{t("feat.title")}</h2>
        <p className="section-copy">{t("feat.copy")}</p>
        <div className="feat-grid">
          <div className="feat">
            <span className="icon-bubble">
              <IconQr />
            </span>
            <h3>{t("feat.qr.t")}</h3>
            <p>{t("feat.qr.d")}</p>
          </div>
          <div className="feat">
            <span className="icon-bubble">
              <IconQueue />
            </span>
            <h3>{t("feat.multi.t")}</h3>
            <p>{t("feat.multi.d")}</p>
          </div>
          <div className="feat">
            <span className="icon-bubble">
              <IconUsers />
            </span>
            <h3>{t("feat.team.t")}</h3>
            <p>{t("feat.team.d")}</p>
          </div>
          <div className="feat">
            <span className="icon-bubble">
              <IconUserCheck />
            </span>
            <h3>{t("feat.brand.t")}</h3>
            <p>{t("feat.brand.d")}</p>
          </div>
          <div className="feat">
            <span className="icon-bubble">
              <IconShield />
            </span>
            <h3>{t("feat.pause.t")}</h3>
            <p>{t("feat.pause.d")}</p>
          </div>
          <div className="feat">
            <span className="icon-bubble">
              <IconClock />
            </span>
            <h3>{t("feat.reports.t")}</h3>
            <p>{t("feat.reports.d")}</p>
          </div>
        </div>
        </div>
      </section>

      {/* ------------------------------------------------ customer view + display */}
      <section className="section tone-soft">
        <div className="shell-inner">
        <div className="disp-split">
          <div>
            <h2 className="section-title">{t("see.title")}</h2>
            <p className="section-copy">{t("see.copy")}</p>
            <ul className="demo-lines">
              <li>
                <span>{t("see.youreNumber")}</span>
                <strong>24</strong>
              </li>
              <li>
                <span>{t("see.peopleAhead")}</span>
                <strong>3</strong>
              </li>
              <li className="demo-turn">
                <span>{t("see.when")}</span>
                <strong>{t("see.itsTurn")}</strong>
              </li>
            </ul>
          </div>
          <div className="disp-shot" aria-hidden="true">
            <p className="eyebrow">{t("disp.nowServing")}</p>
            <p className="disp-shot-num">A21</p>
            <div className="disp-shot-rows">
              <div>
                <span>A22 · {t("dash.nextUp")}</span>
                <span>A23</span>
              </div>
              <div>
                <span>A24</span>
                <span>A25</span>
              </div>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* ------------------------------------------------ display section */}
      <section className="section">
        <div className="shell-inner">
        <div className="disp-split">
          <div className="disp-shot" aria-hidden="true">
            <p className="eyebrow">{t("dispsect.title")}</p>
            <p className="disp-shot-num">B07</p>
            <div className="disp-shot-rows">
              <div>
                <span>{t("disp.waiting")}</span>
                <span>5</span>
              </div>
              <div>
                <span>{t("dash.avgWait", { n: 4 })}</span>
                <span>{t("common.live")}</span>
              </div>
            </div>
          </div>
          <div>
            <h2 className="section-title">{t("dispsect.title")}</h2>
            <p className="section-copy">{t("dispsect.copy")}</p>
            <div className="cta-row" style={{ marginTop: 20 }}>
              <Link to="/demo" className="btn btn-secondary">
                {t("dispsect.cta")}
                <IconArrow size={17} />
              </Link>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* ------------------------------------------------ places */}
      <section className="section tone-soft">
        <div className="shell-inner">
        <h2 className="section-title">{t("places.title")}</h2>
        <div className="places-strip">
          {t("places.list")
            .split("·")
            .map((place) => (
              <span key={place.trim()}>{place.trim()}</span>
            ))}
        </div>
        </div>
      </section>

      {/* ------------------------------------------------ final CTA */}
      <section className="band">
        <div className="shell-inner band-inner">
          <h2>{t("band.title")}</h2>
          <p>{t("band.body")}</p>
          <div className="cta-row">
            <Link to="/auth?mode=signup" className="btn btn-invert btn-big">
              {t("nav.setup")}
            </Link>
            <Link to="/demo" className="link-button">
              {t("band.try")}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

