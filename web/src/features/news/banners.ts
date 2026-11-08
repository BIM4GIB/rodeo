// The small line drawings that head the news (news.ts's card, panel.ts's list): one for each
// release, named by its `art` in releases.ts, and a megaphone for an announcement an admin
// posted. Inline SVG in the theme's colours (classes in news.css): lines in the secondary text
// colour, the part that matters in the accent, on a strip of drawing grid. Each is drawn in a
// 120 x 48 box, centred on the strip.

import { h } from "../../app/dom.ts";

type Pt = readonly [number, number];

const round = (n: number): number => Math.round(n * 10) / 10;
const pts = (...list: Pt[]): string => list.map(([x, y], i) => `${i ? "L" : "M"}${round(x)} ${round(y)}`).join("");

// the pens: ink lines, accent lines, accent lines over a light accent fill, accent dashes, ink
// dashes, and shapes filled in ink or accent
const pen = (cls: string) => (d: string): string => `<path class="${cls}" d="${d}"/>`;
const ink = pen("nb-ink");
const acc = pen("nb-acc");
const tint = pen("nb-tint");
const dash = pen("nb-dash");
const inkDash = pen("nb-ink-dash");
const fill = pen("nb-fill");
const afill = pen("nb-afill");

function ellipse(x: number, y: number, rx: number, ry = rx): string {
  return `M${round(x - rx)} ${round(y)}a${rx} ${ry} 0 1 0 ${round(2 * rx)} 0a${rx} ${ry} 0 1 0 ${round(-2 * rx)} 0z`;
}

