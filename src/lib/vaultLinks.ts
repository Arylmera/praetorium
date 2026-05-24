import type { NoteLinks } from "./types";

export interface LinkMaps {
  /** rel -> its outgoing resolved link rels. */
  forward: Map<string, string[]>;
  /** rel -> rels of notes that link TO it (reverse index). */
  backward: Map<string, string[]>;
}

/** Build forward + backward adjacency from the Rust `vault_links` output. Pure. */
export function buildLinkMaps(notes: NoteLinks[]): LinkMaps {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const { rel, links } of notes) {
    forward.set(rel, links);
    for (const target of links) {
      const srcs = backward.get(target) ?? [];
      if (!srcs.includes(rel)) srcs.push(rel);
      backward.set(target, srcs);
    }
  }
  return { forward, backward };
}
