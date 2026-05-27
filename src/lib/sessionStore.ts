import { createSignal } from "solid-js";
import { reduceWatch, emptyGraph, clearSession as clearGraphSession } from "./graph";
import { reduceInsights, emptyInsights } from "./insightsStore";
import type { InsightsState } from "./insightsStore";
import type { WatchEvent, GraphState, LiveSessionMeta } from "./types";
import { listLiveSessions } from "./sessions";

export type TranscriptLine = { agentRef: string; role: string; text: string };

const [sessions, setSessions] = createSignal<Map<string, { project?: string; repo?: string; lines: TranscriptLine[] }>>(new Map());
const [graph, setGraph] = createSignal<GraphState>(emptyGraph());
const [insights, setInsights] = createSignal<InsightsState>(emptyInsights());
// Default focus is the synthetic local console so its input shows on load and
// an externally-observed session arriving first doesn't steal focus (and hide it).
const [activeId, setActiveId] = createSignal<string | null>("local");
const [metas, setMetas] = createSignal<Map<string, LiveSessionMeta>>(new Map());
// `${sessionId}:${toolUseId}` -> subagent type, so the Console can name nested agents.
const [subagentTypes, setSubagentTypes] = createSignal<Map<string, string>>(new Map());

export { sessions, graph, insights, activeId, setActiveId, metas, subagentTypes };

/** Wipe one session from every live store (transcript, insights, subagent names,
 *  constellation graph). Used by the Console's NEW button to reset the local run. */
export function clearSession(id: string): void {
  setSessions((prev) => { const next = new Map(prev); next.delete(id); return next; });
  setInsights((prev) => { const next = new Map(prev); next.delete(id); return next; });
  setSubagentTypes((prev) => {
    const next = new Map(prev);
    for (const k of prev.keys()) if (k.startsWith(`${id}:`)) next.delete(k);
    return next;
  });
  setGraph((g) => clearGraphSession(g, id));
}

/** Seed an empty session so it appears in the rail before any turns arrive.
 *  No-op if the session already exists. */
export function ensureSession(sid: string, project?: string) {
  setSessions((prev) => {
    if (prev.has(sid)) return prev;
    return new Map(prev).set(sid, { project, lines: [] });
  });
}

/** Remove a session entirely (used when closing a local session). */
export function removeSession(sid: string) {
  setSessions((prev) => {
    if (!prev.has(sid)) return prev;
    const next = new Map(prev);
    next.delete(sid);
    return next;
  });
  if (activeId() === sid) setActiveId(null);
}

export async function refreshMetas(): Promise<void> {
  const list = await listLiveSessions();
  setMetas(new Map(list.map((m) => [m.id, m])));
}

export function applyWatch(e: WatchEvent) {
  if (e.type !== "session") return;
  const { sessionId, project, repo, event, agentRef } = e.data;
  setSessions((prev) => {
    const next = new Map(prev);
    const cur = next.get(sessionId) ?? { project, repo: repo ?? undefined, lines: [] };
    cur.project = cur.project ?? project;
    cur.repo = cur.repo ?? repo ?? undefined;
    if (event.kind === "turn") {
      cur.lines = [...cur.lines.slice(-499), { agentRef, role: event.data.role, text: event.data.text }];
    }
    next.set(sessionId, cur);
    return next;
  });
  if (event.kind === "subagentSpawn") {
    setSubagentTypes((prev) => new Map(prev).set(`${sessionId}:${event.data.toolUseId}`, event.data.subagentType || "agent"));
  }
  setGraph((g) => reduceWatch(g, e));
  // Stamp arrival time here (live-only scope): the insights store has no Rust timestamps.
  setInsights((i) => reduceInsights(i, e, Date.now()));
  if (activeId() === null) setActiveId(sessionId);
}
