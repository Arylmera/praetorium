// Pure view-model joining the three live stores (graph topology, insights
// per-call data, session metas) into the fields the Cockpit renders. No Solid
// signals here so every function is unit-testable as plain (in) → (out).
import type { GraphState, GraphNode, LiveSessionMeta, NodeStatus } from "./types";
import type { InsightsState, ToolCall } from "./insightsStore";

// ---- tool categorization --------------------------------------------------
export type ToolCategory = "read" | "edit" | "bash" | "web" | "search" | "other";

export function toolCategory(name: string): ToolCategory {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return "read";
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return "edit";
    case "Bash":
      return "bash";
    case "WebFetch":
    case "WebSearch":
      return "web";
    case "Grep":
    case "Glob":
      return "search";
    default:
      return "other";
  }
}

/** Pulse / swatch color per tool category (CSS var references; resolved by the DOM). */
export const CATEGORY_COLOR: Record<ToolCategory, string> = {
  read: "var(--accent)",
  edit: "var(--warn)",
  bash: "var(--good)",
  web: "#b98bf0",
  search: "var(--gull)",
  other: "var(--gull-2)",
};

/** A node is "idle" once it has gone this long without observed activity. */
export const IDLE_MS = 30_000;
/** calls-in-last-10s that maps to full heat intensity. */
const RATE_FULL = 6;
const RECENT_WINDOW_MS = 10_000;
const SPARK_BUCKETS = 60; // one per second, last 60s

// ---- per-node liveness ----------------------------------------------------
export interface NodeLive {
  callCount: number;
  failCount: number;
  lastActivityMs?: number;
  idleMs?: number;
  recentRate: number; // 0..1
  lastTool?: ToolCategory;
}

/** Graph node id a session+agentRef maps to (mirrors graph.ts attribution). */
const nodeIdFor = (sid: string, agentRef: string) =>
  agentRef === "master" ? `${sid}:master` : `${sid}:${agentRef}`;

const callEdgeMs = (c: ToolCall) => Math.max(c.startMs, c.endMs ?? c.startMs);

/** Per agent/master node liveness derived from insights, keyed by graph node id. */
export function buildNodeLive(insights: InsightsState, nowMs: number): Map<string, NodeLive> {
  // Accumulate raw fields, then derive idle/rate.
  type Acc = { count: number; fails: number; last: number; recent: number; lastStart: number; lastTool?: ToolCategory };
  const acc = new Map<string, Acc>();
  for (const [sid, calls] of insights) {
    for (const c of calls) {
      const id = nodeIdFor(sid, c.agentRef);
      const a = acc.get(id) ?? { count: 0, fails: 0, last: -Infinity, recent: 0, lastStart: -Infinity };
      a.count++;
      if (c.status === "error") a.fails++;
      const edge = callEdgeMs(c);
      if (edge > a.last) a.last = edge;
      if (c.startMs >= a.lastStart) { a.lastStart = c.startMs; a.lastTool = toolCategory(c.name); }
      if (nowMs - c.startMs <= RECENT_WINDOW_MS) a.recent++;
      acc.set(id, a);
    }
  }
  const out = new Map<string, NodeLive>();
  for (const [id, a] of acc) {
    const lastActivityMs = a.last === -Infinity ? undefined : a.last;
    out.set(id, {
      callCount: a.count,
      failCount: a.fails,
      lastActivityMs,
      idleMs: lastActivityMs === undefined ? undefined : Math.max(0, nowMs - lastActivityMs),
      recentRate: Math.min(1, a.recent / RATE_FULL),
      lastTool: a.lastTool,
    });
  }
  return out;
}

// ---- machine-wide aggregates ----------------------------------------------
export interface CockpitAggregates {
  agents: number;
  sessions: number;
  fails: number;
  idle: number;
  folders: number;
  callsPerSec: number[]; // length SPARK_BUCKETS, oldest → newest
}

/** Idle if no node-live activity yet, or stale beyond IDLE_MS. */
const isIdle = (live: NodeLive | undefined) =>
  !live || live.idleMs === undefined || live.idleMs > IDLE_MS;

