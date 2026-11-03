// The 3D Modeling set's Analysis, in the 3D view. Proximity: click a solid, surface, curve or 3D locus, then
// another, and it places a 3D locus on each where they come nearest, or where a curve passes through a solid,
// or a 3D polygon along where two solids cross. Interrogation: click a curve or surface, then move along it to
// see how it bends there, in a curvature circle (red) with a tangent or normal (blue); a click opens Curve or
// Surface Properties, which give the numbers and can add those to the drawing. Sums in analysisShapes.ts.

import { attempt, setSelection } from "../commands.ts";
import { closest, circlePoints, curveBend, curveCrossings, curvesMeet, meshCrossing, surfaceBend, surfaceData, tooMany, type CurveBend, type SurfaceBend, type SurfaceData, type Thing } from "../analysisShapes.ts";
import { h } from "../dom.ts";
import { appContext, on3d } from "../ext.ts";
import { pieces, type Curve, type Point } from "../extractShapes.ts";
import { showDialog } from "../menubar.ts";
import { healed, isClosedMesh } from "../solidOps.ts";
import { store } from "../state.ts";
import { editBars } from "../symbolEdit.ts";
import { errorMessage, toast } from "../toast.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatLength, formatLengthValue, lengthSuffix, parseLength } from "../units.ts";
import type { FaceHit } from "../view3d.ts";
import { onWorkingPlanes } from "../workingPlanes.ts";
import { curveUnder, findCandidates, segmentsOf, type Candidate } from "./loftSurface.ts";
import { requestShow3d } from "./navigate3d.ts";

type Mode = "proximity" | "interrogation";

const RED = 0xd8342b;
const BLUE = 0x2b6fd8;
const LOCUS3D = 9;
/** how near a 3D locus a click takes it, in screen pixels */
const LOCUS_PX = 12;
/** half the cross shown on a chosen 3D locus, as it's drawn */
const CROSS = 100;

const settings = { mode: "proximity" as Mode, circle: true, loci: false, line: false, length: 1000 };

interface Picked {
  readonly id: string;
  readonly thing: Thing;
  /** its lines, for showing it chosen */
  readonly lines: readonly number[];
}

interface Subject {
  readonly id: string;
  readonly curve: Candidate | null;
  readonly surface: SurfaceData | null;
  readonly lines: readonly number[];
}

let active = false;
let candidates: readonly Candidate[] = [];
let first: Picked | null = null;
let subject: Subject | null = null;

const units = (): string | undefined => store.session?.doc.info.units;
const layerBase = (): number => store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function status(): string {
  if (settings.mode === "proximity") return first ? "Click the second solid, surface, curve or 3D locus" : "Click a solid, surface, curve or 3D locus";
  return subject ? "Move along it to see how it bends, and click for its properties" : "Click a curve or surface";
}

const hintText = (): string => `${status()} · Esc starts over · Drag to orbit`;

const statusLabel = h("span", { cls: "symbol-bar-label" });
const clearBtn = h("button", { cls: "btn small", text: "Clear", attrs: { type: "button" } });
const bar = h("div", { cls: "symbol-bar solid-edit-bar", hidden: true, attrs: { role: "status" } }, h("span", { cls: "symbol-bar-name", text: "Analysis" }), statusLabel, clearBtn);

function reset(): void {
  first = null;
  subject = null;
}

function show(circles?: readonly number[], line?: readonly number[]): void {
  bar.hidden = !active || !store.view3d;
  if (!active) return;
  statusLabel.textContent = status();
  clearBtn.disabled = !first && !subject;
  store.setHint(hintText());
  const v = appContext()?.view3d();
  if (!v) return;
  const chosen = first?.lines ?? subject?.lines ?? [];
  const others = settings.mode === "proximity" || !subject ? candidates.flatMap((c) => segmentsOf(c.curve)) : [];
  v.setHighlightLines(chosen.length ? chosen : null, others, [
    { segments: circles ?? [], color: RED },
    { segments: line ?? [], color: BLUE },
  ]);
}

/** The 3D loci on the layers that can be picked from, wherever they sit. */
function lociUnder(e: MouseEvent): { id: string; point: Point } | null {
  const s = store.session;
  const app = appContext();
  const v = app?.view3d();
  const layerId = store.activeLayerId;
  if (!s || !app || !v || !layerId) return null;
  let best: { id: string; point: Point } | null = null;
  let bestD = LOCUS_PX;
  for (const layer of app.scene.pickableLayers(layerId)) {
    for (const o of s.doc.objects(layer)) {
      if (o.type !== LOCUS3D) continue;
      const q = s.curvePoints(o.id)?.points[0];
      const at = q && v.screenOf([q[0], q[1], q[2]]);
      if (!q || !at) continue;
      const d = Math.hypot(at.x - e.clientX, at.y - e.clientY);
      if (d < bestD) {
        bestD = d;
        best = { id: o.id, point: [q[0], q[1], q[2]] };
      }
    }
  }
  return best;
}

