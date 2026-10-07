import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../lib/i18n";
import { applyTheme, currentTheme, type Theme } from "../lib/theme";

/** One icon in the header that flips between light and dark. */
export default function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label={t("theme.toggle")}
      title={t("theme.toggle")}
      onClick={toggle}
    >
      {theme === "light" ? (
        <Sun size={17} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Moon size={17} strokeWidth={1.8} aria-hidden="true" />
      )}
    </button>
  );
}
