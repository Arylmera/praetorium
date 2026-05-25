import type { SessionMeta } from "./types";

export function groupByLocation(sessions: SessionMeta[]): [string, SessionMeta[]][] {
  const m = new Map<string, SessionMeta[]>();
  for (const s of sessions) (m.get(s.location) ?? m.set(s.location, []).get(s.location)!).push(s);
  for (const arr of m.values()) arr.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return [...m.entries()].sort((a, b) => b[1][0].mtimeMs - a[1][0].mtimeMs);
}

export function relativeTime(ms: number, now: number = Date.now()): string {
  const d = Math.max(0, now - ms);
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
