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
export type NodeKind = "master" | "agent" | "folder" | "project";
export type NodeStatus = "running" | "complete" | "failed";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  status: NodeStatus;
  session?: string;
  weight?: number;
  community?: number;
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

export type SessionEvent =
  | { kind: "turn"; data: { role: string; text: string } }
  | { kind: "subagentSpawn"; data: { toolUseId: string; subagentType: string } }
  | { kind: "toolActivity"; data: { toolUseId: string; name: string; filePath: string | null } }
  | { kind: "agentDone"; data: { toolUseId: string; isError: boolean } };

export type WatchEvent =
  | { type: "session"; data: { sessionId: string; project: string; agentRef: string; event: SessionEvent } }
  | { type: "state"; data: { sessionId: string; state: string } };

export interface LiveSessionMeta { id: string; project: string; title: string; lastActivityMs: number; state: string }
