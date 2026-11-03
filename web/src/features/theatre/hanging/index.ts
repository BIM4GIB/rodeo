// Joins the Stage menu's Lighting section with hanging positions: the Hanging Position tool (tool.ts),
// Convert to Hanging Position and Auto Number Positions (hangingPosition.ts).

import { appContext } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { addStageRows, addStageTools } from "../registry.ts";
import { autoNumberPositions, convertToHangingPosition } from "./hangingPosition.ts";
import { HangingPositionTool } from "./tool.ts";

const open = (): boolean => store.session !== null;

addStageRows("Lighting", () => [
  { label: "Hanging Position", enabled: open, run: () => appContext()?.setTool("hangingposition") },
  { label: "Convert to Hanging Position…", enabled: () => open() && store.selection.size > 0, run: () => void convertToHangingPosition().catch((err: unknown) => toast(errorMessage(err))) },
  { label: "Auto Number Positions", enabled: open, run: autoNumberPositions },
  "-",
]);

addStageTools((env) => [new HangingPositionTool(env)]);
