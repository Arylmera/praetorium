import { createSignal, For } from "solid-js";
import { runClaude } from "../lib/claude";

type Line = { kind: "prompt" | "assistant" | "result" | "error"; text: string };

export function Console() {
  const [prompt, setPrompt] = createSignal("");
  const [lines, setLines] = createSignal<Line[]>([]);
  const [running, setRunning] = createSignal(false);
  const push = (l: Line) => setLines((prev) => [...prev, l]);

  async function submit(e: Event) {
    e.preventDefault();
    const p = prompt().trim();
    if (!p || running()) return;
    push({ kind: "prompt", text: p });
    setPrompt("");
    setRunning(true);
    await runClaude(p, (ev) => {
      if (ev.type === "assistantText") push({ kind: "assistant", text: ev.data.text });
      // The success `result` repeats the final assistant text — only surface it on error.
      else if (ev.type === "result") { if (ev.data.isError) push({ kind: "error", text: ev.data.result }); }
      else if (ev.type === "runError") push({ kind: "error", text: ev.data.message });
      else if (ev.type === "runComplete") setRunning(false);
    });
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
        <input
          style={{ flex: "1", background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--border)", padding: "8px" }}
          value={prompt()} onInput={(e) => setPrompt(e.currentTarget.value)}
          placeholder={running() ? "running…" : "Ask Claude (try /help)"} disabled={running()}
        />
        <button type="submit" disabled={running()}>Run</button>
      </form>
    </div>
  );
}
