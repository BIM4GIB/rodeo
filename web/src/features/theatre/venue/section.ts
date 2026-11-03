// The lighting section: a centre-line section of the venue drawn from the drawing's data, the one a
// designer would otherwise draw by hand. Its frame has x as up (upstage to the right, the house to the
// left) and y as height above the stage floor, mm, with the origin where the plaster line meets the
// floor; sectionPanel.ts places it on the drawing. It draws the floors, the proscenium arch, the back
// wall and grid, each lineset with its cloth, drops and legs, each focused instrument at its lens with
// its beam cut at the floor, the front and rear rows' sightlines past the proscenium top, the iron and a
// 1.7 m figure for scale. It flags a beam cut off by a border and an instrument the front row can see.
// Pure. Leaves out balconies (the audience has none), scenery, people and anything not in the file.

import type { Pt } from "../../../core/index.ts";
import type { Fixture } from "../fixture.ts";
import { toStage, type StageFrame } from "../stage.ts";
import type { Audience, Lineset, SeatBlock, VenueInfo } from "../showTypes.ts";
import type { Sketch } from "./venueShapes.ts";

/** A seated eye's height above the floor under it, mm. */
const SEATED_MM = 1100;
/** a wall's thickness, mm */
const WALL_MM = 300;
/** a lineset's tick across, mm */
const TICK_MM = 300;
/** a figure for scale: its height and head's radius, mm */
const PERSON_MM = 1700;
const HEAD_MM = 115;
/** where the figure stands, up from the plaster line, mm */
const PERSON_UP_MM = 1000;
/** how many dashes a dashed drop, leg or iron line has */
const DASHES = 8;
/** points tested up a border's cloth for a beam's cone */
const CLOTH_SAMPLES = 100;

export interface SectionInput {
  readonly venue: VenueInfo;
  readonly audience: Audience;
  readonly linesets: readonly Lineset[];
  readonly fixtures: readonly Fixture[];
  readonly frame: StageFrame;
  /** the label height on paper times the layer's scale, mm (in the drawing) */
  readonly labelMm: number;
  /** the layer's scale, 1:n */
  readonly scale: number;
  /** a length as the drawing's units write it */
  readonly format: (mm: number) => string;
}

export interface SectionResult {
  /** in the section's own frame, mm: x up (upstage positive), y height above the stage floor */
  readonly sketch: Sketch<Pt>;
  /** what to look at, in words */
  readonly flags: readonly string[];
  /** how many instruments have no focus, so have no beam drawn */
  readonly unfocused: number;
}

const p = (x: number, y: number): Pt => ({ x, y });

/** A block's row, measured down from the plaster line on the centre line (into the house positive), mm. */
function rowDown(b: SeatBlock, r: number): number {
  if (b.curveUpMm === 0) return b.downMm + r * b.rowSpacingMm;
  const R0 = Math.hypot(b.acrossMm, b.downMm + b.curveUpMm);
  const phi = Math.atan2(b.acrossMm, b.downMm + b.curveUpMm);
  return (R0 + r * b.rowSpacingMm) * Math.cos(phi) - b.curveUpMm;
}

/** A row's eye height above the stage floor, mm. */
const eyeOf = (b: SeatBlock, r: number): number => b.eyeMm + r * b.riseMm;

/** Dashes down (or up) a vertical line from y0 to y1 at x: DASHES pieces with gaps of the same length. */
function dashedDown(x: number, y0: number, y1: number): Pt[][] {
  const step = (y1 - y0) / (2 * DASHES);
  const out: Pt[][] = [];
  for (let i = 0; i < DASHES; i++) out.push([p(x, y0 + 2 * i * step), p(x, y0 + (2 * i + 1) * step)]);
  return out;
}

/** The sightline from an eye past the proscenium top to x = `to`, as its two ends. */
function sightline(eyeX: number, eyeY: number, prosH: number, to: number): [Pt, Pt] {
  const slope = (prosH - eyeY) / -eyeX;
  return [p(eyeX, eyeY), p(to, eyeY + (to - eyeX) * slope)];
}

