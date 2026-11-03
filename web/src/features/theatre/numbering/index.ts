// Joins the Stage menu's Lighting and ConnectCAD sections with Spotlight Numbering (numbering.ts) and its
// tool for numbering objects by clicking them in turn (numberTool.ts).

import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { addStageRows, addStageTools } from "../registry.ts";
import { spotlightNumbering } from "./numbering.ts";
import { SpotNumberTool } from "./numberTool.ts";
import "./numbering.css";

const row = { label: "Spotlight Numbering…", enabled: (): boolean => store.session !== null, run: (): void => void spotlightNumbering().catch((err: unknown) => toast(errorMessage(err))) };

addStageRows("Lighting", () => [row]);
addStageRows("ConnectCAD", () => [row]);
addStageTools((env) => [new SpotNumberTool(env)]);
