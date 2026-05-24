import { type Accessor, type Setter, For } from "solid-js";
import { themedCopy } from "../themes/theme";
export type View = "console" | "cockpit" | "explorer" | "settings";
const VIEWS: View[] = ["console", "cockpit", "explorer", "settings"];
export function ViewSwitcher(props: { view: Accessor<View>; setView: Setter<View> }) {
  return (
    <nav class="pr-nav">
      <For each={VIEWS}>{(v) => (
        <button class={`pr-navlink${props.view() === v ? " is-active" : ""}`} onClick={() => props.setView(v)}>
          {themedCopy()?.nav[v] ?? v}
        </button>
      )}</For>
    </nav>
  );
}
