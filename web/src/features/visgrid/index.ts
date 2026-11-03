// visgrid feature: Window > Visibility Grid… opens one table of which classes and design layers each
// viewport on the sheets shows (dialog.ts). The menu row is added through app/ext.ts.
import { registerMenu } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { openVisibilityGrid } from "./dialog.ts";

registerMenu("Window", () => [
  { label: "Visibility Grid…", enabled: () => store.session !== null, run: () => openVisibilityGrid() },
]);
