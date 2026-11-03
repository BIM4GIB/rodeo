// Stage > Sightlines > Audience…: the seat blocks the show keeps (AUDIENCE_KEY), one row each, with the
// numbers editable in the drawing's units. Across is from CL, positive stage left; down is how far into
// the house from PL; a curve centre of 0 gives straight rows. Show Seats draws every seat as a dot on the
// plan. The rake writes its rise and eye back here, and refreshAudience re-reads the open window.

import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { Painter } from "../../../app/tools.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "../../../app/units.ts";
import { readShow, writeShow } from "../show.ts";
import { fromStage } from "../stage.ts";
import { stageFrame } from "../stageTool.ts";
import { dataTable, noteLine, openPanel, type Column, type OpenPanel } from "../ui.ts";
import { AUDIENCE_KEY, type Audience, type SeatBlock } from "../showTypes.ts";
import { seatCount, seatsOf } from "./seats.ts";
import "./sightlines.css";

type LengthKey = "acrossMm" | "downMm" | "rowSpacingMm" | "seatWidthMm" | "curveUpMm" | "eyeMm" | "riseMm";
type CountKey = "rows" | "seatsPerRow";

interface Row {
  readonly index: number;
  readonly block: SeatBlock;
}

let seatsShown = false;
let selectedBlock = -1;
let shown: OpenPanel | null = null;
let refreshWindow: (() => void) | null = null;

/** The blocks the show keeps (none yet: an empty audience). */
export function audience(): Audience {
  return readShow<Audience>(AUDIENCE_KEY, { blocks: [] });
}

/** Whether Show Seats is on. */
export const seatsOn = (): boolean => seatsShown;

/** Turns the seat dots on or off over the plan. */
export function toggleSeats(): void {
  seatsShown = !seatsShown;
  appContext()?.requestDraw();
}

/** Reads the audience again in its window, when one is open. */
export function refreshAudience(): void {
  refreshWindow?.();
}

function saveBlocks(label: string, blocks: readonly SeatBlock[]): void {
  writeShow(label, AUDIENCE_KEY, { blocks });
  refreshAudience();
}

function setBlock(index: number, patch: Partial<SeatBlock>, label: string): void {
  saveBlocks(
    label,
    audience().blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)),
  );
}

function addBlock(): void {
  const blocks = audience().blocks;
  saveBlocks("Add Seat Block", [
    ...blocks,
    { name: `Block ${blocks.length + 1}`, acrossMm: 0, downMm: 2000, rows: 10, seatsPerRow: 20, rowSpacingMm: 900, seatWidthMm: 500, curveUpMm: 0, eyeMm: 1120, riseMm: 120 },
  ]);
  selectedBlock = blocks.length;
}

function deleteBlock(): void {
  const blocks = audience().blocks;
  if (selectedBlock < 0 || selectedBlock >= blocks.length) {
    toast("Click a block's row to select it, then Delete Block.", "info");
    return;
  }
  saveBlocks(
    "Delete Seat Block",
    blocks.filter((_, i) => i !== selectedBlock),
  );
  selectedBlock = -1;
}

/** The table's columns; a typed value is checked, then written as one undo step. */
function columns(refresh: () => void): Column<Row>[] {
  const units = (): string | undefined => store.session?.doc.info.units;
  const len = (label: string, key: LengthKey, signed: boolean): Column<Row> => {
    const suffix = lengthSuffix(units());
    return {
      label: suffix ? `${label} (${suffix})` : label,
      numeric: true,
      value: (r) => formatLengthValue(r.block[key], units()),
      edit: (r, text) => {
        const mm = parseLength(text, units());
        if (mm === null || (!signed && mm < 0)) toast(`${label}: enter a length${signed ? "" : " of 0 or more"}.`, "info");
        else setBlock(r.index, { [key]: mm } as Partial<SeatBlock>, "Edit Seat Block");
        refresh();
      },
    };
  };
  const count = (label: string, key: CountKey, max: number): Column<Row> => ({
    label,
    numeric: true,
    value: (r) => r.block[key],
    edit: (r, text) => {
      const n = Number(text.trim());
      if (Number.isInteger(n) && n >= 1 && n <= max) setBlock(r.index, { [key]: n } as Partial<SeatBlock>, "Edit Seat Block");
      else toast(`${label}: enter a whole number from 1 to ${max}.`, "info");
      refresh();
    },
  });
  return [
    {
      label: "Block",
      value: (r) => r.block.name,
      edit: (r, text) => {
        const name = text.trim();
        if (name) setBlock(r.index, { name }, "Rename Seat Block");
        refresh();
      },
    },
    len("Across from CL", "acrossMm", true),
    len("Down from PL", "downMm", true),
    count("Rows", "rows", 500),
    count("Seats per Row", "seatsPerRow", 500),
    { label: "Seats", numeric: true, value: (r) => r.block.rows * r.block.seatsPerRow },
    len("Row Spacing", "rowSpacingMm", false),
    len("Seat Width", "seatWidthMm", false),
    len("Curve Centre US of PL", "curveUpMm", true),
    len("Eye above Stage", "eyeMm", true),
    len("Eye Rise a Row", "riseMm", true),
  ];
}

/** Opens the Audience window, or brings it forward. */
export function openAudience(): void {
  if (shown) {
    document.body.append(shown.element);
    refreshAudience();
    return;
  }
  const table = dataTable<Row>(
    columns(() => table.refresh()),
    () => audience().blocks.map((block, index) => ({ index, block })),
    {
      empty: "No seats yet. Add Block makes one.",
      onRow: (r) => {
        selectedBlock = r.index;
        table.refresh();
      },
      rowClass: (r) => (r.index === selectedBlock ? "sightlines-selected" : undefined),
    },
  );
  const note = noteLine("");
  const update = (): void => {
    const a = audience();
    const seats = seatCount(a);
    note.textContent = `${seats} seat${seats === 1 ? "" : "s"} in ${a.blocks.length} block${a.blocks.length === 1 ? "" : "s"}. Across is from CL, + stage left. Down is how far into the house from PL. A curve centre of 0 gives straight rows.`;
    table.refresh();
  };
  refreshWindow = update;
  shown = openPanel({
    key: "sightlines.audience",
    title: "Audience",
    body: h("div", { cls: "sightlines-body" }, table.element, note),
    width: 1040,
    height: 440,
    actions: [
      { label: "Add Block", run: addBlock },
      { label: "Delete Block", run: deleteBlock },
    ],
    onClose: () => {
      refreshWindow = null;
      shown = null;
    },
  });
  update();
}

/** Each seat as a dot on the plan, while Show Seats is on. */
export function drawSeats(p: Painter): void {
  if (!seatsShown || !store.session) return;
  const f = stageFrame();
  const ctx = p.ctx;
  ctx.fillStyle = "rgba(43, 153, 255, 0.9)";
  for (const s of seatsOf(audience())) {
    const q = p.toScreen(fromStage(f, { across: s.across, up: s.up }));
    ctx.beginPath();
    ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
