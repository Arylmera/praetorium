# Vault Links — Design

**Date:** 2026-05-24
**Status:** Approved (pending implementation plan)
**Scope:** Third queued feature for Praetorium. Structured as two phases; Phase 1 is independently shippable.

## Summary

Make the Explorer work on any vault and surface wikilink relationships:

- **Phase 1 — Vault selection.** Replace the hardcoded vault path with a user-chosen, persisted path. Foundation for everything that reads the vault.
- **Phase 2 — Wikilink index.** A vault-wide `[[link]]` adjacency, computed in Rust, powering (a) a backlinks footer in the note reader and (b) a live wikilink graph mode in the Map view.

## Background — what already exists

- **Markdown preview:** `Files.tsx` already renders notes via `marked.parse`.
- **Inline wikilinks:** `src/lib/wikilinks.ts` resolves `[[Name]]` / `[[Name|alias]]` in rendered HTML to clickable anchors (`data-rel`) against a name→rel index; clicking opens the target. This stays as-is.
- **Map graph:** `Map.tsx` renders graphs read from **pre-generated** `_Cartographicum/graph.json` (cross-file references, communities, hubs) via `read_folder_graph` / `read_cartographicum`. If a vault has no `_Cartographicum`, the Map is empty.
- **Vault listing:** `vault.rs::vault_index(vaultPath)` walks `.md` files (skipping `Archive` / `.git` / `node_modules`) returning `VaultFile { rel, name, dir }`.
- **Hardcoded path:** both `Files.tsx` and `Map.tsx` define `const VAULT = "C:\\Users\\guill\\Documents\\git\\Terra"`.

So this feature does **not** re-implement preview or inline wikilinks. It adds vault selection, a backlinks panel, and a live (self-parsed) wikilink graph that works on any vault.

## Phase 1 — Vault selection

### `src/lib/vaultStore.ts` (new)
- `vaultPath` signal, initialized from `localStorage["praetorium.vaultPath"]`, falling back to the existing `C:\Users\guill\Documents\git\Terra` default (no regression on first run).
- `setVaultPath(path)` updates the signal and writes `localStorage`.
- Export both; this is the single source of truth for the vault root.

### Settings — vault row
- In `Settings.tsx`, add a "Vault" row showing the current `vaultPath()` and a "Change…" button.
- The button opens the native folder dialog via `tauri-plugin-dialog` (`open({ directory: true, multiple: false })`). On a non-null result, `setVaultPath(result)`.
- **Dialog plugin dependency:** the launch-agent spec (`2026-05-24-launch-agent-design.md`) already introduces `tauri-plugin-dialog`. If that ships first, this is free; if Vault Links ships first, the plugin registration (Cargo dep, npm `@tauri-apps/plugin-dialog`, `lib.rs` `.plugin(...)`, `capabilities/default.json` `dialog:allow-open`) is done here instead. The implementation plan must check which is already present.

### Wire into Explorer
- Replace the `const VAULT` literals in `Files.tsx` and `Map.tsx` with `vaultStore.vaultPath()`.
- Their `createResource`s key off `vaultPath()` so changing the vault re-runs `vault_index` / cartographicum loads. Clear the open note / active selection on vault change.

**Phase 1 is shippable on its own** — it delivers vault switching with the existing browse/preview/Map features.

## Phase 2 — Wikilink index

### Rust — `vault.rs::vault_links(vaultPath) -> Result<Vec<NoteLinks>, String>`
- Reuse the `walk_md` traversal to enumerate `.md` files and build a name→rel index (same lowercased-stem keying as the frontend `wikilinks.ts` resolver, for consistency).
- For each note, read its contents and regex-extract `[[target]]` / `[[target|alias]]` occurrences (same pattern as `resolveWikilinks`: `\[\[([^\]|]+)(?:\|([^\]]+))?\]\]`).
- Resolve each `target` (trimmed, lowercased) against the name index to a rel path. Return:
  ```rust
  struct NoteLinks { rel: String, links: Vec<String>, unresolved: u32 }
  ```
  where `links` are resolved target rels (deduped) and `unresolved` counts targets with no matching note.
