// timelapse feature: records how each drawing is made (record.ts) and adds File > Export Timelapse…
// (dialog.ts). Registers with app/ext.ts when imported.

import { onDocument, registerMenu } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { openTimelapseDialog } from "./dialog.ts";
import { attach } from "./record.ts";

onDocument((session) => attach(session));

registerMenu("File › Export", () => [
  {
    label: "Export Timelapse…",
    enabled: () => store.session !== null,
    run: () => void openTimelapseDialog(),
  },
]);
