// The Magic Sheet: the console's channel cheat sheet, generated. Instruments are grouped into systems (by
// purpose and colour, by colour, or by position); each system is a titled box with its colour chip and a
// small stage map. A channel's bubble sits where its lights focus (or hang, until they are focused), at the
// mean of them when several share it, and bubbles are pushed apart until none overlap. Pure: lengths in paper
// mm with y up, as drawings are; the caller puts the result on a sheet layer at scale 1. Stage left is at the
// right and upstage at the top, as the audience sees the stage.

import type { MarkerDrawing, MarkerText } from "../../../app/markerShapes.ts";
import type { Pt } from "../../../core/index.ts";
import { naturalCompare, type Fixture } from "../fixture.ts";
import { colorOf, type Rgb } from "../gels.ts";
import { toStage, type StageFrame } from "../stage.ts";

export type Grouping = "purposeColour" | "colour" | "position";

export interface MagicOptions {
  /** the sheet's width on paper, mm */
  readonly pageMm: number;
  /** a bubble's diameter on paper, mm; wider for a longer channel number */
  readonly bubbleMm: number;
  readonly group: Grouping;
}

/** a colour chip: a filled rectangle's corners, paper mm */
export interface MagicChip {
  readonly poly: readonly Pt[];
  readonly colour: Rgb;
}

export interface MagicSheet {
  readonly drawing: MarkerDrawing;
  readonly chips: readonly MagicChip[];
  /** the boxes, one per system */
  readonly systems: number;
  /** the distinct channels on the sheet */
  readonly channels: number;
  /** instruments with no channel, which have no bubble */
  readonly unchanneled: number;
}

/** paper mm: a box's title, its gap above the box, and the box's padding */
const TITLE_MM = 4;
const TITLE_GAP = 2;
const TITLE_BAND = TITLE_GAP + TITLE_MM;
const PAD = 4;
const CHIP_W = 8;
const CHIP_H = 4;
/** the colour row above the stage map */
const HEAD = 7;
/** a stage map's width, and its height unless the channels need more */
const MAP_W = 80;
const MAP_H = 60;
const MIN_MAP_H = 30;
/** between boxes across a row, and between rows */
const GAP_X = 6;
const GAP_Y = 10;
const LEGEND_MM = 3;
const LEGEND_LINE = LEGEND_MM * 1.6;
/** a bubble's label height against its diameter, and the diameter per character of the longest label */
const TEXT_SHARE = 0.36;
const CHAR_MM = 2.6;
/** clear space between two bubbles */
const CLEAR = 0.6;
const PASSES = 40;
const GOLDEN = 2.399963;

const LEGEND =
  "Looking at the stage from the audience: upstage is at the top and stage left is at the right. Each bubble is a channel, placed where its lights focus, or where they hang until they are focused. A channel that several lights share sits at their mean.";

interface System {
  readonly name: string;
  readonly members: Fixture[];
}

interface Box {
  /** the box's width and its height below its title */
  readonly w: number;
  readonly h: number;
  /** in the box's own frame, origin at its bottom left, title included */
  readonly drawing: MarkerDrawing;
  readonly chip: MagicChip | null;
}

interface Dot {
  readonly label: string;
  readonly a: number;
  readonly u: number;
}

/** The colour most of these instruments are given, or "" when none has one. */
function mostColour(members: readonly Fixture[]): string {
  const tally = new Map<string, number>();
  for (const f of members) {
    const c = f.color.trim();
    if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  return [...tally].sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0]))[0]?.[0] ?? "";
}

/** The systems of `list` under `group`: named by purpose, or colour, or position, and "Other" for none. */
function systemsOf(list: readonly Fixture[], group: Grouping): System[] {
  const by = new Map<string, { name: string; members: Fixture[] }>();
  for (const f of list) {
    const purpose = f.purpose.trim();
    const colour = f.color.trim();
    const position = f.position.trim();
    const key = group === "position" ? `p:${position.toLowerCase()}` : group === "colour" ? `c:${colour.toUpperCase()}` : `pc:${purpose.toLowerCase()}|${colour.toUpperCase()}`;
    const name = group === "position" ? position : group === "colour" ? colour : purpose || colour;
    const s = by.get(key) ?? { name: name || "Other", members: [] };
    s.members.push(f);
    by.set(key, s);
  }
  const systems = [...by.values()];
  // two purposes' systems with one name are told apart by their colour
  const count = new Map<string, number>();
  for (const s of systems) count.set(s.name, (count.get(s.name) ?? 0) + 1);
  const named = systems.map((s) => {
    const colour = mostColour(s.members);
    return group === "purposeColour" && (count.get(s.name) ?? 0) > 1 && colour ? { name: `${s.name} (${colour})`, members: s.members } : s;
  });
  return named.sort((a, b) => Number(a.name === "Other") - Number(b.name === "Other") || naturalCompare(a.name, b.name));
}

