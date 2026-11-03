// The Stage menu: lighting design and theatre set design, from venue to paperwork. Each part keeps to its
// own folder and joins through registry.ts; this file orders the menu. fixture.ts and instrument.ts hold
// the lighting instruments' data, show.ts what a drawing keeps for the whole show, stage.ts the stage's
// own measuring frame, and ui.ts the windows they share.

import { appContext, registerMenu } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import type { Row } from "../../app/menu.ts";
import { stageRows, type StageSection } from "./registry.ts";
import "./show.ts";
import "./instrument.ts";
import { stageCoordinates } from "./stageTool.ts";
// each part joins when imported, in the order its rows are listed
import "./venue/index.ts";
import "./sightlines/index.ts";
import "./scenes/index.ts";
import "./shop/index.ts";
import "./event/index.ts";
import "./connectcad/index.ts";
import "./numbering/index.ts";
import "./devices/index.ts";
import "./hanging/index.ts";
import "./beam/index.ts";
import "./looks/index.ts";
import "./paperwork/index.ts";
import "./patch/index.ts";
import "./docs/index.ts";
import "./loads/index.ts";

const open = (): boolean => store.session !== null;

/** A section as a submenu, or nothing while it has no rows. */
function submenu(label: string, section: StageSection): Row[] {
  const items = stageRows(section);
  return items.length ? [{ label, enabled: open, items }] : [];
}

function rows(): readonly Row[] {
  return [
    { label: "Set Stage Origin", enabled: open, run: () => appContext()?.setTool("stageorigin") },
    { label: "Show Stage Coordinates", enabled: open, checked: () => stageCoordinates.on(), run: () => stageCoordinates.toggle() },
    "-",
    ...stageRows("Venue"),
    ...submenu("Sightlines", "Sightlines"),
    "-",
    ...stageRows("Scenes"),
    ...submenu("Scene Shop", "Scene Shop"),
    ...submenu("Event", "Event"),
    ...submenu("ConnectCAD", "ConnectCAD"),
    ...submenu("ConnectCAD Layout", "ConnectCAD Layout"),
    "-",
    ...submenu("Lighting", "Lighting"),
    ...submenu("Lighting Paperwork", "Lighting Paperwork"),
    ...submenu("Loads and Power", "Lighting Loads"),
    ...submenu("Visualization", "Visualization"),
    "-",
    ...stageRows("Audit"),
  ];
}

registerMenu("Stage", rows);
