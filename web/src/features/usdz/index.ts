// usdz feature: File > Export > Export USDZ (AR)… and Export glTF (AR)…, registered with app/ext.ts
// when imported. The export code loads when a row is chosen.

import { registerMenu } from "../../app/ext.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { store } from "../../app/state.ts";

function run(format: "usdz" | "gltf"): void {
  import("./export.ts")
    .then((m) => m.exportModel(format))
    .catch((err: unknown) => toast(`The export failed: ${errorMessage(err)}`));
}

registerMenu("File › Export", () => [
  { label: "Export USDZ (AR)…", enabled: () => store.session !== null, run: () => run("usdz") },
  { label: "Export glTF (AR)…", enabled: () => store.session !== null, run: () => run("gltf") },
]);
