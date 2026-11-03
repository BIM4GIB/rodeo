// Joins the Stage menu's Lighting section with the beam tools: Show Beam Pools (pools.ts), the Light Coverage
// Map (coverageMap.ts) and the Wash Planner (washPlanner.ts), and the Focus Instrument tool (focusTool.ts).
// The pools and the map draw over the drawing once their menus are used.

import { store } from "../../../app/state.ts";
import { addStageRows, addStageTools } from "../registry.ts";
import "./beam.css";
import { openCoverageMap } from "./coverageMap.ts";
import { FocusInstrumentTool } from "./focusTool.ts";
import { beamPoolRows } from "./pools.ts";
import { openWashPlanner } from "./washPlanner.ts";

const open = (): boolean => store.session !== null;

addStageRows("Lighting", () => [
  ...beamPoolRows(open),
  { label: "Light Coverage Map…", enabled: open, run: () => void openCoverageMap() },
  { label: "Wash Planner…", enabled: open, run: () => void openWashPlanner() },
]);

addStageTools((env) => [new FocusInstrumentTool(env)]);
