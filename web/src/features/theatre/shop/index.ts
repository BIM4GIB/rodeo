// The Scene Shop's rows on the Stage menu: New Flat… and New Platform… (newPiece.ts), the Cut List window
// (cutListWindow.ts) and the Model Box Cut Sheet (modelBoxUi.ts). The pure parts are flats.ts, cutlist.ts and
// modelBox.ts; the pieces are kept in the drawing by pieces.ts.

import { store } from "../../../app/state.ts";
import { addStageRows } from "../registry.ts";
import { openCutList } from "./cutListWindow.ts";
import { openModelBox } from "./modelBoxUi.ts";
import { newFlat, newPlatform } from "./newPiece.ts";

const open = (): boolean => store.session !== null;

addStageRows("Scene Shop", () => [
  { label: "New Flat…", enabled: open, run: () => void newFlat() },
  { label: "New Platform…", enabled: open, run: () => void newPlatform() },
  "-",
  { label: "Cut List…", enabled: open, run: () => openCutList() },
  { label: "Model Box Cut Sheet…", enabled: open, run: () => void openModelBox() },
]);
