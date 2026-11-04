// Joins the Stage menu's Lighting Paperwork section with Paperwork…, which opens the paperwork window
// (paperwork.ts), and Generate Paperwork…, which writes it into the drawing as worksheets
// (generatePaperwork.ts). The figures in both are reports.ts's.

import { store } from "../../../app/state.ts";
import { addStageRows } from "../registry.ts";
import { generatePaperwork } from "./generatePaperwork.ts";
import { openPaperwork } from "./paperwork.ts";

addStageRows("Lighting Paperwork", () => [
  { label: "Paperwork…", enabled: () => store.session !== null, run: openPaperwork },
  { label: "Generate Paperwork…", enabled: () => store.session !== null, run: () => void generatePaperwork() },
]);