/** The faces of what was clicked, solid or not; analysis changes nothing, so anything that has faces will do. */
function trianglesAt(id: string | null): number[] | null {
  const s = store.session;
  if (!id || !s) return null;
  try {
    let raw: Float64Array;
    try {
      raw = s.solidTriangles(id);
    } catch {
      raw = s.faceTriangles(id);
    }
    if (raw.length) return isClosedMesh(raw) ? healed(raw) : Array.from(raw);
  } catch (err) {
    toast(`${errorMessage(err)[0].toUpperCase()}${errorMessage(err).slice(1)}.`, "info");
    return null;
  }
  toast("That shows no faces to analyze.", "info");
  return null;
}

const creaseLines = (tris: ArrayLike<number>): number[] => pieces(tris).flatMap((p) => [...p.a, ...p.b]);

function pickedAt(hit: FaceHit | null, e: MouseEvent): Picked | null {
  const locus = lociUnder(e);
  if (locus) {
    const [x, y, z] = locus.point;
    return { id: locus.id, thing: { kind: "point", point: locus.point }, lines: [x - CROSS, y, z, x + CROSS, y, z, x, y - CROSS, z, x, y + CROSS, z, x, y, z - CROSS, x, y, z + CROSS] };
  }
  const under = curveUnder(e, candidates);
  if (under) {
    const { curve } = under.candidate;
    return { id: under.candidate.id, thing: { kind: "curve", points: curve.points, closed: curve.closed }, lines: segmentsOf(curve) };
  }
  if (!hit) return null;
  const tris = trianglesAt(hit.objectId);
  return tris && hit.objectId ? { id: hit.objectId, thing: { kind: "mesh", tris }, lines: creaseLines(tris) } : null;
}

/** Adds loci and curves to the active layer and selects them, in a group if asked and there are several. */
function place(loci: readonly Point[], curves: readonly Curve[], asGroup: boolean): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const base = layerBase();
  const above = (p: readonly number[]): number[] => [p[0], p[1], p[2] - base];
  const cls = store.activeClassIndex;
  const done = attempt("Analysis", (s) =>
    s.batch(() => {
      const ids = loci.length ? s.add3DLoci(layerId, loci.map(above), cls) : [];
      for (const c of curves) ids.push(s.add3DPolygons(layerId, [{ points: c.points.flatMap(above), closed: c.closed }], cls));
      return asGroup && ids.length > 1 ? [s.groupObjects(ids)] : ids;
    }),
  );
  if (done) setSelection(done.value);
}

function measure(a: Picked, b: Picked): void {
  if (a.id === b.id) {
    toast("Click a second object.", "info");
    return;
  }
  if (tooMany(a.thing, b.thing)) {
    toast("These two have too many faces to compare.", "info");
    return;
  }
  const crossed = a.thing.kind === "mesh" && b.thing.kind === "mesh" ? meshCrossing(a.thing.tris, b.thing.tris) : [];
  if (crossed.length) {
    place([], crossed, false);
    toast(`They cross: placed ${plural(crossed.length, "3D polygon")} along it.`, "info");
    return;
  }
  const meets = a.thing.kind === "curve" && b.thing.kind === "mesh" ? curveCrossings(a.thing, b.thing.tris) : b.thing.kind === "curve" && a.thing.kind === "mesh" ? curveCrossings(b.thing, a.thing.tris) : a.thing.kind === "curve" && b.thing.kind === "curve" ? curvesMeet(a.thing, b.thing) : [];
  if (meets.length) {
    place(meets, [], false);
    toast(`They cross: placed ${plural(meets.length, "3D locus", "3D loci")}.`, "info");
    return;
  }
  const near = closest(a.thing, b.thing);
  if (near.distance < 1e-6) {
    // a 3D locus that's on the other is already there
    if (a.thing.kind !== "point" && b.thing.kind !== "point") place([near.a], [], false);
    toast(a.thing.kind !== "point" && b.thing.kind !== "point" ? "They touch: placed a 3D locus there." : "They touch.", "info");
    return;
  }
  // a 3D locus marks its own end
  place([...(a.thing.kind === "point" ? [] : [near.a]), ...(b.thing.kind === "point" ? [] : [near.b])], [], false);
  toast(`They come nearest ${formatLength(near.distance, units())} apart.`, "info");
}

const asLines = (points: readonly Point[], closed: boolean): number[] => {
  const n = points.length;
  const out: number[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) out.push(...points[i], ...points[(i + 1) % n]);
  return out;
};

function curveBendAt(p: Point): CurveBend | null {
  if (!subject?.curve) return null;
  const { points, closed } = subject.curve.curve;
  return curveBend(points, closed, p);
}

