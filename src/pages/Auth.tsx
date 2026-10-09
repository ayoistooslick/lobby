import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { PublicBusiness, StaffRole, TemplateInfo } from "../lib/types";

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel";
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

function Field({ id, label, hint, ...input }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={input.type ?? "text"}
        value={input.value}
        onChange={(event) => input.onChange(event.target.value)}
        autoComplete={input.autoComplete}
        inputMode={input.inputMode}
        placeholder={input.placeholder}
        required={input.required}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface InvitePreview {
  email: string;
  name: string;
  role: StaffRole;
  businessName: string;
  branchName: string;
}

export default function Auth() {
  const [params, setParams] = useSearchParams();
  const { token } = useParams();
  const mode = params.get("mode") === "signup" ? "signup" : "login";
  const rawReturn = params.get("returnTo") ?? "";
  const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/dashboard";

  const navigate = useNavigate();
  const isSignup = mode === "signup";
  const isInvite = Boolean(token);
  const { t } = useI18n();

  useDocumentTitle(isInvite ? t("auth.inviteTitle") : isSignup ? "Set up your business, Lobby" : "Sign in, Lobby");

  const [alreadyIn, setAlreadyIn] = useState(false);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [form, setForm] = useState({
    businessName: "",
    ownerName: "",
    name: "",
    email: "",
    password: "",
    branchName: "",
    template: "generic",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ business: PublicBusiness | null }>("/api/auth/me")
      .then((data) => {
        if (!cancelled && data.business && !isInvite) setAlreadyIn(true);
      })
      .catch(() => {
        // The form still works if this check fails. The server validates on submit.
      });
    api<{ templates: TemplateInfo[] }>("/api/auth/templates")
      .then((data) => {
        if (!cancelled) setTemplates(data.templates);
      })
      .catch(() => {
        // The generic template is used when this list cannot load.
      });
    return () => {
      cancelled = true;
    };
  }, [isInvite]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<{ invite: InvitePreview }>(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then((data) => {
        if (cancelled) return;
        setInvite(data.invite);
        setForm((prev) => ({ ...prev, name: data.invite.name, email: data.invite.email }));
      })
      .catch((err) => {
        if (!cancelled) setInviteError(messageOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (alreadyIn) return <Navigate to={returnTo} replace />;

  function setField(key: keyof typeof form) {
    return (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function switchMode(next: "signup" | "login") {
    setParams({ mode: next, returnTo }, { replace: true });
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (isInvite) {
      if (form.name.trim().length < 2) {
        setError(t("err.name"));
        return;
      }
      if (form.password.length < 8) {
        setError(t("err.pwLen"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await api(`/api/auth/invite/${encodeURIComponent(token ?? "")}`, {
          method: "POST",
          body: { name: form.name, password: form.password },
        });
        navigate("/dashboard", { replace: true });
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isSignup && form.businessName.trim().length < 2) {
      setError(t("err.bizName"));
      return;
    }
    if (isSignup && form.ownerName.trim().length < 2) {
      setError(t("err.name"));
      return;
    }
    if (!form.email.trim()) {
      setError(t("err.email"));
      return;
    }
    if (!form.password) {
      setError(t("err.password"));
      return;
    }
    if (isSignup && form.password.length < 8) {
      setError(t("err.pwLen"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (isSignup) {
        await api("/api/auth/signup", {
          method: "POST",
          body: {
            businessName: form.businessName,
            ownerName: form.ownerName,
            email: form.email,
            password: form.password,
            template: form.template,
            branchName: form.branchName,
          },
        });
      } else {
        await api("/api/auth/login", { method: "POST", body: { email: form.email, password: form.password } });
      }
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (isInvite) {
    return (
      <main className="page auth-page">
        <div className="auth-panel">
          <h1>{t("auth.inviteTitle")}</h1>
          {inviteError ? (
            <>
              <p className="form-error" role="alert">
                {inviteError || t("auth.inviteBad")}
              </p>
              <Link to="/auth?mode=login" className="btn btn-secondary">
                {t("nav.signin")}
              </Link>
            </>
          ) : invite ? (
            <>
              <p className="auth-sub">
                {t("auth.inviteBody", {
                  business: invite.businessName,
                  role: invite.role,
                })}
                {invite.branchName ? ` · ${invite.branchName}` : ""}
              </p>
              <form onSubmit={submit} noValidate>
                <Field
                  id="name"
                  label={t("auth.yourName")}
                  value={form.name}
                  onChange={setField("name")}
                  autoComplete="name"
                  required
                />
                <Field
                  id="password"
                  label={t("auth.password")}
                  value={form.password}
                  onChange={setField("password")}
                  type="password"
                  autoComplete="new-password"
                  hint={t("auth.pwHint")}
                  required
                />
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" className="btn btn-primary btn-big btn-block" disabled={busy}>
                  {busy ? t("auth.creating") : t("auth.joinTeam")}
                </button>
              </form>
            </>
          ) : (
            <p className="muted">…</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="page auth-page">
      <div className="auth-panel">
        <h1>{isSignup ? t("nav.setup") : t("auth.welcome")}</h1>
        <p className="auth-sub">{isSignup ? t("auth.setupSub") : t("auth.loginSub")}</p>

        <form onSubmit={submit} noValidate>
          {isSignup && (
            <>
              <Field
                id="businessName"
                label={t("auth.bizName")}
                value={form.businessName}
                onChange={setField("businessName")}
                placeholder="e.g. Bright Care Pharmacy"
                autoComplete="organization"
                required
              />
              <Field
                id="ownerName"
                label={t("auth.yourName")}
                value={form.ownerName}
                onChange={setField("ownerName")}
                placeholder="e.g. Ada"
                autoComplete="name"
                required
              />

              <fieldset className="template-field">
                <legend>{t("auth.shopType")}</legend>
                <p className="field-hint">{t("auth.shopTypeHint")}</p>
                <div className="chip-row">
                  {templates.map((template) => (
                    <button
                      key={template.key}
                      type="button"
                      className={form.template === template.key ? "chip active" : "chip"}
                      aria-pressed={form.template === template.key}
                      onClick={() => setField("template")(template.key)}
                    >
                      <strong>{template.label}</strong>
                      <span className="muted">{template.blurb}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <Field
                id="branchName"
                label={t("auth.branchName")}
                value={form.branchName}
                onChange={setField("branchName")}
                placeholder={t("auth.branchName")}
              />
            </>
          )}
          <Field
            id="email"
            label={t("auth.email")}
            value={form.email}
            onChange={setField("email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
          />
          <Field
            id="password"
            label={t("auth.password")}
            value={form.password}
            onChange={setField("password")}
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            hint={isSignup ? t("auth.pwHint") : undefined}
            required
          />

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary btn-big btn-block" disabled={busy}>
            {busy
              ? isSignup
                ? t("auth.creating")
                : t("auth.signingIn")
              : isSignup
                ? t("auth.create")
                : t("nav.signin")}
          </button>
        </form>

        <p className="auth-switch">
          {isSignup ? (
            <>
              {t("auth.haveAccount")}{" "}
              <button type="button" className="link-button" onClick={() => switchMode("login")}>
                {t("nav.signin")}
              </button>
            </>
          ) : (
            <>
              {t("auth.noAccount")}{" "}
              <button type="button" className="link-button" onClick={() => switchMode("signup")}>
                {t("nav.setup")}
              </button>
            </>
          )}
        </p>
        <p>
          <Link to="/" className="link-button">
            ← {t("auth.backHome")}
          </Link>
        </p>
      </div>
    </main>
  );
}