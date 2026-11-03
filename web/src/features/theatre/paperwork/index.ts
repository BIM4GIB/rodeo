// Joins the Stage menu's Lighting Paperwork section with Paperwork…, which opens the paperwork window
// (paperwork.ts). The figures in it are reports.ts's.

import { store } from "../../../app/state.ts";
import { addStageRows } from "../registry.ts";
import { openPaperwork } from "./paperwork.ts";

addStageRows("Lighting Paperwork", () => [{ label: "Paperwork…", enabled: () => store.session !== null, run: openPaperwork }]);
