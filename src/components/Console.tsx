import { For, Show, createSignal, onCleanup } from "solid-js";
import { sessions, insights, activeId, setActiveId, metas, subagentTypes } from "../lib/sessionStore";
import { failures, type ToolCall } from "../lib/insightsStore";
import { startRun, running } from "../lib/runStore";

export function Console() {
  const [prompt, setPrompt] = createSignal("");
  const [timelineOpen, setTimelineOpen] = createSignal(true);
  // 1s heartbeat so open-ended (running) bars keep growing between watch events.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));
  let streamRef: HTMLDivElement | undefined;

  // Show only live sessions (in the index, active within ~10 min) + the local run; hide archived.
  const list = () => [...sessions().entries()].filter(([id]) => id === "local" || metas().has(id));
  const active = () => (activeId() ? sessions().get(activeId()!) : undefined);

  // ---- Run Insights: tool-call timeline + failure radar ----
  const calls = (id: string | null): ToolCall[] => (id ? insights().get(id) ?? [] : []);
  const activeCalls = () => calls(activeId());
  const failCount = (id: string | null) => (id ? failures(insights(), id) : 0);

  // Ordered swimlanes: master first, then each subagent ref in first-seen order.
  const lanes = () => {
    const seen: string[] = [];
    for (const c of activeCalls()) if (!seen.includes(c.agentRef)) seen.push(c.agentRef);
    return seen.sort((a, b) => (a === "master" ? -1 : b === "master" ? 1 : 0));
  };
  // Time window relative to the session's first call; min 1s so bars stay visible.
  const span = () => {
    const cs = activeCalls();
    if (cs.length === 0) return { t0: 0, ms: 1000 };
    const t0 = Math.min(...cs.map((c) => c.startMs));
    const tEnd = Math.max(...cs.map((c) => c.endMs ?? now()));
    return { t0, ms: Math.max(1000, tEnd - t0) };
  };
  const laneName = (ref: string) => (ref === "master" ? "master" : subagentTypes().get(`${activeId()}:${ref}`) ?? ref);

  function scrollToAgent(ref: string) {
    streamRef?.querySelector<HTMLElement>(`[data-agent-ref="${CSS.escape(ref)}"]`)?.scrollIntoView({ block: "center" });
  }
  function scrollToFirstFailure() {
    const f = activeCalls().find((c) => c.status === "error");
    if (f) scrollToAgent(f.agentRef);
  }
  const activeTitle = () => {
    const id = activeId();
    if (!id) return "";
    return metas().get(id)?.title ?? sessions().get(id)?.project ?? id.slice(0, 8);
  };
  async function submit(e: Event) { e.preventDefault(); const p = prompt(); setPrompt(""); await startRun(p); }

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
                <span class={`pr-session-bullet${failCount(id) > 0 ? " is-failed" : ""}`} />
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

        <div class="pr-stream" ref={streamRef}>
          <Show when={active() && failCount(activeId()) > 0}>
            <div class="pr-fail-banner" onClick={scrollToFirstFailure} title="scroll to first failure">
              <span class="glyph">▲</span>
              <span class="count">{failCount(activeId())}</span>
              <span>{failCount(activeId()) === 1 ? "failure" : "failures"}</span>
            </div>
          </Show>
          <Show when={active()}>
            <For each={blocks()}>{(b) => (
              <Show when={b.kind === "sub"} fallback={
                <div data-agent-ref="master">
                  <For each={b.lines}>{(l) => (
                    <div class={l.role === "user" ? "pr-line pr-line-prompt" : "pr-line pr-line-asst"}>{l.text}</div>
                  )}</For>
                </div>
              }>
                {(() => {
                  const [open, setOpen] = createSignal(false);
                  const ref = (b as { agentRef: string }).agentRef;
                  return (
                    <div class={`pr-sub${open() ? " is-open" : ""}`} data-agent-ref={ref}>
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

        <Show when={activeCalls().length > 0}>
          <div class={`pr-timeline${timelineOpen() ? " is-open" : ""}`}>
            <button class="pr-timeline-head" type="button" onClick={() => setTimelineOpen((v) => !v)}>
              <span class="pr-timeline-title">TIMELINE</span>
              <span class="pr-timeline-sub">{activeCalls().length} calls · {lanes().length} {lanes().length === 1 ? "lane" : "lanes"}</span>
            </button>
            <Show when={timelineOpen()}>
              <div class="pr-timeline-body">
                <div class="pr-timeline-axis"><span>t+0s</span><span>t+{(span().ms / 1000).toFixed(1)}s</span></div>
                <For each={lanes()}>{(ref) => (
                  <div class="pr-timeline-lane">
                    <span class="pr-timeline-lane-label" title={laneName(ref)}>{laneName(ref)}</span>
                    <div class="pr-timeline-track">
                      <For each={activeCalls().filter((c) => c.agentRef === ref)}>{(c) => {
                        const { t0, ms } = span();
                        const end = c.endMs ?? now();
                        const left = ((c.startMs - t0) / ms) * 100;
                        const width = ((end - c.startMs) / ms) * 100;
                        const dur = c.endMs ? `${c.endMs - c.startMs}ms` : "running…";
                        const cls = c.status === "ok" ? "is-ok" : c.status === "error" ? "is-error" : "is-running";
                        return (
                          <div
                            class={`pr-timeline-bar ${cls}`}
                            style={{ left: `${left}%`, width: `${Math.max(width, 0)}%` }}
                            title={`${c.name}${c.filePath ? ` ${c.filePath}` : ""} · ${dur}`}
                            onClick={() => scrollToAgent(ref)}
                          />
                        );
                      }}</For>
                    </div>
                  </div>
                )}</For>
              </div>
            </Show>
          </div>
        </Show>

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
