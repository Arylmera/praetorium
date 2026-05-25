# Explorer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Praetorium explorer hierarchical (tree + breadcrumb), make the map portable to any vault (live wikilink graph only), and group Claude Code sessions by the folder they ran in — while removing all hardcoded Terra paths.

**Architecture:** Pure, unit-tested helpers in `src/lib/*` (`fileTree`, `linksGraph`, `sessions` grouping) feed thin SolidJS components (`Files`, `Map`, `Sessions`). A small `explorerStore` enables map→files cross-navigation. The Rust backend gains `list_all_sessions` that scans `~/.claude/projects`, tagging each session with the `cwd` read from its transcript. Pre-baked `_Cartographicum` artifacts and their code are deleted.

**Tech Stack:** SolidJS, TypeScript, Vitest (frontend tests via `npm test`), Rust + Tauri 2 (backend tests via `cargo test` in `src-tauri`).

Spec: [docs/superpowers/specs/2026-05-25-explorer-redesign-design.md](../specs/2026-05-25-explorer-redesign-design.md)

---

## File structure

**Create**
- `src/lib/fileTree.ts` — pure: build a nested folder tree from `VaultFile[]`, flatten for rendering.
- `src/lib/fileTree.test.ts`
- `src/lib/linksGraph.ts` — pure: wikilink adjacency → `GraphState`, tagged by folder, weighted by degree (extracted from `Map.tsx`).
- `src/lib/linksGraph.test.ts`
- `src/lib/sessions.ts` — pure: `groupByLocation` + `relativeTime` helpers. (NOTE: a `watchSessions` already lives in this repo — see Task 8 for the exact filename to avoid a clash.)
- `src/lib/sessionGroup.test.ts`
- `src/lib/explorerStore.ts` — shared `sub` view signal + `openNote(rel)` for map→files navigation.

**Modify**
- `src/components/explorer/Files.tsx` — tree sidebar + breadcrumb + metadata header + orphan badge + sort.
- `src/components/explorer/Map.tsx` — single live-links mode; folder color; degree size; hover highlight; click→open.
- `src/components/explorer/Sessions.tsx` — grouped-by-location list.
- `src/components/Explorer.tsx` — use shared `sub` signal from `explorerStore`.
- `src/lib/vaultStore.ts` — drop Terra default.
- `src/lib/vaultStore.test.ts` — update for empty default.
- `src/App.tsx` — derive prompt path + status-bar vault name from `vaultPath()`.
- `src/themes/tokens.css` — new `pr-*` classes for tree rows, breadcrumb, metadata, session groups.
- `src-tauri/src/sessions.rs` — `location`/`projectDir` fields + `list_all_sessions` + `cwd` extraction.
- `src-tauri/src/lib.rs` — register `list_all_sessions`; drop `read_cartographicum`/`read_folder_graph`.
- `src-tauri/src/vault.rs` — remove `read_cartographicum` + `read_folder_graph`.

**Delete**
- `src/lib/cartographicum.ts`, `src/lib/cartographicum.test.ts`
- `src/lib/folderGraph.ts`, `src/lib/folderGraph.test.ts`

---

## Resolved open questions (from the spec)

1. **vaultStore default** → empty string (`""`). No hardcoded path. Components already `try/catch` empty/failed invokes and render their empty states, so an empty vault degrades gracefully.
2. **Session message count** → DEFERRED (phase 2). Phase 1 ships `mtime`-based relative "last active" only, avoiding a full parse of every transcript across every project.
3. **`read_folder_graph` / `parseFolderGraph` consumers** → confirmed: only `Map.tsx` and the deleted tests. Safe to remove `folderGraph.ts` and `cartographicum.ts` entirely.

---

# GROUP A — Explorer hierarchy

## Task 1: `lib/fileTree.ts` — pure tree builder

**Files:**
- Create: `src/lib/fileTree.ts`
- Test: `src/lib/fileTree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/fileTree.test.ts
import { describe, it, expect } from "vitest";
import { buildTree, flattenVisible } from "./fileTree";
import type { VaultFile } from "./types";

const f = (rel: string): VaultFile => ({ rel, name: rel.split("/").pop()!, dir: "" });

describe("buildTree", () => {
  it("nests files under their folder segments", () => {
    const root = buildTree([f("a/b/x.md"), f("a/y.md"), f("z.md")]);
    expect(root.files.map((x) => x.name)).toEqual(["z.md"]);
    const a = root.folders.find((x) => x.name === "a")!;
    expect(a.files.map((x) => x.name)).toEqual(["y.md"]);
    const b = a.folders.find((x) => x.name === "b")!;
    expect(b.files.map((x) => x.name)).toEqual(["x.md"]);
    expect(b.path).toBe("a/b");
  });

  it("counts all descendant files per folder", () => {
    const root = buildTree([f("a/b/x.md"), f("a/y.md")]);
    const a = root.folders.find((x) => x.name === "a")!;
    expect(a.count).toBe(2);
  });

  it("sorts folders before files, each alphabetically", () => {
    const root = buildTree([f("b.md"), f("a.md"), f("z/c.md")]);
    expect(root.folders.map((x) => x.name)).toEqual(["z"]);
    expect(root.files.map((x) => x.name)).toEqual(["a.md", "b.md"]);
  });

  it("normalizes backslash separators", () => {
    const root = buildTree([{ rel: "a\\b.md", name: "b.md", dir: "" }]);
    expect(root.folders[0].name).toBe("a");
  });
});

describe("flattenVisible", () => {
  it("shows only top level when nothing is open", () => {
    const root = buildTree([f("a/x.md"), f("z.md")]);
    const rows = flattenVisible(root, new Set());
    expect(rows.map((r) => r.id)).toEqual(["a", "z.md"]);
    expect(rows.find((r) => r.id === "a")!.depth).toBe(0);
  });

  it("expands an open folder's children with incremented depth", () => {
    const root = buildTree([f("a/x.md")]);
    const rows = flattenVisible(root, new Set(["a"]));
    expect(rows.map((r) => r.id)).toEqual(["a", "a/x.md"]);
    expect(rows.find((r) => r.id === "a/x.md")!.depth).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fileTree`
