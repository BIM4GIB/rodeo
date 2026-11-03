// Visits: the editor tells the server it is in use, so admins can see how many people use Rodeo,
// signed in or not (POST /api/visits; the admin page at /admin). It says so when it opens, each
// minute while it is in front, and when a drawing opens, with the drawing's kind ("vwx", "dwg",
// "blank" for a new one). With the first word go how the visit began (the editor, a share link,
// an invite, an embed, the installed app), the site that linked here, a campaign tag (?utm_source=
// or ?ref=) and the kind of device. The check after a file comes in has its answers counted too
// (countCheck). Never the drawing or its name. Nothing is kept on the device
// and no cookie is set: the server tells visitors apart for one day only (server/src/visits.ts).
// Test browsers (navigator.webdriver) send nothing, unless localStorage "openvwx.visits" is "on".

import { serverConfig } from "../platform/api.ts";
import type { VisitEntry } from "../platform/protocol.ts";
import type { EditSession } from "../core/index.ts";
import { onDocument } from "./ext.ts";
import { store } from "./state.ts";

const PING_MS = 60_000;

let lastSent = 0;

function testing(): boolean {
  if (!navigator.webdriver) return false;
  try {
    return localStorage.getItem("openvwx.visits") !== "on";
  } catch {
    return true;
  }
}

function entryOf(params: URLSearchParams): VisitEntry {
  if (params.has("embed")) return "embed";
  if (params.has("share")) return "share";
  if (params.has("invite")) return "invite";
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return standalone ? "app" : "editor";
}

function deviceOf(): "phone" | "tablet" | "desktop" {
  if (!matchMedia("(pointer: coarse)").matches) return "desktop";
  return Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet";
}

function referrerHost(): string | null {
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    return host && host !== location.hostname ? host : null;
  } catch {
    return null;
  }
}

function send(event: "visit" | "ping" | "open" | "check", extra: Record<string, string | null> = {}): void {
  lastSent = Date.now();
  void serverConfig()
    .then((cfg) => {
      if (!cfg) return;
      return fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" },
        body: JSON.stringify({ event, device: deviceOf(), ...extra }),
        credentials: "include",
        keepalive: true,
      });
    })
    .catch(() => {
      // a count missed: nothing to tell anyone
    });
}

/** "dwg", from a file's name; "blank" for a new drawing ("Untitled n") */
function formatOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return /^Untitled \d+(\.\w+)?$/.test(name) || dot <= 0 ? "blank" : name.slice(dot + 1).toLowerCase();
}

/**
 * Counts an answer to the check after a file comes in (features/feedback/check.ts): "asked" when
 * it shows, "failed" when it shows for a file that could not be read, then "ok", "report" or
 * "closed". With the file's kind, never its name.
 */
export function countCheck(answer: "asked" | "failed" | "ok" | "report" | "closed", fileName: string): void {
  if (!testing()) send("check", { answer, format: formatOf(fileName) });
}

if (!testing()) {
  const params = new URLSearchParams(location.search);
  send("visit", {
    entry: entryOf(params),
    referrer: referrerHost(),
    campaign: params.get("utm_source") ?? params.get("ref"),
  });

  // each minute while the editor is in front, and at once on coming back after longer
  setInterval(() => {
    if (document.visibilityState === "visible") send("ping");
  }, PING_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastSent >= PING_MS) send("ping");
  });

  // a drawing counts when it opens, not each time its tab comes to the front
  const seen = new WeakSet<EditSession>();
  onDocument((session) => {
    if (!session || seen.has(session)) return;
    seen.add(session);
    // a new drawing (File > New, or from a template) is "Untitled n" until it is saved
    send("open", { format: formatOf(store.fileName) });
  });
}
