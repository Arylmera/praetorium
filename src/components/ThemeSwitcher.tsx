import { createSignal } from "solid-js";
import { THEMES, getTheme, setTheme, type Theme } from "../themes/theme";

export function ThemeSwitcher() {
  const [current, setCurrent] = createSignal<Theme>(getTheme());
  setTheme(current()); // apply on mount
  return (
    <select
      value={current()}
      onChange={(e) => { const t = e.currentTarget.value as Theme; setCurrent(t); setTheme(t); }}
    >
      {THEMES.map((t) => <option value={t}>{t}</option>)}
    </select>
  );
}
