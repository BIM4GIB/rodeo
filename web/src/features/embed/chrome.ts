// The viewer's controls over an embedded drawing: its name and owner, the layer or sheet picker,
// 2D | 3D, Fit, Turn, Full Screen and Open in Rodeo, as the embed's `ui` option asks. Also the
// poster shown while the drawing loads, and the card for a drawing that can't be shown. Plain DOM
// built with h(); text that came from the drawing goes in as text, never as markup.

import { h } from "../../app/dom.ts";
import "./embed.css";

export type ChromeUi = "full" | "min" | "none";
export interface ChromeLayer { readonly id: string; readonly label: string }
export interface ChromeState {
  readonly view: "2d" | "3d";
  /** false once the drawing turned out to have no 3D model, or WebGL is missing */
  readonly can3d: boolean;
  readonly rotating: boolean;
  readonly layers: readonly ChromeLayer[];
  readonly layerId: string | null;
}
export interface ChromeActions {
  view(view: "2d" | "3d"): void;
  fit(): void;
  rotate(on: boolean): void;
  layer(id: string): void;
}
export interface ChromeInfo { readonly ui: ChromeUi; readonly title: string; readonly owner: string | null; readonly openUrl: string }
export interface EmbedChrome { update(state: ChromeState): void; remove(): void }

/** A 16 px line icon: its paths, stroked in the current colour so they follow the text. */
function iconSvg(paths: string): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const FIT_ICON = iconSvg('<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>');
const TURN_ICON = iconSvg('<path d="M11.83 4.79A5 5 0 1 0 13 8"/><path d="M11.2 9.7 13 8l1.8 1.7"/>');
const EXPAND_ICON = iconSvg('<path d="M9.5 2H14v4.5M6.5 14H2V9.5M14 2 9.5 6.5M2 14l4.5-4.5"/>');
const COLLAPSE_ICON = iconSvg('<path d="M10 2v4h4M14.5 1.5 10 6M6 14v-4H2M1.5 14.5 6 10"/>');

/** The attributes of a link out to the drawing on Rodeo, opened in a new tab. */
function openAttrs(url: string): Record<string, string> {
  return { href: url, target: "_blank", rel: "noopener" };
}

/** A toolbar button: its icon, its words when it has them, and its name for a screen reader. */
function toolButton(act: string, label: string, glyph: string, onClick: () => void, text?: string, pressed?: boolean): HTMLButtonElement {
  const attrs: Record<string, string> = { type: "button", title: label, "aria-label": label, "data-act": act };
  if (pressed !== undefined) attrs["aria-pressed"] = String(pressed);
  const button = h("button", { cls: text === undefined ? "embed-btn embed-btn-icon" : "embed-btn", html: glyph, attrs }, text);
  button.addEventListener("click", onClick);
  return button;
}

/** One half of the 2D | 3D pair: a pressed toggle with the view's name. */
function segButton(act: string, text: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const button = h("button", { cls: "embed-seg-btn", text, attrs: { type: "button", "aria-pressed": String(pressed), "data-act": act } });
  button.addEventListener("click", onClick);
  return button;
}

/** Enters or leaves full screen. A refusal from the browser is ignored, so the button does nothing. */
function toggleFullscreen(): void {
  const change = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  change.catch(() => undefined);
}

