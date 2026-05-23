import { createSignal, For } from "solid-js";
import { lines, running, startRun } from "../lib/runStore";

export function Console() {
  const [prompt, setPrompt] = createSignal("");
  async function submit(e: Event) {
    e.preventDefault();
    const p = prompt();
    setPrompt("");
    await startRun(p);
  }
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div style={{ flex: "1", overflow: "auto", padding: "12px" }}>
        <For each={lines()}>{(l) => (
          <pre style={{ margin: "4px 0", "white-space": "pre-wrap",
            color: l.kind === "error" ? "tomato" : l.kind === "prompt" ? "var(--accent)" : "var(--fg)" }}>
            {l.kind === "prompt" ? "> " : ""}{l.text}
          </pre>
        )}</For>
      </div>
      <form onSubmit={submit} style={{ display: "flex", gap: "8px", padding: "12px", "border-top": "1px solid var(--border)" }}>
        <input style={{ flex: "1", background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--border)", padding: "8px" }}
          value={prompt()} onInput={(e) => setPrompt(e.currentTarget.value)}
          placeholder={running() ? "running…" : "Ask Claude"} disabled={running()} />
        <button type="submit" disabled={running()}>Run</button>
      </form>
    </div>
  );
}
