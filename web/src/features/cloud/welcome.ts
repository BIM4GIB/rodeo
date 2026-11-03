// The start hub's cloud parts, for a signed-in user: Open from Cloud… beside Open file, and their
// latest cloud drawings on the hub's Recent list beside those opened from this computer. Both go
// when they sign out.

import { h } from "../../app/dom.ts";
import type { ShowRecent } from "../../app/ext.ts";
import { files, onUser, serverConfig } from "../../platform/api.ts";
import { openCloudFile } from "./cloud.ts";
import { openCloudBrowser } from "./browser.ts";

/** How many cloud drawings the Recent list takes (it shows the newest few of everything). */
const RECENT = 5;

const ICON_CLOUD = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.8 12.2h6.6a2.6 2.6 0 0 0 .4-5.2 3.6 3.6 0 0 0-6.9.9 2.1 2.1 0 0 0-.1 4.3z"/></svg>`;

/** Open from Cloud…, in the hub's row of open buttons; shown while someone is signed in. */
export function cloudOpenButton(): HTMLElement {
  const button = h("button", { cls: "btn", text: "Open from Cloud…", hidden: true, attrs: { type: "button" } });
  button.addEventListener("click", () => void openCloudBrowser());
  void serverConfig().then((cfg) => {
    if (cfg) onUser((u) => (button.hidden = u === null));
  });
  return button;
}

/** Puts the signed-in user's latest cloud drawings on the Recent list, and takes them off when they sign out. */
export function watchCloudRecent(show: ShowRecent): void {
  const sync = async (signedIn: boolean): Promise<void> => {
    if (!signedIn) {
      show([]);
      return;
    }
    try {
      const latest = [...(await files.list())].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, RECENT);
      show(latest.map((f) => ({ name: f.name, at: Date.parse(f.updatedAt), icon: ICON_CLOUD, open: () => void openCloudFile(f.id) })));
    } catch {
      // the list is a convenience: without it the hub still offers Open from Cloud
      show([]);
    }
  };
  void serverConfig().then((cfg) => {
    if (cfg) onUser((u) => void sync(u !== null));
  });
}
