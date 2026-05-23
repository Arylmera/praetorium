import type { ClaudeEvent, GraphState } from "./types";

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
        s.activity = [...s.activity, { folderId, ts: Date.now() }];
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
