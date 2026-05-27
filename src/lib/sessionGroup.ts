import type { SessionMeta } from "./types";

export function groupByLocation(sessions: SessionMeta[]): [string, SessionMeta[]][] {
  const m = new Map<string, SessionMeta[]>();
  for (const s of sessions) (m.get(s.location) ?? m.set(s.location, []).get(s.location)!).push(s);
  for (const arr of m.values()) arr.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return [...m.entries()].sort((a, b) => b[1][0].mtimeMs - a[1][0].mtimeMs);
}

/** Group items into [key, items][] preserving first-seen order of both the keys
 *  and the items within each key. Used for the Console's live-session rail, where
 *  rows have no mtime to sort on and we want a stable list order. */
export function groupBy<T>(items: T[], keyOf: (item: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const arr = m.get(k);
    if (arr) arr.push(it); else m.set(k, [it]);
  }
  return [...m.entries()];
}

export function relativeTime(ms: number, now: number = Date.now()): string {
  const d = Math.max(0, now - ms);
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
