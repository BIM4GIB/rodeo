// File X-ray feature: Window > File X-ray… shows what takes up the space in the open drawing, with
// findings and one-click fixes (dialog.ts). Registers with app/ext.ts when imported.

import { onDocument, onReady, registerMenu, type AppContext } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { closeXray, openXray } from "./dialog.ts";

let app: AppContext | null = null;
onReady((ctx) => {
  app = ctx;
});
// the report is about the drawing it was made from: a different drawing closes it
onDocument(() => closeXray());

registerMenu("Window", () => [
  {
    label: "File X-ray…",
    enabled: () => store.session !== null,
    run: () => {
      if (app) void openXray(app);
    },
  },
]);
