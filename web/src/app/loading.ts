// Loading overlay: a centred label and an indeterminate bar over the drawing
// while a file is read. Parsing is synchronous, so the caller yields a frame
// before it starts the overlay, and calls the returned function when parsing is
// done or has failed. Given onCancel, the card has an X that calls it. Work that
// knows how far along it is (an upload) changes the label and fills the bar. The start hub
// steps aside while any overlay shows (onLoading), so a file opened from it shows its progress.

import "./loading.css";
import { byId, h } from "./dom.ts";

const CROSS = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

/** how many overlays are showing, and who wants to know when that goes from none to some or back */
let showing = 0;
const loadingListeners: (() => void)[] = [];

/** Whether a loading overlay is showing. */
export function isLoading(): boolean {
  return showing > 0;
}

/** Calls `fn` whenever a first overlay shows or the last one goes. */
export function onLoading(fn: () => void): void {
  loadingListeners.push(fn);
}

function count(by: 1 | -1): void {
  showing += by;
  if (showing === (by === 1 ? 1 : 0)) for (const fn of loadingListeners) fn();
}

/** The function that removes the overlay, which can also change what it says and how full its bar is. */
export interface Loading {
  (): void;
  label(text: string): void;
  /** fills the bar to `fraction` (0 to 1); null makes it the moving bar again */
  progress(fraction: number | null): void;
}

/** Shows the overlay over the canvas area and returns the function that removes it. */
export function showLoading(label: string, onCancel?: () => void): Loading {
  const text = h("div", { cls: "loading-label", text: label, title: label });
  const fill = h("div", { cls: "loading-bar-fill" });
  const head = h("div", { cls: "loading-head" }, text);
  if (onCancel) {
    const cancel = h("button", { cls: "icon-btn loading-cancel", html: CROSS, title: "Cancel", attrs: { type: "button", "aria-label": "Cancel" } });
    cancel.addEventListener("click", onCancel);
    head.append(cancel);
  }
  const overlay = h(
    "div",
    { cls: "loading", attrs: { role: "status", "aria-live": "polite" } },
    h("div", { cls: "loading-card" }, head, h("div", { cls: "loading-bar" }, fill)),
  );
  byId("canvas-wrap").append(overlay);
  let shown = true;
  count(1);
  const done = (): void => {
    if (!shown) return;
    shown = false;
    overlay.remove();
    count(-1);
  };
  return Object.assign(done, {
    label(next: string): void {
      text.textContent = next;
      text.title = next;
    },
    progress(fraction: number | null): void {
      fill.classList.toggle("known", fraction !== null);
      fill.style.width = fraction === null ? "" : `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    },
  });
}

/** how long work runs before slowLoading's overlay shows */
const SLOW_MS = 400;

/**
 * The overlay for work that is often quick (saving a drawing): it shows only once the work has
 * taken SLOW_MS, so a quick one doesn't flash it. done() removes it, or keeps it from showing.
 */
export function slowLoading(label: string, onCancel?: () => void): { progress(fraction: number): void; done(): void } {
  let shown: Loading | null = null;
  let fraction = 0;
  const timer = window.setTimeout(() => {
    shown = showLoading(label, onCancel);
    shown.progress(fraction);
  }, SLOW_MS);
  return {
    progress(f) {
      fraction = f;
      shown?.progress(f);
    },
    done() {
      window.clearTimeout(timer);
      shown?.();
    },
  };
}
