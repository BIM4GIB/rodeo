// The agent pill in the top bar: what outside agents are doing in this drawing (the call running
// and how many wait), a Stop or Resume button, and a menu of their recent calls, the files they
// made and the Connect an Agent dialog. It shows while an agent is working or has worked here in
// the last ten minutes, and while Stop is in effect, so the bar stays as it was otherwise.

import { h } from "../../app/dom.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { openContextMenu, type Row } from "../../app/menu.ts";
import { bridgeState, bridgeStatusText, onBridge, resumeAgents, stopAgents, type BridgeState } from "./bridge.ts";
import { openConnectDialog } from "./dialog.ts";

/** How long after an agent's last call the pill still shows that an agent worked here. */
const RECENT_MS = 10 * 60_000;
/** How often the pill checks whether that time has run out, since nothing else changes then. */
const CHECK_MS = 30_000;
const MENU_CALLS = 12;
const MENU_FILES = 5;

/** The agent pill for the top bar, hidden until there is something to show; registered with registerTopBar. */
export function agentPill(): HTMLElement {
  const dot = h("span", { cls: "mcp-dot" });
  const text = h("span", { cls: "mcp-pill-text" });
  const main = h("button", { cls: "mcp-pill-main", attrs: { type: "button" } }, dot, text);
  const stop = h("button", { cls: "mcp-pill-stop", attrs: { type: "button" } });
  const root = h("div", { cls: "mcp-pill", hidden: true }, main, stop);

  // one button does both: Stop while agents may work, Resume while they are stopped
  stop.addEventListener("click", () => (bridgeState().paused ? resumeAgents() : stopAgents()));
  main.addEventListener("click", () => openMenu(main));

  /** Shows the pill's text and button for the state, or hides the pill when there is nothing to say. */
  const render = (s: BridgeState): void => {
    const shown = describe(s);
    root.hidden = !shown;
    if (!shown) return;
    root.dataset.mode = shown.mode;
    text.textContent = shown.text;
    main.title = shown.title;
    main.setAttribute("aria-label", shown.text);
    stop.textContent = shown.mode === "paused" ? "Resume" : "Stop";
    stop.setAttribute("aria-label", shown.mode === "paused" ? "Resume agents" : "Stop agents");
  };

  onBridge(render);
  window.setInterval(() => render(bridgeState()), CHECK_MS);
  render(bridgeState());
  return root;
}

interface Shown {
  readonly mode: "paused" | "working" | "idle";
  readonly text: string;
  readonly title: string;
}

/** What the pill shows for a state, or null when it should be hidden. */
function describe(s: BridgeState): Shown | null {
  if (s.paused) return { mode: "paused", text: "Agents paused", title: "Agents are stopped: they can't change the drawing until you press Resume." };
  if (s.running) {
    const r = s.running;
    const text = `${r.agent} · ${r.label}${r.progress ? ` · ${r.progress}` : ""}${s.queued ? ` (+${s.queued})` : ""}`;
    return { mode: "working", text, title: text };
  }
  if (s.lastCallAt > 0 && Date.now() - s.lastCallAt < RECENT_MS) {
    const when = new Date(s.lastCallAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return { mode: "idle", text: s.lastAgent || "Agent", title: `An agent last worked here at ${when}` };
  }
  return null;
}

/** The pill's menu: recent calls, files to download, Stop or Resume, and the dialog for connecting another agent. */
function openMenu(anchor: HTMLElement): void {
  const s = bridgeState();
  const rows: Row[] = [];
  if (s.log.length === 0) rows.push({ label: "No calls yet", enabled: () => false });
  for (const e of s.log.slice(0, MENU_CALLS)) {
    rows.push({ label: `${mark(e.ok)} ${clock(e.at)} ${e.agent}: ${e.label}`, enabled: () => false });
  }
  if (s.files.length) {
    rows.push("-");
    for (const f of s.files.slice(0, MENU_FILES)) rows.push({ label: `Download ${f.name}`, run: () => downloadBlob(f.name, f.blob) });
  }
  rows.push("-", { label: s.paused ? "Resume Agents" : "Stop Agents", run: s.paused ? resumeAgents : stopAgents });
  rows.push({ label: "Connect an Agent…", run: () => void openConnectDialog(bridgeStatusText) });
  const r = anchor.getBoundingClientRect();
  openContextMenu(rows, r.left, r.bottom + 4, anchor);
}

/** A call's mark in the menu: running, done, or failed. */
function mark(ok: boolean | null): string {
  if (ok === null) return "…";
  return ok ? "✓" : "✗";
}

/** A call's time for the menu, as the local clock shows it. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
