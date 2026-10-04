import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocumentTitle } from "../lib/hooks";
import type { PublicBusiness } from "../lib/types";

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: "text" | "email";
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

export default function Auth() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "signup" ? "signup" : "login";
  const rawReturn = params.get("returnTo") ?? "";
  const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/dashboard";

  const navigate = useNavigate();
  const isSignup = mode === "signup";
  const { t } = useI18n();

  useDocumentTitle(isSignup ? "Set up your business, Lobby" : "Sign in, Lobby");

  const [alreadyIn, setAlreadyIn] = useState(false);
  const [form, setForm] = useState({ businessName: "", ownerName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ business: PublicBusiness | null }>("/api/auth/me")
      .then((data) => {
        if (!cancelled && data.business) setAlreadyIn(true);
      })
      .catch(() => {
        // The form still works if this check fails; the server validates on submit.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (alreadyIn) return <Navigate to={returnTo} replace />;

  function setField(key: keyof typeof form) {
    return (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function switchMode(next: "signup" | "login") {
    setParams({ mode: next, returnTo }, { replace: true });
    setError(null);
  }

  function checkInputs(): string | null {
    if (isSignup && form.businessName.trim().length < 2) return t("err.bizName");
    if (isSignup && form.ownerName.trim().length < 2) return t("err.name");
    if (!form.email.trim()) return t("err.email");
    if (!form.password) return t("err.password");
    if (isSignup && form.password.length < 8) return t("err.pwLen");
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = checkInputs();
    if (problem) {
      setError(problem);
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
