import { Channel, invoke } from "@tauri-apps/api/core";
import type { ClaudeEvent } from "./types";

/** Run a prompt; `onEvent` fires for every streamed event. Resolves once spawn returns. */
export async function runClaude(
  prompt: string,
  onEvent: (event: ClaudeEvent) => void,
  opts?: { cwd?: string; model?: string },
): Promise<void> {
  const channel = new Channel<ClaudeEvent>();
  channel.onmessage = onEvent;
  await invoke("run_claude", { prompt, cwd: opts?.cwd, model: opts?.model, onEvent: channel });
}
