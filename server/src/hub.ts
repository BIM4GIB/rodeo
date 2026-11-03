// The collaboration hub, set once the HTTP server exists (see index.ts). Routes
// reach live sessions only through getHub().

import type { CollabHub } from "./collab.ts";

let hub: CollabHub | null = null;

export function setHub(h: CollabHub): void {
  hub = h;
}

export function getHub(): CollabHub {
  if (!hub) throw new Error("The collaboration hub is not running yet");
  return hub;
}
