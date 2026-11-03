// Transient messages at the bottom centre of the window.

import { h } from "./dom.ts";

export type ToastKind = "error" | "info";

const MAX_VISIBLE = 4;

const listeners = new Set<(message: string, kind: ToastKind) => void>();

/** Hears every message until the returned function is called (the Agents panel reads what an import said). */
export function onToast(fn: (message: string, kind: ToastKind) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function toast(message: string, kind: ToastKind = "error"): void {
  for (const fn of listeners) fn(message, kind);
  const host = document.getElementById("toasts");
  if (!host) {
    console.warn(message);
    return;
  }
  while (host.childElementCount >= MAX_VISIBLE) host.firstElementChild?.remove();
  const el = h("div", { cls: `toast ${kind}`, text: message });
  host.append(el);
  window.setTimeout(() => el.classList.add("out"), 4200);
  window.setTimeout(() => el.remove(), 4700);
}

// How each browser says a part of the editor that loads on demand (the 3D view, exporters, the
// site map) could not be fetched: openvwx was redeployed since the page opened, so the old file
// is gone, or the connection dropped.
const PART_NOT_LOADED = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (PART_NOT_LOADED.test(message)) {
    return "Part of Rodeo couldn't be downloaded. It may have been updated since this page opened, or the connection dropped: save your drawing, then reload the page.";
  }
  return message;
}
