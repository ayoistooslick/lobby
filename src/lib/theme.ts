export type Theme = "light" | "dark";

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("lobby.theme", theme);
  } catch {
    // Storage can be unavailable in private browsing; the theme still applies.
  }
}

/** Relative brightness of a #rrggbb colour, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const value = hex.replace("#", "");
  if (value.length !== 6) return 0;
  const channels = [0, 2, 4].map((offset) => {
    const part = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Black or white text on a background, whichever stays readable. */
export function readableText(hex: string): string {
  return luminance(hex) > 0.45 ? "#0b0b0c" : "#ffffff";
}

/**
 * Paints a business's colours onto the page and picks readable text for it, so
 * a dark blue brand still gives a legible button in either theme.
 */
export function applyBrand(color: string, accent: string): void {
  const root = document.documentElement;
  if (color) {
    root.style.setProperty("--brand", color);
    root.style.setProperty("--brand-fg", readableText(color));
  }
  if (accent) root.style.setProperty("--brand-accent", accent);
}

export function clearBrand(): void {
  const root = document.documentElement;
  root.style.removeProperty("--brand");
  root.style.removeProperty("--brand-fg");
  root.style.removeProperty("--brand-accent");
}