/** The section of the venue, with its flags. */
export function lightingSection(s: SectionInput): SectionResult {
  const v = s.venue;
  const D = v.stageDepthMm;
  const G = v.gridHeightMm;
  const T = WALL_MM;
  const proscenium = v.kind === "proscenium";
  const frontEdge = v.kind === "proscenium" || v.kind === "thrust" ? -v.apronMm : 0;
  const lines: Pt[][] = [];
  const filled: Pt[][] = [];
  const circles: { center: Pt; radius: number }[] = [];
  const texts: Sketch<Pt>["texts"][number][] = [];
  const flags: string[] = [];
  const label = (at: Pt, text: string, justify: "left" | "centre" | "right" = "centre", height = s.labelMm) => texts.push({ at, text, height, justify });

  // the house: its floor from the front row back, on the centre line; the front block is the nearest one in the house
  const houses = s.audience.blocks.filter((b) => b.rows > 0 && rowDown(b, 0) > 0);
  const front = houses.reduce<SeatBlock | null>((a, b) => (a === null || rowDown(b, 0) < rowDown(a, 0) ? b : a), null);
  const rear = houses.reduce<{ block: SeatBlock; r: number; down: number } | null>((a, b) => {
    const down = rowDown(b, b.rows - 1);
    return a === null || down > a.down ? { block: b, r: b.rows - 1, down } : a;
  }, null);
  const floor: Pt[] = [];
  if (front) for (let r = 0; r < front.rows; r++) floor.push(p(-rowDown(front, r), eyeOf(front, r) - SEATED_MM));
  const houseX = floor.map((q) => q.x);
  const left = Math.min(frontEdge, ...houseX) - 1000;
  const right = D + T + 1000;

  // the stage floor, and the house floor dropping from the stage's edge to the first row
  lines.push([p(frontEdge, 0), p(D, 0)]);
  if (floor.length) {
    if (floor[0].y !== 0) lines.push([p(frontEdge, 0), p(frontEdge, floor[0].y)]);
    lines.push([p(frontEdge, floor[0].y), ...floor]);
  }

  // the proscenium arch: a thick line down from above to its height at up = 0
  if (proscenium) filled.push([p(-T / 2, v.prosHeightMm), p(T / 2, v.prosHeightMm), p(T / 2, G + 500), p(-T / 2, G + 500)]);
  // the back wall, and the grid over the whole section
  filled.push([p(D, 0), p(D + T, 0), p(D + T, G + 1000), p(D, G + 1000)]);
  lines.push([p(left, G), p(right, G)]);
  label(p(left + 200, G + s.labelMm * 1.5), `Grid ${s.format(G)}`, "left");

  // the linesets: a tick at each in trim, cloth hanging from it down, drops and legs dashed
  for (const ls of s.linesets) {
    lines.push([p(ls.upMm - TICK_MM / 2, ls.inTrimMm), p(ls.upMm + TICK_MM / 2, ls.inTrimMm)]);
    label(p(ls.upMm, ls.inTrimMm + s.labelMm * 1.2), ls.name);
    if (ls.kind === "border" && ls.clothMm > 0) lines.push([p(ls.upMm, ls.inTrimMm), p(ls.upMm, ls.inTrimMm - ls.clothMm)]);
    if (ls.kind === "drop" || ls.kind === "leg") {
      const bottom = ls.clothMm > 0 ? ls.inTrimMm - ls.clothMm : 0;
      lines.push(...dashedDown(ls.upMm, ls.inTrimMm, bottom));
    }
  }

  // the iron: a dashed line up the proscenium opening at its line
  if (proscenium) {
    lines.push(...dashedDown(v.ironUpMm, 0, v.prosHeightMm));
    label(p(v.ironUpMm, v.prosHeightMm + s.labelMm * 1.2), "Iron");
  }
  // the plaster line on the stage floor, and the figure standing a metre upstage of it
  label(p(0, -s.labelMm * 1.8), "PL");
  lines.push([p(PERSON_UP_MM, 0), p(PERSON_UP_MM, PERSON_MM - 2 * HEAD_MM)]);
  circles.push({ center: p(PERSON_UP_MM, PERSON_MM - HEAD_MM), radius: HEAD_MM });
  label(p(PERSON_UP_MM + HEAD_MM * 2, PERSON_MM / 2), s.format(PERSON_MM), "left");

  // sightlines past the proscenium top: from the front row's eye, and from the last row's
  const sights: { name: string; line: [Pt, Pt] }[] = [];
  if (proscenium && front) {
    const eye = p(-rowDown(front, 0), eyeOf(front, 0));
    sights.push({ name: "Front row sightline", line: sightline(eye.x, eye.y, v.prosHeightMm, D + T) });
  }
  if (proscenium && rear && rear.r > 0) {
    const eye = p(-rear.down, eyeOf(rear.block, rear.r));
    sights.push({ name: "Last row sightline", line: sightline(eye.x, eye.y, v.prosHeightMm, D + T) });
  }
  for (const sg of sights) {
    lines.push(sg.line);
    const [a, b] = sg.line;
    const at = a.x + (b.x - a.x) * 0.25;
    label(p(at, a.y + (b.y - a.y) * 0.25 + s.labelMm * 1.2), sg.name, "left");
  }

  // the instruments: each focused one at its lens height, with its beam to the floor
  let unfocused = 0;
  const sightFront = sights.find((sg) => sg.name === "Front row sightline");
  for (const f of s.fixtures) {
    if (!f.focus) {
      unfocused++;
      continue;
    }
    const at = p(toStage(s.frame, f.at).up, f.heightMm);
    const focus = p(toStage(s.frame, { x: f.focus.x, y: f.focus.y }).up, f.focus.z);
    const dx = focus.x - at.x;
    const dz = focus.y - at.y;
    const axis = Math.atan2(dz, dx);
    const half = (f.fieldDeg * Math.PI) / 360;
    const edges = [axis - half, axis + half].map((e) => {
      const c = Math.cos(e);
      const sn = Math.sin(e);
      if (sn < -1e-9) {
        const t = at.y / -sn;
        return { angle: e, end: p(at.x + t * c, 0) };
      }
      const t = Math.hypot(dx, dz) * 1.5;
      return { angle: e, end: p(at.x + t * c, at.y + t * sn) };
    });
    circles.push({ center: at, radius: s.labelMm * 0.4 });
    lines.push([at, focus]);
    for (const e of edges) lines.push([at, e.end]);
    const name = `${f.unit ? `Unit ${f.unit}` : f.label}${f.position ? ` (${f.position})` : ""}`;

    // a border's cloth cuts the beam when some of the cloth's height lies inside the cone, above the floor
    const reach = Math.max(...edges.map((e) => Math.hypot(e.end.x - at.x, e.end.y - at.y)));
    const inCone = (x: number, z: number): boolean => {
      if (z < 0 || Math.hypot(x - at.x, z - at.y) > reach) return false;
      const a = Math.atan2(z - at.y, x - at.x);
      const turn = Math.atan2(Math.sin(a - axis), Math.cos(a - axis));
      return Math.abs(turn) <= half;
    };
    for (const ls of s.linesets) {
      if (ls.kind !== "border" || ls.clothMm <= 0) continue;
      const top = ls.inTrimMm;
      const bottom = ls.inTrimMm - ls.clothMm;
      let hit = false;
      for (let i = 0; i <= CLOTH_SAMPLES && !hit; i++) hit = inCone(ls.upMm, bottom + ((top - bottom) * i) / CLOTH_SAMPLES);
      if (hit) flags.push(`${name}: beam cut off by border ${ls.name}`);
    }

    // a focused instrument on the stage side of the proscenium that is below the front row's sightline is seen from it
    if (proscenium && sightFront && at.x > 0) {
      const [eye, over] = sightFront.line;
      const slope = (over.y - eye.y) / (over.x - eye.x);
      const ray = eye.y + (at.x - eye.x) * slope;
      if (at.y < ray) flags.push(`${name}: visible from the front row`);
    }
  }

  // the title and the scale note above the grid
  label(p(left, G + 2000 + s.labelMm), "Lighting Section at CL", "left", s.labelMm * 1.5);
  label(p(left, G + 2000 - s.labelMm * 0.5), `Scale 1:${s.scale} on paper · lengths from the drawing`, "left");

  return {
    sketch: { outlines: [], lines, circles, filled, texts },
    flags,
    unfocused,
  };
}
