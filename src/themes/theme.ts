export const THEMES = ["imperial", "cockpit", "terminal"] as const;
export type Theme = (typeof THEMES)[number];
const KEY = "praetorium.theme";

export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  return THEMES.includes(stored as Theme) ? (stored as Theme) : "imperial";
}
export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(KEY, theme);
}