Expected: FAIL — `buildTree`/`flattenVisible` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/fileTree.ts
import type { VaultFile } from "./types";

export interface TreeFile { kind: "file"; name: string; rel: string }
export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;            // forward-slash path, "" for root
  folders: TreeFolder[];
  files: TreeFile[];
  count: number;           // total descendant files
}

const norm = (s: string) => s.replace(/\\/g, "/");

export function buildTree(files: VaultFile[]): TreeFolder {
  const root: TreeFolder = { kind: "folder", name: "", path: "", folders: [], files: [], count: 0 };
  for (const file of files) {
    const parts = norm(file.rel).split("/").filter(Boolean);
    const fileName = parts.pop()!;
    let node = root;
    for (const seg of parts) {
      let next = node.folders.find((x) => x.name === seg);
      if (!next) {
        next = { kind: "folder", name: seg, path: node.path ? `${node.path}/${seg}` : seg, folders: [], files: [], count: 0 };
        node.folders.push(next);
      }
      node = next;
    }
    node.files.push({ kind: "file", name: fileName, rel: norm(file.rel) });
  }
  const finish = (n: TreeFolder): number => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => a.name.localeCompare(b.name));
    let c = n.files.length;
    for (const sub of n.folders) c += finish(sub);
    n.count = c;
    return c;
  };
  finish(root);
  return root;
}

export interface Row {
  kind: "folder" | "file";
  id: string;              // folder.path or file.rel — unique
  name: string;
  depth: number;
  count?: number;          // folders only
}

