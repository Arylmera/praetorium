# Launch Agent from UI — Design

**Date:** 2026-05-24
**Status:** Approved (pending implementation plan)
**Scope:** Second queued observability/control feature for Praetorium. Siblings (Run Insights — already specced; vault links; command palette) get their own specs.

## Summary

Let the user launch a Claude run from the Console with a chosen **working directory** and **model**, instead of always running in the app's cwd with the default model. The existing input bar grows a thin options row; the run flows through the same `local`-session pipeline that already exists.

**Out of scope (YAGNI):** concurrent local runs, allowed-tools / `--add-dir` scoping, recent-dirs history, persisting run config across launches.

## Background

Today the launch path is fixed:

- `process.rs::run_claude(prompt, on_event)` spawns `claude -p <prompt> --output-format stream-json --verbose` with `.env_clear()` + `sanitized_env`. **No cwd, no model.**
- `claude.ts::runClaude(prompt, onEvent)` invokes it.
- `runStore.ts::startRun(prompt)` guards a single in-flight run (`running` signal), echoes the prompt as a user turn, and pipes events into `sessionStore.applyWatch` under a hardcoded `sessionId: "local"`, `project: "local run"`.
- `Console.tsx` renders the `pr-inputbar` form calling `startRun`.

Note: `claude -p` has **no flag to force a subagent type** for a top-level run — subagents are spawned by the agent mid-run. So the launch form exposes model and cwd, not agent type.

## Architecture

### 1. Rust — `src-tauri/src/process.rs`

`run_claude` gains two optional parameters:

```rust
pub async fn run_claude(
    app: AppHandle,
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    on_event: Channel<ClaudeEvent>,
) -> Result<(), String>
```

- Build args dynamically into a `Vec<String>` instead of the fixed array:
  base = `["-p", prompt, "--output-format", "stream-json", "--verbose"]`; if `model` is `Some`, push `["--model", model]`.
- If `cwd` is `Some`, call `.current_dir(cwd)` on the command builder; otherwise leave default (app cwd — no regression).
- `sanitized_env` and the env handling are unchanged.

### 2. Native folder picker — `tauri-plugin-dialog`

The dialog plugin is not currently present. Add it:

- `src-tauri/Cargo.toml`: `tauri-plugin-dialog` dependency.
- `package.json`: `@tauri-apps/plugin-dialog`.
- `src-tauri/src/lib.rs`: `.plugin(tauri_plugin_dialog::init())` in the builder chain.
- `src-tauri/capabilities/default.json`: grant `dialog:allow-open`.
- Frontend opens it via the plugin's `open({ directory: true, multiple: false })`, returning the selected path or `null` on cancel.

### 3. Frontend plumbing

- `src/lib/claude.ts`: `runClaude(prompt, onEvent, opts?: { cwd?: string; model?: string })` → forward `cwd` / `model` in the `invoke("run_claude", …)` payload.
- `src/lib/runStore.ts`:
  - `startRun(prompt, opts?: { cwd?: string; model?: string })`.
  - Derive the local session's project label from the cwd: a pure helper `cwdLabel(cwd?) => basename(cwd) ?? "local run"`. This replaces the hardcoded `LOCAL_PROJECT` constant at the point where the `WatchEvent`s are constructed, so the Console rail and Cockpit show which project the local run touched.
  - **Single-run guard preserved** — still one `"local"` session at a time; the existing `running()` check stays.

### 4. Console UI — `src/components/Console.tsx` + `src/themes/tokens.css`

The `pr-inputbar` form grows a thin options row above the prompt input:

- **cwd chip** (`.pr-cwd-chip`): a button showing the chosen folder's basename, or `cwd: default` when none. Clicking opens the native dialog; an inline × clears it back to default.
- **model dropdown** (`.pr-model-select`): options `default / opus / sonnet / haiku`. `default` omits `--model`.
- Both disabled while `running()`.
- Local component signals hold the pending `cwd` and `model`; `submit` passes them to `startRun` and the cwd persists across submits within the session (cleared only by the ×). Model selection likewise persists.
- New `pr-*` classes (`.pr-launch-opts`, `.pr-cwd-chip`, `.pr-model-select`). Path and model values render in `--font-mono` per the two-voice font rule. No new motion; nothing to gate for reduce-motion.

### 5. Data flow

```
Console options row (cwd chip → native dialog; model dropdown)
  → submit → startRun(prompt, { cwd, model })
  → runClaude(prompt, onEvent, { cwd, model })
  → invoke("run_claude", { prompt, cwd, model, onEvent })
  → claude -p … [--model …]  (.current_dir(cwd) when set)
  → ClaudeEvent stream → toWatch → applyWatch  (session label = basename(cwd))
```

## Error handling

- Dialog cancelled → `open` returns `null`; cwd unchanged. No error surfaced.
- Invalid/inaccessible cwd → `claude` spawn fails; the existing `run_claude` `Err(...)` path and `runStore`'s `catch` already echo the error as an assistant turn. No new handling needed.
- Empty prompt → existing `startRun` guard (`!prompt.trim()`) returns early.

## Testing

- **Rust unit:** arg-vector builder includes `--model <m>` only when `model` is `Some`, absent when `None`; cwd applied only when `Some`. Existing `sanitized_env` test unchanged.
- **Frontend unit:** `cwdLabel` basename derivation (incl. trailing slash, Windows `\` separators, `undefined` → `"local run"`); `startRun` forwards `opts` to `runClaude`.

## Files touched

- `src-tauri/src/process.rs` — `run_claude` gains `cwd` + `model`; dynamic args.
- `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` — register `tauri-plugin-dialog`.
- `package.json` — `@tauri-apps/plugin-dialog`.
- `src/lib/claude.ts` — `runClaude` opts param.
- `src/lib/runStore.ts` — `startRun` opts; `cwdLabel` helper; cwd-derived session label.
- `src/components/Console.tsx` — launch options row.
- `src/themes/tokens.css` — `.pr-launch-opts`, `.pr-cwd-chip`, `.pr-model-select`.
