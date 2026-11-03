// File > Export > Export USD…, as Vectorworks' Export USD Options has it: the 3D model of the design
// layers the 3D view shows, organized by layer or by texture (combining each texture's objects into
// one mesh, if asked), with the objects' records as metadata or not, as a .usdz package or as text
// (.usda, or .usd holding text). Text with textures goes as a zip of a folder, the scene and its
// images, as Vectorworks writes a folder. The triangles are the 3D view's, so curved surfaces go as
// finely as it draws them (Geometric Detail has no counterpart), and IFC data isn't written. See
// export/usd.ts.

import { usdScene, usdzPackage, type UsdOrganization } from "../export/usd.ts";
import { zipFiles } from "../export/zip.ts";
import { checkRow } from "./engineeringProperties.ts";
import { h } from "./dom.ts";
import { downloadBlob } from "./fileio.ts";
import { withoutHidden } from "./hiddenObjects.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";

type Format = "usdz" | "usda" | "usd";

const FORMATS: readonly { readonly value: Format; readonly label: string }[] = [
  { value: "usdz", label: "USDZ package (.usdz)" },
  { value: "usda", label: "USD text (.usda)" },
  { value: "usd", label: "USD (.usd, as text)" },
];

/** what was chosen last, for next time */
let last: { format: Format; organization: UsdOrganization; combine: boolean; records: boolean } = { format: "usdz", organization: "layer", combine: false, records: false };

function select<T extends string>(label: string, options: readonly { readonly value: T; readonly label: string }[], value: T): HTMLSelectElement {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map((o) => h("option", { value: o.value, text: o.label })));
  el.value = value;
  return el;
}

/** File > Export USD…: asks how, then downloads the model. */
export async function exportUsdDialog(layers3d: ReadonlySet<string>): Promise<void> {
  const session = store.session;
  if (!session) return;
  const format = select("File Format", FORMATS, last.format);
  const organization = select<UsdOrganization>(
    "Scene Graph Organization",
    [
      { value: "layer", label: "By layer" },
      { value: "texture", label: "By texture" },
    ],
    last.organization,
  );
  const [combine, combineRow] = checkRow("Combine objects");
  combine.checked = last.combine;
  const [records, recordsRow] = checkRow("Include record data");
  records.checked = last.records;
  const follow = (): void => {
    combine.disabled = organization.value !== "texture";
  };
  organization.addEventListener("change", follow);
  follow();
  const field = (label: string, control: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
  const v = await showDialog<typeof last>({
    title: "Export USD",
    okLabel: "Export",
    body: [
      field("File Format", format),
      field("Scene Graph Organization", organization),
      combineRow,
      recordsRow,
      h("p", {
        cls: "muted",
        text: "The design layers the 3D view shows, in metres, y up. Each object keeps its name, type, id, class and layer (not when combined); record data adds its records' values. Curved surfaces go as finely as the 3D view draws them.",
      }),
    ],
    check: () => {
      const doc = store.session?.doc;
      if (!doc?.model3d().some((m) => layers3d.has(m.layerId) && m.triangles.length >= 9)) return { error: "No 3D objects on the visible design layers.", focus: format };
      return {
        value: { format: format.value as Format, organization: organization.value as UsdOrganization, combine: organization.value === "texture" && combine.checked, records: records.checked },
      };
    },
  });
  if (!v || store.session !== session) return;
  last = v;
  const name = store.fileName.replace(/\.(vwx|sta)$/i, "") || "drawing";
  try {
    const doc = withoutHidden(session.doc);
    const meshes = doc.model3d().filter((m) => layers3d.has(m.layerId));
    const scene = usdScene(doc, meshes, { organization: v.organization, combine: v.combine, records: v.records, textures: true }, name);
    const text = new TextEncoder().encode(scene.text);
    if (v.format === "usdz") downloadBlob(`${name}.usdz`, new Blob([usdzPackage([[`${name}.usda`, text], ...scene.files]) as BlobPart], { type: "model/vnd.usdz+zip" }));
    else if (scene.files.length === 0) downloadBlob(`${name}.${v.format}`, new Blob([text as BlobPart], { type: "text/plain" }));
    // the scene and its images, in a folder, zipped to download as one file
    else downloadBlob(`${name}.zip`, new Blob([zipFiles([[`${name}/${name}.${v.format}`, text], ...scene.files.map(([p, d]) => [`${name}/${p}`, d] as const)]) as BlobPart], { type: "application/zip" }));
    if (scene.texturesLeftOut > 0) toast(`${scene.texturesLeftOut} ${scene.texturesLeftOut === 1 ? "texture's image isn't" : "textures' images aren't"} PNG or JPEG, so ${scene.texturesLeftOut === 1 ? "its" : "their"} faces took their objects' colours.`, "info");
  } catch (err) {
    toast(`USD export failed: ${errorMessage(err)}`);
  }
}
