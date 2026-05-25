# Explorer redesign — hierarchy, portable map, sessions by location

**Date:** 2026-05-25
**Status:** Approved (design)
**Scope:** The `explorer` view of Praetorium — its file browser (`Files`), map (`Map`/Cartographicum), and `Sessions` panes.

## Problem

1. **Explorer is flat.** `Files.tsx` groups files by full parent-path string and renders one flat, non-collapsible list. Deep vaults become an unreadable wall of groups with no nesting or collapse.
2. **The folder map is opaque.** The `FOLDERS` rollup draws folder → "top hub" nodes whose meaning is unclear, and the `FULL VAULT` mode shows merged per-folder graphs — both sourced from pre-baked `_Cartographicum` artifacts.
3. **The map is not portable.** `FULL VAULT` and `FOLDERS` depend on `_Cartographicum/meta.json` + per-folder `graph.json` files that only exist in the Terra vault. Selecting any other vault shows "No Cartographicum meta.json found." Only `LINKS` (live wikilink graph) works anywhere.
4. **Sessions are hardcoded and ungrouped.** `Sessions.tsx` reads a single hardcoded Terra project dir and lists transcripts flat. There is no notion of *where* a session ran.
5. **Hardcoded Terra paths** litter the app: `PROJECT_DIR`, the vault-store default, and the prompt-path fallback.

## Goals

- A usable, hierarchical file explorer that scales to deep vaults.
- A map that works on **any** vault with no external artifacts.
- Sessions browsable across **all** Claude Code projects, grouped by the folder they ran in.
- Remove the three hardcoded Terra paths.

## Non-goals

- No change to theming/tokens or the `console`/`cockpit`/`settings` views.
- No new persistence backend; reuse Tauri `invoke` + localStorage.
- No editing of vault files (explorer stays read-only).

---

## 1. Explorer — tree + breadcrumb hybrid

### Behavior
- Build a nested tree from `VaultFile[].rel` (split on `/`): folders contain subfolders and files.
- Sidebar renders collapsible folder rows (chevron + name + file count). Click toggles expand/collapse; indentation encodes depth.
- Open/collapsed state persisted **per vault** in localStorage (key derived from `vaultPath()`).
- A breadcrumb bar above the open note shows the active file's path as clickable segments (clicking a segment reveals/expands that folder in the tree).
- Search filters the tree and auto-expands folders containing matches; non-matching branches collapse/hide.

### Units
- `lib/fileTree.ts` (new, pure): `buildTree(files: VaultFile[]): TreeNode` and a `flattenVisible(tree, openSet): Row[]` helper for rendering. Independently testable, no Solid/Tauri deps.
- `Files.tsx`: consumes the tree, owns open-state signal + persistence, renders rows + breadcrumb + preview. Preview/backlinks logic unchanged.

### New info/features (included)
- **Sort toggle** per session of the view: name / modified / size.
- **Note metadata header** in the preview pane: modified date, word count, backlink count, outgoing-link count (computed from already-loaded `links`/`backward` maps + the markdown body).
- **Orphan badge**: small marker on notes with zero links in and out.

### New info/features (deferred — phase 2, not in first plan)
- Recently-modified strip above the tree.
- Frontmatter/`#tag` parsing + tag-chip filter.

---

## 2. Map — LINKS-first, portable

### Behavior
- The live wikilink graph (`vault_links` → `linksToGraph`) becomes the **only** map. It works on any vault.
- Remove the `FULL`/`FOLDERS`/`LINKS` toggle, the `full`/`rollup` modes, the drill-in state, the `showSymbols` option, and the "No Cartographicum meta.json found" empty state.
- Remove dependence on `read_cartographicum` and `read_folder_graph`; delete `lib/cartographicum.ts` and `metaToGraph`. (`parseFolderGraph` / `read_folder_graph` removed only if no other consumer — verify during implementation.)
- **Color nodes by folder**, computed live from each note's `rel` (reuse the existing `folderColor` hash). Preserves at-a-glance clustering without artifacts.

