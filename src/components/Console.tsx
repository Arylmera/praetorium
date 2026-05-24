import { For, Show, createSignal } from "solid-js";
import { sessions, activeId, setActiveId } from "../lib/sessionStore";
import { startRun, running } from "../lib/runStore";

export function Console() {
  const [prompt, setPrompt] = createSignal("");
  const list = () => [...sessions().entries()];
  const active = () => (activeId() ? sessions().get(activeId()!) : undefined);
  async function submit(e: Event) { e.preventDefault(); const p = prompt(); setPrompt(""); await startRun(p); }
  return (
    <div style={{ display: "grid", "grid-template-columns": "240px 1fr", height: "100%" }}>
      <div style={{ overflow: "auto", "border-right": "1px solid var(--border)", padding: "8px" }}>
        <For each={list()}>{([id, s]) => (
          <div onClick={() => setActiveId(id)} style={{ cursor: "pointer", padding: "5px 6px", "font-size": "12px",
            color: id === activeId() ? "var(--accent)" : "var(--fg)" }} title={id}>
            ● {s.project ?? id.slice(0, 8)}
          </div>
        )}</For>
      </div>
      <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
        <div style={{ flex: "1", overflow: "auto", padding: "12px", "font-family": "var(--mono, monospace)", "font-size": "13px" }}>
          <Show when={active()}>
            <For each={active()!.lines}>{(l) => (
              <pre style={{ margin: "4px 0", "white-space": "pre-wrap", color: l.role === "user" ? "var(--accent)" : "var(--fg)" }}>
                <span style={{ color: "var(--accent-dim)", "font-size": "10px" }}>{l.agentRef !== "master" ? `[${l.agentRef}] ` : ""}</span>{l.text}
              </pre>
            )}</For>
          </Show>
        </div>
        <form onSubmit={submit} style={{ display: "flex", gap: "8px", padding: "12px", "border-top": "1px solid var(--border)" }}>
          <input style={{ flex: "1", background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--border)", padding: "8px" }}
            value={prompt()} onInput={(e) => setPrompt(e.currentTarget.value)} placeholder={running() ? "running…" : "Ask Claude (this machine)"} disabled={running()} />
          <button type="submit" disabled={running()}>Run</button>
        </form>
      </div>
    </div>
  );
}
