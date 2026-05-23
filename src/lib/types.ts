// Mirror of Rust ClaudeEvent (serde tag="type", content="data", camelCase).
export type ClaudeEvent =
  | { type: "systemInit"; data: { sessionId: string } }
  | { type: "assistantText"; data: { text: string; parentToolUseId: string | null } }
  | { type: "subagentSpawn"; data: { toolUseId: string; subagentType: string; parentToolUseId: string | null } }
  | { type: "toolCall"; data: { toolUseId: string; name: string; filePath: string | null; parentToolUseId: string | null } }
  | { type: "toolResult"; data: { toolUseId: string; isError: boolean; parentToolUseId: string | null } }
  | { type: "result"; data: { isError: boolean; result: string } }
  | { type: "unknown"; data: { rawType: string } }
  | { type: "runComplete"; data: { exitCode: number } }
  | { type: "runError"; data: { message: string } };

// ---- Graph model (consumed by graph.ts, layout.ts, Cockpit.tsx) ----
export type NodeKind = "master" | "agent" | "folder";
export type NodeStatus = "running" | "complete" | "failed";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  status: NodeStatus;
  weight?: number;
}
export interface GraphEdge {
  id: string;       // `${source}->${target}`
  source: string;
  target: string;
}
export interface ActivityPing {
  folderId: string;
  ts: number;
}
export interface GraphState {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  activity: ActivityPing[];
}

export interface VaultFile { rel: string; name: string; dir: string }
export interface SessionMeta { id: string; mtimeMs: number; title: string; sizeBytes: number }
export interface Turn { role: "user" | "assistant"; text: string; ts: string }
