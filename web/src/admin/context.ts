// What each tab of the admin page is given (main.ts makes it): who is signed in, the server's
// config, the period picked in the header, a signal that is aborted when the admin leaves the tab,
// and ways to put a count on a tab in the side bar and say when the numbers were fetched.

import type { ServerConfig, User } from "../platform/protocol.ts";

export type Tab =
  | "live"
  | "overview"
  | "audience"
  | "revenue"
  | "usage"
  | "people"
  | "feedback"
  | "errors"
  | "gallery"
  | "announcements"
  | "funding"
  | "settings"
  | "system";

export interface AdminContext {
  readonly user: User;
  readonly config: ServerConfig;
  /** the AI credit's currency, or null when this server has none */
  readonly currency: string | null;
  /** the period picked in the header, in days (7, 30, 90 or 365); a tab that uses it is made again when it changes */
  readonly days: number;
  /** aborted when the admin leaves the tab: stop timers, animation frames and fetches with it */
  readonly signal: AbortSignal;
  /** puts a count on a tab in the side bar (0 takes it off) */
  readonly badge: (tab: Tab, n: number) => void;
  /** "Updated 14:02" in the header; null clears it */
  readonly updated: (text: string | null) => void;
}

/**
 * Runs `fn` every `ms` while the tab is shown and the page is in front, until `signal` is aborted;
 * and once at once when the page comes back to the front after missing a turn.
 */
export function every(signal: AbortSignal, ms: number, fn: () => void): void {
  let missed = false;
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") fn();
    else missed = true;
  }, ms);
  const back = (): void => {
    if (document.visibilityState === "visible" && missed) {
      missed = false;
      fn();
    }
  };
  document.addEventListener("visibilitychange", back);
  signal.addEventListener("abort", () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", back);
  });
}

/** "Updated 14:02". */
export function updatedNow(): string {
  return `Updated ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
