// Apple Pencil. Once a pen has been seen, "Pencil Draws Only" (View menu, on by default)
// makes a finger pan the drawing instead of drawing with it, as in Notes or Procreate.
// Both facts are kept in localStorage, per browser, read and written with try/catch.

import { registerMenu } from "../../app/ext.ts";

const ONLY_KEY = "openvwx.pencilOnly";
const SEEN_KEY = "openvwx.penSeen";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // storage blocked: the defaults
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts for this visit
  }
}

let onlyPencil = read(ONLY_KEY) !== "0";
let penSeen = read(SEEN_KEY) === "1";

/** A pen touched the drawing: from now on "Pencil Draws Only" applies (and stays so). */
export function notePen(): void {
  if (penSeen) return;
  penSeen = true;
  write(SEEN_KEY, "1");
}

/** True when a finger should pan rather than draw: the option is on and a pen has been seen. */
export function fingerPans(): boolean {
  return onlyPencil && penSeen;
}

export function setPencilOnly(on: boolean): void {
  onlyPencil = on;
  write(ONLY_KEY, on ? "1" : "0");
}

registerMenu("View", () => [
  {
    label: "Pencil Draws Only",
    checked: () => onlyPencil,
    run: () => setPencilOnly(!onlyPencil),
  },
]);
