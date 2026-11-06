// Menu panels, shared by the menu bar and the context menus: rows with a check
// mark, a label, a shortcut and submenus, built into panels appended to the
// body so nothing round them can clip them. openContextMenu opens rows at the
// pointer, as a right-click on the drawing, a palette's rows or its title does.
// On a phone a submenu drills down instead of opening beside its row: its rows
// replace the panel's, under a back row, and a panel from a button fills the window.

import { h } from "./dom.ts";

/** A menu row, or "-" for a separator. */
export type Row = Item | "-";

export interface Item {
  readonly label: string;
  /** shortcut in Mac notation, e.g. "⇧⌘Z" */
  readonly keys?: string;
  readonly enabled?: () => boolean;
  readonly checked?: () => boolean;
  readonly run?: () => void;
  /** an icon (trusted markup) in place of the check mark; a checked row is highlighted instead */
  readonly icon?: string;
  /** rows of a submenu, opened on hover instead of running; a function is read each time it opens */
  readonly items?: readonly Row[] | (() => readonly Row[]);
  /** the key its label is translated by where the label alone could mean something else (i18n.ts): "Menu › Window" */
  readonly i18n?: string;
}

const ARROW = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Shortcut text for this platform: Mac glyphs as they are, Ctrl/Alt/Shift words elsewhere. */
export function shortcutText(keys: string): string {
  if (IS_MAC) return keys;
  const key = keys.replace(/[⌘⌥⇧]/g, "");
  return [
    keys.includes("⌘") ? "Ctrl" : "",
    keys.includes("⌥") ? "Alt" : "",
    keys.includes("⇧") ? "Shift" : "",
    key === "⌫" ? "Del" : key,
  ]
    .filter((part) => part !== "")
    .join("+");
}

/** The same query as the phone rules in menubar.css: a narrow window, or a touch screen turned sideways. */
const phoneQuery = typeof matchMedia === "function" ? matchMedia("(max-width: 560px), (pointer: coarse) and (max-height: 500px)") : null;

/** Whether this window is a phone now, read as a menu opens or a submenu is tapped. */
function isPhone(): boolean {
  return phoneQuery?.matches ?? false;
}

/** A menu panel and the submenu panels it can open. */
export interface Panel {
  readonly el: HTMLElement;
  /** re-reads the enabled and checked state of every row, submenus included */
  refresh(): void;
  /** shows the panel under `at`, or beside it for a submenu; `wide` spans the window on a phone */
  open(at: HTMLElement | DOMRect, beside: boolean, wide?: boolean): void;
  close(): void;
  /** takes the panel and its submenus out of the page */
  remove(): void;
}

/** Where a panel was last shown from: a box in the window, and whether it is a submenu beside it. */
interface Placed {
  readonly box: DOMRect;
  readonly beside: boolean;
  readonly wide: boolean;
}

/** The rows on show in a panel, and the function that re-reads each row's state. */
interface Screen {
  readonly nodes: Node[];
  readonly updates: (() => void)[];
}

/** Wires the button of a row with a submenu: `items` are its rows, or a function that reads them when it opens. */
type Submenu = (label: string, items: readonly Row[] | (() => readonly Row[]), btn: HTMLButtonElement) => void;

/**
 * Puts a panel shown from `box` under it, or beside it for a submenu. Without room below, a menu
 * from a button or the pointer goes above when it fits there, and a menu that fits the window moves
 * up to fit; a taller one takes the side with more room and its rows scroll. A `wide` phone menu
 * stays under its button. Pulled back inside the window either way.
 */
function place(el: HTMLElement, box: DOMRect, beside: boolean, wide: boolean): void {
  const gap = 4;
  const full = wide && isPhone();
  el.classList.toggle("menu-wide", full);
  // measured from the window's left edge, and with no cap, so the panel is as wide and tall as it is
  el.style.left = "0px";
  el.style.top = "0px";
  el.style.maxHeight = "";
  const w = el.offsetWidth;
  // the whole height, which offsetHeight does not give once the panel is capped
  const height = el.scrollHeight + el.offsetHeight - el.clientHeight;
  const below = beside ? box.top - 4 : box.bottom + 2;
  const roomBelow = window.innerHeight - gap - below;
  const roomAbove = box.top - 2 - gap;
  let top = below;
  let fromAbove = false;
  if (height > roomBelow) {
    if (!beside && height <= roomAbove) {
      top = box.top - 2 - height;
    } else if (!full && height <= window.innerHeight - 2 * gap) {
      top = window.innerHeight - height - gap;
    } else if (beside) {
      top = gap;
    } else if (roomAbove > roomBelow) {
      top = gap;
      fromAbove = true;
    }
  }
  el.style.maxHeight = fromAbove ? `${box.top - 2 - top}px` : `calc(100dvh - ${top}px - ${gap}px - env(safe-area-inset-bottom, 0px))`;
  el.style.top = `${top}px`;
  if (full) {
    el.style.left = "";
  } else {
    let left = beside ? box.right - 2 : box.left;
    if (left + w > window.innerWidth - gap) left = beside ? box.left - w + 2 : window.innerWidth - w - gap;
    el.style.left = `${Math.max(gap, left)}px`;
  }
}

