import { createResource, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { SessionMeta, Turn } from "../../lib/types";

const PROJECT_DIR = "C:\\Users\\guill\\.claude\\projects\\C--Users-guill-Documents-git-Terra";

export function Sessions() {
  const [sessions] = createResource(async () => {
    try { return await invoke<SessionMeta[]>("list_sessions", { projectDir: PROJECT_DIR }); }
    catch { return [] as SessionMeta[]; }
  });
  const [turns, setTurns] = createSignal<Turn[]>([]);
  const [err, setErr] = createSignal("");

  async function open(id: string) {
    setErr("");
    try { setTurns(await invoke<Turn[]>("read_session", { path: `${PROJECT_DIR}\\${id}.jsonl` })); }
    catch (e) { setErr(String(e)); setTurns([]); }
  }

  return (
    <div style={{ display: "grid", "grid-template-columns": "280px 1fr", height: "100%" }}>
      <div style={{ overflow: "auto", "border-right": "1px solid var(--border)", padding: "8px" }}>
        <For each={sessions() ?? []}>{(s) => (
          <div onClick={() => open(s.id)} style={{ cursor: "pointer", padding: "4px", "font-size": "12px",
            color: "var(--fg)", "border-bottom": "1px solid var(--border)" }} title={new Date(s.mtimeMs).toLocaleString()}>
            {s.title}
          </div>
        )}</For>
      </div>
      <div style={{ overflow: "auto", padding: "14px" }}>
        <Show when={!err()} fallback={<pre style={{ color: "tomato" }}>{err()}</pre>}>
          <For each={turns()}>{(t) => (
            <div style={{ margin: "8px 0", padding: "8px",
              background: t.role === "user" ? "var(--panel)" : "transparent",
              "border-left": `2px solid ${t.role === "user" ? "var(--accent)" : "var(--accent-dim)"}` }}>
              <div style={{ "font-size": "10px", color: "var(--accent-dim)", "text-transform": "uppercase" }}>{t.role}</div>
              <pre style={{ margin: "2px 0 0", "white-space": "pre-wrap", color: "var(--fg)" }}>{t.text}</pre>
            </div>
          )}</For>
        </Show>
      </div>
    </div>
  );
}
