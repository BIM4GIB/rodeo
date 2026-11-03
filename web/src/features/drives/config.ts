// What the server offers for the two drives (GET /api/config, drives): a
// provider with a null entry is not set up, and its buttons and rows stay hidden.
// On a static host there is no server and nothing is offered.

import { serverConfig } from "../../platform/api.ts";
import type { ServerConfig } from "../../platform/protocol.ts";

export type DriveConfig = ServerConfig["drives"];
export type GoogleConfig = NonNullable<DriveConfig["google"]>;
export type MicrosoftConfig = NonNullable<DriveConfig["microsoft"]>;

let offered: DriveConfig | null = null;
let reading: Promise<DriveConfig | null> | null = null;

/** The drives the server offers, read once (null when there is no server or none is set up). */
export function driveConfig(): Promise<DriveConfig | null> {
  reading ??= serverConfig().then((c) => {
    offered = c?.drives ?? null;
    return offered;
  });
  return reading;
}

/** The drives as last read (null until driveConfig() has answered). */
export function offeredDrives(): DriveConfig | null {
  return offered;
}
