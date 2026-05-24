import { type Accessor, type Setter, For } from "solid-js";
export type View = "console" | "cockpit" | "explorer" | "settings";
const VIEWS: View[] = ["console", "cockpit", "explorer", "settings"];
export function ViewSwitcher(props: { view: Accessor<View>; setView: Setter<View> }) {
  return (
    <nav class="pr-nav">
      <For each={VIEWS}>{(v) => (
        <button class={`pr-navlink${props.view() === v ? " is-active" : ""}`} onClick={() => props.setView(v)}>
          {v}
        </button>
      )}</For>
    </nav>
  );
}
