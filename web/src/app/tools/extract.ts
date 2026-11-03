// The 3D Modeling set's Extract: geometry taken off the edges or faces of a solid or surface, leaving it as it
// was. It works in the 3D view, showing it when picked: a click chooses an edge or a face, Shift-click adds
// to or takes from the choice, a drag still orbits, and Apply or Enter extracts. Extract Point puts 3D loci at
// the start, end and middle of the edges (and a circular edge's centre), Extract Curve 3D polygons along them,
// Extract Iso-parametric Curves a 3D polygon slicing the face at the click, and Extract Surface an open mesh
// of the face, or with Create Planar Objects a closed 3D polygon round each of a flat face's loops. Several
// results are grouped. Sums in extractShapes.ts.

import { attempt, setActiveLayer, setSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { appContext, on3d } from "../ext.ts";
import { allFaces, edgeLoci, facesAt, isoCurve, joined, nearestPiece, onePerPlace, pieces, ringsOf, trianglesOf, wholeEdges, type Curve, type Point, type WholeEdge } from "../extractShapes.ts";
import { faceEdges, healed, isClosedMesh, nearestEdge, tangentChain, type FacePick, type SolidEdge, type SolidFace } from "../solidOps.ts";
import { store } from "../state.ts";
import { editBars } from "../symbolEdit.ts";
import { errorMessage, toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import type { FaceHit } from "../view3d.ts";
import { onWorkingPlanes } from "../workingPlanes.ts";
import { requestShow3d } from "./navigate3d.ts";

type Mode = "point" | "curve" | "iso" | "surface";
type Way = "u" | "v";

const MODES: readonly { readonly id: Mode; readonly label: string }[] = [
  { id: "point", label: "Extract Point" },
  { id: "curve", label: "Extract Curve" },
  { id: "iso", label: "Extract Iso-parametric Curves" },
  { id: "surface", label: "Extract Surface" },
];

const settings = {
  mode: "point" as Mode,
  way: "u" as Way,
  tangent: false,
  faces: false,
  all: false,
  planar: false,
};

interface Picking {
  readonly id: string | null;
  readonly tris: readonly number[];
  readonly edges: readonly SolidEdge[];
  readonly whole: readonly WholeEdge[];
  readonly size: number;
  /** the pieces of edges chosen */
  readonly chosen: ReadonlySet<number>;
  /** the faces chosen */
  readonly faces: readonly SolidFace[];
  /** the iso-parametric curves chosen */
  readonly curves: readonly Curve[];
}

const NOTHING: Picking = { id: null, tris: [], edges: [], whole: [], size: 1, chosen: new Set(), faces: [], curves: [] };

let active = false;
let picking = NOTHING;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const layerBase = (): number => store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;

/** How many whole edges have a piece chosen. */
const edgesChosen = (): WholeEdge[] => picking.whole.filter((e) => e.pieces.some((i) => picking.chosen.has(i)));

function status(): string {
  switch (settings.mode) {
    case "iso":
      return picking.curves.length ? `${plural(picking.curves.length, "curve")} chosen. Shift-click for more, then Apply` : "Click a face where the curve should run";
    case "surface":
      return picking.faces.length ? `${plural(picking.faces.length, "face")} chosen. Shift-click for more, then Apply` : "Click a face of a solid or surface";
    default:
      return picking.chosen.size ? `${plural(edgesChosen().length, "edge")} chosen. Shift-click for more, then Apply` : "Click an edge of a solid or surface";
  }
}

const hintText = (): string => `${status()} · Enter applies · Drag to orbit`;

function ready(): boolean {
  if (settings.mode === "iso") return picking.curves.length > 0;
  return settings.mode === "surface" ? picking.faces.length > 0 : picking.chosen.size > 0;
}

function load(id: string | null): boolean {
  if (id === picking.id && id !== null) return true;
  const s = store.session;
  if (!id || !s) {
    toast("That isn't a solid or surface: click an extrude, multiple extrude, sweep, solid or mesh.", "info");
    return false;
  }
  try {
    const raw = s.solidTriangles(id);
    const tris = isClosedMesh(raw) ? healed(raw) : Array.from(raw);
    const edges = pieces(tris);
    let size = 1;
    for (let k = 0; k < 3; k++) {
      let [lo, hi] = [Infinity, -Infinity];
      for (let i = k; i < tris.length; i += 3) {
        lo = Math.min(lo, tris[i]);
        hi = Math.max(hi, tris[i]);
      }
      size = Math.max(size, hi - lo);
    }
    picking = { ...NOTHING, id, tris, edges, whole: wholeEdges(edges, size), size };
  } catch (err) {
    toast(`${errorMessage(err)[0].toUpperCase()}${errorMessage(err).slice(1)}.`, "info");
    return false;
  }
  const obj = s.doc.object(id);
  if (obj && obj.layerId !== store.activeLayerId) setActiveLayer(obj.layerId);
  setSelection([id]);
  return true;
}

function piecesAt(hit: FaceHit): number[] {
  const { edges, whole } = picking;
  if (settings.all) return edges.map((_, i) => i);
  if (settings.faces) {
    const found = faceEdges(edges, hit.point, hit.normal);
    if (found.length) return found;
  }
  const near = nearestEdge(edges, hit.point, hit.normal) ?? nearestPiece(edges, hit.point);
  if (near === null) return [];
  if (settings.tangent) return tangentChain(edges, near).flatMap((i) => whole.find((e) => e.pieces.includes(i))?.pieces ?? [i]);
  return [...(whole.find((e) => e.pieces.includes(near))?.pieces ?? [near])];
}

function clickEdges(hit: FaceHit, shift: boolean): void {
  const found = piecesAt(hit);
  if (!found.length) {
    toast("That object has no edge to extract.", "info");
    return;
  }
  const chosen = new Set(shift ? picking.chosen : []);
  if (shift && found.every((i) => chosen.has(i))) for (const i of found) chosen.delete(i);
  else for (const i of found) chosen.add(i);
  picking = { ...picking, chosen };
}

function clickFaces(hit: FaceHit, shift: boolean): void {
  const pick: FacePick = { point: hit.point, normal: hit.normal };
  const found = settings.all ? allFaces(picking.tris) : facesAt(picking.tris, pick, settings.tangent);
  if (!found.length) {
    toast("That object has no face there.", "info");
    return;
  }
  const sameAs = (a: SolidFace, b: SolidFace): boolean => a.triangles.size === b.triangles.size && [...a.triangles].every((i) => b.triangles.has(i));
  const had = shift ? picking.faces : [];
  if (shift && found.every((f) => had.some((o) => sameAs(o, f)))) picking = { ...picking, faces: had.filter((o) => !found.some((f) => sameAs(o, f))) };
  else picking = { ...picking, faces: [...had.filter((o) => !found.some((f) => sameAs(o, f))), ...found] };
}

function clickIso(hit: FaceHit, shift: boolean): void {
  const curve = isoCurve(picking.tris, { point: hit.point, normal: hit.normal }, settings.way);
  if (typeof curve === "string") {
    toast(curve, "info");
    return;
  }
  picking = { ...picking, curves: shift ? [...picking.curves, curve] : [curve] };
}

function clicked(hit: FaceHit | null, shift: boolean): void {
  if (!active) return;
  if (!hit) {
    if (!shift) picking = NOTHING;
  } else if (load(hit.objectId)) {
    if (settings.mode === "iso") clickIso(hit, shift);
    else if (settings.mode === "surface") clickFaces(hit, shift);
    else clickEdges(hit, shift);
  }
  show();
}

const asLines = (c: Curve): number[] => {
  const list = c.closed ? [...c.points, c.points[0]] : c.points;
  const out: number[] = [];
  for (let i = 1; i < list.length; i++) out.push(...list[i - 1], ...list[i]);
  return out;
};

const chosenCurves = (): Curve[] => joined([...picking.chosen].map((i) => [picking.edges[i].a, picking.edges[i].b] as const), picking.size);

/** Above the layer, as new objects are given. */
const above = (p: Point, base: number): Point => [p[0], p[1], p[2] - base];

function apply(): void {
  if (!active || !ready()) return;
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const base = layerBase();
  const cls = store.activeClassIndex;
  const curve = (s: Parameters<Parameters<typeof attempt>[1]>[0], c: Curve): string =>
    s.add3DPolygons(layerId, [{ points: c.points.flatMap((p) => above(p, base)), closed: c.closed }], cls);
  const done = attempt("Extract", (s) =>
    s.batch(() => {
      const ids: string[] = [];
      switch (settings.mode) {
        case "point": {
          const points = onePerPlace(edgesChosen().map(edgeLoci), picking.size);
          return s.add3DLoci(layerId, points.map((p) => above(p, base)), cls, points.length > 1);
        }
        case "curve":
          for (const c of chosenCurves()) ids.push(curve(s, c));
          break;
        case "iso":
          for (const c of picking.curves) ids.push(curve(s, c));
          break;
        case "surface":
          for (const face of picking.faces) {
            if (settings.planar && face.flat) {
              for (const ring of ringsOf(face)) ids.push(curve(s, ring));
              continue;
            }
            const flat = trianglesOf(face);
            const part: number[][] = [];
            for (let i = 0; i + 8 < flat.length; i += 9) part.push(flat.slice(i, i + 9).map((v, k) => (k % 3 === 2 ? v - base : v)));
            ids.push(...s.addMeshes(layerId, [part], cls, store.drawAttrs));
          }
          break;
      }
      return ids.length > 1 ? [s.groupObjects(ids)] : ids;
    }),
  );
  if (!done) return;
  picking = NOTHING;
  setSelection(done.value);
  show();
}

const statusLabel = h("span", { cls: "symbol-bar-label" });
const applyBtn = h("button", { cls: "btn small primary", text: "Apply", attrs: { type: "button" } });
const clearBtn = h("button", { cls: "btn small", text: "Clear", attrs: { type: "button" } });
const bar = h("div", { cls: "symbol-bar solid-edit-bar", hidden: true, attrs: { role: "status" } }, h("span", { cls: "symbol-bar-name", text: "Extract" }), statusLabel, applyBtn, clearBtn);

function show(): void {
  bar.hidden = !active || !store.view3d;
  if (!active) return;
  statusLabel.textContent = status();
  applyBtn.disabled = !ready();
  clearBtn.disabled = picking === NOTHING;
  store.setHint(hintText());
  const lines: number[] = [];
  for (const i of picking.chosen) lines.push(...picking.edges[i].a, ...picking.edges[i].b);
  for (const face of picking.faces) for (const ring of ringsOf(face)) lines.push(...asLines(ring));
  for (const c of picking.curves) lines.push(...asLines(c));
  appContext()?.view3d()?.setHighlightLines(lines.length ? lines : null);
}

/** Puts the bar over the drawing, and has the tool take the 3D view's clicks while it's in use. */
export function mountExtractBar(wrap: HTMLElement): void {
  editBars(wrap).append(bar);
  applyBtn.addEventListener("click", apply);
  clearBtn.addEventListener("click", () => {
    picking = NOTHING;
    show();
  });
  const claim = (): void => {
    const v = appContext()?.view3d();
    if (!v) return;
    if (active) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  };
  store.on("tool", () => {
    const now = store.tool === "extract";
    if (now === active) return;
    active = now;
    picking = NOTHING;
    if (!now) appContext()?.view3d()?.setHighlightLines(null);
    claim();
    show();
  });
  store.on("view3d", show);
  store.on("session", () => {
    if (picking === NOTHING) return;
    if (!picking.id || !store.session?.doc.object(picking.id)) {
      picking = NOTHING;
      show();
    }
  });
  on3d(claim);
  onWorkingPlanes(() => {
    const v = appContext()?.view3d();
    if (v && active) v.onFacePick ??= clicked;
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || !store.view3d) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Enter" && ready()) apply();
      else if (e.key === "Escape" && picking !== NOTHING) {
        picking = NOTHING;
        show();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

export class ExtractTool extends BaseTool {
  readonly id = "extract";
  readonly cursor = "crosshair";

  hint(): string {
    return hintText();
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) requestShow3d();
  }

  modes(): readonly ToolModes[] {
    const groups: ToolModes[] = [{ label: "Extract", options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: settings.mode }];
    if (settings.mode === "iso") groups.push({ label: "Direction", options: [{ id: "u", label: "Along (U)", key: "5" }, { id: "v", label: "Across (V)", key: "6" }], active: settings.way });
    return groups;
  }

  setMode(id: string): void {
    if (id === "u" || id === "v") {
      settings.way = id;
    } else {
      const m = MODES.find((x) => x.id === id);
      if (!m || m.id === settings.mode) return;
      settings.mode = m.id;
      picking = { ...picking, chosen: new Set(), faces: [], curves: [] };
    }
    show();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Extract Preferences",
      [
        { kind: "check", key: "tangent", label: "Select Tangent Entities", value: settings.tangent },
        { kind: "check", key: "faces", label: "Select Faces", value: settings.faces },
        { kind: "check", key: "all", label: "Select All Entities", value: settings.all },
        { kind: "check", key: "planar", label: "Create Planar Objects", value: settings.planar },
      ],
      "None of these change Extract Iso-parametric Curves. Create Planar Objects makes closed 3D polygons in Extract Surface: Rodeo can't hold a 2D object on a plane in space.",
    );
    if (!v) return;
    settings.tangent = v.flag("tangent");
    settings.faces = v.flag("faces");
    settings.all = v.flag("all");
    settings.planar = v.flag("planar");
    show();
  }
}
