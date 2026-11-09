// Joins the Stage menu's Event submenu in Vectorworks' order of setting up an event: Create Room
// (eventRoom.ts), Create Stage and Create Stair (eventStage.ts), Create Lectern (lectern.ts), Create
// Screen (eventScreen.ts) and Create Views (eventViews.ts). Event Design's seating is a tool in the
// Event Design set.

import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { need } from "../../../app/menuReasons.ts";
import { addStageRows } from "../registry.ts";
import { createRoom } from "./eventRoom.ts";
import { createScreen } from "./eventScreen.ts";
import { canCreateStage, createStage, createStair } from "./eventStage.ts";
import { createViews } from "./eventViews.ts";
import { createLectern } from "./lectern.ts";

const open = (): boolean => store.session !== null;
const run = (job: () => Promise<void>) => (): void => void job().catch((err: unknown) => toast(errorMessage(err)));

addStageRows("Event", () => [
  { label: "Create Room…", why: need.closed, enabled: () => open() && canCreateStage(), run: run(createRoom) },
  { label: "Create Stage…", why: need.closed, enabled: () => open() && canCreateStage(), run: run(createStage) },
  { label: "Create Stair…", enabled: open, run: run(createStair) },
  { label: "Create Lectern…", enabled: open, run: run(createLectern) },
  { label: "Create Screen…", enabled: open, run: run(createScreen) },
  { label: "Create Views", enabled: open, run: run(createViews) },
]);
