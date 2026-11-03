// Site Context: File > Import Site Context… (a map dialog that brings real-world context into the
// drawing at true scale), View > Show Site Context in 3D (the imported buildings and terrain over the
// 3D view, kept in memory and never saved), and the per-drawing reset of that overlay.

import { documentSource, on3d, onDocument, registerMenu } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { siteOverlay } from "./overlay3d.ts";

registerMenu("File › Import", () => [
  {
    label: "Import Site Context…",
    enabled: () => store.session !== null && !documentSource()?.readOnly,
    // the map (Leaflet) loads on first use, not with the editor
    run: () => void import("./dialog.ts").then((m) => m.openSiteContextDialog()),
  },
]);

registerMenu("View", () => [
  {
    label: "Show Site Context in 3D",
    enabled: () => store.session !== null,
    checked: () => siteOverlay.on,
    run: () => siteOverlay.setShown(!siteOverlay.on),
  },
]);

on3d((v) => siteOverlay.attach(v));

// the imported context belongs to the drawing it was imported into
onDocument(() => siteOverlay.reset());
