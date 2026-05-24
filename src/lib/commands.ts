import type { View } from "../components/ViewSwitcher";
import type { LiveSessionMeta } from "./types";
import { sessions as sessionsStore, metas as metasStore, setActiveId } from "./sessionStore";
import { themedCopy as themedCopyStore } from "../themes/theme";
import { setView } from "./viewStore";

export type CommandGroup = "Navigate" | "Session";
export type Command = {
  id: string;
  title: string;
  group: CommandGroup;
  hint?: string;
  run: () => void;
};

/* The four navigable views, in the same order the ViewSwitcher renders them. */
const NAV_VIEWS: View[] = ["console", "cockpit", "explorer", "settings"];

/* Dependencies are injectable so buildCommands stays unit-testable without
   touching the live stores. Defaults wire up the real signals. */
export interface BuildDeps {
  sessions?: () => ReadonlyMap<string, { readonly project?: string }>;
  metas?: () => ReadonlyMap<string, LiveSessionMeta>;
  themedCopy?: () => { nav: Record<View, string> } | undefined;
  setView?: (v: View) => void;
  setActiveId?: (id: string) => void;
}

export function buildCommands(deps: BuildDeps = {}): Command[] {
  const sessions = deps.sessions ?? sessionsStore;
  const metas = deps.metas ?? metasStore;
  const themedCopy = deps.themedCopy ?? themedCopyStore;
  const navTo = deps.setView ?? ((v: View) => setView(v));
  const activate = deps.setActiveId ?? ((id: string) => setActiveId(id));

  const nav: Command[] = NAV_VIEWS.map((v) => ({
    id: `nav:${v}`,
    title: themedCopy()?.nav[v] ?? v,
    group: "Navigate",
    run: () => navTo(v),
  }));

  const session: Command[] = [...sessions().keys()].map((id) => {
    const meta = metas().get(id);
    const project = sessions().get(id)?.project ?? meta?.project;
    return {
      id: `session:${id}`,
      title: meta?.title ?? project ?? id.slice(0, 8),
      group: "Session" as const,
      hint: project,
      run: () => { activate(id); navTo("console"); },
    };
  });

  return [...nav, ...session];
}

/* Pure, case-insensitive substring filter over title (+ hint). Empty query
   returns the list unchanged, preserving group order. */
export function filterCommands(list: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      (c.hint?.toLowerCase().includes(q) ?? false),
  );
}