### Units
- `Map.tsx`: single-mode renderer over `activeGraph = linksToGraph(linkNotes)`. Keep zoom/pan/hover/tooltip as-is. `linksToGraph` tags each node with its folder for coloring.

### New info/features (included)
- **Node size = degree** (in + out link count) so hubs visibly grow.
- **Hover highlight**: dim all but the hovered node and its direct neighbors.
- **Click → open in Explorer**: jump to the `explorer` Files view with that note opened (cross-view selection via a shared signal).

### New info/features (deferred — phase 2)
- Filter chips (orphans-only / hubs-only / by folder).
- In-graph search that pulses the matching node.

---

## 3. Sessions — all projects, grouped by location

### Behavior
- New backend command `list_all_sessions` scans `~/.claude/projects/`: for each project subfolder, decode the folder name into a real path (`C--Users-guill-...` → `C:\Users\guill\...`) and return its sessions, each carrying a `location` field.
- Drop the hardcoded `PROJECT_DIR`. `read_session` takes an absolute path as today (the location's folder + `<id>.jsonl`).
- Sidebar groups sessions under collapsible **location headers**, each group sorted by most-recent activity; groups sorted by their most-recent session.
- The location matching the current `vaultPath()` is marked/pinned.

### Data
- Extend `SessionMeta` with `location: string` (decoded path) and `projectDir: string` (raw folder, for building the jsonl path). Keep `id`, `mtimeMs`, `title`, `sizeBytes`.

### Units
- Backend (Rust): `list_all_sessions` enumerates project dirs + decodes names. Path-decode is a small pure helper, unit-testable.
- `lib/sessions.ts` (new, pure): `groupByLocation(sessions): [location, SessionMeta[]][]`, sorted.
- `Sessions.tsx`: collapsible grouped list; transcript viewer unchanged.

### New info/features (included)
- **Per-session meta**: last-active relative time ("2h ago"); message count if cheaply available from `list_all_sessions`, else deferred.
- **Location header info**: session count + last-active; highlight the current-vault location.

### New info/features (deferred — phase 2)
- Transcript content search.
- Global date sort/filter.

---

## 4. Remove hardcoded Terra paths

- `Sessions.tsx` `PROJECT_DIR` → removed (replaced by `list_all_sessions`).
- `vaultStore.ts` default `C:\Users\guill\Documents\git\Terra` → keep a neutral/empty default with an explicit "select a vault" state, OR last-opened from localStorage. Decide in plan; must not hardcode Terra.
- `App.tsx` prompt-path fallback `~/git/Terra` → derive from `vaultPath()` (basename) or show a neutral placeholder.

## Data flow summary

```
vault_index  → VaultFile[]  → buildTree → Explorer sidebar (+ breadcrumb, preview, metadata)
vault_links  → NoteLinks[]  → linksToGraph (folder-tagged) → Map (degree-sized, folder-colored)
list_all_sessions (~/.claude/projects) → SessionMeta[+location] → groupByLocation → Sessions sidebar
```

## Testing

- Pure units (`fileTree`, `groupByLocation`, path-decode, degree/folder tagging) get unit tests.
- Manual verification in the running Tauri app: switch between ≥2 vaults; confirm tree builds + persists open state, map renders with folder colors and no empty-state, sessions list groups across multiple project dirs, no Terra strings remain on a fresh vault.

## Cross-cutting

- New explorer→files selection signal (for map click-through) lives alongside `vaultStore` (e.g. a small `selectionStore`).
- All new CSS uses the `pr-*` prefix and existing tokens per CLAUDE.md.

## Open questions for the plan

- `vaultStore` default behavior (empty + picker vs last-opened).
- Whether `message count` is available from `list_all_sessions` without parsing every transcript (affects whether it ships in phase 1).
- Confirm `read_folder_graph` / `parseFolderGraph` have no other consumers before deleting.
