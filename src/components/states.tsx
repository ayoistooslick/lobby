import { useI18n } from "../lib/i18n";
import type { Connection } from "../lib/hooks";

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="page-state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? t("common.loading")}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="page-state error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {body && <p className="muted">{body}</p>}
    </div>
  );
}

/** A quiet strip that explains why the screen may be a moment behind. */
export function ConnectionBar({ state }: { state: Connection }) {
  const { t } = useI18n();
  if (state === "live") {
    return (
      <p className="conn conn-live" role="status">
        <span className="conn-dot" aria-hidden="true" />
        {t("common.live")}
      </p>
    );
  }
  if (state === "connecting") {
    return (
      <p className="conn conn-warn" role="status">
        <span className="conn-dot" aria-hidden="true" />
        {t("common.reconnecting")}
      </p>
    );
  }
  return (
    <p className="conn conn-warn" role="status">
      <span className="conn-dot" aria-hidden="true" />
      {t("common.offline")}
    </p>
  );
}