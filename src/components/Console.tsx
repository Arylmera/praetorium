import { For, Show, createSignal } from "solid-js";
import { sessions, activeId, setActiveId, metas, subagentTypes } from "../lib/sessionStore";
import { startRun, running } from "../lib/runStore";

export function Console() {
  const [prompt, setPrompt] = createSignal("");
  // Show only live sessions (in the index, active within ~10 min) + the local run; hide archived.
  const list = () => [...sessions().entries()].filter(([id]) => id === "local" || metas().has(id));
  const active = () => (activeId() ? sessions().get(activeId()!) : undefined);
  async function submit(e: Event) { e.preventDefault(); const p = prompt(); setPrompt(""); await startRun(p); }
  return (
    <div style={{ display: "grid", "grid-template-columns": "240px 1fr", height: "100%" }}>
      <div style={{ overflow: "auto", "border-right": "1px solid var(--border)", padding: "8px" }}>
        <For each={list()}>{([id, s]) => {
          const m = () => metas().get(id);
          return (
            <div onClick={() => setActiveId(id)} style={{ cursor: "pointer", padding: "5px 6px", "font-size": "12px",
              color: id === activeId() ? "var(--accent)" : "var(--fg)" }} title={id}>
              ● {m()?.title ?? s.project ?? id.slice(0, 8)}
              <div style={{ "font-size": "10px", color: "var(--accent-dim)" }}>{m()?.project ?? ""}</div>
            </div>
          );
        }}</For>
      </div>
      <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
        <div style={{ flex: "1", overflow: "auto", padding: "12px", "font-family": "var(--mono, monospace)", "font-size": "13px" }}>
          <Show when={active()}>
            <For each={active()!.lines}>{(l) => {
              const isSub = l.agentRef !== "master";
              const subName = () => subagentTypes().get(`${activeId()}:${l.agentRef}`) ?? l.agentRef;
              return (
                <div style={{ "margin-left": isSub ? "20px" : "0",
                  "border-left": isSub ? "2px solid var(--accent-dim)" : "none",
                  "padding-left": isSub ? "8px" : "0", margin: "4px 0" }}>
                  <Show when={isSub}>
                    <div style={{ color: "var(--accent-dim)", "font-size": "10px", "text-transform": "uppercase", "letter-spacing": "1px" }}>⤷ {subName()}</div>
                  </Show>
                  <pre style={{ margin: "2px 0", "white-space": "pre-wrap",
                    color: l.role === "user" ? "var(--accent)" : "var(--fg)" }}>{l.text}</pre>
                </div>
              );
            }}</For>
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
