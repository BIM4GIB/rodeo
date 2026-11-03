// Sun Study: View > Sun Study shows a bar over the 3D view that sets the date, the solar time, the
// north and the place (bar.ts); File > Export Sun Study… records the day (record.ts). Registered
// with app/ext.ts when imported; the export code loads when it is chosen.

import { registerMenu } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { studyOn, toggleStudy } from "./bar.ts";

function report(err: unknown): void {
  toast(`Sun Study: ${errorMessage(err)}`);
}

registerMenu("View", () => [
  {
    label: "Sun Study",
    enabled: () => store.session !== null,
    checked: () => studyOn(),
    run: () => {
      toggleStudy().catch(report);
    },
  },
]);

registerMenu("File › Export", () => [
  {
    label: "Export Sun Study…",
    enabled: () => store.session !== null,
    run: () => {
      import("./record.ts")
        .then((m) => m.recordSunStudy())
        .catch(report);
    },
  },
]);
