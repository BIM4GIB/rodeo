// Joins the Stage menu's Lighting section with Convert To Lighting Device and Replace Lighting Devices
// (devices.ts), and the Label Legend Manager, Assign Legend to Lighting Devices and Create Label
// Legend from Lighting Device (legends.ts), Refresh Lighting Devices, and a lighting device's and a
// hanging position's right-click commands (deviceMenu.ts).

import { registerContextRows } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { need, whyIn } from "../../../app/menuReasons.ts";
import { addStageRows } from "../registry.ts";
import { deviceRows, refreshLightingDevices } from "./deviceMenu.ts";
import { convertToLightingDevice, replaceLightingDevices } from "./devices.ts";
import { assignLegend, createLegendFromDevice, labelLegendManager } from "./legends.ts";
import "./devices.css";

const open = (): boolean => store.session !== null;
const run = (job: () => Promise<void>) => () => void job().catch((err: unknown) => toast(errorMessage(err)));

addStageRows("Lighting", () => [
  { label: "Convert To Lighting Device", why: need.selection, enabled: () => open() && store.selection.size > 0, run: convertToLightingDevice },
  { label: "Replace Lighting Devices…", enabled: open, run: run(replaceLightingDevices) },
  { label: "Label Legend Manager…", enabled: open, run: run(labelLegendManager) },
  { label: "Assign Legend to Lighting Devices…", why: whyIn("Select lighting devices first"), enabled: () => open() && store.selection.size > 0, run: run(assignLegend) },
  { label: "Create Label Legend from Lighting Device…", why: whyIn("Select one lighting device first"), enabled: () => open() && store.selection.size === 1, run: run(createLegendFromDevice) },
  { label: "Refresh Lighting Devices", keys: "⌘/", enabled: open, run: refreshLightingDevices },
]);

registerContextRows(deviceRows);