export function flattenVisible(root: TreeFolder, open: Set<string>): Row[] {
  const rows: Row[] = [];
  const walk = (node: TreeFolder, depth: number) => {
    for (const folder of node.folders) {
      rows.push({ kind: "folder", id: folder.path, name: folder.name, depth, count: folder.count });
      if (open.has(folder.path)) walk(folder, depth + 1);
    }
    for (const file of node.files) {
      rows.push({ kind: "file", id: file.rel, name: file.name, depth });
    }
  };
  walk(root, 0);
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fileTree`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileTree.ts src/lib/fileTree.test.ts
git commit -m "feat(explorer): add pure file-tree builder"
```

---

## Task 2: `explorerStore.ts` — shared sub-view + note open signal

**Files:**
- Create: `src/lib/explorerStore.ts`

(No test: trivial signal store, mirrors existing `viewStore.ts`/`vaultStore.ts` pattern which are covered indirectly.)

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/explorerStore.ts
import { createSignal } from "solid-js";

export type ExplorerSub = "files" | "map" | "sessions";

const [sub, setSub] = createSignal<ExplorerSub>("files");
const [pendingNote, setPendingNote] = createSignal<string>("");

export { sub, setSub, pendingNote };

/** Switch to the Files sub-view and request that note be opened. */
export function openNote(rel: string) {
  setPendingNote(rel);
  setSub("files");
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `explorerStore.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/explorerStore.ts
git commit -m "feat(explorer): add shared sub-view + openNote store"
```

---

## Task 3: Wire `Explorer.tsx` to the shared sub signal

**Files:**
- Modify: `src/components/Explorer.tsx`

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `src/components/Explorer.tsx` with:

```tsx
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Explorer.tsx
git commit -m "refactor(explorer): drive sub-view from shared store"
```

---

## Task 4: Rewrite `Files.tsx` — tree, breadcrumb, metadata, orphan badge, sort

**Files:**
- Modify: `src/components/explorer/Files.tsx`

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/explorer/Files.tsx` with:

```tsx
import { createResource, createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import { resolveWikilinks } from "../../lib/wikilinks";
import { buildLinkMaps } from "../../lib/vaultLinks";
import { vaultPath } from "../../lib/vaultStore";
import { buildTree, flattenVisible } from "../../lib/fileTree";
import { pendingNote } from "../../lib/explorerStore";
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
  const [open, setOpen] = createSignal<Set<string>>(new Set());

  const index = () => new Map((files() ?? []).map((f) => [f.name.toLowerCase(), f.rel]));
  const nameByRel = () => new Map((files() ?? []).map((f) => [f.rel, f.name]));
  const maps = createMemo(() => buildLinkMaps(links() ?? []));
  const backlinks = createMemo(() => maps().backward.get(activeRel()) ?? []);
  const outlinks = createMemo(() => maps().forward.get(activeRel()) ?? []);
  const isOrphan = (rel: string) =>
    (maps().forward.get(rel)?.length ?? 0) === 0 && (maps().backward.get(rel)?.length ?? 0) === 0;

  // Vault changed: reset selection + open state.
  createEffect(() => { vaultPath(); setActiveRel(""); setHtml(""); setErr(""); setOpen(new Set()); });

  // Map (or anything) requested a note: open it + expand its ancestor folders.
  createEffect(() => {
    const rel = pendingNote();
    if (!rel) return;
    const segs = rel.replace(/\\/g, "/").split("/"); segs.pop();
    setOpen((prev) => {
      const next = new Set(prev); let acc = "";
      for (const s of segs) { acc = acc ? `${acc}/${s}` : s; next.add(acc); }
      return next;
    });
    open(rel);
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
    return flattenVisible(t, open());
  });

  function toggle(path: string) {
    setOpen((prev) => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; });
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
                <span class="pr-folder-chevron">{open().has(r.id) || q() ? "▾" : "▸"}</span>
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
```

> NOTE on `sort`: `VaultFile` currently exposes only `rel`/`name`/`dir` (size is read off `(f as any).size`, and there is no mtime). The `sort` toggle therefore sorts the *flat fallback* only where data exists; folder-tree order stays alphabetical (folders have no single mtime/size). Wire `sort` to reorder files **within each folder** in a follow-up only if `vault_index` is extended to return `size`/`mtime`. For phase 1, render the toggle and keep name-sort behavior; do not block on backend changes. (This keeps the task self-contained; remove the toggle instead if the reviewer prefers no dead control.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add the CSS (tree rows, breadcrumb, metadata, orphan)**

Append to `src/themes/tokens.css` (use existing tokens; adjust to match neighboring `pr-file`/`pr-folder` rules already in the file around lines 451–462):

```css
/* explorer tree */
.pr-folder { display:flex; align-items:center; gap:6px; cursor:pointer; font-family:var(--font-mono); color:var(--gull); user-select:none; }
.pr-folder-chevron { width:1ch; color:var(--gull-2); }
.pr-folder-name { flex:1; }
.pr-folder-count { color:var(--gull-2); font-size:var(--t-meta, 11px); }
.pr-file { display:flex; align-items:center; justify-content:space-between; cursor:pointer; }
.pr-file-tail { display:flex; align-items:center; gap:6px; }
.pr-orphan { color:var(--warn); }
.pr-sort { display:flex; gap:4px; margin-top:6px; }
.pr-sort button { font-family:var(--font-mono); font-size:11px; color:var(--gull-2); background:none; border:1px solid var(--iron-border); border-radius:var(--radius-sm,4px); padding:1px 6px; cursor:pointer; }
.pr-sort button.is-active { color:var(--bone); border-color:var(--accent); }
.pr-breadcrumb { display:flex; flex-wrap:wrap; gap:4px; font-family:var(--font-mono); font-size:12px; color:var(--gull); margin-bottom:6px; }
.pr-crumb-sep { color:var(--gull-2); }
.pr-crumb:last-child { color:var(--bone); }
.pr-note-meta { display:flex; gap:14px; font-family:var(--font-mono); font-size:11px; color:var(--gull-2); margin-bottom:12px; border-bottom:1px solid var(--iron-border); padding-bottom:8px; }
```

- [ ] **Step 4: Commit**

```bash
git add src/components/explorer/Files.tsx src/themes/tokens.css
git commit -m "feat(explorer): hierarchical tree, breadcrumb, note metadata, orphan badge"
```

---

# GROUP B — Portable map

## Task 5: `lib/linksGraph.ts` — pure links graph (folder-tagged, degree-weighted)

**Files:**
- Create: `src/lib/linksGraph.ts`
- Test: `src/lib/linksGraph.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/linksGraph.test.ts
import { describe, it, expect } from "vitest";
import { linksToGraph } from "./linksGraph";
import type { NoteLinks } from "./types";

describe("linksToGraph", () => {
  it("creates a node per note and an edge per resolved link", () => {
    const notes: NoteLinks[] = [{ rel: "a/x.md", links: ["a/y.md"], unresolved: 0 }];
    const g = linksToGraph(notes);
    expect(g.nodes.has("a/x.md")).toBe(true);
    expect(g.nodes.has("a/y.md")).toBe(true);
    expect([...g.edges.keys()]).toEqual(["a/x.md->a/y.md"]);
  });

  it("tags each node with its top-level folder via the session field", () => {
    const g = linksToGraph([{ rel: "notes/deep/x.md", links: [], unresolved: 0 }]);
    expect(g.nodes.get("notes/deep/x.md")!.session).toBe("notes");
  });

  it("labels root-level notes with folder 'root'", () => {
    const g = linksToGraph([{ rel: "x.md", links: [], unresolved: 0 }]);
    expect(g.nodes.get("x.md")!.session).toBe("root");
  });

  it("weights nodes by degree (in + out)", () => {
    const notes: NoteLinks[] = [
      { rel: "a.md", links: ["hub.md"], unresolved: 0 },
      { rel: "b.md", links: ["hub.md"], unresolved: 0 },
    ];
    const g = linksToGraph(notes);
    expect(g.nodes.get("hub.md")!.weight).toBe(2);
    expect(g.nodes.get("a.md")!.weight).toBe(1);
  });

  it("uses the stem (no folders, no .md) as the label", () => {
    const g = linksToGraph([{ rel: "a/b/Note.md", links: [], unresolved: 0 }]);
    expect(g.nodes.get("a/b/Note.md")!.label).toBe("Note");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- linksGraph`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/linksGraph.ts
import type { GraphState, GraphNode, GraphEdge, NoteLinks } from "./types";

export const stemOf = (rel: string) => (rel.replace(/\\/g, "/").split("/").pop() ?? rel).replace(/\.md$/i, "");
export const folderOf = (rel: string) => {
  const p = rel.replace(/\\/g, "/");
  const i = p.indexOf("/");
  return i < 0 ? "root" : p.slice(0, i);
};

/** Build a GraphState from live wikilink adjacency. Node per note (tagged by
 *  folder, weighted by degree), edge per resolved link. Pure. */
export function linksToGraph(notes: NoteLinks[]): GraphState {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const deg = new Map<string, number>();
  const bump = (id: string) => deg.set(id, (deg.get(id) ?? 0) + 1);
  const ensure = (rel: string) => {
    if (!nodes.has(rel)) nodes.set(rel, { id: rel, kind: "folder", label: stemOf(rel), status: "complete", session: folderOf(rel) });
  };
  for (const n of notes) {
    ensure(n.rel);
    for (const t of n.links) {
      ensure(t);
      const id = `${n.rel}->${t}`;
      if (!edges.has(id)) { edges.set(id, { id, source: n.rel, target: t }); bump(n.rel); bump(t); }
    }
  }
  for (const [id, node] of nodes) node.weight = deg.get(id) ?? 0;
  return { nodes, edges, activity: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- linksGraph`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/linksGraph.ts src/lib/linksGraph.test.ts
git commit -m "feat(map): pure folder-tagged, degree-weighted links graph"
```

---

## Task 6: Rewrite `Map.tsx` — single live mode, folder color, degree size, hover highlight, click→open

**Files:**
- Modify: `src/components/explorer/Map.tsx`

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/explorer/Map.tsx` with:

```tsx
import { createResource, createMemo, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { RadialForceLayout } from "../../lib/layout";
import type { PositionedNode } from "../../lib/layout";
import { emptyGraph } from "../../lib/graph";
import { vaultPath } from "../../lib/vaultStore";
import { linksToGraph } from "../../lib/linksGraph";
import { openNote } from "../../lib/explorerStore";
import type { GraphState, NoteLinks } from "../../lib/types";

const W = 1200, H = 860;
const layout = new RadialForceLayout();

const posMap = (nodes: PositionedNode[]) => new Map(nodes.map((p) => [p.id, p]));
const folderColor = (f?: string) =>
  (!f ? "var(--accent)" : `hsl(${(Array.from(f).reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360},65%,62%)`);

export function MapView() {
  const [linkNotes] = createResource(vaultPath, async (vp) => {
    if (!vp) return [] as NoteLinks[];
    try { return await invoke<NoteLinks[]>("vault_links", { vaultPath: vp }); }
    catch { return [] as NoteLinks[]; }
  });
  const graph = createMemo<GraphState>(() => linksToGraph(linkNotes() ?? []));

  // adjacency for hover highlight
  const neighbors = createMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => { (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b); };
    for (const e of graph().edges.values()) { add(e.source, e.target); add(e.target, e.source); }
    return m;
  });

  const base = createMemo(() => {
    const g = graph();
    const positioned = layout.layout(g, W, H);
    const pos = posMap(positioned);
    let bx = 0, by = 0, bw = W, bh = H;
    if (positioned.length) {
      const xs = positioned.map((p) => p.x), ys = positioned.map((p) => p.y);
      const pad = 60, labelPad = 160;
      bx = Math.min(...xs) - pad; by = Math.min(...ys) - pad;
      bw = Math.max(...xs) + labelPad - bx; bh = Math.max(...ys) + pad - by;
    }
    return { g, pos, bx, by, bw, bh };
  });

  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [hover, setHover] = createSignal<{ x: number; y: number; id: string; title: string } | null>(null);
  let svgEl: SVGSVGElement | undefined;
  function reset() { setZoom(1); setPan({ x: 0, y: 0 }); }

  const radiusOf = (w?: number) => Math.min(26, 5 + Math.sqrt(w ?? 0) * 3);
  const dimmed = (id: string) => {
    const h = hover(); if (!h) return false;
    return id !== h.id && !(neighbors().get(h.id)?.has(id));
  };

  const viewBox = createMemo(() => {
    const b = base();
    const w = b.bw / zoom(), h = b.bh / zoom();
    const cx = b.bx + b.bw / 2 + pan().x, cy = b.by + b.bh / 2 + pan().y;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  });
  function onWheel(e: WheelEvent) { e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; setZoom((z) => Math.min(8, Math.max(0.3, z * f))); }
  let down = false, moved = false, lx = 0, ly = 0;
  function onDown(e: PointerEvent) { down = true; moved = false; lx = e.clientX; ly = e.clientY; }
  function onMove(e: PointerEvent) {
    if (!down || !svgEl) return;
    if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 3) moved = true;
    const r = svgEl.getBoundingClientRect();
    const scale = (base().bw / zoom()) / r.width;
    setPan((p) => ({ x: p.x - (e.clientX - lx) * scale, y: p.y - (e.clientY - ly) * scale }));
    lx = e.clientX; ly = e.clientY;
  }
  function onUp() { down = false; }
  function nodeClick(id: string) { if (!moved) openNote(id); }

  return (
    <div class="pr-map-wrap">
      <div class="pr-info-card pr-map-info">
        <h3>CARTOGRAPHICUM</h3>
        <p>Every note linked by <b><code>[[wikilinks]]</code></b>, parsed live — coloured by <b>folder</b>, sized by <b>link count</b>. Works on any vault.</p>
        <div class="pr-info-meta" style={{ "margin-top": "8px" }}>scroll = zoom · drag = pan · click a node to open · <a onClick={reset}>reset</a></div>
      </div>
      <Show when={(linkNotes() ?? []).length} fallback={<div style={{ padding: "14px", color: "var(--gull)" }}>No linked notes in this vault.</div>}>
        <svg ref={svgEl} width="100%" height="100%" viewBox={viewBox()} preserveAspectRatio="xMidYMid meet"
          style={{ cursor: "grab", "touch-action": "none" }}
          onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <For each={[...base().g.edges.values()]}>{(e) => {
            const a = () => base().pos.get(e.source); const b = () => base().pos.get(e.target);
            const dim = () => dimmed(e.source) && dimmed(e.target);
            return <Show when={a() && b()}><line x1={a()!.x} y1={a()!.y} x2={b()!.x} y2={b()!.y} stroke="var(--border)" stroke-width="1" opacity={dim() ? 0.1 : 0.7} /></Show>;
          }}</For>
          <For each={[...base().g.nodes.values()]}>{(n) => {
            const p = () => base().pos.get(n.id);
            const r = radiusOf((n as any).weight);
            return (
              <Show when={p()}>
                <g style={{ cursor: "pointer", opacity: dimmed(n.id) ? 0.15 : 1 }}
                  onClick={() => nodeClick(n.id)}
                  onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, id: n.id, title: n.label })}
                  onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, id: n.id, title: n.label })}
                  onMouseLeave={() => setHover(null)}>
                  <circle cx={p()!.x} cy={p()!.y} r={r} fill="var(--panel)" stroke={folderColor(n.session)} stroke-width="2" />
                  <Show when={r >= 7 || hover()?.id === n.id}>
                    <text x={p()!.x + r + 4} y={p()!.y + 4} fill="var(--fg)" style={{ "font-size": "11px" }}>{n.label}</text>
                  </Show>
                </g>
              </Show>
            );
          }}</For>
        </svg>
      </Show>
      <Show when={linkNotes.loading}>
        <div style={{ position: "absolute", bottom: "12px", left: "12px", color: "var(--gull-2)", "font-size": "11px", "font-family": "var(--font-mono)" }}>building graph…</div>
      </Show>
      <Show when={hover()}>
        <div class="pr-tooltip" style={{ left: `${hover()!.x + 14}px`, top: `${hover()!.y + 14}px` }}>
          {hover()!.title}
          <span class="sub">{hover()!.id}</span>
        </div>
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (note `cartographicum.ts`/`folderGraph.ts` are still present here — they are deleted in Task 7, which has no other dependency on this task).

- [ ] **Step 3: Commit**

```bash
git add src/components/explorer/Map.tsx
git commit -m "feat(map): single portable live-links view with folder color, degree size, hover highlight, click-to-open"
```

---

## Task 7: Delete pre-baked cartographicum code (frontend + backend)

**Files:**
- Delete: `src/lib/cartographicum.ts`, `src/lib/cartographicum.test.ts`, `src/lib/folderGraph.ts`, `src/lib/folderGraph.test.ts`
- Modify: `src-tauri/src/vault.rs` (remove `read_cartographicum`, `read_folder_graph`)
- Modify: `src-tauri/src/lib.rs` (drop the two handlers)

- [ ] **Step 1: Delete the dead frontend files**

```bash
git rm src/lib/cartographicum.ts src/lib/cartographicum.test.ts src/lib/folderGraph.ts src/lib/folderGraph.test.ts
```

- [ ] **Step 2: Remove the two Rust commands**

In `src-tauri/src/vault.rs`, delete the `read_cartographicum` and `read_folder_graph` `#[tauri::command]` functions (and any now-unused `use`/helpers they alone relied on — verify by compiling).

In `src-tauri/src/lib.rs`, edit the `generate_handler!` macro to remove `vault::read_cartographicum, vault::read_folder_graph,` so it reads:

```rust
.invoke_handler(tauri::generate_handler![process::run_claude, process::stop_claude, vault::read_vault_file, vault::vault_index, vault::vault_links, sessions::list_sessions, sessions::list_all_sessions, sessions::read_session, session_watch::list_live_sessions, session_watch::watch_sessions])
```

> NOTE: `sessions::list_all_sessions` is added by Task 8 — if implementing strictly in order, add it here in Task 8 instead and leave it out now. Pick one; do not register a command that does not yet exist (compile will fail).

- [ ] **Step 3: Verify both build**

Run: `npm test` (frontend — deleted tests gone, rest pass)
Run: `cd src-tauri && cargo build` (backend compiles without the two commands)
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(map): remove pre-baked _Cartographicum code (frontend + backend)"
```

---

# GROUP C — Sessions by location

## Task 8: Rust `list_all_sessions` — scan all projects, tag by cwd

**Files:**
- Modify: `src-tauri/src/sessions.rs`
- Modify: `src-tauri/src/lib.rs` (register `list_all_sessions`)

- [ ] **Step 1: Write the failing Rust test**

Add to the bottom of `src-tauri/src/sessions.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_cwd_reads_the_cwd_field_from_the_first_line_that_has_one() {
        let raw = "{\"type\":\"summary\"}\n{\"type\":\"user\",\"cwd\":\"C:/work/proj\",\"message\":{}}\n";
        assert_eq!(first_cwd(raw).as_deref(), Some("C:/work/proj"));
    }

    #[test]
    fn first_cwd_is_none_when_absent() {
        assert_eq!(first_cwd("{\"type\":\"user\"}\n"), None);
    }

    fn decode_project_name(name: &str) -> String {
        super::decode_project_name(name)
    }

    #[test]
    fn decode_project_name_turns_dashes_back_into_a_path() {
        // best-effort fallback when no cwd is present in any transcript line
        assert_eq!(decode_project_name("C--Users-guill-git-Terra"), "C:\\Users\\guill\\git\\Terra");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test sessions`
Expected: FAIL — `first_cwd` / `decode_project_name` undefined.

- [ ] **Step 3: Implement the helpers + command + extended struct**

In `src-tauri/src/sessions.rs`: extend `SessionMeta` and add the helpers + command. Replace the `SessionMeta` struct with:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub mtime_ms: u64,
    pub title: String,
    pub size_bytes: u64,
    pub location: String,     // real cwd (from transcript) or decoded folder name
    pub project_dir: String,  // absolute path of the containing project folder
}
```

Add these functions (note `list_sessions` constructs `SessionMeta` — update it to pass `location` and `project_dir`; for `list_sessions`, set `location = first_cwd(raw).unwrap_or_else(|| decode_project_name(<dir name>))` and `project_dir = project_dir.clone()`):

```rust
use std::path::PathBuf;

/// First `"cwd"` string field found scanning transcript lines.
pub fn first_cwd(raw: &str) -> Option<String> {
    for line in raw.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
            if let Some(c) = v.get("cwd").and_then(|c| c.as_str()) {
                return Some(c.to_string());
            }
        }
    }
    None
}

/// Best-effort reverse of Claude Code's project-dir encoding. The encoding is
/// lossy (every separator becomes `-`), so this only runs as a fallback when no
/// transcript line carries a `cwd`. Heuristic: a leading single drive letter
/// followed by `--` becomes `X:\`, remaining single `-` become `\`.
pub fn decode_project_name(name: &str) -> String {
    let mut out = String::new();
    let bytes = name.as_bytes();
    // Drive prefix: "C--" => "C:\"
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b'-' && bytes[2] == b'-' {
        out.push(bytes[0] as char);
        out.push(':');
        out.push('\\');
        out.push_str(&name[3..].replace('-', "\\"));
    } else {
        out.push_str(&name.replace('-', "\\"));
    }
    out
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// Scan ~/.claude/projects/*/ and return every top-level session, each tagged
/// with the working directory it ran in.
#[tauri::command]
pub async fn list_all_sessions() -> Result<Vec<SessionMeta>, String> {
    let mut root = home_dir().ok_or("no home dir")?;
    root.push(".claude");
    root.push("projects");
    let projects = std::fs::read_dir(&root).map_err(|e| format!("read projects failed: {e}"))?;
    let mut out = vec![];
    for proj in projects.flatten() {
        let proj_path = proj.path();
        if !proj_path.is_dir() { continue; }
        let dir_name = proj_path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let project_dir = proj_path.to_string_lossy().to_string();
        let rd = match std::fs::read_dir(&proj_path) { Ok(r) => r, Err(_) => continue };
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_file() { continue; }
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") { continue; }
            let meta = match entry.metadata() { Ok(m) => m, Err(_) => continue };
            let size_bytes = meta.len();
            let mtime_ms = meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64).unwrap_or(0);
            let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let raw = std::fs::read_to_string(&path).unwrap_or_default();
            let title = raw.lines().find_map(line_to_turn)
                .map(|t| t.text.chars().take(80).collect::<String>())
                .unwrap_or_else(|| id.clone());
            let location = first_cwd(&raw).unwrap_or_else(|| decode_project_name(&dir_name));
            out.push(SessionMeta { id, mtime_ms, title, size_bytes, location, project_dir: project_dir.clone() });
        }
    }
    out.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    Ok(out)
}
```

Update the existing `list_sessions` push site to include the two new fields (it has `project_dir` as its argument; use `first_cwd` on the already-read `raw`):

```rust
        let location = std::fs::read_to_string(&path).ok()
            .and_then(|raw| first_cwd(&raw))
            .unwrap_or_else(|| project_dir.clone());
        out.push(SessionMeta { id, mtime_ms, title, size_bytes, location, project_dir: project_dir.clone() });
```

In `src-tauri/src/lib.rs`, add `sessions::list_all_sessions,` to the `generate_handler!` list (see Task 7 Step 2 for the full line).

- [ ] **Step 4: Run tests + build**

Run: `cd src-tauri && cargo test sessions`
Expected: PASS (3 tests).
Run: `cd src-tauri && cargo build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sessions.rs src-tauri/src/lib.rs
git commit -m "feat(sessions): list_all_sessions across projects, tagged by cwd"
```

---

## Task 9: `lib/sessionGroup.ts` — group by location + relative time

**Files:**
- Create: `src/lib/sessionGroup.ts`
- Test: `src/lib/sessionGroup.test.ts`
- Modify: `src/lib/types.ts` (extend `SessionMeta`)

- [ ] **Step 1: Extend the `SessionMeta` type**

In `src/lib/types.ts`, replace the `SessionMeta` line with:

```ts
export interface SessionMeta { id: string; mtimeMs: number; title: string; sizeBytes: number; location: string; projectDir: string }
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/sessionGroup.test.ts
import { describe, it, expect } from "vitest";
import { groupByLocation, relativeTime } from "./sessionGroup";
import type { SessionMeta } from "./types";

const s = (id: string, location: string, mtimeMs: number): SessionMeta =>
  ({ id, location, mtimeMs, title: id, sizeBytes: 0, projectDir: location });

describe("groupByLocation", () => {
  it("groups sessions by location", () => {
    const g = groupByLocation([s("a", "C:/x", 1), s("b", "C:/y", 2), s("c", "C:/x", 3)]);
    const map = new Map(g);
    expect(map.get("C:/x")!.map((x) => x.id)).toEqual(["c", "a"]); // newest first within group
    expect(map.get("C:/y")!.map((x) => x.id)).toEqual(["b"]);
  });

  it("orders groups by their most-recent session", () => {
    const g = groupByLocation([s("a", "C:/x", 1), s("b", "C:/y", 5)]);
    expect(g.map(([loc]) => loc)).toEqual(["C:/y", "C:/x"]);
  });
});

describe("relativeTime", () => {
  it("formats recent times", () => {
    const now = 10_000_000;
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- sessionGroup`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/sessionGroup.ts
import type { SessionMeta } from "./types";

export function groupByLocation(sessions: SessionMeta[]): [string, SessionMeta[]][] {
  const m = new Map<string, SessionMeta[]>();
  for (const s of sessions) (m.get(s.location) ?? m.set(s.location, []).get(s.location)!).push(s);
  for (const arr of m.values()) arr.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return [...m.entries()].sort((a, b) => b[1][0].mtimeMs - a[1][0].mtimeMs);
}

export function relativeTime(ms: number, now: number = Date.now()): string {
  const d = Math.max(0, now - ms);
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- sessionGroup`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/sessionGroup.ts src/lib/sessionGroup.test.ts src/lib/types.ts
git commit -m "feat(sessions): group-by-location + relative-time helpers"
```

---

## Task 10: Rewrite `Sessions.tsx` — grouped by location

**Files:**
- Modify: `src/components/explorer/Sessions.tsx`

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/explorer/Sessions.tsx` with:

```tsx
import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { vaultPath } from "../../lib/vaultStore";
import { groupByLocation, relativeTime } from "../../lib/sessionGroup";
import type { SessionMeta, Turn } from "../../lib/types";

const turnClass = (role: string) => role === "user" ? "pr-turn user" : role === "tool" ? "pr-turn tool" : "pr-turn";
const shortLoc = (loc: string) => loc.replace(/\\/g, "/").split("/").filter(Boolean).slice(-2).join("/") || loc;

export function Sessions() {
  const [sessions] = createResource(async () => {
    try { return await invoke<SessionMeta[]>("list_all_sessions"); }
    catch { return [] as SessionMeta[]; }
  });
  const groups = createMemo(() => groupByLocation(sessions() ?? []));
  const [turns, setTurns] = createSignal<Turn[]>([]);
  const [err, setErr] = createSignal("");
  const [activeIdSel, setActiveIdSel] = createSignal("");
  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const isCurrentVault = (loc: string) => !!vaultPath() && loc.replace(/\\/g, "/") === vaultPath().replace(/\\/g, "/");

  // Open the current-vault group (and the newest group) by default once loaded.
  const ensureDefaults = createMemo(() => {
    const g = groups();
    if (!g.length) return new Set<string>();
    const next = new Set<string>([g[0][0]]);
    for (const [loc] of g) if (isCurrentVault(loc)) next.add(loc);
    return next;
  });

  function toggle(loc: string) {
    setOpen((prev) => {
      const base = prev.size ? prev : ensureDefaults();
      const next = new Set(base);
      next.has(loc) ? next.delete(loc) : next.add(loc);
      return next;
    });
  }
  const isOpen = (loc: string) => (open().size ? open() : ensureDefaults()).has(loc);

  async function openSession(s: SessionMeta) {
    setErr(""); setActiveIdSel(s.id);
    try { setTurns(await invoke<Turn[]>("read_session", { path: `${s.projectDir}\\${s.id}.jsonl` })); }
    catch (e) { setErr(String(e)); setTurns([]); }
  }

  return (
    <div class="pr-sessions-pane">
      <aside class="pr-sess-list">
        <div class="pr-sessions-head">
          <span class="pr-sessions-title">TRANSCRIPTS</span>
          <span class="pr-sessions-sub">archive · {sessions()?.length ?? 0} sessions · {groups().length} locations</span>
        </div>
        <div class="pr-sess-scroll">
          <For each={groups()}>{([loc, items]) => (
            <div class="pr-sess-group">
              <div class={`pr-sess-loc${isCurrentVault(loc) ? " is-current" : ""}`} onClick={() => toggle(loc)} title={loc}>
                <span class="pr-folder-chevron">{isOpen(loc) ? "▾" : "▸"}</span>
                <span class="pr-sess-loc-name">{shortLoc(loc)}</span>
                <span class="pr-folder-count">{items.length}</span>
                <span class="pr-sess-loc-time">{relativeTime(items[0].mtimeMs)}</span>
              </div>
              <Show when={isOpen(loc)}>
                <For each={items}>{(s) => (
                  <div class={`pr-sess-row${s.id === activeIdSel() ? " is-active" : ""}`} onClick={() => openSession(s)}>
                    <span class="pr-sess-title">{s.title}</span>
                    <span class="pr-sess-meta"><span>{relativeTime(s.mtimeMs)}</span></span>
                  </div>
                )}</For>
              </Show>
            </div>
          )}</For>
        </div>
      </aside>
      <section class="pr-transcript">
        <Show when={!err()} fallback={<pre style={{ color: "var(--bad)" }}>{err()}</pre>}>
          <For each={turns()}>{(t) => (
            <div class={turnClass(t.role)}>
              <div class="role"><span class="tag">{t.role}</span></div>
              <pre>{t.text}</pre>
            </div>
          )}</For>
        </Show>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for session groups**

Append to `src/themes/tokens.css`:

```css
/* sessions grouped by location */
.pr-sess-group { margin-bottom:4px; }
.pr-sess-loc { display:flex; align-items:center; gap:6px; cursor:pointer; font-family:var(--font-mono); font-size:12px; color:var(--gull); padding:4px 8px; user-select:none; }
.pr-sess-loc.is-current { color:var(--accent); }
.pr-sess-loc-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pr-sess-loc-time { color:var(--gull-2); font-size:11px; }
.pr-sess-row { padding-left:22px; }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/explorer/Sessions.tsx src/themes/tokens.css
git commit -m "feat(sessions): group transcripts by working directory, pin current vault"
```

---

# GROUP D — Remove hardcoded Terra paths

## Task 11: Drop the Terra default + prompt/status-bar fallbacks

**Files:**
- Modify: `src/lib/vaultStore.ts`
- Modify: `src/lib/vaultStore.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update the vaultStore test first (TDD)**

Replace `src/lib/vaultStore.test.ts` with:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const KEY = "praetorium.vaultPath";

function makeLocalStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

describe("vaultStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", makeLocalStorage());
  });

  it("defaults to empty (no hardcoded vault) when unset", async () => {
    const m = await import("./vaultStore");
    expect(m.vaultPath()).toBe("");
  });

  it("reads a previously persisted path on load", async () => {
    localStorage.setItem(KEY, "D:\\notes");
    const m = await import("./vaultStore");
    expect(m.vaultPath()).toBe("D:\\notes");
  });

  it("setVaultPath updates the signal and persists (round-trip)", async () => {
    const m = await import("./vaultStore");
    m.setVaultPath("E:\\vault");
    expect(m.vaultPath()).toBe("E:\\vault");
    expect(localStorage.getItem(KEY)).toBe("E:\\vault");
  });
});
```

- [ ] **Step 2: Run test to verify the first case fails**

Run: `npm test -- vaultStore`
Expected: FAIL — currently returns the Terra default, not `""`.

- [ ] **Step 3: Update `vaultStore.ts`**

Replace `src/lib/vaultStore.ts` with:

```ts
import { createSignal } from "solid-js";

const KEY = "praetorium.vaultPath";

const [vaultPath, setSignal] = createSignal(localStorage.getItem(KEY) || "");
export { vaultPath };

/** Single source of truth for the vault root. Updates the signal and persists. */
export function setVaultPath(path: string) {
  localStorage.setItem(KEY, path);
  setSignal(path);
}
```

(Any other importer of `DEFAULT_VAULT` must be updated — grep `DEFAULT_VAULT` and remove usages. As of this plan, only `vaultStore.test.ts` referenced it.)

- [ ] **Step 4: Update `App.tsx` prompt path + status-bar vault name**

In `src/App.tsx`:
- Add an import near the others: `import { vaultPath } from "./lib/vaultStore";`
- Add a derived basename helper inside `App()` (before `return`):

```tsx
  const vaultName = () => { const p = vaultPath().replace(/\\/g, "/").split("/").filter(Boolean).pop(); return p || "no vault"; };
```

- Replace the prompt path line (currently `{themedCopy()?.path ?? "~/git/Terra"}`) with:

```tsx
          <span class="pr-prompt-path">{themedCopy()?.path ?? vaultName()}</span>
```

- Replace the status-bar vault span (currently `vault <span class="v">Terra</span>`) with:

```tsx
        <span class="item ok">vault <span class="v">{vaultName()}</span></span>
```

- [ ] **Step 5: Verify**

Run: `npm test -- vaultStore`
Expected: PASS (3 tests).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/vaultStore.ts src/lib/vaultStore.test.ts src/App.tsx
git commit -m "chore: remove hardcoded Terra paths (vault default, prompt, status bar)"
```

---

## Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full frontend test suite**

Run: `npm test`
Expected: all suites pass; no references to deleted `cartographicum`/`folderGraph`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Backend build + tests**

Run: `cd src-tauri && cargo test && cargo build`
Expected: success.

- [ ] **Step 4: Manual app verification (Tauri dev)**

Run: `npm run tauri dev`
Verify:
- Explorer: deep vault renders a collapsible tree; chevrons expand/collapse; counts show; search auto-expands matches; opening a note shows breadcrumb + word/backlink/outlink metadata; orphan notes show the `○` badge.
- Map: renders the live link graph with folder-colored, degree-sized nodes; hovering dims non-neighbors; clicking a node jumps to Files with that note open. No "No Cartographicum meta.json found" state.
- Switch to a different vault (Settings folder picker): map + explorer rebuild with no Terra strings anywhere; status bar + prompt show the new vault's basename.
- Sessions: lists sessions grouped under location headers across multiple `~/.claude/projects` folders; the current-vault location is highlighted; relative times render; clicking a session loads its transcript.

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "test(explorer): verification fixups"
```

---

## Self-review notes (addressed)

- **Spec coverage:** Explorer tree+breadcrumb (Tasks 1–4), included metadata/orphan/sort (Task 4), map LINKS-first + folder color + degree + hover + click-open (Tasks 5–6), delete pre-baked (Task 7), sessions all-projects grouped-by-location + relative time + current-vault pin (Tasks 8–10), Terra path removal (Task 11). Deferred phase-2 items (tags, recent strip, filter chips, in-graph search, transcript search, date filter, message count) are intentionally out of scope.
- **Type consistency:** `SessionMeta` extended once (Task 9 frontend / Task 8 backend) with matching `location`/`projectDir`(camelCase) ↔ `location`/`project_dir`(serde). `linksToGraph` signature stable between lib and `Map.tsx`. `flattenVisible(root, Set<string>)` used consistently.
- **Ordering caveat:** `list_all_sessions` registration in `lib.rs` belongs to Task 8; if Task 7 runs first, do not pre-register it (noted inline).
- **Known limitation:** the Files `sort` toggle is rendered but only meaningfully reorders once `vault_index` returns `size`/`mtime`; documented inline as phase-2 wiring.
