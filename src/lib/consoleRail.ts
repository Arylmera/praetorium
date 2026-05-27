import type { RunStatus } from "./runStore";
import { cwdLabel, repoLabel } from "./runStore";

export interface RailSub { ref: string; name: string; steps: number }
export interface RailEntry {
  id: string;
  title: string;
  owned: boolean;
  observed: boolean;
  status?: RunStatus;
  failCount: number;
  lastActivityMs: number;
  cwd?: string;
  subagents: RailSub[];
}
export interface RailGroup {
  dir: string;
  label: string;
  repo?: string;
  sessions: RailEntry[];
}

/** Group rail entries by their working directory. Entries with no cwd fall back
 *  to `appCwd`; if that is also undefined they collect under an empty-key group.
 *  Sessions sort newest-first within a group; groups sort by their newest member. */
export function buildRail(entries: RailEntry[], appCwd?: string): RailGroup[] {
  const groups = new Map<string, RailEntry[]>();
  for (const e of entries) {
    const dir = e.cwd ?? appCwd ?? "";
    (groups.get(dir) ?? groups.set(dir, []).get(dir)!).push(e);
  }
  const out: RailGroup[] = [];
  for (const [dir, sessions] of groups) {
    sessions.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
    out.push({ dir, label: dir ? cwdLabel(dir) : "local", repo: repoLabel(dir), sessions });
  }
  out.sort((a, b) => (b.sessions[0]?.lastActivityMs ?? 0) - (a.sessions[0]?.lastActivityMs ?? 0));
  return out;
}
