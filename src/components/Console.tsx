import { For, Show, createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { sessions, activeId, setActiveId, metas, subagentTypes } from "../lib/sessionStore";
import { startRun, running, cwdLabel } from "../lib/runStore";

export function Console() {
  const [prompt, setPrompt] = createSignal("");
  const [cwd, setCwd] = createSignal<string | undefined>(undefined);
  const [model, setModel] = createSignal("default");
  // Show only live sessions (in the index, active within ~10 min) + the local run; hide archived.
  const list = () => [...sessions().entries()].filter(([id]) => id === "local" || metas().has(id));
  const active = () => (activeId() ? sessions().get(activeId()!) : undefined);
  const activeTitle = () => {
    const id = activeId();
    if (!id) return "";
    return metas().get(id)?.title ?? sessions().get(id)?.project ?? id.slice(0, 8);
  };
  async function submit(e: Event) {
    e.preventDefault();
    const p = prompt();
    setPrompt("");
    const m = model();
    await startRun(p, { cwd: cwd(), model: m === "default" ? undefined : m });
  }
  async function pickCwd() {
    if (running()) return;
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") setCwd(picked);
  }

  // Collapse consecutive lines from the same agent into one block so a subagent
  // renders as a single tree branch with its rows nested beneath, instead of
  // repeating the header on every line.
  type Block =
    | { kind: "master"; lines: { role: string; text: string }[] }
    | { kind: "sub"; agentRef: string; lines: { role: string; text: string }[] };
  const blocks = (): Block[] => {
    const out: Block[] = [];
    for (const l of active()?.lines ?? []) {
      const isSub = l.agentRef !== "master";
      const last = out[out.length - 1];
      if (isSub) {
        if (last && last.kind === "sub" && last.agentRef === l.agentRef) last.lines.push(l);
        else out.push({ kind: "sub", agentRef: l.agentRef, lines: [l] });
      } else {
        if (last && last.kind === "master") last.lines.push(l);
        else out.push({ kind: "master", lines: [l] });
      }
    }
    return out;
  };

  return (
    <div class="pr-console-grid">
      {/* live sessions */}
      <aside class="pr-sessions">
        <div class="pr-sessions-head">
          <span class="pr-sessions-title">LIVE SESSIONS</span>
          <span class="pr-sessions-sub">{list().length} active</span>
        </div>
        <div class="pr-sessions-list">
          <For each={list()}>{([id, s]) => {
            const m = () => metas().get(id);
            return (
              <div class={`pr-session${id === activeId() ? " is-active" : ""}`} onClick={() => setActiveId(id)} title={id}>
                <span class="pr-session-bullet" />
                <span class="pr-session-title">{m()?.title ?? s.project ?? id.slice(0, 8)}</span>
                <span class="pr-session-time">{id === "local" ? "now" : ""}</span>
                <span class="pr-session-project">{m()?.project ?? s.project ?? ""}</span>
              </div>
            );
          }}</For>
        </div>
      </aside>

      {/* stream */}
      <section class="pr-console-right">
        <div class="pr-stream-head">
          <div class="pr-stream-crumb">
            <span>local</span><span class="pr-crumb-sep">/</span>
            <b>{activeTitle()}</b>
          </div>
          <div class="pr-stream-stats">
            <div class="pr-stream-stat"><span class="lbl">TURNS</span><span class="val">{active()?.lines.length ?? 0}</span></div>
          </div>
        </div>

        <div class="pr-stream">
          <Show when={active()}>
            <For each={blocks()}>{(b) => (
              <Show when={b.kind === "sub"} fallback={
                <For each={b.lines}>{(l) => (
                  <div class={l.role === "user" ? "pr-line pr-line-prompt" : "pr-line pr-line-asst"}>{l.text}</div>
                )}</For>
              }>
                {(() => {
                  const [open, setOpen] = createSignal(false);
                  const ref = (b as { agentRef: string }).agentRef;
                  return (
                    <div class={`pr-sub${open() ? " is-open" : ""}`}>
                      <button class="pr-sub-role" type="button" onClick={() => setOpen((v) => !v)}>
                        <span class="pr-sub-name">{subagentTypes().get(`${activeId()}:${ref}`) ?? ref}</span>
                        <span class="pr-sub-meta">{b.lines.length} {b.lines.length === 1 ? "step" : "steps"}</span>
                      </button>
                      <Show when={open()}>
                        <div class="pr-sub-rows">
                          <For each={b.lines}>{(l) => (
                            <div class={l.role === "user" ? "pr-sub-line pr-sub-line-prompt" : "pr-sub-line"}>{l.text}</div>
                          )}</For>
                        </div>
                      </Show>
                    </div>
                  );
                })()}
              </Show>
            )}</For>
          </Show>
        </div>

        <form class="pr-inputbar" onSubmit={submit}>
          <div class="pr-launch-opts">
            <button type="button" class="pr-cwd-chip" onClick={pickCwd} disabled={running()}
              title={cwd() ?? "run in app's working directory"}>
              <span class="pr-cwd-label">{cwd() ? cwdLabel(cwd()) : "cwd: default"}</span>
              <Show when={cwd()}>
                <span class="pr-cwd-clear" role="button" aria-label="clear working directory"
                  onClick={(e) => { e.stopPropagation(); if (!running()) setCwd(undefined); }}>×</span>
              </Show>
            </button>
            <select class="pr-model-select" value={model()} disabled={running()}
              onChange={(e) => setModel(e.currentTarget.value)}>
              <option value="default">default</option>
              <option value="opus">opus</option>
              <option value="sonnet">sonnet</option>
              <option value="haiku">haiku</option>
            </select>
          </div>
          <div class="pr-input-wrap">
            <span class="pr-input-ps">$</span>
            <input class="pr-input" value={prompt()} onInput={(e) => setPrompt(e.currentTarget.value)}
              placeholder={running() ? "running…" : "ask Claude (this machine)…"} disabled={running()} />
          </div>
          <button class={`pr-run${running() ? " is-running" : ""}`} type="submit" disabled={running()}>
            {running() ? "RUNNING" : "RUN"}
          </button>
        </form>
      </section>
    </div>
  );
}
