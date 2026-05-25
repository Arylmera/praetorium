import type { ClaudeEvent, GraphEdge, GraphState, WatchEvent } from "./types";

export const MASTER_ID = "__master__";

export function emptyGraph(): GraphState {
  return { nodes: new Map(), edges: new Map(), activity: [] };
}

function dirname(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i <= 0 ? norm : norm.slice(0, i);
}

function ensureMaster(s: GraphState): void {
  if (!s.nodes.has(MASTER_ID)) {
    s.nodes.set(MASTER_ID, { id: MASTER_ID, kind: "master", label: "master", status: "running" });
  }
}

function addEdge(s: GraphState, source: string, target: string): void {
  const id = `${source}->${target}`;
  if (!s.edges.has(id)) s.edges.set(id, { id, source, target });
}

// Resolve which agent owns an event: master when parent is null, else the agent node
// keyed by that tool_use id (falls back to master if the agent isn't known yet).
function ownerId(s: GraphState, parent: string | null): string {
  if (parent && s.nodes.has(parent)) return parent;
  return MASTER_ID;
}

/** Pure: returns a NEW state with the event applied. */
export function reduce(prev: GraphState, ev: ClaudeEvent): GraphState {
  const s: GraphState = {
    nodes: new Map(prev.nodes),
    edges: new Map(prev.edges),
    activity: prev.activity,
  };
  switch (ev.type) {
    case "systemInit":
    case "assistantText": {
      ensureMaster(s);
      return s;
    }
    case "subagentSpawn": {
      ensureMaster(s);
      const id = ev.data.toolUseId;
      s.nodes.set(id, { id, kind: "agent", label: ev.data.subagentType || "agent", status: "running" });
      addEdge(s, ownerId(s, ev.data.parentToolUseId), id);
      return s;
    }
    case "toolCall": {
      ensureMaster(s);
      const owner = ownerId(s, ev.data.parentToolUseId);
      if (ev.data.filePath) {
        const folderId = dirname(ev.data.filePath);
        if (!s.nodes.has(folderId)) {
          s.nodes.set(folderId, { id: folderId, kind: "folder", label: folderId, status: "running" });
        }
        addEdge(s, owner, folderId);
        s.activity = [...s.activity, { folderId, ts: Date.now(), tool: ev.data.name }];
      }
      return s;
    }
    case "toolResult": {
      const node = s.nodes.get(ev.data.toolUseId);
      if (node && node.kind === "agent") {
        s.nodes.set(node.id, { ...node, status: ev.data.isError ? "failed" : "complete" });
      }
      return s;
    }
    case "result":
    case "runComplete": {
      const m = s.nodes.get(MASTER_ID);
      if (m) s.nodes.set(MASTER_ID, { ...m, status: "complete" });
      return s;
    }
    default:
      return s; // unknown / runError: ignore for graph purposes
  }
}

const sessionMaster = (sid: string) => `${sid}:master`;

/** Pure: drop every node owned by `sessionId` (its master + agents, tagged via
 *  `node.session`) and any edge touching them. Shared project/folder nodes and
 *  global folder-activity stay — other sessions may still reference them. */
export function clearSession(prev: GraphState, sessionId: string): GraphState {
  const nodes = new Map(prev.nodes);
  for (const [id, n] of prev.nodes) if (n.session === sessionId) nodes.delete(id);
  const edges = new Map<string, GraphEdge>();
  for (const [id, e] of prev.edges) if (nodes.has(e.source) && nodes.has(e.target)) edges.set(id, e);
  return { nodes, edges, activity: prev.activity };
}

/** Fold a WatchEvent into the shared constellation graph.
 *  Agent/master nodes are namespaced per session; folder nodes are GLOBAL
 *  (keyed by absolute path) so sessions touching the same folder share a node. */
export function reduceWatch(prev: GraphState, e: WatchEvent): GraphState {
  if (e.type !== "session") return prev;
  const s: GraphState = { nodes: new Map(prev.nodes), edges: new Map(prev.edges), activity: prev.activity };
  const { sessionId, agentRef, event } = e.data;
  const masterId = sessionMaster(sessionId);
  if (!s.nodes.has(masterId)) {
    s.nodes.set(masterId, { id: masterId, kind: "master", label: e.data.project || sessionId.slice(0, 6), status: "running", session: sessionId });
  }
  const projectId = `proj:${e.data.project}`;
  if (!s.nodes.has(projectId)) {
    s.nodes.set(projectId, { id: projectId, kind: "project", label: e.data.project, status: "running" });
  }
  // Worktree sessions nest one level deeper: the parent repo node owns the
  // worktree (project) node, which owns the master. All worktrees of a repo
  // thus collapse under a single repo node instead of floating as siblings.
  if (e.data.repo && e.data.repo !== e.data.project) {
    const repoId = `proj:${e.data.repo}`;
    if (!s.nodes.has(repoId)) s.nodes.set(repoId, { id: repoId, kind: "project", label: e.data.repo, status: "running" });
    addEdge(s, repoId, projectId);
  }
  addEdge(s, projectId, masterId);
  const ownerId = agentRef === "master" ? masterId : `${sessionId}:${agentRef}`;
  switch (event.kind) {
    case "subagentSpawn": {
      const id = `${sessionId}:${event.data.toolUseId}`;
      s.nodes.set(id, { id, kind: "agent", label: event.data.subagentType || "agent", status: "running", session: sessionId });
      addEdge(s, masterId, id);
      return s;
    }
    case "toolActivity": {
      if (event.data.filePath) {
        const folderId = dirname(event.data.filePath);
        if (!s.nodes.has(folderId)) s.nodes.set(folderId, { id: folderId, kind: "folder", label: folderId, status: "running" });
        if (ownerId !== masterId && !s.nodes.has(ownerId)) {
          s.nodes.set(ownerId, { id: ownerId, kind: "agent", label: agentRef, status: "running", session: sessionId });
        }
        // Always keep a subagent attached to its session master, even if its spawn
        // event was never seen (e.g. the session predates the watcher) — no orphans.
        if (ownerId !== masterId) addEdge(s, masterId, ownerId);
        addEdge(s, ownerId, folderId);
        s.activity = [...s.activity, { folderId, ts: Date.now(), tool: event.data.name }];
      }
      return s;
    }
    case "toolDone": {
      // Subagent completion: a spawn's tool_use_id IS its agent node id.
      const id = `${sessionId}:${event.data.toolUseId}`;
      const node = s.nodes.get(id);
      if (node && node.kind === "agent") s.nodes.set(id, { ...node, status: event.data.isError ? "failed" : "complete" });
      // Failure radar: an errored call marks the agent/master node that owns it failed.
      if (event.data.isError) {
        const owner = s.nodes.get(ownerId);
        if (owner && (owner.kind === "agent" || owner.kind === "master")) {
          s.nodes.set(ownerId, { ...owner, status: "failed" });
        }
      }
      return s;
    }
    default:
      return s; // turn: console only
  }
}
