import { createResource, createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import { resolveWikilinks } from "../../lib/wikilinks";
import { buildLinkMaps } from "../../lib/vaultLinks";
import { vaultPath } from "../../lib/vaultStore";
import type { VaultFile, NoteLinks } from "../../lib/types";

const folderOf = (rel: string) => {
  const i = rel.replace(/\\/g, "/").lastIndexOf("/");
  return i < 0 ? "root" : rel.replace(/\\/g, "/").slice(0, i).replace(/\//g, " / ");
};

export function Files() {
  const [files] = createResource(vaultPath, async (vp) => {
    try { return await invoke<VaultFile[]>("vault_index", { vaultPath: vp }); }
    catch { return [] as VaultFile[]; }
  });
  const [links] = createResource(vaultPath, async (vp) => {
    try { return await invoke<NoteLinks[]>("vault_links", { vaultPath: vp }); }
    catch { return [] as NoteLinks[]; }
  });
  const [html, setHtml] = createSignal("");
  const [err, setErr] = createSignal("");
  const [activeRel, setActiveRel] = createSignal("");
  const [q, setQ] = createSignal("");

  const index = () => new Map((files() ?? []).map((f) => [f.name.toLowerCase(), f.rel]));
  const nameByRel = () => new Map((files() ?? []).map((f) => [f.rel, f.name]));
  const backward = createMemo(() => buildLinkMaps(links() ?? []).backward);
  const backlinks = createMemo(() => backward().get(activeRel()) ?? []);

  // Vault changed: drop the open note / selection so we don't show a stale doc.
  createEffect(() => { vaultPath(); setActiveRel(""); setHtml(""); setErr(""); });

  // Group files by top-level folder, honouring the search filter.
  const grouped = createMemo(() => {
    const needle = q().toLowerCase();
    const groups = new Map<string, VaultFile[]>();
    for (const f of files() ?? []) {
      if (needle && !f.name.toLowerCase().includes(needle) && !f.rel.toLowerCase().includes(needle)) continue;
      const k = folderOf(f.rel);
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
    }
    return [...groups.entries()];
  });

  async function open(rel: string) {
    setErr(""); setActiveRel(rel);
    try {
      const md = await invoke<string>("read_vault_file", { path: `${vaultPath()}\\${rel.replace(/\//g, "\\")}` });
      setHtml(resolveWikilinks(await marked.parse(md), index()));
    } catch (e) { setErr(String(e)); }
  }
  function onContentClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.classList.contains("wikilink")) { e.preventDefault(); const rel = t.getAttribute("data-rel"); if (rel) open(rel); }
  }

  return (
    <div class="pr-files-grid">
      <aside class="pr-files-list">
        <div class="pr-files-search">
          <input class="pr-search-input" placeholder="grep vault…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
        </div>
        <div class="pr-files-scroll">
          <For each={grouped()}>{([folder, items]) => (
            <>
              <div class="pr-folder">{folder}</div>
              <For each={items}>{(f) => (
                <div class={`pr-file${f.rel === activeRel() ? " is-active" : ""}`} onClick={() => open(f.rel)} title={f.rel}>
                  <span>{f.name}</span>
                  <Show when={(f as any).size}><span class="size">{((f as any).size / 1024).toFixed(1)}k</span></Show>
                </div>
              )}</For>
            </>
          )}</For>
        </div>
      </aside>
      <article class="pr-doc" onClick={onContentClick}>
        <Show when={!err()} fallback={<pre style={{ color: "var(--bad)" }}>{err()}</pre>}>
          <Show when={html()} fallback={<p class="muted">Select a note to read it.</p>}>
            <div innerHTML={html()} />
            <Show when={activeRel()}>
              <section class="pr-backlinks">
                <div class="pr-backlinks-head">Linked references</div>
                <Show when={backlinks().length} fallback={<div class="pr-backlinks-empty">No linked references.</div>}>
                  <div class="pr-backlinks-list">
                    <For each={backlinks()}>{(rel) => (
                      <span class="pr-backlink" onClick={() => open(rel)} title={rel}>{nameByRel().get(rel) ?? rel}</span>
                    )}</For>
                  </div>
                </Show>
              </section>
            </Show>
          </Show>
        </Show>
      </article>
    </div>
  );
}
