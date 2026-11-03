// The 3D Modeling set's Loft Surface: a mesh through cross sections, with no rail, one rail or two. Rodeo
// has no NURBS curves, so the curves are 3D polygons, or 2D shapes at their layer's plane; picked, the
// tool shows the 3D view, draws what it can take in grey over it, and a click near one chooses it. A click
// on a section also sets where it starts, as Vectorworks does, and Enter or Loft opens the Loft Creation
// dialog with its Reverse, Start, Ruled, Closed, Create Solid and Keep Curves, the 3D view showing
// the result as they change. The curves stay lines in the mesh's faces, not a NURBS surface.

import { attempt, setSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { appContext, on3d } from "../ext.ts";
import { aligned, birailRings, loftFaces, loftProblem, loftRings, loftWires, oneRailRings, shareNearest, type LoftCurve, type Point3 } from "../loftShapes.ts";
import { showDialog } from "../menubar.ts";
import { store } from "../state.ts";
import { editBars } from "../symbolEdit.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import type { FaceHit } from "../view3d.ts";
import { onWorkingPlanes } from "../workingPlanes.ts";
import { requestShow3d } from "./navigate3d.ts";

type LoftMode = "norail" | "onerail" | "birail";

const MODES: readonly { readonly id: LoftMode; readonly label: string }[] = [
  { id: "norail", label: "No Rail" },
  { id: "onerail", label: "One Rail" },
  { id: "birail", label: "Birail Sweep" },
];
/** how near a click must be to a curve, in screen pixels */
const PICK_PX = 14;
/** past this many objects, 2D shapes are left out of what can be chosen */
const MAX_CANDIDATES = 2000;

/** a 3D polygon's record type */
const POLY3D = 25;

const settings = { mode: "norail" as LoftMode, ruled: false, closed: false, solid: true, keep: true };

export interface Candidate {
  readonly id: string;
  readonly curve: LoftCurve;
}

interface Chosen extends Candidate {
  readonly start: number;
  readonly reverse: boolean;
}

let active = false;
let candidates: Candidate[] = [];
let chosen: Chosen[] = [];

const railCount = (): number => (settings.mode === "birail" ? 2 : settings.mode === "onerail" ? 1 : 0);
const railsOf = (): Chosen[] => chosen.slice(0, railCount());
const sectionsOf = (): Chosen[] => chosen.slice(railCount());

function status(): string {
  const need = railCount();
  if (chosen.length < need) return need === 2 ? `Click rail ${chosen.length + 1}` : "Click the rail";
  const sections = sectionsOf().length;
  if (settings.mode === "birail") return sections ? "Press Enter or Loft" : "Click the cross section";
  if (settings.mode === "onerail") return sections ? `${sections} cross section${sections === 1 ? "" : "s"}. Click more, or press Enter or Loft` : "Click a cross section";
  return sections >= 2 ? `${sections} cross sections. Click more, or press Enter or Loft` : sections ? "Click the next cross section" : "Click a cross section";
}

const ready = (): boolean => (settings.mode === "norail" ? sectionsOf().length >= 2 : sectionsOf().length >= 1);

/** The curves on the layers that can be picked from: 3D polygons on any, 2D shapes on the active one too unless there are very many. */
export function findCandidates(): Candidate[] {
  const s = store.session;
  const app = appContext();
  if (!s || !app) return [];
  const active3d = store.activeLayerId;
  if (!active3d) return [];
  const out: Candidate[] = [];
  for (const layerId of app.scene.pickableLayers(active3d)) {
    const objects = s.doc.objects(layerId).filter((o) => o.parentId === null);
    const flat = layerId === active3d && objects.length <= MAX_CANDIDATES;
    for (const o of objects) {
      if (!flat && o.type !== POLY3D) continue;
      const found = s.curvePoints(o.id);
      if (found && found.points.length >= 2) out.push({ id: o.id, curve: { points: found.points as unknown as Point3[], closed: found.closed } });
    }
  }
  return out;
}

export const segmentsOf = (c: LoftCurve): number[] => {
  const n = c.points.length;
  const out: number[] = [];
  for (let i = 0; i < (c.closed ? n : n - 1); i++) out.push(...c.points[i], ...c.points[(i + 1) % n]);
  return out;
};

/** Brings the bar and the lines over the 3D view up to date. */
function show(extra?: readonly number[]): void {
  bar.hidden = !active || !store.view3d;
  statusLabel.textContent = status();
  loftBtn.disabled = !ready();
  clearBtn.disabled = !chosen.length;
  if (active) store.setHint(hint());
  const v = appContext()?.view3d();
  if (!v) return;
  if (!active) {
    v.setHighlightLines(null);
    return;
  }
  const lines = chosen.flatMap((c) => segmentsOf(c.curve));
  // the proposed alignment, from each section's start to the next's
  const sections = sectionsOf();
  for (let i = 0; i + 1 < sections.length; i++) lines.push(...aligned(sections[i].curve, sections[i].reverse, sections[i].start).points[0], ...aligned(sections[i + 1].curve, sections[i + 1].reverse, sections[i + 1].start).points[0]);
  if (extra) lines.push(...extra);
  v.setHighlightLines(lines, candidates.filter((c) => !chosen.some((p) => p.id === c.id)).flatMap((c) => segmentsOf(c.curve)));
}

const hint = (): string => `${status()} · Click a chosen curve to take it back · Drag to orbit`;

/** The curve nearest the pointer on the screen, and the point on it there. */
export function curveUnder(e: MouseEvent, candidates: readonly Candidate[]): { candidate: Candidate; point: Point3 } | null {
  const v = appContext()?.view3d();
  if (!v) return null;
  let best: { candidate: Candidate; point: Point3 } | null = null;
  let bestD = PICK_PX;
  for (const candidate of candidates) {
    const { points, closed } = candidate.curve;
    const n = points.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const [a, b] = [points[i], points[(i + 1) % n]];
      const [sa, sb] = [v.screenOf(a), v.screenOf(b)];
      if (!sa || !sb) continue;
      const [dx, dy] = [sb.x - sa.x, sb.y - sa.y];
      const u = Math.min(1, Math.max(0, ((e.clientX - sa.x) * dx + (e.clientY - sa.y) * dy) / Math.max(dx * dx + dy * dy, 1e-9)));
      const d = Math.hypot(e.clientX - (sa.x + u * dx), e.clientY - (sa.y + u * dy));
      if (d < bestD) {
        bestD = d;
        best = { candidate, point: [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2])] };
      }
    }
  }
  return best;
}

