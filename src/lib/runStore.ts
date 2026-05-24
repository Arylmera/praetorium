import { createSignal } from "solid-js";
import { runClaude } from "./claude";
import { applyWatch } from "./sessionStore";
import type { ClaudeEvent, WatchEvent, SessionEvent } from "./types";

const LOCAL_SID = "local";
const LOCAL_PROJECT = "local run";

const [running, setRunning] = createSignal(false);
export { running };

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
 *  appearing as a "local" session in the Console rail and the Cockpit constellation. */
function toWatch(ev: ClaudeEvent, project: string): WatchEvent | null {
  const wrap = (agentRef: string, event: SessionEvent): WatchEvent =>
    ({ type: "session", data: { sessionId: LOCAL_SID, project, agentRef, event } });
  switch (ev.type) {
    case "assistantText":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "turn", data: { role: "assistant", text: ev.data.text } });
    case "subagentSpawn":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "subagentSpawn", data: { toolUseId: ev.data.toolUseId, subagentType: ev.data.subagentType } });
    case "toolCall":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "toolActivity", data: { toolUseId: ev.data.toolUseId, name: ev.data.name, filePath: ev.data.filePath } });
    case "toolResult":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "agentDone", data: { toolUseId: ev.data.toolUseId, isError: ev.data.isError } });
    default:
      return null;
  }
}

export async function startRun(prompt: string, opts?: { cwd?: string; model?: string }): Promise<void> {
  if (running() || !prompt.trim()) return;
  const project = cwdLabel(opts?.cwd);
  // Echo the prompt as a user turn in the local session.
  applyWatch({ type: "session", data: { sessionId: LOCAL_SID, project, agentRef: "master", event: { kind: "turn", data: { role: "user", text: prompt } } } });
  setRunning(true);
  try {
    await runClaude(prompt, (ev: ClaudeEvent) => {
      const w = toWatch(ev, project);
      if (w) applyWatch(w);
      else if (ev.type === "result" && ev.data.isError) {
        applyWatch({ type: "session", data: { sessionId: LOCAL_SID, project, agentRef: "master", event: { kind: "turn", data: { role: "assistant", text: ev.data.result } } } });
      } else if (ev.type === "runError") {
        applyWatch({ type: "session", data: { sessionId: LOCAL_SID, project, agentRef: "master", event: { kind: "turn", data: { role: "assistant", text: ev.data.message } } } });
      } else if (ev.type === "runComplete") setRunning(false);
    }, opts);
  } catch (e) {
    applyWatch({ type: "session", data: { sessionId: LOCAL_SID, project, agentRef: "master", event: { kind: "turn", data: { role: "assistant", text: String(e) } } } });
    setRunning(false);
  }
}
