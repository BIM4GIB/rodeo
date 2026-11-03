// The check after a file comes in: while Rodeo is new, a card over the drawing asks whether the
// file the user just opened or imported looks right, with one click to report it (the form opens
// with a screenshot and the file ticked, report.ts) and one to say it does. A file that could not
// be read gets the same offer straight away. Each file (by name and size) is asked about once on
// this device; the card goes when answered or closed, and when another drawing comes to the front.
// The answers are counted (app/visits.ts), so the admin page shows how files went for the people
// who brought them in, and how many left without answering.

import { h } from "../../app/dom.ts";
import { onDocument } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { countCheck } from "../../app/visits.ts";
import { config } from "../account/config.ts";
import { onBrought, type Brought } from "./brought.ts";
import { openFeedback } from "./report.ts";

/** time to look at the drawing before being asked */
const ASK_AFTER_MS = 2500;
const ASKED_KEY = "openvwx.fileChecks";
/** files remembered as asked about; the oldest are forgotten */
const ASKED_KEPT = 200;

let card: HTMLElement | null = null;
let showing: Brought | null = null;
let timer = 0;

onBrought((b) => {
  if (!config() || asked(b)) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => show(b), b.error ? 400 : ASK_AFTER_MS);
});

// the card is about the drawing it came into: another one brought to the front takes it away
onDocument((session) => {
  if (showing?.session && session !== showing.session) hide();
});

function keyOf(b: Brought): string {
  return `${b.name}|${b.size}`;
}

function askedList(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(ASKED_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function asked(b: Brought): boolean {
  return askedList().includes(keyOf(b));
}

function remember(b: Brought): void {
  try {
    const list = askedList().filter((k) => k !== keyOf(b));
    list.push(keyOf(b));
    localStorage.setItem(ASKED_KEY, JSON.stringify(list.slice(-ASKED_KEPT)));
  } catch {
    // storage off: the file may be asked about again
  }
}

function hide(): void {
  card?.remove();
  card = null;
  showing = null;
}

function show(b: Brought): void {
  // moved on to another drawing while waiting
  if (b.session && store.session !== b.session) return;
  const stage = document.getElementById("stage");
  if (!stage) return;
  hide();
  remember(b);
  countCheck(b.error ? "failed" : "asked", b.name);

  const answer = (how: "ok" | "report" | "closed"): void => {
    countCheck(how, b.name);
    hide();
    if (how === "report") openFeedback("bug", { about: b });
  };
  const button = (label: string, primary: boolean, run: () => void): HTMLButtonElement => {
    const btn = h("button", { cls: primary ? "btn small primary" : "btn small", text: label, attrs: { type: "button" } });
    btn.addEventListener("click", run);
    return btn;
  };
  const close = h("button", { cls: "icon-btn fb-check-close", text: "×", title: "Close", attrs: { type: "button", "aria-label": "Close" } });
  close.addEventListener("click", () => answer("closed"));

  const title = b.error ? `${b.name} didn't come in right` : `Does ${b.name} look right?`;
  const text = b.error
    ? "Send it to us and we'll find out why. One click opens a report with the file and a screenshot attached."
    : "Rodeo is new, and some files don't come in perfectly yet. If anything is missing or looks off, one click opens a report with a screenshot and the file attached, so we can fix it.";
  card = h(
    "section",
    { cls: b.error ? "fb-check failed" : "fb-check", attrs: { role: "status", "aria-label": title } },
    h("div", { cls: "fb-check-head" }, h("h2", { cls: "fb-check-title", text: title, title: b.name }), close),
    h("p", { cls: "fb-check-text", text }),
    h(
      "div",
      { cls: "fb-check-actions" },
      button(b.error ? "Send a report" : "Report a problem", true, () => answer("report")),
      button(b.error ? "Not now" : "Looks right", false, () => answer(b.error ? "closed" : "ok")),
    ),
  );
  showing = b;
  stage.append(card);
}