/** The first `n` of `words` as lines no longer than `max` characters. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Each channel's point in stage terms: the mean of its instruments' focus (or hanging point). */
function dotsOf(members: readonly Fixture[], frame: StageFrame): Dot[] {
  const by = new Map<string, { a: number; u: number; n: number }>();
  for (const f of members) {
    const p = toStage(frame, f.focus ?? f.at);
    const ch = f.channel.trim();
    const e = by.get(ch) ?? { a: 0, u: 0, n: 0 };
    by.set(ch, { a: e.a + p.across, u: e.u + p.up, n: e.n + 1 });
  }
  return [...by].map(([label, e]) => ({ label, a: e.a / e.n, u: e.u / e.n }));
}

/** The first point in a clear spot round `pos[i]`, spiralling out past the map if need be. */
function clearSpot(pos: Pt[], i: number, sep: number): Pt {
  const clash = (p: Pt): boolean => pos.some((q, j) => j !== i && Math.hypot(p.x - q.x, p.y - q.y) < sep - 1e-9);
  const start = pos[i]!;
  const step = sep / 2;
  for (let ring = 1; ring < 10000; ring++) {
    const r = ring * step;
    const steps = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
    for (let t = 0; t < steps; t++) {
      const angle = (2 * Math.PI * t) / steps + ring * GOLDEN;
      const p = { x: start.x + r * Math.cos(angle), y: start.y + r * Math.sin(angle) };
      if (!clash(p)) return p;
    }
  }
  return start;
}

/** One system's box, in its own frame. Bubbles are placed in the map, pushed apart, then any left touching are moved clear. */
function boxOf(sys: System, frame: StageFrame, opts: MagicOptions): Box {
  const dots = dotsOf(sys.members, frame);
  const longest = Math.max(...dots.map((d) => d.label.length), 1);
  const diameter = Math.max(opts.bubbleMm, longest * CHAR_MM);
  const r = diameter / 2;
  const sep = 2 * r + CLEAR;
  const as = dots.map((d) => d.a);
  const us = dots.map((d) => d.u);
  const minA = Math.min(...as);
  const minU = Math.min(...us);
  const spanA = Math.max(...as) - minA;
  const spanU = Math.max(...us) - minU;
  // the scale that fits the spread into the map; a spread under 1 mm on an axis is centred on it
  let k = Infinity;
  if (spanA > 1) k = Math.min(k, (MAP_W - diameter) / spanA);
  if (spanU > 1) k = Math.min(k, (MAP_H - diameter) / spanU);
  if (!Number.isFinite(k)) k = 1;
  const mapW = MAP_W;
  const mapH = spanU > 1 ? Math.max(MIN_MAP_H, spanU * k + diameter) : MIN_MAP_H;
  const X = (a: number): number => (spanA > 1 ? r + (a - minA) * k : mapW / 2);
  const Y = (u: number): number => (spanU > 1 ? r + (u - minU) * k : mapH / 2);
  const pos: Pt[] = dots.map((d) => ({ x: X(d.a), y: Y(d.u) }));
  const clamp = (p: Pt): void => {
    p.x = Math.min(mapW - r, Math.max(r, p.x));
    p.y = Math.min(mapH - r, Math.max(r, p.y));
  };
  pos.forEach(clamp);
  for (let pass = 0; pass < PASSES; pass++) {
    let touching = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!;
        const b = pos[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= sep) continue;
        touching = true;
        const ux = d < 1e-9 ? Math.cos(i * GOLDEN) : dx / d;
        const uy = d < 1e-9 ? Math.sin(i * GOLDEN) : dy / d;
        const push = (sep - (d < 1e-9 ? 0 : d)) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
    pos.forEach(clamp);
    if (!touching) break;
  }
  // what the passes couldn't clear goes to the nearest clear spot, which may lie past the map's edge
  for (let i = 0; i < pos.length; i++) {
    const clear = pos.every((q, j) => j === i || Math.hypot(pos[i]!.x - q.x, pos[i]!.y - q.y) >= sep - 1e-9);
    if (!clear) pos[i] = clearSpot(pos, i, sep);
  }
  // the box grows to hold any bubble past the map, its origin at the bottom left of what it holds
  const low = { x: Math.min(0, ...pos.map((p) => p.x - r)), y: Math.min(0, ...pos.map((p) => p.y - r)) };
  const shift = { x: -low.x, y: -low.y };
  const innerW = Math.max(mapW, ...pos.map((p) => p.x + r + shift.x));
  const innerH = Math.max(mapH, ...pos.map((p) => p.y + r + shift.y));
  const at = (p: Pt): Pt => ({ x: p.x + shift.x + PAD, y: p.y + shift.y + PAD });
  const w = innerW + 2 * PAD;
  const h = innerH + HEAD + 2 * PAD;
  const top = h - PAD - CHIP_H / 2;
  const colour = mostColour(sys.members);
  const lines: Pt[][] = [];
  if (spanA > 1) {
    const x = X(0) + shift.x + PAD;
    if (x > PAD && x < PAD + innerW) lines.push([{ x, y: PAD }, { x, y: PAD + innerH }]);
  }
  if (spanU > 1) {
    const y = Y(0) + shift.y + PAD;
    if (y > PAD && y < PAD + innerH) lines.push([{ x: PAD, y }, { x: PAD + innerW, y }]);
  }
  const circles = dots.map((_, i) => ({ center: at(pos[i]!), radius: r }));
  const texts: MarkerText[] = dots.map((d, i) => ({ at: at(pos[i]!), text: d.label, height: diameter * TEXT_SHARE, justify: "centre" }));
  const channels = dots.length;
  const lights = sys.members.length;
  texts.push({ at: { x: PAD, y: h + TITLE_GAP + TITLE_MM / 2 }, text: sys.name, height: TITLE_MM, justify: "left" });
  if (colour) texts.push({ at: { x: PAD + CHIP_W + 2, y: top }, text: colour, height: 2.8, justify: "left" });
  texts.push({ at: { x: w - PAD, y: top }, text: `${channels} ${channels === 1 ? "channel" : "channels"}, ${lights} ${lights === 1 ? "light" : "lights"}`, height: 2.6, justify: "right" });
  const outline: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const chip = colour
    ? {
        poly: [
          { x: PAD, y: top - CHIP_H / 2 },
          { x: PAD + CHIP_W, y: top - CHIP_H / 2 },
          { x: PAD + CHIP_W, y: top + CHIP_H / 2 },
          { x: PAD, y: top + CHIP_H / 2 },
        ],
        colour: colorOf(colour),
      }
    : null;
  return {
    w,
    h,
    drawing: { outlines: [outline], lines, circles, filled: [], texts },
    chip,
  };
}

