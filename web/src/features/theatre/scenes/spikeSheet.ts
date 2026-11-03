// Stage > Scenes > Spike Sheet: a tab per scene, with a plan of the pieces on stage in it and a table of each
// piece's corners in stage terms, the numbers a stage manager tapes the floor by. Draw Spike Marks puts a
// small L of tape at every corner in the scene's colour, on a class named for the scene (one undo step).

import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { NewShape, Pt } from "../../../core/index.ts";
import { colorOf } from "../gels.ts";
import { stageText } from "../stage.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { csvOf, dataTable, downloadText, noteLine, openPanel, tabs, type Column } from "../ui.ts";
import { sceneData, sceneNamed } from "./scenesData.ts";
import { footprint, poseIn, spikeLegs, spikes, type Scene, type Spike } from "./transitions.ts";

/** A spike mark's arm on paper, mm (times the layer's scale). */
const TAPE_MM = 3;

interface CornerRow {
  piece: string;
  corner: string;
  text: string;
  across: number;
  up: number;
}

const COLUMNS: readonly Column<CornerRow>[] = [
  { label: "Piece", value: (r) => r.piece },
  { label: "Corner", value: (r) => r.corner },
  { label: "Position", value: (r) => r.text },
  { label: "Across (mm)", value: (r) => r.across, numeric: true },
  { label: "Up (mm)", value: (r) => r.up, numeric: true },
];

/** Each corner of each spike, named by where it sits on its piece (US SL and so on). */
function cornerRows(list: readonly Spike[]): CornerRow[] {
  return list.flatMap((sp) => {
    const cx = sp.corners.reduce((sum, c) => sum + c.across, 0) / sp.corners.length;
    const cy = sp.corners.reduce((sum, c) => sum + c.up, 0) / sp.corners.length;
    return sp.corners.map((c) => ({
      piece: sp.name,
      corner: `${c.up >= cy ? "US" : "DS"} ${c.across >= cx ? "SL" : "SR"}`,
      text: stageText(c, lengthText),
      across: Math.round(c.across),
      up: Math.round(c.up),
    }));
  });
}

const XML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch] ?? ch);
}

/**
 * A plan of the pieces on stage, as the audience sees it: upstage at the top, stage left to the right.
 * Stage points are plotted as x = across, y = -up: stage left (across is positive) is on the right, as the labels say.
 */
function planSvg(sc: Scene, list: readonly Spike[]): string {
  const pts = list.flatMap((sp) => sp.corners.map((c) => ({ x: c.across, y: -c.up })));
  const xs = [0, ...pts.map((p) => p.x)];
  const ys = [0, ...pts.map((p) => p.y)];
  const pad = Math.max(500, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.1);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - x0;
  const hh = Math.max(...ys) + pad - y0;
  const size = Math.max(w, hh);
  const stroke = size / 250;
  const font = size / 26;
  const shapes = list.map((sp) => {
    const q = sp.corners.map((c) => ({ x: c.across, y: -c.up }));
    const cx = q.reduce((sum, p) => sum + p.x, 0) / q.length;
    const cy = q.reduce((sum, p) => sum + p.y, 0) / q.length;
    const points = q.map((p) => `${p.x},${p.y}`).join(" ");
    const color = escapeXml(sc.color);
    return `<polygon points="${points}" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="${stroke}"/>` + `<text x="${cx}" y="${cy}" font-size="${font}">${escapeXml(sp.name)}</text>`;
  });
  const lines =
    `<line x1="0" y1="${y0}" x2="0" y2="${y0 + hh}" stroke="currentColor" stroke-width="${stroke / 2}" stroke-dasharray="${stroke * 4} ${stroke * 4}" opacity="0.5"/>` +
    `<line x1="${x0}" y1="0" x2="${x0 + w}" y2="0" stroke="currentColor" stroke-width="${stroke / 2}" stroke-dasharray="${stroke * 4} ${stroke * 4}" opacity="0.5"/>`;
  const marks =
    `<text x="0" y="${y0 + font}" font-size="${font * 0.8}">US</text>` +
    `<text x="0" y="${y0 + hh - font * 0.3}" font-size="${font * 0.8}">DS</text>` +
    `<text x="${x0 + w - font * 0.6}" y="${font * 0.3}" font-size="${font * 0.8}">SL</text>` +
    `<text x="${x0 + font * 0.6}" y="${font * 0.3}" font-size="${font * 0.8}">SR</text>`;
  return `<svg viewBox="${x0} ${y0} ${w} ${hh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Plan of ${escapeXml(sc.name)}">${lines}${shapes.join("")}${marks}</svg>`;
}