function clicked(_hit: FaceHit | null, _shift: boolean, e: MouseEvent): void {
  if (!active) return;
  const under = curveUnder(e, candidates);
  if (!under) {
    toast("Click nearer a curve: a 3D polygon, or a 2D shape on the active layer.", "info");
    return;
  }
  const { candidate, point } = under;
  if (chosen.some((c) => c.id === candidate.id)) chosen = chosen.filter((c) => c.id !== candidate.id);
  else if (settings.mode === "birail" && sectionsOf().length && chosen.length >= 3) toast("Birail Sweep takes just one cross section.", "info");
  else {
    // a closed section starts at the click; an open one at its nearer end
    const share = shareNearest(candidate.curve, point);
    chosen = [...chosen, { ...candidate, start: candidate.curve.closed ? share : 0, reverse: !candidate.curve.closed && share > 0.5 }];
  }
  show();
}

/** The rings for what's chosen, with these per-section settings. */
function ringsFor(sections: readonly Chosen[], ruled: boolean, closed: boolean): Point3[][] {
  const curves = sections.map((c) => aligned(c.curve, c.reverse, c.start));
  const rails = railsOf();
  if (settings.mode === "birail") return birailRings(rails[0].curve, rails[1].curve, curves[0]);
  if (settings.mode === "onerail") return oneRailRings(rails[0].curve, curves);
  return loftRings(curves, { ruled, closed, solid: false });
}

