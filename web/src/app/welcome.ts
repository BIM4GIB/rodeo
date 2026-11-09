/// <reference types="vite/client" />
// The start hub: one card over the whole editor, which shows faded behind it, until a drawing is
// open (and over open ones from Window > Home Screen, with a button, Esc or a click beside the card
// back). Open a file (or drop one anywhere, fileio.ts), the drawings opened lately, and the blocks
// features register (account at the header's end, the cloud's Recent drawings, the sponsor, the
// footer's links). It steps aside while a file loads, so the loading card shows. The markup is in
// index.html. "Try sample" exists only in the dev server, where Vite serves
// ../samples/sample.vwx at /__sample.vwx.

import { byId, h } from "./dom.ts";
import { registerWelcome, type RecentFile, type ShowRecent } from "./ext.ts";
import { language, languagePicker } from "./i18n.ts";
import { isLoading, onLoading } from "./loading.ts";
import { type RecentEntry, onRecentChange, recentList } from "./recent.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import "./welcome.css";

export interface WelcomeActions {
  openPicker(): void;
  newDrawing(): void;
  newFromTemplate(): void;
  openBytes(bytes: Uint8Array, name: string): void;
  /** reopens a drawing from the recent list, read through its handle */
  openRecent(entry: RecentEntry): void;
}

registerWelcome(languagePicker, "foot");

/** How many recent drawings the hub lists. */
const RECENT_SHOWN = 5;

const ICON_FILE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5"/></svg>`;

/** the hub, its button back to the drawing, and how it decides whether it shows */
let hub: HTMLElement | null = null;
let back: HTMLButtonElement | null = null;
let sync: () => void = () => {};
/** Window > Home Screen asked for it over the drawing open */
let home = false;

export function mountWelcome(root: HTMLElement, actions: WelcomeActions): void {
  hub = root;
  back = h("button", { cls: "btn hub-back", text: "Back to drawing", hidden: true, attrs: { type: "button" } });
  back.addEventListener("click", hideHome);
  root.querySelector(".hub-head-end")?.prepend(back);
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !store.session) return;
    e.stopPropagation();
    hideHome();
  });
  // a click on the faded editor beside the card goes back to the drawing
  root.addEventListener("click", (e) => {
    if (e.target === root) hideHome();
  });
  byId("welcome-open").addEventListener("click", () => actions.openPicker());
  byId("welcome-new").addEventListener("click", () => actions.newDrawing());
  byId("welcome-template").addEventListener("click", () => actions.newFromTemplate());

  const sample = byId<HTMLButtonElement>("welcome-sample");
  if (import.meta.env.DEV) {
    sample.hidden = false;
    sample.addEventListener("click", () => {
      void loadSample(actions);
    });
  }

  mountRecent(actions);

  // shown with no drawing open or when asked for, and never while a file loads; the editor behind
  // takes no clicks or focus while it shows (dialogs and menus open on the body, above it)
  const editor = document.querySelector<HTMLElement>(".app");
  sync = (): void => {
    const shown = (store.session === null || home) && !isLoading();
    root.hidden = !shown;
    if (editor) editor.inert = shown;
    if (back) back.hidden = store.session === null;
  };
  // a drawing opened or brought to the front hides it
  store.on("session", () => {
    home = false;
    sync();
  });
  onLoading(sync);
  sync();
}

/** Window > Home Screen: the hub over the drawings open, with a button (and Esc) back to the one in front. */
export function showHome(): void {
  if (!hub) return;
  home = true;
  sync();
  hub.querySelector<HTMLButtonElement>("#welcome-open")?.focus();
}

function hideHome(): void {
  if (!store.session) return;
  home = false;
  sync();
}

/**
 * The Recent list: the drawings opened from this computer and those features list (the cloud's),
 * newest first. Shown while there are any, and redrawn whenever one of them changes.
 */
let paintRecent: () => void = () => {};
const featureFiles: (readonly RecentFile[])[] = [];

/** A place on the Recent list for a feature's drawings (ext.ts registerRecentFiles). */
export function recentSource(): ShowRecent {
  const at = featureFiles.push([]) - 1;
  return (files) => {
    featureFiles[at] = files;
    paintRecent();
  };
}

function mountRecent(actions: WelcomeActions): void {
  const section = byId("welcome-recent");
  const list = byId("welcome-recent-list");
  paintRecent = (): void => {
    const here: RecentFile[] = recentList().map((entry) => ({
      name: entry.name,
      at: entry.openedAt,
      icon: ICON_FILE,
      open: () => actions.openRecent(entry),
    }));
    const files = [...here, ...featureFiles.flat()].sort((a, b) => b.at - a.at).slice(0, RECENT_SHOWN);
    section.hidden = files.length === 0;
    list.replaceChildren(...files.map(recentRow));
  };
  onRecentChange(paintRecent);
  paintRecent();
}

function recentRow(file: RecentFile): HTMLElement {
  const button = h(
    "button",
    { cls: "hub-file", attrs: { type: "button", title: file.name } },
    h("span", { cls: "hub-file-icon", html: file.icon }),
    h("span", { cls: "hub-file-name", text: file.name, attrs: { translate: "no" } }),
    h("span", { cls: "hub-file-time", text: timeAgo(file.at) }),
  );
  button.addEventListener("click", () => file.open());
  return h("li", {}, button);
}

/** How long ago a time was, as the list reads it: "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
function timeAgo(ms: number, now = Date.now()): string {
  const secs = (now - ms) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 7 * 86400) {
    const days = Math.floor(secs / 86400);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  const then = new Date(ms);
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return then.toLocaleDateString(language().code === "en" ? "en-GB" : language().code, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

async function loadSample(actions: WelcomeActions): Promise<void> {
  try {
    const res = await fetch("/__sample.vwx");
    if (!res.ok) throw new Error(`sample not available (HTTP ${res.status})`);
    actions.openBytes(new Uint8Array(await res.arrayBuffer()), "sample.vwx");
  } catch (err) {
    toast(`Could not load the sample: ${errorMessage(err)}`);
  }
}