/** One scene's tab: its plan, and its corners to tape. */
function spikeTab(sceneId: string): HTMLElement {
  const d = sceneData();
  const sc = sceneNamed(d, sceneId);
  if (!sc) return noteLine("That scene is gone.", "th-warn");
  const list = spikes(sc, d.pieces, stageFrame());
  const rows = cornerRows(list);
  const flown = d.pieces.filter((p) => poseIn(sc, p).out).map((p) => p.name);
  const table = dataTable(COLUMNS, () => rows, { empty: "No piece is on stage in this scene." });
  const counts = `${list.length} ${list.length === 1 ? "piece" : "pieces"} on stage, ${rows.length} corners to tape.`;
  const notes = [noteLine(counts)];
  if (flown.length) notes.push(noteLine(`Flown out, so not taped: ${flown.join(", ")}.`));
  return h("div", { cls: "scenes-window" }, h("div", { cls: "scenes-plan", html: planSvg(sc, list) }), table.element, ...notes);
}

/** Draws each corner's spike mark in the scene's colour on a class "Spikes-<scene name>", as one undo step. */
function drawSpikeMarks(sceneId: string): void {
  const s = store.session;
  const d = sceneData();
  const sc = sceneNamed(d, sceneId);
  if (!s || !sc) return;
  const layerId = store.activeLayerId;
  const layer = s.doc.layers().find((l) => l.id === layerId);
  if (!layer || layer.kind !== "design") {
    toast("Make a design layer active to draw spike marks on it.", "info");
    return;
  }
  const arm = TAPE_MM * (layer.scale || 1);
  const marks: NewShape[] = d.pieces.flatMap((piece) => {
    const pose = poseIn(sc, piece);
    if (pose.out) return [];
    return spikeLegs(footprint(piece, pose), arm).map((points: Pt[]) => ({ kind: "polyline" as const, points, closed: false }));
  });
  if (marks.length === 0) {
    toast("No piece is on stage in this scene to mark.", "info");
    return;
  }
  const className = `Spikes-${sc.name}`;
  const colour = colorMatcher()(colorOf(sc.color));
  const ok = attempt("Draw Spike Marks", (sess) =>
    sess.batch(() => {
      const found = sess.doc.classes().find((c) => c.name === className);
      const cls = found ? found.index : sess.createClass(className);
      sess.setClassAttributes(cls, { penFore: colour });
      sess.addObjects(layer.id, marks, cls, { penFore: colour });
    }),
  );
  if (ok) toast(`Drew ${marks.length} spike marks on the class ${className}.`, "info");
}

/** Saves one scene's corners as CSV. */
function exportSpikes(sceneId: string): void {
  const d = sceneData();
  const sc = sceneNamed(d, sceneId);
  if (!sc) return;
  const rows = cornerRows(spikes(sc, d.pieces, stageFrame()));
  downloadText(`Spikes ${sc.name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Scene"}.csv`, csvOf(COLUMNS, rows), "text/csv");
}

/** Opens the Spike Sheet window over the drawing: a tab per scene, the one in the drawing first. */
export function openSpikeSheet(): void {
  const d = sceneData();
  if (d.scenes.length === 0) {
    toast("Make a scene first: New Scene in the Scenes palette.", "info");
    return;
  }
  const view = tabs(
    d.scenes.map((sc) => ({ id: sc.id, label: sc.name, build: () => spikeTab(sc.id) })),
    d.current ?? d.scenes[0].id,
  );
  // a new window follows the drawing while it is open; one already open keeps its own tabs
  let off = (): void => {};
  const panel = openPanel({
    key: "scenes.spikes",
    title: "Spike Sheet",
    body: view.element,
    width: 700,
    height: 600,
    actions: [
      { label: "Export CSV", run: () => exportSpikes(view.current()) },
      { label: "Draw Spike Marks", run: () => drawSpikeMarks(view.current()), primary: true },
    ],
    onClose: () => off(),
  });
  if (panel.element.contains(view.element)) off = store.on("session", () => view.refresh());
}
