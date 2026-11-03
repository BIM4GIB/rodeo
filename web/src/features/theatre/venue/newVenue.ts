// Stage > Venue > New Venue…: asks for a venue's kind and dimensions, then draws its walls, stage, seating
// and notes as plain objects in four classes (Venue-Walls, Venue-Stage, Venue-Seating, Venue-Notes), each
// group named Venue Walls and so on (a drawing's names are shared with its class names, so a group can't take
// the class's own name), in one undo step. The venue's dimensions and seat blocks go into the drawing
// too, for the linesets, the lighting section and the audit. A stage origin already set stays where it is;
// with none, the drawing's own origin stands in, upstage up the page.

import { appContext } from "../../../app/ext.ts";
import { attempt } from "../../../app/commands.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../../../app/toolPrefs.ts";
import { writeShowIn } from "../show.ts";
import { AUDIENCE_KEY, VENUE_KEY, type VenueInfo } from "../showTypes.ts";
import { STAGE_KEY } from "../stage.ts";
import { hasStageFrame, stageFrame } from "../stageTool.ts";
import { audienceOf, DEFAULT_VENUE, VENUE_KINDS, venueParts, type VenueSpec } from "./venueShapes.ts";
import { activeScale, addSketch, classIndexOf, drawingOf, LABEL_PAPER_MM, midGrey } from "./venueDraw.ts";

/** what New Venue last drew with, so the next one starts from it */
let last: VenueSpec = DEFAULT_VENUE;

function fieldsOf(c: VenueSpec): PrefField[] {
  return [
    { kind: "choice", key: "kind", label: "Kind", value: c.kind, options: VENUE_KINDS },
    { kind: "length", key: "stageWidth", label: "Stage Width", value: c.stageWidthMm },
    { kind: "length", key: "stageDepth", label: "Stage Depth", value: c.stageDepthMm },
    { kind: "length", key: "prosWidth", label: "Proscenium Width", value: c.prosWidthMm },
    { kind: "length", key: "prosHeight", label: "Proscenium Height", value: c.prosHeightMm },
    { kind: "length", key: "apron", label: "Apron", value: c.apronMm, zero: true },
    { kind: "length", key: "wing", label: "Wing Width (each side)", value: c.wingMm, zero: true },
    { kind: "length", key: "grid", label: "Grid Height", value: c.gridHeightMm },
    { kind: "length", key: "house", label: "House Depth", value: c.houseDepthMm },
    { kind: "number", key: "rows", label: "Rows of Seats", value: c.rows, min: 0, max: 200, integer: true },
    { kind: "number", key: "seats", label: "Seats per Row", value: c.seatsPerRow, min: 0, max: 200, integer: true },
    { kind: "length", key: "rowSpacing", label: "Row Spacing", value: c.rowSpacingMm },
    { kind: "length", key: "doorWidth", label: "Load-in Door Width", value: c.doorWidthMm },
    { kind: "length", key: "doorHeight", label: "Load-in Door Height", value: c.doorHeightMm },
    { kind: "length", key: "iron", label: "Iron Up", value: c.ironUpMm, zero: true },
  ];
}

function specOf(v: PrefValues): VenueSpec {
  const kind = VENUE_KINDS.find((k) => k.value === v.choice("kind"))?.value ?? DEFAULT_VENUE.kind;
  return {
    kind,
    stageWidthMm: v.num("stageWidth"),
    stageDepthMm: v.num("stageDepth"),
    prosWidthMm: v.num("prosWidth"),
    prosHeightMm: v.num("prosHeight"),
    apronMm: v.num("apron"),
    wingMm: v.num("wing"),
    gridHeightMm: v.num("grid"),
    houseDepthMm: v.num("house"),
    rows: v.num("rows"),
    seatsPerRow: v.num("seats"),
    rowSpacingMm: v.num("rowSpacing"),
    doorWidthMm: v.num("doorWidth"),
    doorHeightMm: v.num("doorHeight"),
    ironUpMm: v.num("iron"),
  };
}

/** The venue's main figures as the drawing keeps them. */
function infoOf(v: VenueSpec): VenueInfo {
  return {
    kind: v.kind,
    prosWidthMm: v.prosWidthMm,
    prosHeightMm: v.prosHeightMm,
    stageDepthMm: v.stageDepthMm,
    stageWidthMm: v.stageWidthMm,
    apronMm: v.apronMm,
    gridHeightMm: v.gridHeightMm,
    ironUpMm: v.ironUpMm,
    doorWidthMm: v.doorWidthMm,
    doorHeightMm: v.doorHeightMm,
  };
}

/** New Venue…: asks for the venue, then draws it in the active design layer. */
export async function newVenue(): Promise<void> {
  const v = await toolPrefs(
    "New Venue",
    fieldsOf(last),
    "Draws the venue as ordinary drawing objects in four classes (Venue-Walls, Venue-Stage, Venue-Seating, Venue-Notes), each grouped. Rows are drawn as lines, one per row, with the block's seat count beside it. Proscenium: the opening, the apron and the house; Thrust: the stage runs out into the seats on three sides; Arena: a centre stage with seats all round and four vomitories; Black Box: a room with loose seats at the far end; Traverse: a long stage with seats on both sides. Dimensions are approximate, for planning.",
  );
  if (!v) return;
  const spec = specOf(v);
  last = spec;
  const scale = activeScale();
  const layerId = store.activeLayerId;
  if (scale === null || !layerId) {
    toast("Make a design layer active to draw the venue.", "info");
    return;
  }
  const frame = stageFrame();
  const parts = venueParts(spec, LABEL_PAPER_MM * scale);
  const sets = [
    { name: "Venue-Walls", sketch: parts.walls, fill: midGrey() },
    { name: "Venue-Stage", sketch: parts.stage, fill: undefined },
    { name: "Venue-Seating", sketch: parts.seating, fill: undefined },
    { name: "Venue-Notes", sketch: parts.notes, fill: undefined },
  ];
  const drawn = attempt("New Venue", (s) =>
    s.batch(() => {
      for (const set of sets) {
        const ids = addSketch(s, layerId, drawingOf(frame, set.sketch), classIndexOf(s, set.name), set.fill);
        if (ids.length > 1) s.setObjectName(s.groupObjects(ids), set.name.replace("-", " "));
      }
      if (!hasStageFrame()) writeShowIn(s, STAGE_KEY, frame);
      writeShowIn(s, VENUE_KEY, infoOf(spec));
      writeShowIn(s, AUDIENCE_KEY, audienceOf(spec));
      return audienceOf(spec).blocks.reduce((n, b) => n + b.rows * b.seatsPerRow, 0);
    }),
  );
  if (!drawn) return;
  toast(`Venue drawn with ${drawn.value} seats. Stage > Linesets… and Lighting Section… read it.`, "info");
  appContext()?.fit();
}
