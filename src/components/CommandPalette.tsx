import { createMemo, createSignal, For, Show } from "solid-js";
import { buildCommands, filterCommands, type Command } from "../lib/commands";

export function CommandPalette(props: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let inputEl: HTMLInputElement | undefined;

  // Recomputed each keystroke; buildCommands reads the live session/theme signals.
  const results = createMemo<Command[]>(() =>
    props.open ? filterCommands(buildCommands(), query()) : [],
  );

  const close = () => {
    props.onClose();
    setQuery("");
    setSelected(0);
  };

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    cmd.run();
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const list = results();
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (list.length ? (i + 1) % list.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(list[selected()]);
    }
  };

  // Reset selection to the top whenever the filtered set changes.
  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    setQuery(e.currentTarget.value);
    setSelected(0);
  };

  // Autofocus + reset whenever the palette opens.
  const focusInput = (el: HTMLInputElement) => {
    inputEl = el;
    queueMicrotask(() => inputEl?.focus());
  };

  // Group headers in render order; selection indexes the flat filtered list.
  const groups = createMemo(() => {
    const flat = results();
    const order: Command["group"][] = ["Navigate", "Session"];
    return order
      .map((g) => ({ group: g, items: flat.filter((c) => c.group === g) }))
      .filter((s) => s.items.length > 0);
  });

  const flatIndex = (cmd: Command) => results().indexOf(cmd);

  return (
    <Show when={props.open}>
      <div class="pr-palette" onClick={close} onKeyDown={onKeyDown}>
        <div class="pr-palette-panel" onClick={(e) => e.stopPropagation()}>
          <input
            ref={focusInput}
            class="pr-palette-input"
            type="text"
            placeholder="Type a command…"
            value={query()}
            onInput={onInput}
            spellcheck={false}
            autocomplete="off"
          />
          <Show
            when={results().length > 0}
            fallback={<div class="pr-palette-empty">No matching commands.</div>}
          >
            <div class="pr-palette-list" role="listbox">
              <For each={groups()}>{(section) => (
                <div class="pr-palette-group">
                  <div class="pr-palette-group-label">{section.group}</div>
                  <For each={section.items}>{(cmd) => {
                    const idx = flatIndex(cmd);
                    return (
                      <div
                        class="pr-palette-item"
                        classList={{ "is-selected": selected() === idx }}
                        role="option"
                        aria-selected={selected() === idx}
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => run(cmd)}
                      >
                        <span class="pr-palette-item-title">{cmd.title}</span>
                        <Show when={cmd.hint}>
                          <span class="pr-palette-item-hint">{cmd.hint}</span>
                        </Show>
                      </div>
                    );
                  }}</For>
                </div>
              )}</For>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