/** A straight line of the Length in Preferences, through `at` or from it. */
const tangentLine = (at: Point, way: Point, len: number): Point[] => [
  [at[0] - (way[0] * len) / 2, at[1] - (way[1] * len) / 2, at[2] - (way[2] * len) / 2],
  [at[0] + (way[0] * len) / 2, at[1] + (way[1] * len) / 2, at[2] + (way[2] * len) / 2],
];
const normalLine = (at: Point, way: Point, len: number): Point[] => [at, [at[0] + way[0] * len, at[1] + way[1] * len, at[2] + way[2] * len]];

function followCurve(p: Point): void {
  const bend = curveBendAt(p);
  if (!bend) return;
  const circle = bend.radius && bend.centre && bend.axis ? asLines(circlePoints(bend.centre, bend.radius, bend.axis), true) : [];
  show(circle, asLines(tangentLine(bend.point, bend.tangent, settings.length), false));
}

function followSurface(hit: FaceHit): void {
  if (!subject?.surface) return;
  const bend = surfaceBend(subject.surface, hit.point, hit.normal);
  show(bend.bends.flatMap((b) => (b.radius && b.centre ? asLines(circlePoints(b.centre, b.radius, circleAxis(bend, b.along)), true) : [])), asLines(normalLine(bend.point, bend.normal, settings.length), false));
}

/** Square to the plane holding the surface's normal and the way across it. */
const circleAxis = (bend: SurfaceBend, along: Point): Point => [bend.normal[1] * along[2] - bend.normal[2] * along[1], bend.normal[2] * along[0] - bend.normal[0] * along[2], bend.normal[0] * along[1] - bend.normal[1] * along[0]];

function follow(e: PointerEvent): void {
  if (!active || settings.mode !== "interrogation" || !subject || !store.view3d || e.buttons) return;
  if (!(e.target instanceof HTMLCanvasElement)) return;
  const v = appContext()?.view3d();
  if (!v) return;
  if (subject.curve) {
    const under = curveUnder(e, [subject.curve]);
    if (under) followCurve(under.point);
    return;
  }
  const hit = v.faceAt(e);
  if (hit && hit.objectId === subject.id) followSurface(hit);
}

const checkRow = (text: string, on: boolean): { input: HTMLInputElement; row: HTMLElement } => {
  const input = h("input", { attrs: { type: "checkbox", "aria-label": text } }) as HTMLInputElement;
  input.checked = on;
  return { input, row: h("label", { cls: "menu-dialog-check" }, input, text) };
};

const readout = (label: string, text: string): HTMLElement => h("div", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), h("span", { text }));

/** The radius and curvature of one bend, in document units. */
function bendText(radius: number | null, curvature: number): string {
  if (radius === null) return "straight here, no curvature";
  const unitLength = parseLength("1", units()) ?? 1;
  return `radius ${formatLength(radius, units())}, curvature ${(curvature * unitLength).toPrecision(4)} per ${formatLength(unitLength, units())}`;
}

const pointText = (p: Point): string => [p[0], p[1], p[2] - layerBase()].map((v) => formatLength(v, units())).join(", ");
const wayText = (p: Point): string => p.map((v) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3)).join(", ");

