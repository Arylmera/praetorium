import { Channel, invoke } from "@tauri-apps/api/core";
import type { ClaudeEvent } from "./types";

/** Run a prompt; `onEvent` fires for every streamed event. Resolves once spawn returns. */
export async function runClaude(
  runId: string,
  prompt: string,
  onEvent: (event: ClaudeEvent) => void,
  opts?: { cwd?: string; model?: string; resumeId?: string },
): Promise<void> {
  const channel = new Channel<ClaudeEvent>();
  channel.onmessage = onEvent;
  await invoke("run_claude", {
    runId,
    prompt,
    cwd: opts?.cwd,
    model: opts?.model,
    resumeId: opts?.resumeId,
    onEvent: channel,
  });
}

/** Kill an in-flight run by its run id. */
export async function stopClaude(runId: string): Promise<void> {
  await invoke("stop_claude", { runId });
}
