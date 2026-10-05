import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { applyTheme, currentTheme, type Theme } from "../lib/theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  function choose(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      <button
        type="button"
        aria-pressed={theme === "light"}
        className={theme === "light" ? "active" : ""}
        onClick={() => choose("light")}
      >
        <Sun size={18} strokeWidth={1.9} aria-hidden="true" />
        <span>Light</span>
      </button>
      <button
        type="button"
        aria-pressed={theme === "dark"}
        className={theme === "dark" ? "active" : ""}
        onClick={() => choose("dark")}
      >
        <Moon size={18} strokeWidth={1.9} aria-hidden="true" />
        <span>Dark</span>
      </button>
    </div>
  );
}
