import { createResource, createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import { resolveWikilinks } from "../../lib/wikilinks";
import { buildLinkMaps } from "../../lib/vaultLinks";
import { vaultPath } from "../../lib/vaultStore";
import { buildTree, flattenVisible } from "../../lib/fileTree";
import { pendingNote, clearPendingNote } from "../../lib/explorerStore";
import type { VaultFile, NoteLinks } from "../../lib/types";

type Sort = "name" | "modified" | "size";

export function Files() {
  const [files] = createResource(vaultPath, async (vp) => {
    if (!vp) return [] as VaultFile[];
    try { return await invoke<VaultFile[]>("vault_index", { vaultPath: vp }); }
    catch { return [] as VaultFile[]; }
  });
  const [links] = createResource(vaultPath, async (vp) => {
    if (!vp) return [] as NoteLinks[];
    try { return await invoke<NoteLinks[]>("vault_links", { vaultPath: vp }); }
    catch { return [] as NoteLinks[]; }
  });

  const [html, setHtml] = createSignal("");
  const [err, setErr] = createSignal("");
  const [activeRel, setActiveRel] = createSignal("");
  const [q, setQ] = createSignal("");
  const [sort, setSort] = createSignal<Sort>("name");
  // "expanded" = set of folder paths currently open in the tree
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set<string>());

  const index = () => new Map((files() ?? []).map((f) => [f.name.toLowerCase(), f.rel]));
  const nameByRel = () => new Map((files() ?? []).map((f) => [f.rel, f.name]));
  const maps = createMemo(() => buildLinkMaps(links() ?? []));
  const backlinks = createMemo(() => maps().backward.get(activeRel()) ?? []);
  const outlinks = createMemo(() => maps().forward.get(activeRel()) ?? []);
  const isOrphan = (rel: string) =>
    (maps().forward.get(rel)?.length ?? 0) === 0 && (maps().backward.get(rel)?.length ?? 0) === 0;

  // Vault changed: reset selection + open state.
  createEffect(() => { vaultPath(); setActiveRel(""); setHtml(""); setErr(""); setExpanded(new Set<string>()); });

  // Map (or anything) requested a note: open it + expand its ancestor folders.
  createEffect(() => {
    const rel = pendingNote();
    if (!rel) return;
    const segs = rel.replace(/\\/g, "/").split("/"); segs.pop();
    setExpanded((prev) => {
      const next = new Set<string>(prev); let acc = "";
      for (const s of segs) { acc = acc ? `${acc}/${s}` : s; next.add(acc); }
      return next;
    });
    open(rel);
    clearPendingNote();
  });

  const filtered = createMemo(() => {
    const needle = q().toLowerCase();
    const all = files() ?? [];
    if (!needle) return all;
    return all.filter((f) => f.name.toLowerCase().includes(needle) || f.rel.toLowerCase().includes(needle));
  });

  // When searching, force-expand every folder so matches are visible.
  const tree = createMemo(() => buildTree(filtered()));
  const rows = createMemo(() => {
    const t = tree();
    if (q()) {
      const allFolders = new Set<string>();
      const collect = (n: ReturnType<typeof buildTree>) => { for (const sub of n.folders) { allFolders.add(sub.path); collect(sub); } };
      collect(t);
      return flattenVisible(t, allFolders);
    }
    return flattenVisible(t, expanded());
  });

  function toggle(path: string) {
    setExpanded((prev) => { const next = new Set<string>(prev); next.has(path) ? next.delete(path) : next.add(path); return next; });
  }

  const sizeByRel = () => new Map((files() ?? []).map((f) => [f.rel, (f as any).size ?? 0]));
  const wordCount = createMemo(() => {
    const text = html().replace(/<[^>]+>/g, " ");
    const m = text.match(/\S+/g);
    return m ? m.length : 0;
  });
  const breadcrumb = () => activeRel().replace(/\\/g, "/").split("/");

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
          <div class="pr-sort" role="group" aria-label="Sort">
            <button class={sort() === "name" ? "is-active" : ""} onClick={() => setSort("name")}>name</button>
            <button class={sort() === "modified" ? "is-active" : ""} onClick={() => setSort("modified")}>mod</button>
            <button class={sort() === "size" ? "is-active" : ""} onClick={() => setSort("size")}>size</button>
          </div>
        </div>
        <div class="pr-files-scroll">
          <For each={rows()}>{(r) => (
            <Show
              when={r.kind === "folder"}
              fallback={
                <div class={`pr-file${r.id === activeRel() ? " is-active" : ""}`} style={{ "padding-left": `${8 + r.depth * 14}px` }} onClick={() => open(r.id)} title={r.id}>
                  <span>{r.name}</span>
                  <span class="pr-file-tail">
                    <Show when={isOrphan(r.id)}><span class="pr-orphan" title="no links in or out">○</span></Show>
                    <Show when={sizeByRel().get(r.id)}><span class="size">{(sizeByRel().get(r.id)! / 1024).toFixed(1)}k</span></Show>
                  </span>
                </div>
              }
            >
              <div class="pr-folder" style={{ "padding-left": `${8 + r.depth * 14}px` }} onClick={() => toggle(r.id)}>
                <span class="pr-folder-chevron">{expanded().has(r.id) || q() ? "▾" : "▸"}</span>
                <span class="pr-folder-name">{r.name}</span>
                <span class="pr-folder-count">{r.count}</span>
              </div>
            </Show>
          )}</For>
        </div>
      </aside>
      <article class="pr-doc" onClick={onContentClick}>
        <Show when={!err()} fallback={<pre style={{ color: "var(--bad)" }}>{err()}</pre>}>
          <Show when={html()} fallback={<p class="muted">Select a note to read it.</p>}>
            <nav class="pr-breadcrumb">
              <For each={breadcrumb()}>{(seg, i) => (
                <>
                  <Show when={i() > 0}><span class="pr-crumb-sep">/</span></Show>
                  <span class="pr-crumb">{seg}</span>
                </>
              )}</For>
            </nav>
            <div class="pr-note-meta">
              <span>{wordCount()} words</span>
              <span>{backlinks().length} backlinks</span>
              <span>{outlinks().length} links out</span>
            </div>
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
