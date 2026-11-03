// Stage > Sightlines > Seat Coverage Map: a heat map on the stage floor of the share of the audience that
// can see each point, drawn over the drawing: red where under half the seats see a point, amber at half,
// clear where all of them see it. Its window gives the overall figures and the Worst Seats; a click on one
// looks through the 3D view from that seat. The proscenium masks the view when a venue is set, and Use
// Selection as Masking adds the edges of the selected objects. Plan only: heights aren't tested.

import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { setViz, store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { Painter } from "../../../app/tools.ts";
import type { EditSession } from "../../../core/index.ts";
import { readShow, writeShow } from "../show.ts";
import { fromStage, type StagePoint } from "../stage.ts";
import { stageFrame } from "../stageTool.ts";
import { dataTable, noteLine, openPanel, type Column, type OpenPanel } from "../ui.ts";
import { audience } from "./audienceWindow.ts";
import { coverageGrid, coverageStats, MAX_SEATS, wallsOf, type Coverage, type StageRect, type Wall } from "./coverage.ts";
import { seatCount, seatsOf, type Seat } from "./seats.ts";
import { venue } from "./shared.ts";
import "./sightlines.css";

/** The show key for the masking the selection gives, as stage-terms walls. */
const MASKING_KEY = "sightlines.masking";
/** The map's cells, about this big, mm; a stage without a venue is 14 m by 10 m. */
const CELL_MM = 600;
const DEFAULT_WIDTH_MM = 14000;
const DEFAULT_DEPTH_MM = 10000;
/** How far the proscenium's walls run out past the opening, mm (20 m). */
const PROS_REACH_MM = 20000;
/** The eye the 3D view looks from through a seat is this high at the seat, and aims this high at the stage. */
const AIM_HEIGHT_MM = 1200;
const RED: readonly number[] = [200, 32, 40];
const AMBER: readonly number[] = [255, 170, 0];
const ALPHA = 150;

interface Map {
  readonly session: EditSession;
  readonly cov: Coverage;
  readonly rect: StageRect;
  /** the map painted one cell to a pixel, scaled up when drawn */
  readonly image: HTMLCanvasElement;
}

interface WorstRow {
  readonly seat: Seat;
  /** the share of the stage the seat sees, 0 to 100 */
  readonly score: number;
}

let mapOn = false;
let dirty = true;
let map: Map | null = null;
let readout: OpenPanel | null = null;
let refreshReadout: (() => void) | null = null;
const watched = new WeakSet<EditSession>();

/** Whether the map is on (its window is open). */
export const coverageOn = (): boolean => mapOn;

/** The stage's area the map covers: the venue's stage, or a default 14 m by 10 m centred on CL, upstage of PL. */
function stageRect(): StageRect {
  const v = venue();
  if (v && v.stageWidthMm > 0 && v.stageDepthMm > 0) return { across0: -v.stageWidthMm / 2, across1: v.stageWidthMm / 2, up0: 0, up1: v.stageDepthMm };
  return { across0: -DEFAULT_WIDTH_MM / 2, across1: DEFAULT_WIDTH_MM / 2, up0: 0, up1: DEFAULT_DEPTH_MM };
}

/** The walls that hide the stage from a seat: the proscenium's two sides when a venue is set, and the masking. */
function occluders(): Wall[] {
  const v = venue();
  const walls: Wall[] = [];
  if (v) {
    const half = v.prosWidthMm / 2;
    walls.push({ a: { across: half, up: 0 }, b: { across: half + PROS_REACH_MM, up: 0 } }, { a: { across: -half, up: 0 }, b: { across: -half - PROS_REACH_MM, up: 0 } });
  }
  return [...walls, ...readShow<Wall[]>(MASKING_KEY, [])];
}

/** A cell count for a length of stage: about CELL_MM each, between 4 and 80. */
const cellsFor = (mm: number): number => Math.min(80, Math.max(4, Math.round(mm / CELL_MM)));

/** A cell's colour and alpha: red at none of the seats, through amber at half, clear at all of them. */
function heat(percent: number): [number, number, number, number] {
  const t = Math.min(100, Math.max(0, percent)) / 100;
  if (t < 0.5) {
    const k = t / 0.5;
    const mix = (i: number): number => Math.round(RED[i] + (AMBER[i] - RED[i]) * k);
    return [mix(0), mix(1), mix(2), ALPHA];
  }
  return [AMBER[0], AMBER[1], AMBER[2], Math.round(ALPHA * (1 - (t - 0.5) / 0.5))];
}

/** The grid painted one pixel to a cell. */
function paint(cov: Coverage): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = cov.cols;
  c.height = cov.rows;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(cov.cols, cov.rows);
  cov.percent.forEach((p, k) => img.data.set(heat(p), k * 4));
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Marks the map stale when the drawing or its show data changes, and re-reads an open window. */
function watch(s: EditSession): void {
  if (watched.has(s)) return;
  watched.add(s);
  s.onChange(() => {
    dirty = true;
    refreshReadout?.();
    appContext()?.requestDraw();
  });
}

/** The map for the drawing as it stands (worked out again when it changed), or null without seats. */
function current(): Map | null {
  const s = store.session;
  if (!s) return null;
  watch(s);
  if (map && map.session === s && !dirty) return map;
  const seats = seatsOf(audience());
  if (seats.length === 0) return null;
  const rect = stageRect();
  const cov = coverageGrid(seats, rect, cellsFor(rect.across1 - rect.across0), cellsFor(rect.up1 - rect.up0), occluders());
  map = { session: s, cov, rect, image: paint(cov) };
  dirty = false;
  return map;
}

/** Paints the map over the stage's floor, cell by cell, through the plan's transform. */
export function drawCoverage(p: Painter): void {
  if (!mapOn) return;
  const cur = current();
  if (!cur) return;
  const { cov, rect } = cur;
  const f = stageFrame();
  const top = p.toScreen(fromStage(f, { across: rect.across0, up: rect.up1 }));
  const right = p.toScreen(fromStage(f, { across: rect.across1, up: rect.up1 }));
  const bottom = p.toScreen(fromStage(f, { across: rect.across0, up: rect.up0 }));
  const along = { x: (right.x - top.x) / cov.cols, y: (right.y - top.y) / cov.cols };
  const down = { x: (bottom.x - top.x) / cov.rows, y: (bottom.y - top.y) / cov.rows };
  const ctx = p.ctx;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.transform(along.x, along.y, down.x, down.y, top.x, top.y);
  ctx.drawImage(cur.image, 0, 0);
  ctx.restore();
  const corners = [top, right, p.toScreen(fromStage(f, { across: rect.across1, up: rect.up0 })), bottom];
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** Turns the map on (opening its window) or off (closing it). */
export function toggleCoverage(): void {
  if (mapOn) {
    readout?.close();
    return;
  }
  if (!store.session) return;
  if (seatCount(audience()) === 0) {
    toast("Add an audience first: Stage > Sightlines > Audience…", "info");
    return;
  }
  mapOn = true;
  openReadout();
  appContext()?.requestDraw();
}

const pct = (v: number): string => `${Math.round(v)}%`;

function para(text: string, cls?: string): HTMLElement {
  return h("p", { cls, text });
}

/** The readout's lines: the seats counted, the average and worst seats, the stage every seat sees, the masking, and what isn't tested. */
function summaryLines(): HTMLElement[] {
  const cur = current();
  if (!cur) return [para("There are no seats to count. Add some under Stage > Sightlines > Audience…")];
  const { cov } = cur;
  const st = coverageStats(cov);
  const sampled = cov.counted.length < cov.total;
  const seats = `${cov.total} seat${cov.total === 1 ? "" : "s"}${sampled ? `, of which ${cov.counted.length} are counted (sampled evenly, up to ${MAX_SEATS}, to keep the map quick)` : ""}`;
  const edges = readShow<Wall[]>(MASKING_KEY, []).length;
  const masks = [venue() ? "the proscenium" : "", edges ? `${edges} selected edges` : ""].filter((m) => m !== "");
  return [
    para(`${seats}. The average seat sees ${pct(st.average)} of the stage; the worst sees ${pct(st.worst)}.`),
    para(`${pct(st.everyone)} of the stage is seen from every counted seat; ${pct(st.underHalf)} is seen from fewer than half of them.`),
    para(`Masking: ${masks.length ? masks.join(" and ") : "none yet"}. ${edges ? "Clear Masking removes the selected edges." : "Select objects and press Use Selection as Masking to mask the view with their edges."}`),
    noteLine(
      venue() ? "Plan only: seats' heights and the rake aren't tested. Click a seat to see from it in the 3D view." : "No venue is set, so the stage is a default 14 m by 10 m with no proscenium. New Venue… sets the real one.",
      venue() ? undefined : "th-warn",
    ),
  ];
}

/** The counted seats, worst first. */
function worstRows(): WorstRow[] {
  const cur = current();
  if (!cur) return [];
  return cur.cov.counted.map((seat, i) => ({ seat, score: cur.cov.seatScores[i] })).sort((a, b) => a.score - b.score);
}

const WORST_COLUMNS: Column<WorstRow>[] = [
  { label: "Block", value: (r) => r.seat.block },
  { label: "Row", value: (r) => r.seat.row, numeric: true },
  { label: "Seat", value: (r) => r.seat.seat, numeric: true },
  {
    label: "% of Stage Seen",
    value: (r) => Math.round(r.score),
    numeric: true,
    cellClass: (r) => (r.score < 50 ? "th-bad" : r.score < 75 ? "th-warn" : undefined),
  },
];

/** Looks through the 3D view from `seat`, at the stage's middle. */
async function seeFrom(seat: Seat): Promise<void> {
  const view = await appContext()?.show3d();
  if (!view) {
    toast("The 3D view isn't available here.", "info");
    return;
  }
  if (store.viz3d.projection !== "perspective") setViz({ projection: "perspective" });
  const f = stageFrame();
  const rect = stageRect();
  const eye = fromStage(f, { across: seat.across, up: seat.up });
  const aim = fromStage(f, { across: 0, up: (rect.up0 + rect.up1) / 2 });
  view.lookThrough([eye.x, eye.y, seat.eyeMm], [aim.x, aim.y, AIM_HEIGHT_MM], 55, 1.5);
}

function round(p: StagePoint): StagePoint {
  return { across: Math.round(p.across * 10) / 10, up: Math.round(p.up * 10) / 10 };
}

/** The selected objects' ids, with the members of any groups among them (each member names its group as its parent). */
function selectedIds(s: EditSession): string[] {
  const picked = [...store.selection];
  if (!picked.some((id) => s.doc.object(id)?.kind === "group")) return picked;
  const layers = new Set(picked.map((id) => s.doc.object(id)?.layerId).filter((l): l is string => !!l));
  const members = new Map<string, string[]>();
  for (const layer of layers) {
    for (const o of s.doc.objects(layer)) if (o.parentId) members.set(o.parentId, [...(members.get(o.parentId) ?? []), o.id]);
  }
  const out = new Set<string>();
  const walk = (id: string): void => {
    out.add(id);
    for (const m of members.get(id) ?? []) walk(m);
  };
  picked.forEach(walk);
  return [...out];
}

/** Makes the masking the edges of the selected objects, in stage terms. */
function useSelection(): void {
  const s = store.session;
  if (!s) return;
  const ids = selectedIds(s);
  if (ids.length === 0) {
    toast("Select the objects whose edges should mask the view, then press Use Selection as Masking.", "info");
    return;
  }
  const frame = stageFrame();
  const walls: Wall[] = [];
  let used = 0;
  for (const id of ids) {
    const shape = s.doc.object(id)?.shape;
    if (!shape) continue;
    const edges = wallsOf(shape, frame);
    if (edges.length) used++;
    for (const w of edges) walls.push({ a: round(w.a), b: round(w.b) });
  }
  if (walls.length === 0) {
    toast("Those objects have no edges to mask with. Lines, rectangles, polygons and arcs do.", "info");
    return;
  }
  writeShow("Use Selection as Masking", MASKING_KEY, walls);
  toast(`${used} object${used === 1 ? "" : "s"} give ${walls.length} edges to mask the view.`, "info");
}

function clearMasking(): void {
  if (readShow<Wall[]>(MASKING_KEY, []).length === 0) {
    toast("There is no masking to clear.", "info");
    return;
  }
  writeShow("Clear Masking", MASKING_KEY, []);
}

function openReadout(): void {
  if (readout) {
    document.body.append(readout.element);
    return;
  }
  const summary = h("div", { cls: "sightlines-summary" });
  const table = dataTable<WorstRow>(WORST_COLUMNS, worstRows, {
    empty: "No seats to count.",
    onRow: (r) => void seeFrom(r.seat),
  });
  const update = (): void => {
    summary.replaceChildren(...summaryLines());
    table.refresh();
  };
  refreshReadout = update;
  readout = openPanel({
    key: "sightlines.coverage",
    title: "Seat Coverage Map",
    body: h("div", { cls: "sightlines-body" }, summary, para("Worst Seats: click one to see from it.", "th-note"), table.element),
    width: 460,
    height: 580,
    anchor: "side",
    actions: [
      { label: "Use Selection as Masking", run: useSelection, primary: true },
      { label: "Clear Masking", run: clearMasking },
    ],
    onClose: () => {
      mapOn = false;
      readout = null;
      refreshReadout = null;
      appContext()?.requestDraw();
    },
  });
  update();
}
