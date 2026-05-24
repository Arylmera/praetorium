import { createSignal } from "solid-js";
import { runClaude } from "./claude";
import { applyWatch, clearSession, setActiveId } from "./sessionStore";
import type { ClaudeEvent, WatchEvent, SessionEvent } from "./types";

const LOCAL_SID = "local";
const LOCAL_PROJECT = "local run";

const [running, setRunning] = createSignal(false);
// Real session id claude assigns to the current local run (from its stream-json
// "system"/init line). The file watcher independently re-discovers this same
// transcript on disk under this id; the Console uses it to hide that duplicate,
// since the run already shows live under the synthetic "local" session.
const [localSessionId, setLocalSessionId] = createSignal<string | null>(null);
export { running, localSessionId };

/** Start a fresh local conversation: drop the resume id and wipe the local
 *  session's transcript/timeline so the next prompt begins anew. Re-focuses the
 *  local console. No-op while a run is in flight. */
export function resetLocal(): void {
  if (running()) return;
  setLocalSessionId(null);
  clearSession(LOCAL_SID);
  setActiveId(LOCAL_SID);
}

/** Derive the local session's project label from the chosen cwd: its basename,
 *  or "local run" when no cwd is set. Tolerates trailing and Windows separators. */
export function cwdLabel(cwd?: string): string {
  if (!cwd) return LOCAL_PROJECT;
  const trimmed = cwd.replace(/[/\\]+$/, "");
  const base = trimmed.split(/[/\\]/).pop();
  return base || LOCAL_PROJECT;
}

/** Parent-repo label for a git-worktree cwd (.../<repo>/.claude/worktrees/<name>).
 *  Returns the segment just before `.claude` so worktrees nest under their repo;
 *  undefined when the cwd isn't inside a worktree. */
export function repoLabel(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  const parts = cwd.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean);
  const i = parts.findIndex((p, idx) => p === ".claude" && parts[idx + 1] === "worktrees");
  return i > 0 ? parts[i - 1] : undefined;
}

/** Translate a locally-launched run's ClaudeEvent into a WatchEvent so the app's
 *  own run flows through the same sessionStore pipeline as observed sessions —
 *  appearing as a "local" session in the Console rail and the Cockpit constellation. */
function toWatch(ev: ClaudeEvent, project: string, repo?: string): WatchEvent | null {
  const wrap = (agentRef: string, event: SessionEvent): WatchEvent =>
    ({ type: "session", data: { sessionId: LOCAL_SID, project, repo, agentRef, event } });
  switch (ev.type) {
    case "assistantText":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "turn", data: { role: "assistant", text: ev.data.text } });
    case "subagentSpawn":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "subagentSpawn", data: { toolUseId: ev.data.toolUseId, subagentType: ev.data.subagentType } });
    case "toolCall":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "toolActivity", data: { toolUseId: ev.data.toolUseId, name: ev.data.name, filePath: ev.data.filePath } });
    case "toolResult":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "toolDone", data: { toolUseId: ev.data.toolUseId, isError: ev.data.isError } });
    default:
      return null;
  }
}

export async function startRun(prompt: string, opts?: { cwd?: string; model?: string }): Promise<void> {
  if (running() || !prompt.trim()) return;
  const project = cwdLabel(opts?.cwd);
  const repo = repoLabel(opts?.cwd);
  // Echo the prompt as a user turn in the local session.
  applyWatch({ type: "session", data: { sessionId: LOCAL_SID, project, repo, agentRef: "master", event: { kind: "turn", data: { role: "user", text: prompt } } } });
  setRunning(true);
  // Continue the prior local run when one exists, so follow-ups keep context;
  // no id (first prompt or after NEW) starts a fresh session — pass opts untouched
  // then so callers that omit opts still forward `undefined`.
  const id = localSessionId();
  const runOpts = id ? { ...opts, resume: id } : opts;
  try {
    await runClaude(prompt, (ev: ClaudeEvent) => {
      const w = toWatch(ev, project, repo);
      if (w) applyWatch(w);
      else if (ev.type === "systemInit") setLocalSessionId(ev.data.sessionId);
      else if (ev.type === "result" && ev.data.isError) {
        applyWatch({ type: "session", data: { sessionId: LOCAL_SID, project, repo, agentRef: "master", event: { kind: "turn", data: { role: "assistant", text: ev.data.result } } } });
      } else if (ev.type === "runError") {
        applyWatch({ type: "session", data: { sessionId: LOCAL_SID, project, repo, agentRef: "master", event: { kind: "turn", data: { role: "assistant", text: ev.data.message } } } });
      } else if (ev.type === "runComplete") setRunning(false);
    }, runOpts);
  } catch (e) {
    applyWatch({ type: "session", data: { sessionId: LOCAL_SID, project, repo, agentRef: "master", event: { kind: "turn", data: { role: "assistant", text: String(e) } } } });
    setRunning(false);
  }
}
