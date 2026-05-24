import { createSignal } from "solid-js";
import { reduceWatch, emptyGraph } from "./graph";
import { reduceInsights, emptyInsights } from "./insightsStore";
import type { InsightsState } from "./insightsStore";
import type { WatchEvent, GraphState, LiveSessionMeta } from "./types";
import { listLiveSessions } from "./sessions";

export type TranscriptLine = { agentRef: string; role: string; text: string };

const [sessions, setSessions] = createSignal<Map<string, { project?: string; lines: TranscriptLine[] }>>(new Map());
const [graph, setGraph] = createSignal<GraphState>(emptyGraph());
const [insights, setInsights] = createSignal<InsightsState>(emptyInsights());
const [activeId, setActiveId] = createSignal<string | null>(null);
const [metas, setMetas] = createSignal<Map<string, LiveSessionMeta>>(new Map());
// `${sessionId}:${toolUseId}` -> subagent type, so the Console can name nested agents.
const [subagentTypes, setSubagentTypes] = createSignal<Map<string, string>>(new Map());

export { sessions, graph, insights, activeId, setActiveId, metas, subagentTypes };

export async function refreshMetas(): Promise<void> {
  const list = await listLiveSessions();
  setMetas(new Map(list.map((m) => [m.id, m])));
}

export function applyWatch(e: WatchEvent) {
  if (e.type !== "session") return;
  const { sessionId, project, event, agentRef } = e.data;
  setSessions((prev) => {
    const next = new Map(prev);
    const cur = next.get(sessionId) ?? { project, lines: [] };
    cur.project = cur.project ?? project;
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
