// The Notification Center, as Vectorworks 2027 has it on its status bar: a bell that keeps every
// alert of this session (each message shown at the foot of the window, notes and errors, with its
// time), newest first, with a count of those not yet seen (red when one of them is an error) and
// Clear All. The alerts still show where they did and go by themselves, needing no answer. A click
// on the bell, or Window > Notification Center, opens the list; Esc, the bell again or a click
// elsewhere closes it. The session is the page's: a reload starts an empty list.

import "./notifications.css";
import { h } from "./dom.ts";
import { UI_ICON } from "./icons.ts";
import { onToast, type ToastKind } from "./toast.ts";

interface Alert {
  readonly message: string;
  readonly kind: ToastKind;
  readonly at: Date;
}

/** the most alerts kept; older ones drop off */
const MAX_ALERTS = 200;
/** a count above this shows as this and a plus */
const MAX_COUNT = 99;
/** the list's gap from the bell and from the window's edges (CSS px) */
const GAP = 8;

const alerts: Alert[] = [];
let unseen = 0;
let unseenError = false;
let bell: HTMLButtonElement | null = null;
let badge: HTMLElement | null = null;
let panel: { readonly el: HTMLElement; render(): void } | null = null;

// heard from the start, so what is said before the bar is built is kept too
onToast((message, kind) => {
  alerts.unshift({ message, kind, at: new Date() });
  alerts.length = Math.min(alerts.length, MAX_ALERTS);
  if (panel) {
    panel.render();
  } else {
    unseen++;
    unseenError ||= kind === "error";
  }
  renderBadge();
});

function renderBadge(): void {
  if (!bell || !badge) return;
  badge.hidden = unseen === 0;
  badge.textContent = unseen > MAX_COUNT ? `${MAX_COUNT}+` : String(unseen);
  badge.classList.toggle("error", unseenError);
  const label = unseen ? `Notification Center: ${unseen} new` : "Notification Center";
  bell.title = label;
  bell.setAttribute("aria-label", label);
}

/** Puts the Notification Center's bell at the end of `host` (the status bar's pill). */
export function mountNotifications(host: HTMLElement): void {
  badge = h("span", { cls: "sb-badge", attrs: { "aria-hidden": "true" } });
  bell = h(
    "button",
    { cls: "sb-more sb-notify", attrs: { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" } },
    badge,
  );
  bell.insertAdjacentHTML("afterbegin", UI_ICON.bell);
  bell.addEventListener("click", () => {
    if (panel) closeNotificationCenter();
    else openNotificationCenter();
  });
  host.append(h("span", { cls: "pill-sep sb-notify-sep" }), bell);
  renderBadge();
}

/** Opens the list of this session's alerts above the bell (or the window's foot when the bell is hidden). */
export function openNotificationCenter(): void {
  if (panel) return;
  const list = h("ol", { cls: "notify-list" });
  const count = h("span", { cls: "notify-count" });
  const clear = h("button", { cls: "btn", text: "Clear All", attrs: { type: "button" } });
  const el = h(
    "div",
    { cls: "notify-panel", attrs: { role: "dialog", "aria-label": "Notification Center", tabindex: "-1" } },
    h("header", { cls: "notify-head" }, h("h2", { cls: "notify-title", text: "Notifications" }), count, clear),
    list,
  );
  const render = (): void => {
    count.textContent = alerts.length ? String(alerts.length) : "";
    clear.disabled = alerts.length === 0;
    list.replaceChildren(
      ...(alerts.length
        ? alerts.map((a) =>
            h(
              "li",
              { cls: `notify-item ${a.kind}` },
              h("span", { cls: "notify-dot", attrs: { "aria-label": a.kind === "error" ? "Error" : "Note" } }),
              h("span", { cls: "notify-message", text: a.message }),
              h("time", { cls: "notify-time", text: a.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), attrs: { datetime: a.at.toISOString() } }),
            ),
          )
        : [h("li", { cls: "notify-empty", text: "No alerts this session." })]),
    );
  };
  clear.addEventListener("click", () => {
    alerts.length = 0;
    render();
  });
  render();
  document.body.append(el);
  panel = { el, render };
  unseen = 0;
  unseenError = false;
  renderBadge();
  bell?.setAttribute("aria-expanded", "true");
  place(el);
  el.focus();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onResize);
}

export function closeNotificationCenter(): void {
  if (!panel) return;
  panel.el.remove();
  panel = null;
  bell?.setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("resize", onResize);
}

/** Above the bell, its right edge with the bell's; at the window's foot when the bell isn't showing. */
function place(el: HTMLElement): void {
  const r = bell && bell.offsetParent !== null ? bell.getBoundingClientRect() : null;
  const right = r ? window.innerWidth - r.right : 16;
  const bottom = r ? window.innerHeight - r.top + GAP : 72;
  el.style.right = `${Math.max(GAP, right)}px`;
  el.style.bottom = `${Math.max(GAP, bottom)}px`;
}

function onPointerDown(e: PointerEvent): void {
  const t = e.target as Node;
  if (panel && !panel.el.contains(t) && !bell?.contains(t)) closeNotificationCenter();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  closeNotificationCenter();
  bell?.focus();
}

function onResize(): void {
  if (panel) place(panel.el);
}
