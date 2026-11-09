// Model > Volumetric Properties…, as Vectorworks has it: the surface area, volume and centre of mass
// of the 3D objects selected, together, in the units chosen (meshSolid.ts measures them); the dialog
// can place a 3D locus at the centre of mass, the list as text where the 2D drawing is clicked next,
// and save it as a text file (engineeringProperties.ts has the shared parts). A volume needs faces
// that close round it: when the faces' outward areas don't cancel out, the volume and centre of mass
// are left out. Tools > Machine Design > 3D Properties… (threeDProperties.ts) measures the same way.

import type { Mesh3D } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { checkRow, placeTextAtClick, propertyList, propertyText, unitSelect, writeTextFile, type PropertyLine, type Unit } from "./engineeringProperties.ts";
import { solidOf, type Solid } from "./meshSolid.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** The selected objects on their layers (not inside a group being edited), which the 3D model is made of. */
function selectedTop(): Set<string> {
  const doc = store.session?.doc;
  const out = new Set<string>();
  if (!doc) return out;
  for (const id of store.selection) if (!isDerivedId(id) && doc.object(id)?.parentId === null) out.add(id);
  return out;
}

export function canVolumetricProperties(): boolean {
  const doc = store.session?.doc;
  if (!doc) return false;
  // a 3D object says where it lies in plan; groups, symbols and plug-ins may hold some
  for (const id of selectedTop()) {
    const o = doc.object(id);
    if (o && (o.bounds || o.kind === "group" || o.kind === "symbol" || o.kind === "other")) return true;
  }
  return false;
}

/** The selected objects' faces measured together: the solid, how many objects show faces, and the first one's layer. */
export function measureSelected(): { solid: Solid; objects: number; layerId: string } | null {
  const doc = store.session?.doc;
  const ids = selectedTop();
  const meshes: Mesh3D[] = doc ? doc.model3d().filter((m) => ids.has(m.objectId)) : [];
  const solid = solidOf(meshes);
  if (!solid) return null;
  const faced = meshes.filter((m) => m.triangles.length >= 9);
  return { solid, objects: new Set(faced.map((m) => m.objectId)).size, layerId: faced[0].layerId };
}

/** A 3D locus at the centre of mass on `layerId`, its height above that layer, selected; false when it failed (the user has been told). */
export function placeCentreLocus(solid: Solid, layerId: string): boolean {
  const c = solid.center;
  if (!c) return false;
  const elevation = store.session?.doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;
  const made = attempt("Place Locus at Center of Mass", (s) => s.add3DLoci(layerId, [[c.x, c.y, c.z - elevation]], store.activeClassIndex));
  if (made) setSelection(made.value);
  return made !== null;
}

function solidLines(solid: Solid, objects: number): { title?: string; lines: PropertyLine[] }[] {
  const open = solid.volume === null;
  return [
    {
      lines: [
        { label: "Objects measured", mm: objects, power: 0 },
        { label: "Surface area", mm: solid.area, power: 2 },
        { label: open ? "Volume (faces not closed)" : "Volume", mm: solid.volume ?? NaN, power: 3 },
        { label: "Center of mass X", mm: solid.center?.x ?? NaN, power: 1 },
        { label: "Center of mass Y", mm: solid.center?.y ?? NaN, power: 1 },
        { label: "Center of mass Z", mm: solid.center?.z ?? NaN, power: 1 },
      ],
    },
  ];
}

/** Model > Volumetric Properties…: the list in the units chosen, and what to do with it. */
export async function volumetricPropertiesDialog(): Promise<void> {
  const measured = measureSelected();
  if (!measured) {
    toast("Select 3D objects on their layer: nothing selected shows 3D faces.", "info");
    return;
  }
  const { solid, objects, layerId } = measured;
  const groups = solidLines(solid, objects);
  const holder = h("div", { cls: "props-holder" });
  const units = unitSelect(() => holder.replaceChildren(propertyList(groups, units.unit())));
  holder.replaceChildren(propertyList(groups, units.unit()));
  const [locus, locusRow] = checkRow("Place locus at center of mass");
  locus.disabled = solid.center === null;
  const [place, placeRow] = checkRow("Place properties on drawing");
  const [write, writeRow] = checkRow("Write properties to file");
  const r = await showDialog<{ unit: Unit; locus: boolean; place: boolean; write: boolean }>({
    title: "Volumetric Properties",
    okLabel: "OK",
    cls: "props-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Units" }), units.el),
      holder,
      ...(solid.volume === null ? [h("p", { cls: "muted", text: "The faces don't close round a volume, so only the surface area is measured." })] : []),
      locusRow,
      placeRow,
      writeRow,
    ],
    check: () => ({ value: { unit: units.unit(), locus: locus.checked, place: place.checked, write: write.checked } }),
  });
  if (!r) return;
  if (r.locus) placeCentreLocus(solid, layerId);
  const text = propertyText("Volumetric Properties", groups, r.unit);
  if (r.write) writeTextFile("Volumetric Properties", text);
  if (r.place) placeTextAtClick("Volumetric Properties", text);
}
