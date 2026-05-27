import { For, Show, createSignal, createMemo, onCleanup, onMount } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { sessions, insights, activeId, setActiveId, metas, subagentTypes, type TranscriptLine } from "../lib/sessionStore";
import { failures, type ToolCall } from "../lib/insightsStore";
import { startRun, stopRun, closeSession, renameSession, isRunning, newLocalSession, isLocalSession, localSessions, cwdLabel, adoptSession, ownedClaudeIds } from "../lib/runStore";
import { appCwd } from "../lib/sessions";
import { buildRail, type RailEntry } from "../lib/consoleRail";
import { buildAgentNames } from "../lib/agentNaming";

export function Console() {
  const [prompt, setPrompt] = createSignal("");
  const [cwd, setCwd] = createSignal<string | undefined>(undefined);
  const [model, setModel] = createSignal("default");
  const [timelineOpen, setTimelineOpen] = createSignal(true);
  // 1s heartbeat so open-ended (running) bars keep growing between watch events.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));
  const [appDir, setAppDir] = createSignal<string | undefined>(undefined);
  onMount(async () => setAppDir(await appCwd()));
  const [viewRef, setViewRef] = createSignal<string | null>(null);
  let streamRef: HTMLDivElement | undefined;

  // Show only live sessions (in the index, active within ~10 min) + local runs;
  // hide archived, and hide the watcher's "observed" mirror of a run we own
  // (the CLI writes under its own Claude id while we drive it under a local id).
  const list = () => {
    const owned = ownedClaudeIds();
    return [...sessions().entries()].filter(([id]) =>
      isLocalSession(id) || (metas().has(id) && !owned.has(id)));
  };
  const active = () => (activeId() ? sessions().get(activeId()!) : undefined);
  // Disable the input/RUN only when the *active* local session is itself in-flight,
  // so other sessions can keep running concurrently.
  const activeRunning = () => { const id = activeId(); return isLocalSession(id) && isRunning(id); };
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const sess = (id: string) => localSessions().get(id);
  const activeSess = () => { const id = activeId(); return isLocalSession(id) ? sess(id) : undefined; };
  const canContinue = () => !!activeSess()?.claudeSessionId;
  const locked = () => { const s = activeSess(); return !!(s && (s.cwd !== undefined || s.model !== undefined) && s.status !== "idle"); };

  // ---- Run Insights: tool-call timeline + failure radar ----
  const calls = (id: string | null): ToolCall[] => (id ? insights().get(id) ?? [] : []);
  const activeCalls = () => calls(activeId());
  const failCount = (id: string | null) => (id ? failures(insights(), id) : 0);
  const failingCalls = () => activeCalls().filter((c) => c.status === "error");
  // Basename for the failure list; keeps long paths from blowing out the banner.
  const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
  // First non-empty line of the captured error — CSS handles the horizontal ellipsis.
  const firstLine = (s: string) => s.split("\n").find((l) => l.trim()) ?? s;

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
    const refs: string[] = [];
    for (const l of active()?.lines ?? []) if (l.agentRef !== "master" && !refs.includes(l.agentRef)) refs.push(l.agentRef);
    for (const c of activeCalls()) if (c.agentRef !== "master" && !refs.includes(c.agentRef)) refs.push(c.agentRef);
    const typeOf = (r: string) => subagentTypes().get(`${activeId()}:${r}`);
    return buildAgentNames(refs, typeOf);
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

  const railSubs = (id: string): { ref: string; name: string; steps: number }[] => {
    const lines = sessions().get(id)?.lines ?? [];
    const refs: string[] = [];
    const steps = new Map<string, number>();
    for (const l of lines) if (l.agentRef !== "master") {
      if (!refs.includes(l.agentRef)) refs.push(l.agentRef);
      steps.set(l.agentRef, (steps.get(l.agentRef) ?? 0) + 1);
    }
    const names = buildAgentNames(refs, (r) => subagentTypes().get(`${id}:${r}`));
    return refs.map((r) => ({ ref: r, name: names.get(r) ?? r, steps: steps.get(r) ?? 0 }));
  };

  const railGroups = () => {
    const entries: RailEntry[] = list().map(([id, s]) => {
      const ls = sess(id);
      const m = metas().get(id);
      return {
        id,
        title: ls?.label ?? m?.title ?? s.project ?? id.slice(0, 8),
        owned: isLocalSession(id),
        observed: !isLocalSession(id) && metas().has(id),
        status: ls?.status,
        failCount: failCount(id),
        lastActivityMs: m?.lastActivityMs ?? (isLocalSession(id) ? now() : 0),
        cwd: ls?.cwd ?? m?.cwd,
        subagents: railSubs(id),
      };
    });
    return buildRail(entries, appDir());
  };

  // ---- Collapsible folder state for the rail (keyed by each group's unique dir) ----
  // Default open: the first group + whichever group holds the active session.
  const [openGroups, setOpenGroups] = createSignal<Set<string>>(new Set());
  const defaultOpen = createMemo(() => {
    const g = railGroups();
    if (!g.length) return new Set<string>();
    const next = new Set<string>([g[0].dir]);
    const aid = activeId();
    for (const grp of g) if (grp.sessions.some((e) => e.id === aid)) next.add(grp.dir);
    return next;
  });
  const isGroupOpen = (key: string) => (openGroups().size ? openGroups() : defaultOpen()).has(key);
  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const base = prev.size ? prev : defaultOpen();
      const next = new Set(base);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function submit(e: Event) {
    e.preventDefault();
    const p = prompt();
    if (!p.trim()) return;
    setPrompt("");
    const m = model();
    const id = activeId();
    let sid: string;
    if (isLocalSession(id)) sid = id;
    else if (id && metas().has(id)) { adoptSession(metas().get(id)!); sid = id; }
    else sid = newLocalSession();
    setViewRef(null);
    await startRun(sid, p, { cwd: cwd(), model: m === "default" ? undefined : m });
  }
  async function pickCwd() {
    if (activeRunning()) return;
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") setCwd(picked);
  }

  // Master stream as a flat flow: master lines verbatim, with a one-time jump
  // marker at the first appearance of each subagent (the subagent's own steps
  // are shown in its swap view, reachable via the marker or the rail).
  type FlowItem = { kind: "line"; line: TranscriptLine } | { kind: "marker"; ref: string };
  const masterFlow = (): FlowItem[] => {
    const out: FlowItem[] = [];
    const seenSub = new Set<string>();
    for (const l of active()?.lines ?? []) {
      if (l.agentRef === "master") out.push({ kind: "line", line: l });
      else if (!seenSub.has(l.agentRef)) { seenSub.add(l.agentRef); out.push({ kind: "marker", ref: l.agentRef }); }
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
      if (!next) { if (!activeRunning()) set.add(l); }
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
          <button class="pr-new-session" type="button" onClick={() => newLocalSession()}
            title="start a new local session">+ NEW</button>
        </div>
        <div class="pr-sessions-list">
          <For each={railGroups()}>{(g) => (
            <div class="pr-session-group">
              <div class="pr-session-group-head" onClick={() => toggleGroup(g.dir)} title={g.dir || g.label}>
                <span class="pr-folder-chevron">{isGroupOpen(g.dir) ? "▾" : "▸"}</span>
                <span class="pr-session-group-dir">{g.label}</span>
                <Show when={g.repo}><span class="pr-session-group-repo">{g.repo}</span></Show>
                <span class="pr-folder-count">{g.sessions.length}</span>
              </div>
              <Show when={isGroupOpen(g.dir)}>
                <For each={g.sessions}>{(e) => {
                  const bulletCls = () => {
                    if (e.failCount > 0) return " is-failed";
                    return e.status ? ` is-${e.status}` : "";
                  };
                  return (
                    <>
                      <div class={`pr-session${e.id === activeId() && viewRef() === null ? " is-active" : ""}`}
                           onClick={() => { setActiveId(e.id); setViewRef(null); }} title={e.id}>
                        <span class={`pr-session-bullet${bulletCls()}`} />
                        <Show when={renaming() === e.id}
                          fallback={
                            <span class="pr-session-title"
                                  onDblClick={(ev) => { ev.stopPropagation(); if (e.owned) setRenaming(e.id); }}>
                              {e.title}
                            </span>
                          }>
                          <input class="pr-session-rename" autofocus value={sess(e.id)?.label ?? ""}
                            onClick={(ev) => ev.stopPropagation()}
                            onBlur={(ev) => { renameSession(e.id, ev.currentTarget.value); setRenaming(null); }}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") { renameSession(e.id, ev.currentTarget.value); setRenaming(null); }
                              else if (ev.key === "Escape") setRenaming(null);
                            }} />
                        </Show>
                        <span class="pr-session-time">
                          {e.observed ? "" : e.status === "running" ? "live" : "now"}
                        </span>
                        <Show when={e.owned && e.status === "running"}>
                          <button class="pr-session-stop" type="button" title="stop run"
                            onClick={(ev) => { ev.stopPropagation(); void stopRun(e.id); }}>■</button>
                        </Show>
                        <Show when={e.owned}>
                          <button class="pr-session-close" type="button" title="close session"
                            onClick={(ev) => { ev.stopPropagation(); void closeSession(e.id); }}>×</button>
                        </Show>
                        <Show when={e.observed}><span class="pr-session-observed">observed</span></Show>
                      </div>
                      <For each={e.subagents}>{(sub) => (
                        <div class={`pr-session-sub${e.id === activeId() && viewRef() === sub.ref ? " is-active" : ""}`}
                             onClick={() => { setActiveId(e.id); setViewRef(sub.ref); }}
                             title={`${sub.name} · ${sub.steps} steps`}>
                          <span class="pr-session-sub-arrow">↳</span>
                          <span class="pr-session-sub-name">{sub.name}</span>
                          <span class="pr-session-sub-steps">{sub.steps}</span>
                        </div>
                      )}</For>
                    </>
                  );
                }}</For>
              </Show>
            </div>
          )}</For>
        </div>
      </aside>

      {/* stream */}
      <section class="pr-console-right">
        <div class="pr-stream-head">
          <div class="pr-stream-crumb">
            <span class="pr-crumb-loc" onClick={() => setViewRef(null)}>{activeTitle()}</span>
            <Show when={viewRef()}>
              <span class="pr-crumb-sep">/</span>
              <b>{agentName(viewRef()!)}</b>
            </Show>
          </div>
          <div class="pr-stream-stats">
            <div class="pr-stream-stat"><span class="lbl">TURNS</span><span class="val">{active()?.lines.length ?? 0}</span></div>
          </div>
        </div>

        <div class="pr-stream" ref={streamRef}>
          <Show when={active() && failCount(activeId()) > 0}>
            <div class="pr-fail-banner">
              <div class="pr-fail-banner-head" onClick={scrollToFirstFailure} title="scroll to first failure">
                <span class="glyph">▲</span>
                <span class="count">{failCount(activeId())}</span>
                <span>{failCount(activeId()) === 1 ? "failure" : "failures"}</span>
              </div>
              <Show when={failingCalls().length > 0}>
                <ul class="pr-fail-list">
                  <For each={failingCalls()}>{(c) => (
                    <li class="pr-fail-item" onClick={() => scrollToAgent(c.agentRef)} title={c.errorText ?? "scroll to this call"}>
                      <span class="pr-fail-tool">{c.name}</span>
                      <Show when={c.filePath}><span class="pr-fail-path">{baseName(c.filePath!)}</span></Show>
                      <Show when={c.errorText}><span class="pr-fail-msg">{firstLine(c.errorText!)}</span></Show>
                    </li>
                  )}</For>
                </ul>
              </Show>
            </div>
          </Show>
          <Show when={active()}>
            <Show
              when={viewRef() === null}
              fallback={
                <div data-agent-ref={viewRef()!}>
                  <For each={(active()?.lines ?? []).filter((l) => l.agentRef === viewRef())}>{(l) => (
                    <Show when={l.role !== "user"} fallback={<div class="pr-line pr-line-prompt">{l.text}</div>}>
                      <For each={toolSegs(l.text)}>{(s) => s.tool
                        ? <div class="pr-line pr-tool-line"><span class="pr-tool"><span class="pr-tool-n">{s.name}</span><Show when={s.arg}><span class="pr-tool-a">{s.arg}</span></Show></span></div>
                        : <Show when={s.text.trim()}><div class="pr-line pr-line-asst">{s.text}</div></Show>}</For>
                    </Show>
                  )}</For>
                </div>
              }
            >
              <div data-agent-ref="master">
                <For each={masterFlow()}>{(item) => (
                  <Show
                    when={item.kind === "marker"}
                    fallback={(() => {
                      const l = (item as { line: TranscriptLine }).line;
                      return (
                        <Show when={l.role !== "user"} fallback={<div class="pr-line pr-line-prompt">{l.text}</div>}>
                          <div class={answerLines().has(l) ? "pr-answer" : undefined}>
                            <For each={toolSegs(l.text)}>{(s) => s.tool
                              ? <div class="pr-line pr-tool-line"><span class="pr-tool"><span class="pr-tool-n">{s.name}</span><Show when={s.arg}><span class="pr-tool-a">{s.arg}</span></Show></span></div>
                              : <Show when={s.text.trim()}><div class={answerLines().has(l) ? "pr-line pr-answer-text" : "pr-line pr-line-asst"}>{s.text}</div></Show>}</For>
                          </div>
                        </Show>
                      );
                    })()}
                  >
                    <button class="pr-spawn-marker" type="button"
                      onClick={() => setViewRef((item as { ref: string }).ref)}>
                      ↳ spawned {agentName((item as { ref: string }).ref)}
                    </button>
                  </Show>
                )}</For>
              </div>
            </Show>
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
          <div class="pr-launch-opts">
            <Show
              when={!locked()}
              fallback={
                <>
                  <span class="pr-cwd-chip is-locked" title={activeSess()?.cwd ?? "app working directory"}>
                    {activeSess()?.cwd ? cwdLabel(activeSess()!.cwd) : "cwd: default"}
                  </span>
                  <span class="pr-model-chip is-locked">{activeSess()?.model ?? "default"}</span>
                </>
              }
            >
              <button type="button" class="pr-cwd-chip" onClick={pickCwd} disabled={activeRunning()}
                title={cwd() ?? appDir() ?? "run in app's working directory"}>
                <span class="pr-cwd-label">{cwd() ? cwdLabel(cwd()) : appDir() ? cwdLabel(appDir()!) : "cwd: default"}</span>
                <Show when={cwd()}>
                  <span class="pr-cwd-clear" role="button" aria-label="clear working directory"
                    onClick={(e) => { e.stopPropagation(); if (!activeRunning()) setCwd(undefined); }}>×</span>
                </Show>
              </button>
              <select class="pr-model-select" value={model()} disabled={activeRunning()}
                onChange={(e) => setModel(e.currentTarget.value)}>
                <option value="default">default</option>
                <option value="opus">opus</option>
                <option value="sonnet">sonnet</option>
                <option value="haiku">haiku</option>
              </select>
            </Show>
          </div>
          <div class="pr-input-wrap">
            <span class="pr-input-ps">$</span>
            <input class="pr-input" value={prompt()} onInput={(e) => setPrompt(e.currentTarget.value)}
              placeholder={activeRunning() ? "running…" : canContinue() ? "continue…" : "ask Claude (this machine)…"}
              disabled={activeRunning()} />
          </div>
          <button class={`pr-run${activeRunning() ? " is-running" : ""}`} type="submit" disabled={activeRunning()}>
            {activeRunning() ? "RUNNING" : canContinue() ? "CONTINUE" : "RUN"}
          </button>
        </form>
      </section>
    </div>
  );
}
