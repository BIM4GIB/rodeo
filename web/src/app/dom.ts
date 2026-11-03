// Tiny DOM helpers. No framework: elements are built with h() and rebuilt
// with replaceChildren() by the panels that own them.

/**
 * Resolves after the browser has painted, so an overlay shows before synchronous work starts.
 * A hidden tab, or a window another covers, runs no frames: then it resolves after a moment
 * instead, so the work doesn't wait for the window to be seen again.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 100);
  });
}

/** Resolves after the events that came in meanwhile (a click during a long parse) have run. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`openvwx: missing #${id} in index.html`);
  return el as T;
}

export interface HOpts {
  cls?: string;
  text?: string;
  /** trusted static markup only (icons); never user data */
  html?: string;
  title?: string;
  value?: string;
  placeholder?: string;
  checked?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  draggable?: boolean;
  attrs?: Record<string, string>;
}

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: HOpts = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (opts.cls !== undefined) el.className = opts.cls;
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.html !== undefined) el.innerHTML = opts.html;
  if (opts.title !== undefined) el.title = opts.title;
  if (opts.hidden !== undefined) el.hidden = opts.hidden;
  if (opts.draggable !== undefined) el.draggable = opts.draggable;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) el.setAttribute(k, v);
  }
  if (opts.value !== undefined) (el as HTMLInputElement).value = opts.value;
  if (opts.placeholder !== undefined) (el as HTMLInputElement).placeholder = opts.placeholder;
  if (opts.checked !== undefined) (el as HTMLInputElement).checked = opts.checked;
  if (opts.disabled !== undefined) (el as HTMLInputElement).disabled = opts.disabled;
  for (const c of children) {
    if (c !== null && c !== undefined && c !== false) el.append(c);
  }
  return el;
}

/**
 * Replaces `host` contents with a text input (one per value) that commits on
 * Enter or when focus leaves it, and cancels on Escape. `done` receives the
 * trimmed values, or null when cancelled. The caller re-renders afterwards.
 */
export function editInline(
  host: HTMLElement,
  values: readonly string[],
  done: (values: string[] | null) => void,
): void {
  const inputs = values.map((v) => h("input", { cls: "inline-edit", value: v, attrs: { type: "text" } }));
  let settled = false;
  const settle = (values: string[] | null): void => {
    if (settled) return;
    settled = true;
    done(values);
  };
  for (const input of inputs) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        settle(inputs.map((i) => i.value.trim()));
      } else if (e.key === "Escape") {
        e.preventDefault();
        settle(null);
      }
    });
    input.addEventListener("focusout", (e) => {
      if (e.relatedTarget instanceof Node && host.contains(e.relatedTarget)) return;
      settle(inputs.map((i) => i.value.trim()));
    });
  }
  host.replaceChildren(...inputs);
  inputs[0]?.focus();
  inputs[0]?.select();
}
