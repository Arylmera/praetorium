import { createSignal } from "solid-js";

export type ExplorerSub = "files" | "map" | "sessions";

const [sub, setSub] = createSignal<ExplorerSub>("files");
const [pendingNote, setPendingNote] = createSignal<string>("");

export { sub, setSub, pendingNote };

/** Switch to the Files sub-view and request that note be opened. */
export function openNote(rel: string) {
  setPendingNote(rel);
  setSub("files");
}

/** Files calls this once it has consumed a pending note, so the same note can
 *  be requested again later (signals only fire on value change). */
export function clearPendingNote() {
  setPendingNote("");
}
