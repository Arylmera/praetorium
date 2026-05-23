import { createSignal, Show, For } from "solid-js";
import { Files } from "./explorer/Files";
import { MapView } from "./explorer/Map";
import { Sessions } from "./explorer/Sessions";

type Sub = "files" | "map" | "sessions";
const SUBS: Sub[] = ["files", "map", "sessions"];

export function Explorer() {
  const [sub, setSub] = createSignal<Sub>("files");
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div style={{ display: "flex", gap: "4px", padding: "6px 10px", "border-bottom": "1px solid var(--border)" }}>
        <For each={SUBS}>{(s) => (
          <button onClick={() => setSub(s)} style={{
            background: sub() === s ? "var(--accent)" : "var(--panel)",
            color: sub() === s ? "var(--bg)" : "var(--fg)",
            border: "1px solid var(--border)", padding: "3px 10px", "text-transform": "capitalize" }}>{s}</button>
        )}</For>
      </div>
      <div style={{ flex: "1", "min-height": "0" }}>
        <Show when={sub() === "files"}><Files /></Show>
        <Show when={sub() === "map"}><MapView /></Show>
        <Show when={sub() === "sessions"}><Sessions /></Show>
      </div>
    </div>
  );
}
