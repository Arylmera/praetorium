import { invoke, Channel } from "@tauri-apps/api/core";
import type { WatchEvent, LiveSessionMeta } from "./types";

export async function listLiveSessions(): Promise<LiveSessionMeta[]> {
  try { return await invoke<LiveSessionMeta[]>("list_live_sessions"); } catch { return []; }
}

export async function watchSessions(onEvent: (e: WatchEvent) => void): Promise<void> {
  const ch = new Channel<WatchEvent>();
  ch.onmessage = onEvent;
  await invoke("watch_sessions", { onEvent: ch });
}

export async function appCwd(): Promise<string | undefined> {
  try { return (await invoke<string | null>("app_cwd")) ?? undefined; } catch { return undefined; }
}
