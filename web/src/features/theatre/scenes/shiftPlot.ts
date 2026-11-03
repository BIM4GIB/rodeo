// Stage > Scenes > Shift Plot: a tab per change from one scene to the next, with a table of the pieces that
// move, turn or fly on it (what each does, from and to where, its crew and its time), and the collisions on
// the way above the table. Export CSV writes the change in front; Export All writes every change in one file.

import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { csvText, dataTable, downloadText, noteLine, openPanel, tabs, type Column } from "../ui.ts";
import { sceneData, sceneNamed, transitionsOf } from "./scenesData.ts";
import { sceneDiff, sweep, type DiffRow, type Scene, type SceneData } from "./transitions.ts";

const COLUMNS: readonly Column<DiffRow>[] = [
  { label: "Piece", value: (r) => r.piece },
  { label: "Action", value: (r) => r.action },
  { label: "From", value: (r) => r.from },
  { label: "To", value: (r) => r.to },
  { label: "Crew", value: (r) => r.crew, numeric: true },
  { label: "Seconds", value: (r) => Math.round(r.seconds), numeric: true },
];

const HEADINGS = ["Change", "Piece", "Action", "From", "To", "Distance (mm)", "Turn (deg)", "Crew", "Seconds"];

/** "1 min 12 s", or "7 s". */
export function timeText(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

/** A file name from a scene name: no characters a file system refuses. */
function fileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Scenes";
}

/** One change's CSV rows: its collisions first, then each piece that moves. */
function changeRows(a: Scene, b: Scene, d: SceneData): (string | number)[][] {
  const change = `${a.name} to ${b.name}`;
  const named = (id: string): string => d.pieces.find((p) => p.id === id)?.name ?? id;
  const hits = sweep(a, b, d.pieces).map((c) => [change, named(c.a), `Hits ${named(c.b)} at ${Math.round(c.t * 100)}% through the change`, "", "", "", "", "", ""]);
  const moves = sceneDiff(a, b, stageFrame(), lengthText, d.pieces).map((r) => [change, r.piece, r.action, r.from, r.to, Math.round(r.distanceMm), Math.round(r.turnDeg * 10) / 10, r.crew, Math.round(r.seconds)]);
  return [...hits, ...moves];
}

/** The window's panel for one change, read fresh from the drawing each time it is shown. */
function changePanel(aId: string, bId: string): HTMLElement {
  const d = sceneData();
  const a = sceneNamed(d, aId);
  const b = sceneNamed(d, bId);
  if (!a || !b) return noteLine("One of these scenes is gone.", "th-warn");
  const rows = sceneDiff(a, b, stageFrame(), lengthText, d.pieces);
  const hits = sweep(a, b, d.pieces);
  const named = (id: string): string => d.pieces.find((p) => p.id === id)?.name ?? "a piece";
  const table = dataTable(COLUMNS, () => rows, { empty: "No piece moves, turns or flies on this change." });
  const crew = rows.reduce((sum, r) => sum + r.crew, 0);
  const seconds = rows.reduce((sum, r) => sum + r.seconds, 0);
  const notes = hits.length
    ? hits.map((c) => noteLine(`${named(c.a)} hits ${named(c.b)} at ${Math.round(c.t * 100)}% through the change.`, "th-bad"))
    : [noteLine("No pieces hit on the way.")];
  return h(
    "div",
    { cls: "scenes-window" },
    ...notes,
    table.element,
    noteLine(`Crew: ${crew} in all if every piece moves at once. Time: ${timeText(seconds)} if the pieces move one after another (a starting guess).`),
  );
}

/** Opens the Shift Plot window over the drawing: a tab per change in the scenes' order. */
export function openShiftPlot(): void {
  const d = sceneData();
  const pairs = transitionsOf(d);
  if (pairs.length === 0) {
    toast("Make two scenes first: a shift plot is the changes from one scene to the next.", "info");
    return;
  }
  const ids = pairs.map(([a, b]) => [a.id, b.id] as const);
  const view = tabs(
    pairs.map(([a, b], i) => ({ id: String(i), label: `${a.name} to ${b.name}`, build: () => changePanel(ids[i][0], ids[i][1]) })),
  );
  const exportOne = (tab: string): void => {
    const i = Number(tab);
    const d2 = sceneData();
    const a = sceneNamed(d2, ids[i]?.[0]);
    const b = sceneNamed(d2, ids[i]?.[1]);
    if (!a || !b) return;
    downloadText(`Shift ${fileName(a.name)} to ${fileName(b.name)}.csv`, csvText(HEADINGS, changeRows(a, b, d2)), "text/csv");
  };
  const exportAll = (): void => {
    const d2 = sceneData();
    const rows = ids.flatMap(([aid, bid]) => {
      const a = sceneNamed(d2, aid);
      const b = sceneNamed(d2, bid);
      return a && b ? changeRows(a, b, d2) : [];
    });
    downloadText("Shift Plot.csv", csvText(HEADINGS, rows), "text/csv");
  };
  // a new window follows the drawing while it is open; one already open keeps its own tabs
  let off = (): void => {};
  const panel = openPanel({
    key: "scenes.shift",
    title: "Shift Plot",
    body: view.element,
    width: 780,
    height: 540,
    actions: [
      { label: "Export CSV", run: () => exportOne(view.current()) },
      { label: "Export All", run: exportAll, primary: true },
    ],
    onClose: () => off(),
  });
  if (panel.element.contains(view.element)) off = store.on("session", () => view.refresh());
}