/** The viewer's controls over the drawing, as `info.ui` asks. */
export function mountChrome(info: ChromeInfo, state: ChromeState, actions: ChromeActions): EmbedChrome {
  const root = h("div", { cls: "embed-ui" });
  let current = state;
  let head: HTMLElement | null = null;
  let layerPicker: HTMLSelectElement | null = null;
  let tools: HTMLElement | null = null;

  // the name and the layer picker sit at the top left, in full mode only
  if (info.ui === "full") {
    const owner = info.owner ? h("span", { cls: "embed-title-owner", text: `by ${info.owner}` }) : null;
    const title = h("div", { cls: "embed-title", title: info.title }, h("span", { cls: "embed-title-name", text: info.title }), owner);
    head = h("div", { cls: "embed-head" }, title);
    root.append(head);
  }

  if (info.ui === "none") {
    root.append(h("a", { cls: "embed-mark", title: "Open in Rodeo", attrs: { ...openAttrs(info.openUrl), "aria-label": "Open in Rodeo" } },
      h("img", { attrs: { src: "/icon.svg", width: "20", height: "20", alt: "" } })));
  } else {
    const bar = h("div", { cls: "embed-tools", attrs: { role: "toolbar", "aria-label": "View" } });
    tools = bar;
    // the words are hidden on a phone, where the toolbar needs the room; the link keeps its name
    root.append(bar, h("a", { cls: "embed-open", attrs: { ...openAttrs(info.openUrl), "aria-label": "Open in Rodeo" } },
      h("img", { attrs: { src: "/icon.svg", width: "16", height: "16", alt: "" } }),
      h("span", { cls: "embed-open-words", text: "Open in Rodeo" })));
  }

  /** Makes the layer picker once, so it keeps its focus across updates. */
  function makePicker(host: HTMLElement): HTMLSelectElement {
    const picker = h("select", { cls: "embed-layer", attrs: { "aria-label": "Layer or sheet" } });
    picker.addEventListener("change", () => actions.layer(picker.value));
    host.append(picker);
    return picker;
  }

  // the picker appears with two or more layers or sheets to choose from
  function drawLayer(s: ChromeState): void {
    if (!head) return;
    if (s.layers.length < 2) {
      layerPicker?.remove();
      layerPicker = null;
      return;
    }
    const picker = layerPicker ?? makePicker(head);
    layerPicker = picker;
    picker.replaceChildren(...s.layers.map((l) => h("option", { value: l.id, text: l.label })));
    picker.value = s.layerId ?? "";
  }

  // the toolbar: 2D | 3D, Fit, Turn and Full Screen, as the mode allows. A rebuilt toolbar gives
  // the focus back to the control with the same action, so keyboard use isn't lost on a change.
  function drawTools(s: ChromeState): void {
    if (!tools) return;
    const active = document.activeElement;
    const keep = active instanceof HTMLElement && tools.contains(active) ? active.dataset.act : undefined;
    const parts: HTMLElement[] = [];
    if (info.ui === "full" && s.can3d) {
      parts.push(h("div", { cls: "embed-seg", attrs: { role: "group", "aria-label": "2D or 3D" } },
        segButton("view2d", "2D", s.view === "2d", () => actions.view("2d")),
        segButton("view3d", "3D", s.view === "3d", () => actions.view("3d"))));
    }
    if (info.ui === "full") parts.push(toolButton("fit", "Fit", FIT_ICON, () => actions.fit(), "Fit"));
    if (info.ui === "full" && s.view === "3d") {
      parts.push(toolButton("rotate", "Turn slowly", TURN_ICON, () => actions.rotate(!s.rotating), "Turn", s.rotating));
    }
    if (document.fullscreenEnabled) {
      const on = Boolean(document.fullscreenElement);
      parts.push(toolButton("fullscreen", on ? "Exit full screen" : "Full screen", on ? COLLAPSE_ICON : EXPAND_ICON, toggleFullscreen));
    }
    tools.replaceChildren(...parts);
    if (keep) {
      Array.from(tools.querySelectorAll<HTMLElement>("[data-act]")).find((b) => b.dataset.act === keep)?.focus();
    }
  }

  // leaving or entering full screen changes the button's icon and name
  function onFullscreen(): void {
    drawTools(current);
  }

  drawLayer(state);
  drawTools(state);
  document.body.append(root);
  document.addEventListener("fullscreenchange", onFullscreen);

  return {
    update(next: ChromeState): void {
      current = next;
      drawLayer(next);
      drawTools(next);
    },
    remove(): void {
      document.removeEventListener("fullscreenchange", onFullscreen);
      root.remove();
    },
  };
}

/** The poster, for a page that came without one (no server, or a public file): the name and a spinner. */
export function showPoster(title: string): void {
  if (document.getElementById("embed-poster")) return;
  document.body.append(h("div", { cls: "embed-poster", attrs: { id: "embed-poster" } },
    h("p", { cls: "embed-poster-name", text: title }),
    h("span", { cls: "embed-poster-spin" })));
}

/** A line on the poster (how much of a public file has come). */
export function posterStatus(text: string): void {
  const poster = document.getElementById("embed-poster");
  if (!poster) return;
  let status = poster.querySelector<HTMLElement>(".embed-poster-status");
  if (!status) {
    status = h("p", { cls: "embed-poster-status" });
    poster.append(status);
  }
  status.textContent = text;
}

/** Fades the poster out and removes it, once the drawing is drawn. */
export function dropPoster(): void {
  const poster = document.getElementById("embed-poster");
  if (!poster || poster.classList.contains("gone")) return;
  poster.classList.add("gone");
  setTimeout(() => poster.remove(), 300);
}

/** The card shown in place of the drawing when it can't be shown. */
export function showEmbedError(message: string, openUrl: string | null): void {
  dropPoster();
  document.querySelector(".embed-error")?.remove();
  const card = h("div", { cls: "embed-error-card" },
    h("p", { text: message }),
    openUrl ? h("a", { cls: "btn primary", text: "Open Rodeo", attrs: openAttrs(openUrl) }) : null);
  document.body.append(h("div", { cls: "embed-error", attrs: { role: "alert" } }, card));
}
