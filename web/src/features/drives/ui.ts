// The drives' entries in the editor: the File menu rows, and the start hub's
// provider buttons. A provider shows only when the server offers it, so a server
// without drive settings shows neither.

import { h } from "../../app/dom.ts";
import type { Row } from "../../app/menu.ts";
import { store } from "../../app/state.ts";
import { openFromGoogle, openFromOneDrive, saveToGoogle, saveToOneDrive } from "./actions.ts";
import { type GoogleConfig, type MicrosoftConfig, driveConfig, offeredDrives } from "./config.ts";
import { ICON_CLOUD } from "./icons.ts";

/** The File menu rows: open rows, then save rows, for the providers offered. */
export function fileRows(): Row[] {
  const drives = offeredDrives();
  const opens: Row[] = [];
  const saves: Row[] = [];
  const hasDrawing = (): boolean => store.session !== null;
  const google = drives?.google;
  if (google) {
    opens.push({ label: "Open from Google Drive…", run: () => openFromGoogle(google) });
    saves.push({ label: "Save to Google Drive…", enabled: hasDrawing, run: () => saveToGoogle(google) });
  }
  const microsoft = drives?.microsoft;
  if (microsoft) {
    opens.push({ label: "Open from OneDrive…", run: () => openFromOneDrive(microsoft) });
    saves.push({ label: "Save to OneDrive…", enabled: hasDrawing, run: () => saveToOneDrive(microsoft) });
  }
  return opens.length > 0 ? [...opens, "-", ...saves] : [];
}

/** The start hub's open row: a button per provider offered, beside Open file, hidden until the server answers. */
export function welcomeBlock(): HTMLElement {
  let google: GoogleConfig | null = null;
  let microsoft: MicrosoftConfig | null = null;
  const googleBtn = h(
    "button",
    { cls: "btn", attrs: { type: "button" }, hidden: true },
    h("span", { cls: "drives-glyph", html: ICON_CLOUD }),
    h("span", { text: "Google Drive" }),
  );
  const onedriveBtn = h(
    "button",
    { cls: "btn", attrs: { type: "button" }, hidden: true },
    h("span", { cls: "drives-glyph", html: ICON_CLOUD }),
    h("span", { text: "OneDrive" }),
  );
  const block = h("div", { cls: "drives-welcome", hidden: true }, googleBtn, onedriveBtn);
  googleBtn.addEventListener("click", () => {
    if (google) openFromGoogle(google);
  });
  onedriveBtn.addEventListener("click", () => {
    if (microsoft) openFromOneDrive(microsoft);
  });
  void driveConfig().then((drives) => {
    google = drives?.google ?? null;
    microsoft = drives?.microsoft ?? null;
    googleBtn.hidden = !google;
    onedriveBtn.hidden = !microsoft;
    block.hidden = !google && !microsoft;
  });
  return block;
}