/** The sheet of `fixtures` under `frame`: its boxes packed across `pageMm`, centred on the origin. */
export function magicLayout(fixtures: readonly Fixture[], frame: StageFrame, opts: MagicOptions): MagicSheet {
  const channelled = fixtures.filter((f) => f.channel.trim() !== "");
  const unchanneled = fixtures.length - channelled.length;
  const channels = new Set(channelled.map((f) => f.channel.trim())).size;
  const systems = systemsOf(channelled, opts.group);
  const boxes = systems.map((s) => boxOf(s, frame, opts));
  const out: MarkerDrawing = { outlines: [], lines: [], circles: [], filled: [], texts: [] };
  const chips: MagicChip[] = [];
  if (boxes.length === 0) return { drawing: out, chips, systems: 0, channels: 0, unchanneled };

  // the legend across the top, then the boxes in rows, each row's top below the last
  const legend = wrap(LEGEND, Math.max(20, Math.floor(opts.pageMm / (LEGEND_MM * 0.6))));
  let rowTop = -legend.length * LEGEND_LINE - GAP_Y / 2;
  const legendTop = 0;
  let cursor = 0;
  let rowH = 0;
  let right = 0;
  let bottom = rowTop;
  const place = (box: Box, x0: number, y0: number): void => {
    const T = (p: Pt): Pt => ({ x: p.x + x0, y: p.y + y0 });
    out.outlines.push(...box.drawing.outlines.map((poly) => poly.map(T)));
    out.lines.push(...box.drawing.lines.map((line) => line.map(T)));
    out.circles.push(...box.drawing.circles.map((c) => ({ center: T(c.center), radius: c.radius })));
    out.texts.push(...box.drawing.texts.map((t) => ({ ...t, at: T(t.at) })));
    if (box.chip) chips.push({ poly: box.chip.poly.map(T), colour: box.chip.colour });
  };
  for (const box of boxes) {
    if (cursor > 0 && cursor + box.w > opts.pageMm) {
      rowTop -= rowH + GAP_Y;
      cursor = 0;
      rowH = 0;
    }
    const y0 = rowTop - TITLE_BAND - box.h;
    place(box, cursor, y0);
    cursor += box.w + GAP_X;
    right = Math.max(right, cursor - GAP_X);
    rowH = Math.max(rowH, TITLE_BAND + box.h);
    bottom = Math.min(bottom, y0);
  }
  legend.forEach((line, i) => out.texts.push({ at: { x: 0, y: legendTop - LEGEND_LINE * (i + 0.5) }, text: line, height: LEGEND_MM, justify: "left" }));

  // centred on the origin, as a sheet's page is
  const dx = -right / 2;
  const dy = -(bottom + legendTop) / 2;
  const T = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  const drawing: MarkerDrawing = {
    outlines: out.outlines.map((poly) => poly.map(T)),
    lines: out.lines.map((line) => line.map(T)),
    circles: out.circles.map((c) => ({ center: T(c.center), radius: c.radius })),
    filled: [],
    texts: out.texts.map((t) => ({ ...t, at: T(t.at) })),
  };
  return {
    drawing,
    chips: chips.map((c) => ({ poly: c.poly.map(T), colour: c.colour })),
    systems: boxes.length,
    channels,
    unchanneled,
  };
}
