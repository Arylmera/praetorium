import { For, Show, createSignal, onCleanup } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { sessions, insights, activeId, setActiveId, metas, subagentTypes, type TranscriptLine } from "../lib/sessionStore";
import { failures, type ToolCall } from "../lib/insightsStore";
import { startRun, running, cwdLabel, localSessionId, resetLocal } from "../lib/runStore";

export function Console() {
  const [prompt, setPrompt] = createSignal("");
  const [cwd, setCwd] = createSignal<string | undefined>(undefined);
  const [model, setModel] = createSignal("default");
  const [timelineOpen, setTimelineOpen] = createSignal(true);
  // 1s heartbeat so open-ended (running) bars keep growing between watch events.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));
  let streamRef: HTMLDivElement | undefined;

  // The synthetic local card is ALWAYS present (even before the first run) so its
  // input stays reachable; then live observed sessions (in the index, active within
  // ~10 min) — minus the watcher's re-discovery of our own local run (same transcript,
  // real id), which would otherwise duplicate the local card.
  const list = (): [string, { project?: string; lines: TranscriptLine[] }][] => {
    const map = sessions();
    const out: [string, { project?: string; lines: TranscriptLine[] }][] = [
      ["local", map.get("local") ?? { project: cwdLabel(cwd()), lines: [] }],
    ];
    for (const [id, s] of map) if (id !== "local" && metas().has(id) && id !== localSessionId()) out.push([id, s]);
    return out;
  };
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
  // Stable, legible names for nested agents (replaces the raw hex toolUseId).
  // First-seen order across the chat + timeline; use the captured subagent type
  // when available (disambiguating duplicates, e.g. "Explore 1" / "Explore 2"),
  // otherwise a plain sequential "agent N".
  const agentNames = () => {
    const map = new Map<string, string>();
    const refs: string[] = [];
    const push = (r: string) => { if (r !== "master" && !refs.includes(r)) refs.push(r); };
    for (const l of active()?.lines ?? []) push(l.agentRef);
    for (const c of activeCalls()) push(c.agentRef);
    const typeOf = (r: string) => subagentTypes().get(`${activeId()}:${r}`);
    const typeTotals = new Map<string, number>();
    for (const r of refs) { const t = typeOf(r); if (t) typeTotals.set(t, (typeTotals.get(t) ?? 0) + 1); }
    const typeSeen = new Map<string, number>();
    let generic = 0;
    for (const r of refs) {
      const t = typeOf(r);
      if (t) {
        const n = (typeSeen.get(t) ?? 0) + 1;
        typeSeen.set(t, n);
        map.set(r, (typeTotals.get(t) ?? 1) > 1 ? `${t} ${n}` : t);
      } else {
        map.set(r, `agent ${++generic}`);
      }
    }
    return map;
  };
  const agentName = (ref: string) => agentNames().get(ref) ?? ref;
  const laneName = (ref: string) => (ref === "master" ? "master" : agentName(ref));

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
    | { kind: "master"; lines: TranscriptLine[] }
    | { kind: "sub"; agentRef: string; lines: TranscriptLine[] };
  const blocks = (): Block[] => {
    const out: Block[] = [];
    // agentRef -> index of its (single) block in `out`, so interleaved parallel
    // agents don't each spawn a fresh header every time they regain the stream.
    const subAt = new Map<string, number>();
    for (const l of active()?.lines ?? []) {
      if (l.agentRef !== "master") {
        const at = subAt.get(l.agentRef);
        if (at !== undefined) (out[at] as Extract<Block, { kind: "sub" }>).lines.push(l);
        else { subAt.set(l.agentRef, out.length); out.push({ kind: "sub", agentRef: l.agentRef, lines: [l] }); }
      } else {
        const last = out[out.length - 1];
        if (last && last.kind === "master") last.lines.push(l);
        else out.push({ kind: "master", lines: [l] });
      }
    }
    return out;
  };

  // A turn's text is prose lines plus tool placeholders ("[Read path]", "[Bash]")
  // joined by newlines. Split each line so tool calls render as chips, not prose.
  type Seg = { tool: true; name: string; arg: string } | { tool: false; text: string };
  const toolSegs = (text: string): Seg[] =>
    text.split("\n").map((s) => {
      const m = s.match(/^\[(\S+)(?:\s+([\s\S]+?))?\]$/);
      return m ? { tool: true, name: m[1], arg: m[2] ?? "" } : { tool: false, text: s };
    });

  // For each user question, the last master assistant line of that round is the
  // "answer" and stays highlighted; the narration before it is muted. The trailing
  // round's answer is only marked once the run finishes (no mid-flight highlight).
  const answerLines = () => {
    const master = (active()?.lines ?? []).filter((l) => l.agentRef === "master");
    const set = new Set<TranscriptLine>();
    for (let i = 0; i < master.length; i++) {
      const l = master[i];
      if (l.role === "user") continue;
      const next = master[i + 1];
      if (!next) { if (!running()) set.add(l); }
      else if (next.role === "user") set.add(l);
    }
    return set;
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
                    <Show when={l.role !== "user"} fallback={<div class="pr-line pr-line-prompt">{l.text}</div>}>
                      <div class={answerLines().has(l) ? "pr-answer" : undefined}>
                        <For each={toolSegs(l.text)}>{(s) => s.tool
                          ? <div class="pr-line pr-tool-line"><span class="pr-tool"><span class="pr-tool-n">{s.name}</span><Show when={s.arg}><span class="pr-tool-a">{s.arg}</span></Show></span></div>
                          : <Show when={s.text.trim()}><div class={answerLines().has(l) ? "pr-line pr-answer-text" : "pr-line pr-line-asst"}>{s.text}</div></Show>}</For>
                      </div>
                    </Show>
                  )}</For>
                </div>
              }>
                {(() => {
                  const [open, setOpen] = createSignal(false);
                  const ref = (b as { agentRef: string }).agentRef;
                  return (
                    <div class={`pr-sub${open() ? " is-open" : ""}`} data-agent-ref={ref}>
                      <button class="pr-sub-role" type="button" onClick={() => setOpen((v) => !v)}>
                        <span class="pr-sub-name">{agentName(ref)}</span>
                        <span class="pr-sub-meta">{b.lines.length} {b.lines.length === 1 ? "step" : "steps"}</span>
                      </button>
                      <Show when={open()}>
                        <div class="pr-sub-rows">
                          <For each={b.lines}>{(l) => (
                            <Show when={l.role !== "user"} fallback={<div class="pr-sub-line pr-sub-line-prompt">{l.text}</div>}>
                              <For each={toolSegs(l.text)}>{(s) => s.tool
                                ? <div class="pr-sub-line is-tool"><span class="pr-tool"><span class="pr-tool-n">{s.name}</span><Show when={s.arg}><span class="pr-tool-a">{s.arg}</span></Show></span></div>
                                : <Show when={s.text.trim()}><div class="pr-sub-line">{s.text}</div></Show>}</For>
                            </Show>
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

        {/* The input belongs to the local console only; observed sessions are read-only. */}
        <Show when={activeId() === "local"}>
        <form class="pr-inputbar" onSubmit={submit}>
          <div class="pr-launch-opts">
            {/* cwd/model lock once a conversation is underway — --resume reuses the
                original session's context, so a mid-run change would silently no-op. */}
            <button type="button" class="pr-cwd-chip" onClick={pickCwd} disabled={running() || localSessionId() != null}
              title={cwd() ?? "run in app's working directory"}>
              <span class="pr-cwd-label">{cwd() ? cwdLabel(cwd()) : "cwd: default"}</span>
              <Show when={cwd()}>
                <span class="pr-cwd-clear" role="button" aria-label="clear working directory"
                  onClick={(e) => { e.stopPropagation(); if (!running() && localSessionId() == null) setCwd(undefined); }}>×</span>
              </Show>
            </button>
            <select class="pr-model-select" value={model()} disabled={running() || localSessionId() != null}
              onChange={(e) => setModel(e.currentTarget.value)}>
              <option value="default">default</option>
              <option value="opus">opus</option>
              <option value="sonnet">sonnet</option>
              <option value="haiku">haiku</option>
            </select>
            <button type="button" class="pr-new" onClick={resetLocal} disabled={running()}
              title="start a fresh local conversation">+ NEW</button>
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
        </Show>
      </section>
    </div>
  );
}
