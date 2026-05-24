import { For } from "solid-js";
import { themedCopy } from "../themes/theme";
import { view, setView } from "../lib/viewStore";
export type View = "console" | "cockpit" | "explorer" | "settings";
const VIEWS: View[] = ["console", "cockpit", "explorer", "settings"];
export function ViewSwitcher() {
  return (
    <nav class="pr-nav">
      <For each={VIEWS}>{(v) => (
        <button class={`pr-navlink${view() === v ? " is-active" : ""}`} onClick={() => setView(v)}>
          {themedCopy()?.nav[v] ?? v}
        </button>
      )}</For>
    </nav>
  );
}
