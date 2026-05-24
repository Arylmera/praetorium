import { createSignal } from "solid-js";
import { runClaude } from "./claude";
import { applyWatch, ensureSession, setActiveId } from "./sessionStore";
import type { ClaudeEvent, WatchEvent, SessionEvent } from "./types";

const LOCAL_PROJECT = "local run";

/** True for any locally-launched session id ("local", "local-2", …). */
export function isLocalSession(id: string | null | undefined): id is string {
  return !!id && (id === "local" || id.startsWith("local-"));
}

// Per-session in-flight state, so several local agents can stream at once.
const [runningSessions, setRunningSessions] = createSignal<Set<string>>(new Set());
export function isRunning(sid: string): boolean {
  return runningSessions().has(sid);
}
export function anyRunning(): boolean {
  return runningSessions().size > 0;
}
function setRunning(sid: string, on: boolean) {
  setRunningSessions((prev) => {
    const next = new Set(prev);
    if (on) next.add(sid);
    else next.delete(sid);
    return next;
  });
}

let localCount = 0;
/** Allocate a fresh local session ("local", then "local-2", …), seed it so it
 *  shows in the rail immediately, make it active, and return its id. */
export function newLocalSession(): string {
  localCount += 1;
  const sid = localCount === 1 ? "local" : `local-${localCount}`;
  ensureSession(sid);
  setActiveId(sid);
  return sid;
}

/** Derive the local session's project label from the chosen cwd: its basename,
 *  or "local run" when no cwd is set. Tolerates trailing and Windows separators. */
export function cwdLabel(cwd?: string): string {
  if (!cwd) return LOCAL_PROJECT;
  const trimmed = cwd.replace(/[/\\]+$/, "");
  const base = trimmed.split(/[/\\]/).pop();
  return base || LOCAL_PROJECT;
}

/** Translate a locally-launched run's ClaudeEvent into a WatchEvent so the app's
 *  own run flows through the same sessionStore pipeline as observed sessions —
 *  appearing as a local session in the Console rail and the Cockpit constellation. */
function toWatch(ev: ClaudeEvent, sid: string, project: string): WatchEvent | null {
  const wrap = (agentRef: string, event: SessionEvent): WatchEvent =>
    ({ type: "session", data: { sessionId: sid, project, agentRef, event } });
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

export async function startRun(sid: string, prompt: string, opts?: { cwd?: string; model?: string }): Promise<void> {
  if (isRunning(sid) || !prompt.trim()) return;
  const project = cwdLabel(opts?.cwd);
  const turn = (role: string, text: string): WatchEvent =>
    ({ type: "session", data: { sessionId: sid, project, agentRef: "master", event: { kind: "turn", data: { role, text } } } });
  // Echo the prompt as a user turn in the local session.
  applyWatch(turn("user", prompt));
  setRunning(sid, true);
  try {
    await runClaude(prompt, (ev: ClaudeEvent) => {
      const w = toWatch(ev, sid, project);
      if (w) applyWatch(w);
      else if (ev.type === "result" && ev.data.isError) applyWatch(turn("assistant", ev.data.result));
      else if (ev.type === "runError") applyWatch(turn("assistant", ev.data.message));
      else if (ev.type === "runComplete") setRunning(sid, false);
    }, opts);
  } catch (e) {
    applyWatch(turn("assistant", String(e)));
    setRunning(sid, false);
  }
}