/** Curve Properties or Surface Properties: what's there, and what to add to the drawing. */
async function properties(title: string, rows: readonly HTMLElement[], names: { circle: string; loci: string; line: string }): Promise<boolean> {
  const circle = checkRow(names.circle, settings.circle);
  const loci = checkRow(names.loci, settings.loci);
  const line = checkRow(names.line, settings.line);
  const suffix = lengthSuffix(units());
  const input = h("input", { cls: "menu-dialog-input", value: formatLengthValue(settings.length, units()), attrs: { type: "text", inputmode: "decimal", "aria-label": "Length" } }) as HTMLInputElement;
  const v = await showDialog<number>({
    title,
    okLabel: "OK",
    body: [...rows, circle.row, loci.row, line.row, h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Length" }), input, suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null)],
    check: () => {
      const mm = parseLength(input.value, units());
      return mm !== null && mm > 0 ? { value: mm } : { error: "Length: enter a length more than 0.", focus: input };
    },
  });
  if (v === null) return false;
  settings.length = v;
  settings.circle = circle.input.checked;
  settings.loci = loci.input.checked;
  settings.line = line.input.checked;
  return true;
}

async function curveProperties(bend: CurveBend): Promise<void> {
  const rows = [readout("Point", pointText(bend.point)), readout("Curvature", bendText(bend.radius, bend.radius ? 1 / bend.radius : 0)), readout("Tangent", wayText(bend.tangent))];
  if (!(await properties("Curve Properties", rows, { circle: "Create Curvature Circle", loci: "Locus at center of curvature", line: "Create Tangent Curve" }))) return;
  const curves: Curve[] = [];
  const loci: Point[] = [];
  if (settings.circle && bend.radius && bend.centre && bend.axis) curves.push({ points: circlePoints(bend.centre, bend.radius, bend.axis), closed: true });
  if (settings.loci && bend.centre) loci.push(bend.point, bend.centre);
  if (settings.line) curves.push({ points: tangentLine(bend.point, bend.tangent, settings.length), closed: false });
  if (curves.length || loci.length) place(loci, curves, true);
}

async function surfaceProperties(bend: SurfaceBend): Promise<void> {
  const [most, least] = bend.bends;
  const rows = [readout("Point", pointText(bend.point)), readout("Most curved", bendText(most.radius, most.curvature)), readout("Least curved", bendText(least.radius, least.curvature)), readout("Normal", wayText(bend.normal))];
  if (!(await properties("Surface Properties", rows, { circle: "Create Curvature Circles", loci: "Loci at centers of curvature", line: "Create Normal Curve" }))) return;
  const curves: Curve[] = [];
  const loci: Point[] = [];
  for (const b of bend.bends) {
    if (settings.circle && b.radius && b.centre) curves.push({ points: circlePoints(b.centre, b.radius, circleAxis(bend, b.along)), closed: true });
    if (settings.loci && b.centre) loci.push(bend.point, b.centre);
  }
  if (settings.line) curves.push({ points: normalLine(bend.point, bend.normal, settings.length), closed: false });
  if (curves.length || loci.length) place([...new Map(loci.map((p) => [p.join(), p])).values()], curves, true);
}

function interrogate(hit: FaceHit | null, e: MouseEvent): void {
  if (subject?.curve) {
    const under = curveUnder(e, [subject.curve]);
    const bend = under && curveBendAt(under.point);
    if (bend) return void curveProperties(bend);
  } else if (subject?.surface && hit?.objectId === subject.id) {
    return void surfaceProperties(surfaceBend(subject.surface, hit.point, hit.normal));
  }
  const under = curveUnder(e, candidates);
  if (under) {
    subject = { id: under.candidate.id, curve: under.candidate, surface: null, lines: segmentsOf(under.candidate.curve) };
    return;
  }
  const tris = hit ? trianglesAt(hit.objectId) : null;
  subject = tris && hit?.objectId ? { id: hit.objectId, curve: null, surface: surfaceData(tris), lines: creaseLines(tris) } : null;
  if (!hit) toast("Click on a curve or surface.", "info");
}

function clicked(hit: FaceHit | null, _shift: boolean, e: MouseEvent): void {
  if (!active) return;
  if (settings.mode === "interrogation") interrogate(hit, e);
  else {
    const picked = pickedAt(hit, e);
    if (!picked) toast("Click on a solid, surface, curve or 3D locus.", "info");
    else if (!first) first = picked;
    else {
      const a = first;
      first = null;
      measure(a, picked);
      candidates = findCandidates();
    }
  }
  show();
}

/** Puts the bar over the drawing, and has the tool take the 3D view's clicks while it's in use. */
export function mountAnalysisBar(wrap: HTMLElement): void {
  editBars(wrap).append(bar);
  clearBtn.addEventListener("click", () => {
    reset();
    show();
  });
  const claim = (): void => {
    const v = appContext()?.view3d();
    if (!v) return;
    if (active) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  };
  store.on("tool", () => {
    const now = store.tool === "analysis";
    if (now === active) return;
    active = now;
    reset();
    candidates = now ? findCandidates() : [];
    if (!now) appContext()?.view3d()?.setHighlightLines(null);
    claim();
    show();
  });
  store.on("view3d", () => {
    if (active) candidates = findCandidates();
    show();
  });
  store.on("session", () => {
    if (!active) return;
    candidates = findCandidates();
    if (first && !store.session?.doc.object(first.id)) first = null;
    if (subject && !store.session?.doc.object(subject.id)) subject = null;
    show();
  });
  on3d(() => {
    claim();
    show();
  });
  onWorkingPlanes(() => {
    const v = appContext()?.view3d();
    if (v && active) v.onFacePick ??= clicked;
  });
  window.addEventListener("pointermove", follow);
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || !store.view3d || e.key !== "Escape" || (!first && !subject)) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      reset();
      show();
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

export class AnalysisTool extends BaseTool {
  readonly id = "analysis";
  readonly cursor = "crosshair";

  hint(): string {
    return hintText();
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) requestShow3d();
  }

  modes(): readonly ToolModes[] {
    return [{ label: "Analysis", options: [{ id: "proximity", label: "Proximity", key: "1" }, { id: "interrogation", label: "Interrogation", key: "2" }], active: settings.mode }];
  }

  setMode(id: string): void {
    if ((id !== "proximity" && id !== "interrogation") || id === settings.mode) return;
    settings.mode = id;
    reset();
    show();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }
}