/** A row's button: its check mark or icon, label, shortcut and submenu arrow, and the function that re-reads its state. */
function rowButton(row: Item): { btn: HTMLButtonElement; update: () => void } {
  const check = h("span", row.icon !== undefined ? { cls: "menu-icon", html: row.icon } : { cls: "menu-check" });
  const btn = h(
    "button",
    { cls: "menu-item", attrs: { type: "button", role: "menuitem" } },
    check,
    h("span", { cls: "menu-label", text: row.label, attrs: row.i18n ? { "data-i18n": row.i18n } : undefined }),
    row.keys !== undefined ? h("kbd", { cls: "menu-keys", text: shortcutText(row.keys) }) : null,
    row.items ? h("span", { cls: "menu-arrow", html: ARROW }) : null,
  );
  const update = (): void => {
    btn.disabled = row.enabled !== undefined && !row.enabled();
    const on = row.checked?.() ?? false;
    if (row.icon !== undefined) btn.classList.toggle("checked", on);
    else check.textContent = on ? "✓" : "";
  };
  return { btn, update };
}

/** Builds a panel of `rows` into the page, hidden; `done` runs before a chosen row does. */
export function buildPanel(rows: readonly Row[], done: () => void): Panel {
  const el = h("div", { cls: "menu-panel", attrs: { role: "menu" }, hidden: true });
  /** the submenus built with the panel, as they now stand (the desktop cascade) */
  const children: Panel[] = [];
  /** the submenus built when they open, as they now stand */
  const made: (() => Panel | null)[] = [];
  let sub: Panel | null = null;
  const closeSub = (): void => {
    sub?.close();
    sub = null;
  };
  /** where the panel was last shown from, so its rows are placed again when they change */
  let at: Placed | null = null;
  /** a phone: the screens drilled down from, the top level first */
  const above: Screen[] = [];

  /** The rows of one screen, as buttons; a row with a submenu is wired by `submenu`. `title`, when given, heads it with a back row. */
  const screenOf = (list: readonly Row[], title: string | null, submenu: Submenu): Screen => {
    const nodes: Node[] = [];
    const updates: (() => void)[] = [];
    if (title !== null) {
      const back = h(
        "button",
        { cls: "menu-back", attrs: { type: "button", role: "menuitem" } },
        h("span", { cls: "menu-arrow", html: ARROW }),
        h("span", { cls: "menu-label", text: title }),
      );
      back.addEventListener("click", () => pop());
      nodes.push(back, h("div", { cls: "menu-sep", attrs: { role: "separator" } }));
    }
    for (const row of list) {
      if (row === "-") {
        nodes.push(h("div", { cls: "menu-sep", attrs: { role: "separator" } }));
        continue;
      }
      const { btn, update } = rowButton(row);
      updates.push(update);
      if (row.items) {
        btn.setAttribute("aria-haspopup", "menu");
        submenu(row.label, row.items, btn);
      } else {
        btn.addEventListener("pointerenter", closeSub);
        btn.addEventListener("click", () => {
          btn.blur();
          done();
          row.run?.();
        });
      }
      nodes.push(btn);
    }
    return { nodes, updates };
  };

  /** A submenu on the desktop opens beside its row on hover; a phone's tap drills down into it instead. */
  const cascade: Submenu = (label, items, btn) => {
    // a fixed submenu is built once; one read when it opens is built afresh each time
    let child: Panel | null = typeof items === "function" ? null : buildPanel(items, done);
    if (child) children.push(child);
    else made.push(() => child);
    btn.addEventListener("pointerenter", () => {
      // a tap on a phone also enters the row first, so it must not open the submenu beside it
      if (isPhone()) return;
      if (child && sub === child) return;
      closeSub();
      if (btn.disabled) return;
      if (typeof items === "function") {
        child?.remove();
        child = buildPanel(items(), done);
        child.refresh();
      }
      sub = child;
      child?.open(btn, true);
    });
    btn.addEventListener("click", () => {
      if (isPhone()) drill(label, items);
    });
  };

  /** A submenu inside a drilled screen: a tap always drills down into it. */
  const drillInto: Submenu = (label, items, btn) => {
    btn.addEventListener("click", () => drill(label, items));
  };

  /** Puts `screen` in place of the rows on show, their state read afresh and the panel placed again. */
  const show = (screen: Screen): void => {
    shown = screen;
    el.replaceChildren(...screen.nodes);
    for (const update of screen.updates) update();
    el.scrollTop = 0;
    if (at) place(el, at.box, at.beside, at.wide);
  };

  /** A phone: a submenu's rows replace the rows on show, under a back row that names it. */
  const drill = (label: string, items: readonly Row[] | (() => readonly Row[])): void => {
    above.push(shown);
    show(screenOf(typeof items === "function" ? items() : items, label, drillInto));
  };

  /** A phone: back up one level. */
  const pop = (): void => {
    const prev = above.pop();
    if (prev) show(prev);
  };

  /** Back to the panel's own rows, as it opens. */
  const home = (): void => {
    const first = above[0];
    if (!first) return;
    above.length = 0;
    shown = first;
    el.replaceChildren(...first.nodes);
    for (const update of first.updates) update();
  };

  const root = screenOf(rows, null, cascade);
  let shown = root;
  el.append(...root.nodes);
  document.body.append(el);

  return {
    el,
    refresh(): void {
      for (const update of shown.updates) update();
      for (const child of children) child.refresh();
    },
    open(anchor: HTMLElement | DOMRect, beside: boolean, wide = false): void {
      home();
      el.hidden = false;
      const placed: Placed = { box: anchor instanceof DOMRect ? anchor : anchor.getBoundingClientRect(), beside, wide };
      at = placed;
      place(el, placed.box, beside, wide);
    },
    close(): void {
      closeSub();
      el.hidden = true;
    },
    remove(): void {
      for (const child of children) child.remove();
      for (const child of made) child()?.remove();
      el.remove();
    },
  };
}

