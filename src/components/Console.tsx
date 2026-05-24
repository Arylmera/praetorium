import { For, Show, createSignal } from "solid-js";
import { sessions, activeId, setActiveId, metas, subagentTypes } from "../lib/sessionStore";
import { startRun, running } from "../lib/runStore";

export function Console() {
  const [prompt, setPrompt] = createSignal("");
  // Show only live sessions (in the index, active within ~10 min) + the local run; hide archived.
  const list = () => [...sessions().entries()].filter(([id]) => id === "local" || metas().has(id));
  const active = () => (activeId() ? sessions().get(activeId()!) : undefined);
  const activeTitle = () => {
    const id = activeId();
    if (!id) return "";
    return metas().get(id)?.title ?? sessions().get(id)?.project ?? id.slice(0, 8);
  };
  async function submit(e: Event) { e.preventDefault(); const p = prompt(); setPrompt(""); await startRun(p); }

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
            <For each={active()!.lines}>{(l) => {
              const isSub = l.agentRef !== "master";
              const subName = () => subagentTypes().get(`${activeId()}:${l.agentRef}`) ?? l.agentRef;
              return (
                <Show when={isSub} fallback={
                  <div class={l.role === "user" ? "pr-line pr-line-prompt" : "pr-line pr-line-asst"}>{l.text}</div>
                }>
                  <div class="pr-sub">
                    <div class="pr-sub-role">{subName()}</div>
                    <div class="pr-sub-body">{l.text}</div>
                  </div>
                </Show>
              );
            }}</For>
          </Show>
        </div>

        <form class="pr-inputbar" onSubmit={submit}>
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
