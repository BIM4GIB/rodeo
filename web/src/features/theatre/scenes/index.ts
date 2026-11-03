// The Scenes rows of the Stage menu: the Scenes palette (the set's pieces and scenes, and the scrub between
// them), the Shift Plot and Spike Sheet windows that read them, and the Spike Mark tool on the toolbar.

import { appContext } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { addStageRows, addStageTools } from "../registry.ts";
import { PALETTE_ID } from "./scenesPalette.ts";
import { openShiftPlot } from "./shiftPlot.ts";
import { openSpikeSheet } from "./spikeSheet.ts";
import { SpikeMarkTool } from "./spikeMarkTool.ts";

const open = (): boolean => store.session !== null;

addStageRows("Scenes", () => [
  {
    label: "Scenes",
    enabled: open,
    checked: () => appContext()?.palettes.isShown(PALETTE_ID) ?? false,
    run: () => appContext()?.palettes.toggle(PALETTE_ID),
  },
  { label: "Shift Plot…", enabled: open, run: () => openShiftPlot() },
  { label: "Spike Sheet…", enabled: open, run: () => openSpikeSheet() },
]);

addStageTools((env) => [new SpikeMarkTool(env)]);