export function buildAggregates(
  graph: GraphState,
  live: Map<string, NodeLive>,
  insights: InsightsState,
  nowMs: number,
): CockpitAggregates {
  let agents = 0, sessions = 0, folders = 0, fails = 0, idle = 0;
  for (const n of graph.nodes.values()) {
    if (n.kind === "agent") agents++;
    else if (n.kind === "master") sessions++;
    else if (n.kind === "folder") folders++;
    if (n.kind === "agent" || n.kind === "master") {
      if (n.status === "failed") fails++;
      // Idle = running but quiet; finished (complete/failed) nodes aren't "idle".
      if (n.status === "running" && isIdle(live.get(n.id))) idle++;
    }
  }
  // Sparkline: bucket every call's startMs into the last SPARK_BUCKETS seconds.
  const callsPerSec = new Array<number>(SPARK_BUCKETS).fill(0);
  const windowMs = SPARK_BUCKETS * 1000;
  for (const calls of insights.values()) {
    for (const c of calls) {
      const age = nowMs - c.startMs;
      if (age < 0 || age >= windowMs) continue;
      const bucket = SPARK_BUCKETS - 1 - Math.floor(age / 1000);
      if (bucket >= 0 && bucket < SPARK_BUCKETS) callsPerSec[bucket]++;
    }
  }
  return { agents, sessions, folders, fails, idle, callsPerSec };
}

// ---- selected-node detail -------------------------------------------------
export interface DetailCall {
  tool: ToolCategory;
  name: string;
  target?: string;
  status: "running" | "ok" | "error";
  durMs?: number;
}
export interface NodeDetail {
  sessionId?: string;
  kind: GraphNode["kind"];
  label: string;
  state: string;
  project?: string;
  durationMs?: number;
  fails: number;
  calls: number;
  idleMs?: number;
  recentCalls: DetailCall[];
  subagents: { label: string; status: NodeStatus }[];
  folders: string[];
}

const MAX_DETAIL_CALLS = 8;

/** Outgoing targets of `id` whose node has the given kind. */
function targetsOfKind(graph: GraphState, id: string, kind: GraphNode["kind"]): GraphNode[] {
  const out: GraphNode[] = [];
  for (const e of graph.edges.values()) {
    if (e.source !== id) continue;
    const t = graph.nodes.get(e.target);
    if (t && t.kind === kind) out.push(t);
  }
  return out;
}

export function buildDetail(
  graph: GraphState,
  nodeId: string,
  insights: InsightsState,
  metas: Map<string, LiveSessionMeta>,
  nowMs: number,
): NodeDetail | null {
  const node = graph.nodes.get(nodeId);
  if (!node) return null;

  const sid = node.session;
  const meta = sid ? metas.get(sid) : undefined;
  const all = sid ? insights.get(sid) ?? [] : [];

  // Master → whole-session calls; agent → that agent's calls only.
  let scoped = all;
  if (node.kind === "agent" && sid) {
    const ref = nodeId.startsWith(`${sid}:`) ? nodeId.slice(sid.length + 1) : nodeId;
    scoped = all.filter((c) => c.agentRef === ref);
  } else if (node.kind === "master") {
    // master node id is `${sid}:master`; keep every call in the session.
    scoped = all;
  }

  const fails = scoped.reduce((n, c) => n + (c.status === "error" ? 1 : 0), 0);
  const starts = scoped.map((c) => c.startMs);
  const ends = scoped.map(callEdgeMs);
  const firstStart = starts.length ? Math.min(...starts) : undefined;
  const lastEdge = ends.length ? Math.max(...ends) : undefined;
  const durationMs = firstStart !== undefined && lastEdge !== undefined ? lastEdge - firstStart : undefined;
  const idleMs = lastEdge !== undefined ? Math.max(0, nowMs - lastEdge) : undefined;

  const recentCalls: DetailCall[] = scoped
    .slice(-MAX_DETAIL_CALLS)
    .map((c) => ({
      tool: toolCategory(c.name),
      name: c.name,
      target: c.filePath ?? undefined,
      status: c.status,
      durMs: c.endMs !== undefined ? c.endMs - c.startMs : undefined,
    }));

  const subagents = targetsOfKind(graph, nodeId, "agent").map((a) => ({ label: a.label, status: a.status }));

  // Folders touched = folders linked from this node and from its subagent children.
  const folderSet = new Set<string>();
  for (const f of targetsOfKind(graph, nodeId, "folder")) folderSet.add(f.label);
  for (const a of subagents.length ? targetsOfKind(graph, nodeId, "agent") : []) {
    for (const f of targetsOfKind(graph, a.id, "folder")) folderSet.add(f.label);
  }

  return {
    sessionId: sid,
    kind: node.kind,
    label: node.label,
    state: meta?.state ?? node.status,
    project: node.kind === "master" ? node.label : undefined,
    durationMs,
    fails,
    calls: scoped.length,
    idleMs,
    recentCalls,
    subagents,
    folders: [...folderSet],
  };
}
