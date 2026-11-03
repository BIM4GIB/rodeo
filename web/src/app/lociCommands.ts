// What makes and takes 3D loci. AEC > Survey Input > 3D Polygons to 3D Loci: a 3D locus at each vertex of
// the selected 3D polygons on the active layer, at the vertex's height. Modify > Convert > Stake Object from
// 3D Locus: a stake (tools/paths.ts) at each selected 3D locus, its Z-value the locus's height above the layer.
// A stake here is plain objects in plan, and there's no site model to modify, so the dialog's Mode and Site
// Model aren't asked, and only a label says how high it was.

import type { ObjectInfo, Pt, Vec3 } from "../core/index.ts";
import { attempt, setEditGroup, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { addStakeGroups, newStakeSettings, STAKE_LABELS, STAKE_STYLES, stakeParts, type StakeLabel } from "./tools/paths.ts";
import type { Part } from "./tools/detailing.ts";
import type { StakeStyle } from "./stakeShapes.ts";

const POLY3D = 25;
const LOCUS3D = 9;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function selectedOf(type: number): ObjectInfo[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || !store.selection.size) return [];
  return s.doc.objects(layerId).filter((o) => o.type === type && store.selection.has(o.id) && o.parentId === store.editGroupId && !isDerivedId(o.id));
}

const layerBase = (): number => store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;

export const canPolygonsToLoci = (): boolean => selectedOf(POLY3D).length > 0;
export const canStakesFromLoci = (): boolean => selectedOf(LOCUS3D).length > 0;

const check = (text: string, on: boolean): { input: HTMLInputElement; row: HTMLElement } => {
  const input = h("input", { attrs: { type: "checkbox" } }) as HTMLInputElement;
  input.checked = on;
  return { input, row: h("label", { cls: "menu-dialog-check" }, input, text) };
};

const row = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);

const options = (rows: readonly { readonly id: string; readonly label: string }[], current: string): HTMLSelectElement => {
  const select = h("select", { cls: "menu-dialog-input menu-dialog-select wide" }, ...rows.map((o) => h("option", { value: o.id, text: o.label }))) as HTMLSelectElement;
  select.value = current;
  return select;
};

let deletePolygons = false;

/** AEC > Survey Input > 3D Polygons to 3D Loci. */
export async function polygonsToLociDialog(): Promise<void> {
  const s = store.session;
  const polys = selectedOf(POLY3D);
  const layerId = store.activeLayerId;
  if (!s || !layerId || !polys.length) return;
  const remove = check("Delete original 3D polygons", deletePolygons);
  const ok = await showDialog<true>({
    title: "3D Polygons to 3D Loci",
    okLabel: "OK",
    body: [h("p", { cls: "muted", text: `A 3D locus at each vertex of the ${plural(polys.length, "selected 3D polygon")}.` }), remove.row],
    check: () => ({ value: true }),
  });
  if (!ok) return;
  deletePolygons = remove.input.checked;
  const base = layerBase();
  const points: Vec3[] = polys.flatMap((o) => (s.curvePoints(o.id)?.points ?? []).map((q) => [q[0], q[1], q[2] - base] as Vec3));
  const r = attempt("3D Polygons to 3D Loci", (e) =>
    e.batch(() => {
      const ids = e.add3DLoci(layerId, points, store.activeClassIndex);
      if (deletePolygons) e.deleteObjects(polys.map((o) => o.id));
      return ids;
    }),
  );
  if (!r) return;
  setEditGroup(null, r.value);
  toast(`Placed ${plural(r.value.length, "3D locus", "3D loci")}${deletePolygons ? `, deleting the ${plural(polys.length, "3D polygon")}` : ""}.`, "info");
}

const stakeSettings = newStakeSettings();
let deleteLoci = false;

/** Modify > Convert > Stake Object from 3D Locus. */
export async function stakesFromLociDialog(): Promise<void> {
  const s = store.session;
  const loci = selectedOf(LOCUS3D);
  const layerId = store.activeLayerId;
  if (!s || !layerId || !loci.length) return;
  const k = stakeSettings;
  const style = options(STAKE_STYLES, k.style);
  const label = options(STAKE_LABELS, k.label);
  const text = (value: string, name: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": name } }) as HTMLInputElement;
  const prefix = text(k.prefix, "ID Prefix");
  const first = text(String(k.idNumber), "Initial ID Number");
  const description = text(k.description, "Description");
  const size = text(String(k.scaleFactor), "Scale Factor");
  const auto = check("Auto ID Numbering", k.autoId);
  const leader = check("Display Leader Line", k.leader);
  const remove = check("Delete Source Loci", deleteLoci);
  const v = await showDialog<{ idNumber: number; scaleFactor: number }>({
    title: "Convert to Stake Object",
    okLabel: "OK",
    body: [
      row("Style", style),
      row("Label Reference", label),
      row("ID Prefix", prefix),
      auto.row,
      row("(Initial) ID Number", first),
      row("Description", description),
      leader.row,
      row("Scale Factor", size),
      remove.row,
      h("p", { cls: "muted", text: `A stake at each of the ${plural(loci.length, "selected 3D locus", "selected 3D loci")}, in plan, with a 3D locus of its own at the same height.` }),
    ],
    check: () => {
      const idNumber = Number(first.value);
      if (!Number.isInteger(idNumber) || idNumber < 0) return { error: "(Initial) ID Number: enter a whole number, 0 or more.", focus: first };
      const scaleFactor = Number(size.value);
      if (!(scaleFactor >= 0.01 && scaleFactor <= 100)) return { error: "Scale Factor: enter a number from 0.01 to 100.", focus: size };
      return { value: { idNumber, scaleFactor } };
    },
  });
  if (!v) return;
  k.style = style.value as StakeStyle;
  k.label = label.value as StakeLabel;
  k.prefix = prefix.value;
  k.autoId = auto.input.checked;
  k.idNumber = v.idNumber;
  k.description = description.value;
  k.leader = leader.input.checked;
  k.scaleFactor = v.scaleFactor;
  deleteLoci = remove.input.checked;
  const scale = s.doc.layers().find((l) => l.id === layerId)?.scale || 1;
  const base = layerBase();
  const pieces: { parts: readonly Part[]; at: Pt; z: number }[] = [];
  loci.forEach((o, i) => {
    const q = s.curvePoints(o.id)?.points[0];
    if (!q) return;
    const at = { x: q[0], y: q[1] };
    const parts = stakeParts({ ...k, z: q[2] - base }, at, null, i, scale);
    if (parts) pieces.push({ parts, at, z: q[2] - base });
  });
  if (!pieces.length) {
    toast("These stakes draw nothing: set a Style or a Label Reference.", "info");
    return;
  }
  const r = attempt("Stake Object from 3D Locus", (e) =>
    e.batch(() => {
      const ids = addStakeGroups(e, layerId, pieces);
      if (deleteLoci) e.deleteObjects(loci.map((o) => o.id));
      return ids;
    }),
  );
  if (!r) return;
  if (k.autoId) k.idNumber += loci.length;
  setSelection(r.value);
  toast(`Placed ${plural(r.value.length, "stake")}${deleteLoci ? `, deleting the ${plural(loci.length, "3D locus", "3D loci")}` : ""}.`, "info");
}
