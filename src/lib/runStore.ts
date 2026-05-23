import { createSignal } from "solid-js";
import { runClaude } from "./claude";
import { reduce, emptyGraph } from "./graph";
import type { ClaudeEvent, GraphState } from "./types";

export type TranscriptLine = { kind: "prompt" | "assistant" | "error"; text: string };

const [graph, setGraph] = createSignal<GraphState>(emptyGraph());
const [lines, setLines] = createSignal<TranscriptLine[]>([]);
const [running, setRunning] = createSignal(false);

export { graph, lines, running };

export async function startRun(prompt: string): Promise<void> {
  if (running() || !prompt.trim()) return;
  setLines((p) => [...p, { kind: "prompt", text: prompt }]);
  setGraph(emptyGraph());
  setRunning(true);
  await runClaude(prompt, (ev: ClaudeEvent) => {
    setGraph((g) => reduce(g, ev));
    if (ev.type === "assistantText") setLines((p) => [...p, { kind: "assistant", text: ev.data.text }]);
    else if (ev.type === "result" && ev.data.isError) setLines((p) => [...p, { kind: "error", text: ev.data.result }]);
    else if (ev.type === "runError") setLines((p) => [...p, { kind: "error", text: ev.data.message }]);
    else if (ev.type === "runComplete") setRunning(false);
  });
}
