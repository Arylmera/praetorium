import { createResource, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import { resolveWikilinks } from "../../lib/wikilinks";
import type { VaultFile } from "../../lib/types";

const VAULT = "C:\\Users\\guill\\Documents\\git\\Terra";

export function Files() {
  const [files] = createResource(async () => {
    try { return await invoke<VaultFile[]>("vault_index", { vaultPath: VAULT }); }
    catch { return [] as VaultFile[]; }
  });
  const index = () => new Map((files() ?? []).map((f) => [f.name.toLowerCase(), f.rel]));
  const [html, setHtml] = createSignal("");
  const [err, setErr] = createSignal("");

  async function open(rel: string) {
    setErr("");
    try {
      const md = await invoke<string>("read_vault_file", { path: `${VAULT}\\${rel.replace(/\//g, "\\")}` });
      setHtml(resolveWikilinks(await marked.parse(md), index()));
    } catch (e) { setErr(String(e)); }
  }
  function onContentClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.classList.contains("wikilink")) { e.preventDefault(); const rel = t.getAttribute("data-rel"); if (rel) open(rel); }
  }

  return (
    <div style={{ display: "grid", "grid-template-columns": "260px 1fr", height: "100%" }}>
      <div style={{ overflow: "auto", "border-right": "1px solid var(--border)", padding: "8px" }}>
        <For each={files() ?? []}>{(f) => (
          <div onClick={() => open(f.rel)} style={{ cursor: "pointer", padding: "2px 4px", color: "var(--fg)", "font-size": "12px" }}
            title={f.rel}>{f.name}</div>
        )}</For>
      </div>
      <div style={{ overflow: "auto", padding: "14px" }} onClick={onContentClick}>
        <Show when={!err()} fallback={<pre style={{ color: "tomato" }}>{err()}</pre>}>
          <div innerHTML={html()} />
        </Show>
      </div>
    </div>
  );
}