- **Documented limitation:** plain regex; does not exclude `[[ ]]` inside fenced code blocks. Acceptable for v1; note it in code.
- Mirror `NoteLinks` in `src/lib/types.ts`.

### `src/lib/vaultLinks.ts` (new, pure)
- From `NoteLinks[]` build:
  - `forward: Map<rel, string[]>` (a note's outgoing links),
  - `backward: Map<rel, string[]>` (notes linking *to* this rel — the reverse index).
- Pure functions, unit-testable independently of Tauri.

### Backlinks footer — `Files.tsx`
- Load `vault_links` alongside `vault_index` (keyed on `vaultPath()`), build the reverse map via `vaultLinks.ts`.
- Under the rendered note (`.pr-doc`), add a "Linked references" section listing `backward.get(activeRel())`; each entry is clickable → existing `open(rel)`.
- Empty list → hidden (or a muted "No linked references.").
- New `pr-*` classes (e.g. `.pr-backlinks`, `.pr-backlink`); labels in `--font-mono` per the two-voice font rule.

### Map "LINKS" mode — `Map.tsx`
- Add a third toggle button **LINKS** beside FULL VAULT / FOLDERS.
- In LINKS mode, build a `GraphState` from the wikilink adjacency: nodes = notes (kind `folder`/note-style), edges = resolved links. Feed the existing `RadialForceLayout` + zoom/pan/tooltip pipeline — no new layout code.
- Info-card copy describes the mode ("notes linked by `[[wikilinks]]`, parsed live").
- Works regardless of whether `_Cartographicum` exists.

## Data flow

```
Settings "Change…" → native dialog → setVaultPath → localStorage
                                          │
                vaultStore.vaultPath() ───┼──> Files.tsx  (vault_index + vault_links)
                                          └──> Map.tsx    (cartographicum | LINKS graph)

vault_links(vaultPath) → NoteLinks[] → vaultLinks.ts → { forward, backward }
   backward → Files "Linked references" footer
   forward  → Map LINKS GraphState → RadialForceLayout
```

## Error handling
- Dialog cancelled → no change.
- Invalid vault path → `vault_index` / `vault_links` return `Err`; the existing resource `catch` yields empty lists (Files shows nothing, Map shows its "no meta" fallback). No crash.
- A note that fails to read during link extraction is skipped (contributes no links) rather than failing the whole command.

## Testing
- **Rust `vault_links`:** `[[link]]` and `[[link|alias]]` extraction; resolution against the name index; `unresolved` count for dangling targets; dedupe; a note with no links; skip-list dirs honored. Document (and optionally test) the code-fence non-exclusion limitation.
- **`vaultLinks.ts`:** forward/backward map construction; multi-link notes; dangling links absent from `backward`; a note linked by several others.
- **Phase 1 `vaultStore`:** localStorage round-trip; default fallback when unset.

## Files touched
- `src/lib/vaultStore.ts` — **new** (Phase 1).
- `src/components/Settings.tsx` — vault row + picker (Phase 1).
- `src/components/explorer/Files.tsx` — use `vaultStore`; backlinks footer (Phase 1 + 2).
- `src/components/explorer/Map.tsx` — use `vaultStore`; LINKS mode (Phase 1 + 2).
- `src-tauri/src/vault.rs` — `vault_links` command (Phase 2).
- `src-tauri/src/lib.rs` — register `vault_links` (+ dialog plugin if not already from launch-agent spec).
- `src/lib/types.ts` — `NoteLinks` type (Phase 2).
- `src/lib/vaultLinks.ts` — **new**, forward/backward maps (Phase 2).
- `src/themes/tokens.css` — `.pr-backlinks*` classes.
- `package.json` / `src-tauri/Cargo.toml` / `capabilities/default.json` — `tauri-plugin-dialog`, only if not already added by the launch-agent spec.