async function create(): Promise<void> {
  if (!ready()) return;
  const problem = loftProblem(sectionsOf().map((c) => c.curve));
  if (problem) {
    toast(problem, "info");
    return;
  }
  const open = !sectionsOf()[0].curve.closed;
  const rows = sectionsOf().map((c, i) => {
    const reverse = h("input", { attrs: { type: "checkbox", "aria-label": `Reverse curve ${i + 1}` } });
    reverse.checked = c.reverse;
    const start = h("input", { cls: "menu-dialog-input", value: String(Math.round(c.start * 1000) / 10 % 100), disabled: c.curve.closed === false, attrs: { type: "text", "aria-label": `Start of curve ${i + 1}` } });
    return { reverse, start, el: h("div", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: `Curve ${i + 1}` }), h("label", { cls: "menu-dialog-check" }, reverse, "Reverse"), start, h("span", { cls: "menu-dialog-unit", text: "% start" })) };
  });
  const check = (text: string, value: boolean, enabled = true): HTMLInputElement => {
    const input = h("input", { disabled: !enabled, attrs: { type: "checkbox", "aria-label": text } });
    input.checked = value && enabled;
    return input;
  };
  const noRail = settings.mode === "norail";
  const ruled = check("Ruled", settings.ruled, noRail);
  const closed = check("Closed", settings.closed, noRail && sectionsOf().length >= 3);
  const solid = check("Create Solid", settings.solid, !open);
  const keep = check("Keep Curves", settings.keep);
  const sectionsNow = (): Chosen[] => sectionsOf().map((c, i) => ({ ...c, reverse: rows[i].reverse.checked, start: Math.max(0, Math.min(100, Number(rows[i].start.value) || 0)) / 100 }));
  const preview = (): void => show(loftWires(ringsFor(sectionsNow(), ruled.checked, closed.checked), !open));
  const row = (input: HTMLInputElement, text: string): HTMLElement => h("label", { cls: "menu-dialog-check" }, input, text);
  const body = [...rows.map((r) => r.el), row(ruled, "Ruled"), row(closed, "Closed"), row(solid, "Create Solid"), row(keep, "Keep Curves"), h("p", { cls: "muted", text: "The 3D view shows the loft as these change: turn a curve or move its start to untwist it." })];
  for (const el of body) el.addEventListener("input", preview);
  preview();
  const v = await showDialog<{ sections: Chosen[] }>({
    title: "Loft Creation",
    okLabel: "Create",
    body,
    check: () => {
      const bad = rows.find((r) => !Number.isFinite(Number(r.start.value)));
      return bad ? { error: "The start must be a share of the curve's length, from 0 to 100.", focus: bad.start } : { value: { sections: sectionsNow() } };
    },
  });
  if (!v) {
    show();
    return;
  }
  settings.ruled = ruled.checked;
  settings.closed = closed.checked;
  settings.solid = solid.checked;
  settings.keep = keep.checked;
  const rings = ringsFor(v.sections, ruled.checked, closed.checked);
  // the curves are in the model, and a mesh is added by its height above the layer
  const base = store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;
  const faces = loftFaces(rings, !open, solid.checked).map((f) => f.map((v, i) => (i % 3 === 2 ? v - base : v)));
  const curves = chosen.map((c) => c.id);
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const made = attempt("Loft Surface", (s) =>
    s.batch(() => {
      const ids = s.addMeshes(layerId, [faces], store.activeClassIndex, store.drawAttrs);
      if (!keep.checked) s.deleteObjects(curves);
      return ids;
    }),
  );
  chosen = [];
  candidates = findCandidates();
  if (made) setSelection(made.value);
  show();
}

const statusLabel = h("span", { cls: "symbol-bar-label" });
const loftBtn = h("button", { cls: "btn small primary", text: "Loft…", attrs: { type: "button" } });
const clearBtn = h("button", { cls: "btn small", text: "Clear", attrs: { type: "button" } });
const bar = h("div", { cls: "symbol-bar solid-edit-bar", hidden: true, attrs: { role: "status" } }, h("span", { cls: "symbol-bar-name", text: "Loft Surface" }), statusLabel, loftBtn, clearBtn);

/** Puts the bar over the drawing, and has the tool take the 3D view's clicks while it's in use. */
export function mountLoftBar(wrap: HTMLElement): void {
  editBars(wrap).append(bar);
  loftBtn.addEventListener("click", () => void create());
  clearBtn.addEventListener("click", () => {
    chosen = [];
    show();
  });
  store.on("tool", () => {
    const now = store.tool === "loftsurface";
    if (now !== active) {
      const was = active;
      active = now;
      chosen = [];
      candidates = now ? findCandidates() : [];
      if (was || now) show();
    }
    const v = appContext()?.view3d();
    if (!v) return;
    if (now) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  });
  store.on("view3d", () => {
    if (active) show();
    else bar.hidden = true;
  });
  // curves moved or drawn, or an undo: what can be chosen has changed
  store.on("session", () => {
    if (!active) return;
    candidates = findCandidates();
    chosen = chosen.filter((c) => candidates.some((k) => k.id === c.id));
    show();
  });
  on3d((v) => {
    if (active) {
      v.onFacePick = clicked;
      show();
    }
  });
  onWorkingPlanes(() => {
    const v = appContext()?.view3d();
    if (v && active) v.onFacePick ??= clicked;
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || !store.view3d) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      // a dialog of ours is open
      if (document.querySelector(".menu-dialog")) return;
      if (e.key === "Enter" && ready()) {
        e.preventDefault();
        e.stopPropagation();
        void create();
      } else if (e.key === "Escape" && chosen.length) {
        e.preventDefault();
        e.stopPropagation();
        chosen = [];
        show();
      }
    },
    true,
  );
}

export class LoftSurfaceTool extends BaseTool {
  readonly id = "loftsurface";
  readonly cursor = "crosshair";

  hint(): string {
    return hint();
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) requestShow3d();
  }

  modes(): readonly ToolModes[] {
    return [{ label: "Rails", options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: settings.mode }];
  }

  setMode(id: string): void {
    const m = MODES.find((x) => x.id === id);
    if (!m || m.id === settings.mode) return;
    settings.mode = m.id;
    // what was chosen means something else now
    chosen = [];
    show();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }
}
