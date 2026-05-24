import { createSignal } from "solid-js";
import { runClaude, stopClaude } from "./claude";
import { applyWatch, ensureSession, removeSession, setActiveId, activeId } from "./sessionStore";
import type { ClaudeEvent, WatchEvent, SessionEvent } from "./types";

const LOCAL_PROJECT = "local run";

export type RunStatus = "idle" | "running" | "done" | "failed" | "stopped";

export interface LocalSession {
  sid: string;
  label?: string;
  cwd?: string;
  model?: string;
  claudeSessionId?: string;
  status: RunStatus;
  runId?: string;
}

/** Pure status transition for a session given a streamed event. `stopped` is sticky. */
export function nextStatus(prev: RunStatus, ev: ClaudeEvent): RunStatus {
  if (prev === "stopped") return "stopped";
  switch (ev.type) {
    case "runError":
      return "failed";
    case "result":
      return ev.data.isError ? "failed" : prev;
    case "runComplete":
      return prev === "failed" ? "failed" : "done";
    default:
      return prev;
  }
}

/** True for any locally-launched session id ("local", "local-2", …). */
export function isLocalSession(id: string | null | undefined): id is string {
  return !!id && (id === "local" || id.startsWith("local-"));
}

const [localSessions, setLocalSessions] = createSignal<Map<string, LocalSession>>(new Map());
export { localSessions };

export function isRunning(sid: string): boolean {
  return localSessions().get(sid)?.status === "running";
}
export function anyRunning(): boolean {
  return [...localSessions().values()].some((s) => s.status === "running");
}

function updateSession(sid: string, patch: Partial<LocalSession>) {
  setLocalSessions((prev) => {
    const cur = prev.get(sid);
    if (!cur) return prev;
    return new Map(prev).set(sid, { ...cur, ...patch });
  });
}

let localCount = 0;
/** Allocate a fresh local session ("local", then "local-2", …), seed it so it
 *  shows in the rail immediately, make it active, and return its id. */
export function newLocalSession(): string {
  localCount += 1;
  const sid = localCount === 1 ? "local" : `local-${localCount}`;
  setLocalSessions((prev) => new Map(prev).set(sid, { sid, status: "idle" }));
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
 *  own run flows through the same sessionStore pipeline as observed sessions. */
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
  const s = localSessions().get(sid);
  if (!s || s.status === "running" || !prompt.trim()) return;
  // Lock cwd/model onto the thread on the first run; ignore opts thereafter.
  const cwd = s.cwd ?? opts?.cwd;
  const model = s.model ?? opts?.model;
  const project = s.label ?? cwdLabel(cwd);
  const runId = crypto.randomUUID();
  const resumeId = s.claudeSessionId;
  const turn = (role: string, text: string): WatchEvent =>
    ({ type: "session", data: { sessionId: sid, project, agentRef: "master", event: { kind: "turn", data: { role, text } } } });

  updateSession(sid, { status: "running", runId, cwd, model });
  applyWatch(turn("user", prompt));
  try {
    await runClaude(runId, prompt, (ev: ClaudeEvent) => {
      if (ev.type === "systemInit") updateSession(sid, { claudeSessionId: ev.data.sessionId });
      const w = toWatch(ev, sid, project);
      if (w) applyWatch(w);
      else if (ev.type === "result" && ev.data.isError) applyWatch(turn("assistant", ev.data.result));
      else if (ev.type === "runError") applyWatch(turn("assistant", ev.data.message));
      const prev = localSessions().get(sid)?.status ?? "running";
      updateSession(sid, { status: nextStatus(prev, ev) });
    }, { cwd, model, resumeId });
  } catch (e) {
    applyWatch(turn("assistant", String(e)));
    updateSession(sid, { status: "failed" });
  }
}

export async function stopRun(sid: string): Promise<void> {
  const s = localSessions().get(sid);
  if (!s || s.status !== "running" || !s.runId) return;
  updateSession(sid, { status: "stopped" });
  await stopClaude(s.runId);
}

export async function closeSession(sid: string): Promise<void> {
  const s = localSessions().get(sid);
  if (!s) return;
  if (s.status === "running") await stopRun(sid);
  setLocalSessions((prev) => {
    if (!prev.has(sid)) return prev;
    const next = new Map(prev);
    next.delete(sid);
    return next;
  });
  removeSession(sid);
  if (activeId() === null) {
    const fallback = [...localSessions().keys()][0];
    if (fallback) setActiveId(fallback);
  }
}

export function renameSession(sid: string, label: string) {
  updateSession(sid, { label: label.trim() || undefined });
}
