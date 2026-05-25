import { Show, For } from "solid-js";
import { Files } from "./explorer/Files";
import { MapView } from "./explorer/Map";
import { Sessions } from "./explorer/Sessions";
import { sub, setSub, type ExplorerSub } from "../lib/explorerStore";

const SUBS: ExplorerSub[] = ["files", "map", "sessions"];

export function Explorer() {
  return (
    <div class="pr-explorer">
      <div class="pr-subnav">
        <For each={SUBS}>{(s) => (
          <button class={sub() === s ? "is-active" : ""} onClick={() => setSub(s)}>{s}</button>
        )}</For>
      </div>
      <div class="pr-explorer-pane">
        <Show when={sub() === "files"}><Files /></Show>
        <Show when={sub() === "map"}><MapView /></Show>
        <Show when={sub() === "sessions"}><Sessions /></Show>
      </div>
    </div>
  );
}
