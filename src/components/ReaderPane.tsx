import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";

export function ReaderPane() {
  const [path, setPath] = createSignal("");
  const [html, setHtml] = createSignal("");
  const [err, setErr] = createSignal("");

  async function open(e: Event) {
    e.preventDefault();
    setErr("");
    try {
      const md = await invoke<string>("read_vault_file", { path: path() });
      setHtml(await marked.parse(md));
    } catch (e) { setErr(String(e)); }
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", "border-left": "1px solid var(--border)" }}>
      <form onSubmit={open} style={{ display: "flex", gap: "8px", padding: "12px", "border-bottom": "1px solid var(--border)" }}>
        <input style={{ flex: "1", background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--border)", padding: "8px" }}
          value={path()} onInput={(e) => setPath(e.currentTarget.value)} placeholder="Absolute path to a .md file" />
        <button type="submit">Open</button>
      </form>
      <div style={{ flex: "1", overflow: "auto", padding: "12px" }}>
        {err() ? <pre style={{ color: "tomato" }}>{err()}</pre> : <div innerHTML={html()} />}
      </div>
    </div>
  );
}