/** Rows without separators at either end or two in a row, as rows left out by a condition can leave them. */
function tidy(rows: readonly Row[]): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    if (row === "-" && (out.length === 0 || out[out.length - 1] === "-")) continue;
    out.push(row);
  }
  if (out[out.length - 1] === "-") out.pop();
  return out;
}

let openContext: (() => void) | null = null;
/** the button the open context menu drops from, if it does */
let openOwner: HTMLElement | null = null;

/** Closes the open context menu, if there is one. */
export function closeContextMenu(): void {
  openContext?.();
}

/**
 * Opens `rows` as a menu at (x, y) in the window, in place of the browser's own. A click outside
 * it, Escape or leaving the window closes it. A menu dropped from a button names it as `owner`:
 * a press on the button is left to the button (see menuButton), which closes the menu again.
 * `onClose` runs when it closes, however it does.
 */
export function openContextMenu(rows: readonly Row[], x: number, y: number, owner?: HTMLElement, onClose?: () => void): void {
  closeContextMenu();
  const shown = tidy(rows);
  if (shown.length === 0) return;
  const panel = buildPanel(shown, () => close());
  panel.el.classList.add("context-menu");
  const onDown = (e: PointerEvent): void => {
    if (e.target instanceof Element && e.target.closest(".menu-panel")) return;
    if (owner && e.target instanceof Node && owner.contains(e.target)) return;
    close();
  };
  // Escape closes the menu and is not passed on, so it does not also clear the selection; a modifier
  // pressed on its own leaves it open, for a Shift-click on a row
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
    }
    close();
  };
  const close = (): void => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("blur", close);
    panel.remove();
    openContext = null;
    openOwner = null;
    onClose?.();
  };
  openContext = close;
  openOwner = owner ?? null;
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
  panel.refresh();
  // a menu dropped from a button opens below it, or above it near the bottom of the window, and on a phone spans the window
  panel.open(owner ?? new DOMRect(x, y - 2, 0, 0), false, owner !== undefined);
}

/**
 * A button that drops a menu of `rows()` (read each time it opens) from its lower edge; a second
 * press closes it.
 */
export function menuButton(btn: HTMLButtonElement, rows: () => readonly Row[]): HTMLButtonElement {
  btn.setAttribute("aria-haspopup", "menu");
  btn.addEventListener("click", () => {
    btn.blur();
    if (openOwner === btn) {
      closeContextMenu();
      return;
    }
    const r = btn.getBoundingClientRect();
    openContextMenu(rows(), r.left, r.bottom + 2, btn);
  });
  return btn;
}