function rect(x: number, y: number, w: number, hgt: number, r = 0): string {
  if (!r) return `M${x} ${y}h${w}v${hgt}h${-w}z`;
  const [iw, ih] = [round(w - 2 * r), round(hgt - 2 * r)];
  return `M${round(x + r)} ${y}h${iw}a${r} ${r} 0 0 1 ${r} ${r}v${ih}a${r} ${r} 0 0 1 ${-r} ${r}h${-iw}a${r} ${r} 0 0 1 ${-r} ${-r}v${-ih}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

/** An isometric projection from (ox, oy): world x runs down-right, y down-left, z up. */
function iso(ox: number, oy: number): (x: number, y: number, z?: number) => Pt {
  return (x, y, z = 0) => [ox + (x - y) * 0.866, oy + (x + y) * 0.5 - z];
}

/** A box's outline and the three edges of its corner nearest the viewer. */
function box(p: ReturnType<typeof iso>, w: number, d: number, hgt: number): string {
  const c = p(w, d, hgt);
  return pts(p(0, 0, hgt), p(w, 0, hgt), p(w, 0), p(w, d), p(0, d), p(0, d, hgt)) + "Z" + pts(c, p(w, 0, hgt)) + pts(c, p(0, d, hgt)) + pts(c, p(w, d));
}

function boxTop(p: ReturnType<typeof iso>, w: number, d: number, hgt: number): string {
  return pts(p(0, 0, hgt), p(w, 0, hgt), p(w, d, hgt), p(0, d, hgt)) + "Z";
}

/** A spur gear: `teeth` square teeth `depth` deep, turned by `turn` of a tooth. */
function gear(cx: number, cy: number, r: number, teeth: number, depth: number, turn = 0): string {
  const n = teeth * 4;
  const list: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + turn * 4) / n) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : r - depth;
    list.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return pts(...list) + "Z";
}

/** A revision cloud round a rectangle, its scallops about `step` apart. */
function revCloud(x: number, y: number, w: number, hgt: number, step: number): string {
  const [nx, ny] = [Math.max(1, Math.round(w / step)), Math.max(1, Math.round(hgt / step))];
  const [ax, ay] = [round(w / nx), round(hgt / ny)];
  const r = round(Math.max(ax, ay) * 0.6);
  const arc = (dx: number, dy: number, k: number): string => `a${r} ${r} 0 0 1 ${dx} ${dy}`.repeat(k);
  return `M${x} ${y}` + arc(ax, 0, nx) + arc(0, ay, ny) + arc(-ax, 0, nx) + arc(0, -ay, ny) + "z";
}

/** A pointer with its tip at (x, y). */
function cursor(x: number, y: number): string {
  const tip: Pt[] = [[0, 0], [0, 11.5], [3.2, 8.6], [5.4, 13.4], [7.4, 12.5], [5.3, 7.8], [9.6, 7.8]];
  return pts(...tip.map(([dx, dy]): Pt => [x + dx, y + dy])) + "Z";
}

/** A four-pointed sparkle of radius r. */
function sparkle(x: number, y: number, r: number): string {
  const k = round(r * 0.1);
  const q = round(r * 0.9);
  return `M${x} ${y - r}c${k} ${round(r * 0.6)} ${round(r * 0.4)} ${q} ${r} ${r}c${-round(r * 0.6)} ${k} ${-q} ${round(r * 0.4)} ${-r} ${r}c${-k} ${-round(r * 0.6)} ${-round(r * 0.4)} ${-q} ${-r} ${-r}c${round(r * 0.6)} ${-k} ${q} ${-round(r * 0.4)} ${r} ${-r}z`;
}

// a gauge's ticks from 180 to 360 degrees, every 30
const gaugeTicks = [180, 210, 240, 270, 300, 330, 360]
  .map((deg) => {
    const a = (deg * Math.PI) / 180;
    return pts([60 + 17 * Math.cos(a), 34 + 17 * Math.sin(a)], [60 + 20 * Math.cos(a), 34 + 20 * Math.sin(a)]);
  })
  .join("");

const hex = pts(...[0, 1, 2, 3, 4, 5].map((i): Pt => [38 + 11 * Math.cos((i * Math.PI) / 3), 24 + 11 * Math.sin((i * Math.PI) / 3)])) + "Z";

const house = ((): string => {
  const p = iso(82, 28);
  const [w, d, hgt, r] = [14, 10, 8, 6];
  const front = pts(p(0, d), p(w, d), p(w, d, hgt), p(0, d, hgt)) + "Z";
  const side = pts(p(w, 0), p(w, d), p(w, d, hgt), p(w, 0, hgt)) + "Z";
  const gable = pts(p(w, 0, hgt), p(w, d, hgt), p(w, d / 2, hgt + r)) + "Z";
  const roof = pts(p(0, d, hgt), p(w, d, hgt), p(w, d / 2, hgt + r), p(0, d / 2, hgt + r)) + "Z";
  return acc(front + side + gable) + tint(roof);
})();

const ART = {
  // a drawing's file opened in a browser window
  browser:
    ink("M26 12h12l6 6v22H26zM38 12v6h6M30 27h9M30 32h9M49 26h8M54 23l3 3-3 3" + rect(62, 9, 36, 32, 2.5) + "M62 15h36") +
    fill(ellipse(65.5, 12, 0.9) + ellipse(68.5, 12, 0.9) + ellipse(71.5, 12, 0.9)) +
    acc("M68 20h24v15H68zM80 20v7M68 28h7"),
  // a rectangle, a selected circle with its handles and a polyline
  shapes:
    ink(rect(22, 15, 22, 18) + "M78 33l6-12 7 7 7-13") +
    acc(ellipse(60, 24, 10)) +
    afill(rect(48.8, 22.8, 2.4, 2.4) + rect(68.8, 22.8, 2.4, 2.4) + rect(58.8, 12.8, 2.4, 2.4) + rect(58.8, 32.8, 2.4, 2.4)),
  // a sheet with its title block and a viewport onto a 3D view
  sheet: ink(rect(26, 7, 68, 34, 1.5) + "M78 41v-8h16") + inkDash(rect(32, 12, 40, 24)) + tint(boxTop(iso(52, 24), 7, 7, 7)) + acc(box(iso(52, 24), 7, 7, 7)),
  // the editor's frame: tool bar, drawing and palettes
  workspace:
    ink(rect(22, 8, 76, 32, 2.5) + "M22 14h76M31 14v26M84 14v26M87.5 19h7M87.5 24h5M87.5 29h6") +
    fill(ellipse(26.5, 19, 1) + ellipse(26.5, 24, 1) + ellipse(26.5, 29, 1)) +
    acc("M44 20h27v14H44zM57 20v6"),
  // two lines snapped end to end, with the snap's mark and its alignment guide
  snap: ink("M24 38L58 16L96 30") + dash("M58 22V44") + acc(rect(55, 13, 6, 6)),
  // a shared plan with two people's pointers and name tags
  cursors:
    ink("M24 12h44v24H24zM46 12v10") +
    afill(cursor(58, 21) + rect(66, 32.5, 16, 6, 2)) +
    fill(cursor(80, 9) + rect(88, 20.5, 12, 6, 2)),
  // a record format's fields
  records: tint(rect(36, 9, 48, 6)) + ink(rect(36, 9, 48, 30, 2) + "M36 21h48M36 27h48M36 33h48M52 15v24"),
  // a lasso's loop and its rope
  lasso: `<g transform="rotate(-10 54 19)">${acc(ellipse(54, 19, 22, 9))}</g>` + ink("M72 23.5c3 7 11 13 26 16") + fill(ellipse(72, 22.5, 1.6)),
  // a box and a cylinder
  solids: ink(box(iso(44, 22), 12, 12, 12)) + tint(ellipse(76, 15, 8, 4)) + acc("M68 15v15M84 15v15M68 30a8 4 0 0 0 16 0"),
  // a camera, its view and the ball in it
  camera: ink(rect(26, 18, 18, 12, 2) + "M44 21l7-3v12l-7-3" + ellipse(31, 14, 3) + ellipse(39, 14, 3)) + dash("M51 18L92 9M51 30L92 39") + tint(ellipse(80, 24, 6)),
  // a room's walls in plan and a dimension along them
  walls: ink("M26 12h68v22H26zM29.5 15.5h61v15h-61zM60 15.5v15") + acc("M26 41h68M24.5 42.5l3-3M92.5 42.5l3-3M26 37v7M94 37v7"),
  // the sun, a shaded ball and its shadow
  sphere:
    acc(ellipse(36, 12, 3.5) + "M36 5v2M36 17v2M29 12h2M41 12h2M31 7l1.4 1.4M39.6 15.6l1.4 1.4M31 17l1.4-1.4M39.6 8.4l1.4-1.4") +
    ink(ellipse(70, 22, 12)) +
    acc("M62.5 17a9 9 0 0 1 6-5") +
    tint(ellipse(75, 39, 12, 2.5)),
  // a phone with a plan on it, and a new blank sheet
  phone: ink(rect(35, 5, 22, 38, 4) + "M43 8.5h6" + rect(69, 13, 18, 22, 1.5)) + acc("M40 16h12v16H40zM46 16v7M78 19v10M73 24h10"),
  // a chat bubble and sparkles
  agent:
    ink("M27 10h38a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H41l-7 6v-6h-7a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4zM30 18h30M30 24h20") +
    tint(sparkle(83, 20, 11)) +
    afill(sparkle(94, 34, 4)),
  // a gauge turned up near the top
  speed: ink("M38 34A22 22 0 0 1 71 14.9" + gaugeTicks) + acc("M71 14.9A22 22 0 0 1 82 34M60 34L73.8 22.4") + afill(ellipse(60, 34, 2)),
  // a cloud with a render in it, sent down as a picture
  cloud:
    ink("M27 34h37a8 8 0 0 0 0-16a12 12 0 0 0-23-3a9 9 0 0 0-14 7a6 6 0 0 0 0 12z" + "M76 26h5M79 24l2 2-2 2" + rect(84, 19, 16, 13, 1.5)) +
    tint(ellipse(45, 25, 5)) +
    acc("M84 31l4-5 3 3 2-2 7 5"),
  // document tabs over a window split into panes
  panes:
    tint(rect(26, 7, 18, 7, 1.5)) +
    ink(rect(46, 7, 18, 7, 1.5) + rect(24, 14, 72, 28, 2) + "M60 14v28M60 28h36M66 33h24M66 37h16" + box(iso(78, 21), 4, 4, 4)) +
    acc("M31 20h22v16H31zM42 20v8"),
  // a white model sent off and painted as a picture, with sparkles
  paint:
    ink(box(iso(34, 22), 9, 9, 9) + "M52 26h7M57 24l2 2-2 2" + rect(64, 10, 34, 28, 1.5)) +
    tint("M64 38l10-11 7 6 5-4 12 9z") +
    acc("M64 38l10-11 7 6 5-4 12 9" + ellipse(90, 18, 3)) +
    afill(sparkle(100, 8, 4.5)),
  // a tree in plan and a north arrow
  site: ink(ellipse(40, 24, 12) + "M40 14v20M30 24h20M33 17l14 14M47 17L33 31") + acc(ellipse(80, 24, 9)) + afill("M80 13.5l4.5 15-4.5-3-4.5 3z"),
  // a door swinging in a wall, and a window
  door: ink("M22 28h24v5H22zM66 28h32v5H66zM78 28v5M90 28v5M78 30.5h12") + acc("M66 28V8h2v20") + dash("M46 28A20 20 0 0 1 66 8"),
  // a building cut by a section line, with a marker at each end
  section: ink(rect(34, 12, 52, 24) + "M60 12v24") + dash("M27 24h66") + acc(ellipse(22, 24, 4) + ellipse(98, 24, 4)) + afill("M18 24a4 4 0 0 1 8 0zM94 24a4 4 0 0 1 8 0z"),
  // the view cube and a screen tip
  viewcube: tint(boxTop(iso(42, 24), 11, 11, 11)) + ink(box(iso(42, 24), 11, 11, 11) + rect(64, 9, 28, 11, 2.5) + "M68 14.5h20M68 20l-3 4 6-4"),
  // shapes inside a selection marquee, dragged by the pointer
  marquee: ink(ellipse(47, 21, 7) + rect(59, 14, 14, 13)) + dash(rect(34, 8, 46, 26)) + afill(cursor(80, 34)),
  // a ball, its reflection in the floor and a glowing light
  reflection: ink("M24 33h72" + ellipse(52, 22, 10)) + dash("M42 33a10 10 0 0 0 20 0" + ellipse(80, 18, 7)) + afill(ellipse(80, 18, 3)),
  // a script's window with a prompt
  code: ink(rect(30, 8, 60, 32, 3) + "M30 15h60M37 34h30M71 34h10") + fill(ellipse(34, 11.5, 0.9) + ellipse(37.5, 11.5, 0.9) + ellipse(41, 11.5, 0.9)) + acc("M37 20l4 3.5-4 3.5M45 27h8"),
  // a picture exported, and a file checked
  filecheck:
    ink(rect(28, 16, 16, 13, 1.5) + "M28 29l5-6 4 4 2-2 5 4M48 22h6M52 20l2 2-2 2M60 8h17l7 7v25H60zM77 8v7h7M64 20h14M64 25h14M64 30h9") +
    fill(ellipse(39, 20, 1.3)) +
    tint(ellipse(84, 35, 6.5)) +
    acc("M80.5 35.3l2.5 2.5 4.6-5"),
  // a desk and its chair, and shelving, in plan
  furniture: ink(rect(31, 10, 36, 14, 1) + rect(77, 8, 12, 32) + "M77 16h12M77 24h12M77 32h12") + tint(rect(43, 27, 12, 10, 2.5)) + acc("M42 38.5h14"),
  // a plug on its cable
  plug: tint("M50 18h20v8a10 10 0 0 1-20 0z") + acc("M55 10v8M65 10v8M60 36v2c0 4 6 5 12 3") + ink("M76 12l3-3M78 18h4M44 12l-3-3M42 18h-4"),
  // two gears in mesh
  gears: acc(gear(50, 24, 14, 12, 3) + ellipse(50, 24, 4)) + ink(gear(70, 24, 9, 8, 2.6, 0.5) + ellipse(70, 24, 2.5)),
  // a hex nut, and a bolt with its thread
  fasteners: ink(hex + "M64 19h30v10H64M70 19l-2 10M75 19l-2 10M80 19l-2 10M85 19l-2 10M90 19l-2 10") + acc(ellipse(38, 24, 5)) + tint(rect(56, 15, 8, 18, 1)),
  // a plan, and the house built from it
  plan3d: ink(rect(24, 13, 26, 20) + "M37 13v9M55 24h8M60 21l3 3-3 3") + house,
  // structural grid lines with bubbles, and a revision cloud with its tag
  grid: inkDash("M34 15v29M58 15v29M22 34h52") + ink(ellipse(34, 9, 5) + ellipse(58, 9, 5)) + acc(revCloud(70, 13, 24, 16, 5.5)) + afill("M98 36l4 7h-8z"),
  // a globe, and a speech bubble saying "A" and "文"
  language:
    ink(ellipse(44, 24, 14) + ellipse(44, 24, 6, 14) + "M30 24h28M32 17h24M32 31h24") +
    tint(rect(66, 9, 32, 19, 4)) +
    acc(rect(66, 9, 32, 19, 4) + "M74 28l-3 7 9-7") +
    ink("M71 23.5l3.8-9.5 3.8 9.5M72.5 20h4.6M84 14.5h9M88.5 12v2.5M85.5 16.5c1.8 3.6 4 5.6 7 7M91.5 16.5c-1.5 3.6-3.5 5.6-6.5 7"),
  // a megaphone, for announcements
  announce: ink("M38 20h8l16-9v26l-16-9h-8zM42 28l2 8h4l-1-8") + acc("M68 18a8 8 0 0 1 0 12M73 14a14 14 0 0 1 0 20"),
};

export type Art = keyof typeof ART;

/** The strip for an item: its release's drawing, or the megaphone. */
export function banner(art: Art | undefined): HTMLElement {
  const body = art !== undefined && Object.hasOwn(ART, art) ? ART[art] : ART.announce;
  return h("div", { cls: "news-banner", attrs: { "aria-hidden": "true" }, html: `<svg viewBox="0 0 120 48">${body}</svg>` });
}
