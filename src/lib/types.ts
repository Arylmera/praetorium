// Mirror of Rust ClaudeEvent (serde tag="type", content="data", camelCase).
export type ClaudeEvent =
  | { type: "systemInit"; data: { sessionId: string } }
  | { type: "assistantText"; data: { text: string } }
  | { type: "result"; data: { isError: boolean; result: string } }
  | { type: "unknown"; data: { rawType: string } }
  | { type: "runComplete"; data: { exitCode: number } }
  | { type: "runError"; data: { message: string } };
