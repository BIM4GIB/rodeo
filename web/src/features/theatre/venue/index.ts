// The Venue rows at the top of the Stage menu: New Venue… draws a venue, Linesets… keeps its fly lines and
// their hang plot, and Lighting Section… draws its centre-line section. Each reads and saves the drawing's
// show data (show.ts); the rows are enabled only with a drawing open.

import { store } from "../../../app/state.ts";
import { addStageRows } from "../registry.ts";
import { newVenue } from "./newVenue.ts";
import { openLinesets } from "./linesetsUi.ts";
import { openLightingSection } from "./sectionPanel.ts";

const open = (): boolean => store.session !== null;

addStageRows("Venue", () => [
  { label: "New Venue…", enabled: open, run: () => void newVenue() },
  { label: "Linesets…", enabled: open, run: openLinesets },
  { label: "Lighting Section…", enabled: open, run: openLightingSection },
]);
