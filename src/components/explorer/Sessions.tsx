import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { vaultPath } from "../../lib/vaultStore";
import { groupByLocation, relativeTime } from "../../lib/sessionGroup";
import type { SessionMeta, Turn } from "../../lib/types";

const turnClass = (role: string) => role === "user" ? "pr-turn user" : role === "tool" ? "pr-turn tool" : "pr-turn";
const shortLoc = (loc: string) => loc.replace(/\\/g, "/").split("/").filter(Boolean).slice(-2).join("/") || loc;

export function Sessions() {
  const [sessions] = createResource(async () => {
    try { return await invoke<SessionMeta[]>("list_all_sessions"); }
    catch { return [] as SessionMeta[]; }
  });
  const groups = createMemo(() => groupByLocation(sessions() ?? []));
  const [turns, setTurns] = createSignal<Turn[]>([]);
  const [err, setErr] = createSignal("");
  const [activeIdSel, setActiveIdSel] = createSignal("");
  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const isCurrentVault = (loc: string) => !!vaultPath() && loc.replace(/\\/g, "/") === vaultPath().replace(/\\/g, "/");

  // Open the current-vault group (and the newest group) by default once loaded.
  const ensureDefaults = createMemo(() => {
    const g = groups();
    if (!g.length) return new Set<string>();
    const next = new Set<string>([g[0][0]]);
    for (const [loc] of g) if (isCurrentVault(loc)) next.add(loc);
    return next;
  });

  function toggle(loc: string) {
    setOpen((prev) => {
      const base = prev.size ? prev : ensureDefaults();
      const next = new Set(base);
      next.has(loc) ? next.delete(loc) : next.add(loc);
      return next;
    });
  }
  const isOpen = (loc: string) => (open().size ? open() : ensureDefaults()).has(loc);

  async function openSession(s: SessionMeta) {
    setErr(""); setActiveIdSel(s.id);
    try { setTurns(await invoke<Turn[]>("read_session", { path: `${s.projectDir}\\${s.id}.jsonl` })); }
    catch (e) { setErr(String(e)); setTurns([]); }
  }

  return (
    <div class="pr-sessions-pane">
      <aside class="pr-sess-list">
        <div class="pr-sessions-head">
          <span class="pr-sessions-title">TRANSCRIPTS</span>
          <span class="pr-sessions-sub">archive · {sessions()?.length ?? 0} sessions · {groups().length} locations</span>
        </div>
        <div class="pr-sess-scroll">
          <For each={groups()}>{([loc, items]) => (
            <div class="pr-sess-group">
              <div class={`pr-sess-loc${isCurrentVault(loc) ? " is-current" : ""}`} onClick={() => toggle(loc)} title={loc}>
                <span class="pr-folder-chevron">{isOpen(loc) ? "▾" : "▸"}</span>
                <span class="pr-sess-loc-name">{shortLoc(loc)}</span>
                <span class="pr-folder-count">{items.length}</span>
                <span class="pr-sess-loc-time">{relativeTime(items[0].mtimeMs)}</span>
              </div>
              <Show when={isOpen(loc)}>
                <For each={items}>{(s) => (
                  <div class={`pr-sess-row${s.id === activeIdSel() ? " is-active" : ""}`} onClick={() => openSession(s)}>
                    <span class="pr-sess-title">{s.title}</span>
                    <span class="pr-sess-meta"><span>{relativeTime(s.mtimeMs)}</span></span>
                  </div>
                )}</For>
              </Show>
            </div>
          )}</For>
        </div>
      </aside>
      <section class="pr-transcript">
        <Show when={!err()} fallback={<pre style={{ color: "var(--bad)" }}>{err()}</pre>}>
          <For each={turns()}>{(t) => (
            <div class={turnClass(t.role)}>
              <div class="role"><span class="tag">{t.role}</span></div>
              <pre>{t.text}</pre>
            </div>
          )}</For>
        </Show>
      </section>
    </div>
  );
}
