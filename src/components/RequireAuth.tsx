import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api, messageOf } from "../lib/api";
import type { PublicBusiness } from "../lib/types";
import { ErrorState, LoadingState } from "./states";

type Status = "checking" | "signed-in" | "signed-out";

export default function RequireAuth() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");
    api<{ business: PublicBusiness | null }>("/api/auth/me")
      .then((data) => {
        if (!cancelled) setStatus(data.business ? "signed-in" : "signed-out");
      })
      .catch((err) => {
        if (!cancelled) setError(messageOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (status === "checking") return <LoadingState label="Opening your dashboard…" />;

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

  if (status === "signed-out") {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <Outlet />;
}
