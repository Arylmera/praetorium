import { createResource, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { SessionMeta, Turn } from "../../lib/types";

const PROJECT_DIR = "C:\\Users\\guill\\.claude\\projects\\C--Users-guill-Documents-git-Terra";

const turnClass = (role: string) => role === "user" ? "pr-turn user" : role === "tool" ? "pr-turn tool" : "pr-turn";

export function Sessions() {
  const [sessions] = createResource(async () => {
    try { return await invoke<SessionMeta[]>("list_sessions", { projectDir: PROJECT_DIR }); }
    catch { return [] as SessionMeta[]; }
  });
  const [turns, setTurns] = createSignal<Turn[]>([]);
  const [err, setErr] = createSignal("");
  const [activeIdSel, setActiveIdSel] = createSignal("");

  async function open(id: string) {
    setErr(""); setActiveIdSel(id);
    try { setTurns(await invoke<Turn[]>("read_session", { path: `${PROJECT_DIR}\\${id}.jsonl` })); }
    catch (e) { setErr(String(e)); setTurns([]); }
  }

  return (
    <div class="pr-sessions-pane">
      <aside class="pr-sess-list">
        <div class="pr-sessions-head">
          <span class="pr-sessions-title">TRANSCRIPTS</span>
          <span class="pr-sessions-sub">archive · {sessions()?.length ?? 0} sessions</span>
        </div>
        <div class="pr-sess-scroll">
          <For each={sessions() ?? []}>{(s) => (
            <div class={`pr-sess-row${s.id === activeIdSel() ? " is-active" : ""}`} onClick={() => open(s.id)}>
              <span class="pr-sess-title">{s.title}</span>
              <span class="pr-sess-meta"><span>{new Date(s.mtimeMs).toLocaleString()}</span></span>
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
