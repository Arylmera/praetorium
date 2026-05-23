import { type Accessor, type Setter, For } from "solid-js";
export type View = "console" | "cockpit" | "reader";
const VIEWS: View[] = ["console", "cockpit", "reader"];
export function ViewSwitcher(props: { view: Accessor<View>; setView: Setter<View> }) {
  return (
    <div style={{ display: "flex", gap: "4px" }}>
      <For each={VIEWS}>{(v) => (
        <button onClick={() => props.setView(v)}
          style={{ background: props.view() === v ? "var(--accent)" : "var(--panel)",
                   color: props.view() === v ? "var(--bg)" : "var(--fg)",
                   border: "1px solid var(--border)", padding: "4px 10px", "text-transform": "capitalize" }}>
          {v}
        </button>
      )}</For>
    </div>
  );
}
