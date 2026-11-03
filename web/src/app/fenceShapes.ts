// What Site Planning's Fence tool draws in plan (tools/fence.ts), as plain geometry: the fence's
// line, or its posts, rails, infill, gravel board and the footers hidden below grade, placed as
// Vectorworks' Fence settings place them. Kept apart from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import type { Drawing } from "./detailShapes.ts";
import { degToRad, dist, offsetPolyline } from "./geom.ts";

/** Draw 2D: a simple line, a line with square or round posts, or full detail */
export type FenceDraw = "line" | "squarePosts" | "roundPosts" | "full";
export type FenceSide = "left" | "right";
/** how a corner post lines up: with the segment before it, the one after it, or between the two */
export type CornerAlign = "previous" | "next" | "bisect";
export type PostSpacing = "fixed" | "equal";
export type PostShape = "square" | "round";
/** Rail Offset to Post */
export type RailOffset = "centre" | "front" | "rear" | "onFront" | "custom";
export type FenceInfill = "rails" | "panel" | "vertical" | "horizontal";
export type FooterShape = "none" | "square" | "round";

export interface Fence {
  readonly draw: FenceDraw;
  /** the fence's line from the drawn path, to its right (negative: to its left) */
  readonly offset: number;
  /** the side of the drawn path that is the fence's front: infill goes on that side of the rails */
  readonly face: FenceSide;
  readonly startPost: boolean;
  readonly endPost: boolean;
  readonly cornerAlign: CornerAlign;
  /** Fixed Distance steps the distance from each segment's start; Equal Spacing divides it into bays near it */
  readonly spacing: PostSpacing;
  readonly distance: number;
  readonly postShape: PostShape;
  /** a post's size along the fence (a round post's diameter) */
  readonly postWidth: number;
  /** a square post's size from the fence's front to its back */
  readonly postDepth: number;
  readonly footer: FooterShape;
  /** a square footer's width and depth, or a round one's diameter (its width) */
  readonly footerWidth: number;
  readonly footerDepth: number;
  /** the drainage layer round the footer; 0 for none */
  readonly drainage: number;
  /** rails one over another all fall in one place in plan; 0 draws none */
  readonly rails: number;
  /** a rail's width from the fence's front to its back */
  readonly railWidth: number;
  /** one rail along the whole fence, not broken at the posts */
  readonly continuousRail: boolean;
  readonly railOffset: RailOffset;
  /** Custom Offset from Center, toward the front */
  readonly railCustom: number;
  /** the rails' offset changes side from one bay to the next */
  readonly switchSides: boolean;
  /** how far the rails run past the far side of each post; 0 stops them at the posts */
  readonly railExtend: number;
  readonly infill: FenceInfill;
  /** the infill runs along the whole fence, not broken at the posts */
  readonly continuousInfill: boolean;
  /** the infill's offset from where it sits, toward the front (negative: toward the back) */
  readonly infillOffset: number;
  /** a board's width, or a panel's (which spaces the posts) */
  readonly infillWidth: number;
  readonly infillThickness: number;
  /** vertical boards' spacing, centre to centre */
  readonly infillSpacing: number;
  /** vertical boards turned diagonally by this many degrees */
  readonly diagonal: number;
  readonly gravelBoard: boolean;
  readonly gravelThickness: number;
}

/** What a fence draws, bottom first; `hidden` lies below grade (dashed). */
export interface FencePlan {
  readonly hidden: Drawing;
  readonly infill: Drawing;
  readonly rails: Drawing;
  readonly posts: Drawing;
  readonly line: Pt[][];
  readonly postCount: number;
}

/** most posts and infill boards one fence draws */
export const MAX_FENCE_POSTS = 2000;
export const MAX_FENCE_BOARDS = 10000;

const EPS = 1e-6;

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });

/** A rectangle `along` long and `across` wide centred on `p`, its length along `u`. */
function box(p: Pt, u: Pt, along: number, across: number): Pt[] {
  const n = { x: -u.y, y: u.x };
  const a = along / 2;
  const b = across / 2;
  return [add(add(p, u, -a), n, -b), add(add(p, u, a), n, -b), add(add(p, u, a), n, b), add(add(p, u, -a), n, b)];
}

/** One straight segment of the fence's line, its front's side. */
interface Segment {
  readonly a: Pt;
  readonly len: number;
  readonly u: Pt;
  /** toward the front */
  readonly f: Pt;
}

/** A post: where it stands, the way it faces and whether it ends a bay (a missing end post doesn't stand). */
interface Post {
  readonly s: number;
  readonly u: Pt;
  readonly stands: boolean;
}

/** Why the fence can't be drawn as set, or null. */
export function fenceProblem(f: Fence): string | null {
  if (!(f.distance > 0)) return "Set a post spacing more than 0.";
  if (!(f.postWidth > 0) || (f.postShape === "square" && !(f.postDepth > 0))) return "Set the posts' size more than 0.";
  if (f.draw !== "full") return null;
  if (f.footer !== "none" && (!(f.footerWidth > 0) || (f.footer === "square" && !(f.footerDepth > 0)))) return "Set the footer's size more than 0.";
  if (!(f.drainage >= 0)) return "Set a drainage layer of 0 or more.";
  if (f.rails > 0 && !(f.railWidth > 0)) return "Set the rails' width more than 0.";
  if (!(f.railExtend >= 0)) return "Set how far the rails run past the posts to 0 or more.";
  if (f.infill !== "rails" && !(f.infillWidth > 0 && f.infillThickness > 0)) return "Set the infill's width and thickness more than 0.";
  if (f.infill === "vertical" && !(f.infillSpacing > 0)) return "Set the boards' spacing more than 0.";
  if (f.gravelBoard && !(f.gravelThickness > 0)) return "Set the gravel board's thickness more than 0.";
  return null;
}

/**
 * A fence along `path` (closed: round it) in plan, or why it can't be drawn. The fence's line lies
 * the offset to the path's right. Each segment has a post at both ends (the fence's start and end
 * only when set) and posts between: Fixed Distance steps the spacing from the segment's start, its
 * last bay shorter, Equal Spacing divides it into bays near the spacing; a panel spaces them its
 * width apart between faces. Rails, infill and the gravel board fill each bay between posts (or
 * run the whole fence when continuous); footers and their drainage lie hidden under the posts.
 */
export function fence(path: readonly Pt[], closed: boolean, f: Fence): FencePlan | string {
  const problem = fenceProblem(f);
  if (problem) return problem;
  const line = offsetPolyline(path, closed, -f.offset);
  if (!line || line.length < 2) return "The offset from the path folds the fence back on itself: draw a longer path or set a smaller offset.";
  const n = line.length;
  const segs: Segment[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = line[i];
    const b = line[(i + 1) % n];
    const len = dist(a, b);
    if (!(len > EPS)) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    segs.push({ a, len, u, f: f.face === "left" ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x } });
  }
  if (segs.length === 0) return "Draw a fence longer than 0.";
  const empty = (): Drawing => ({ outlines: [], lines: [], circles: [] });
  const plan = { hidden: empty(), infill: empty(), rails: empty(), posts: empty(), line: [] as Pt[][], postCount: 0 };
  if (f.draw === "line") {
    plan.line.push(closed ? [...line, line[0]] : [...line]);
    return plan;
  }

  // a post's size along and across the fence
  const along = f.postWidth;
  const across = f.postShape === "round" ? f.postWidth : f.postDepth;
  const panel = f.draw === "full" && f.infill === "panel";
  const step = panel ? f.infillWidth + along : f.distance;
  const corner = (i: number): Pt => {
    const prev = segs[(i - 1 + segs.length) % segs.length].u;
    const next = segs[i % segs.length].u;
    if (f.cornerAlign === "previous") return prev;
    if (f.cornerAlign === "next") return next;
    const bis = { x: prev.x + next.x, y: prev.y + next.y };
    const l = Math.hypot(bis.x, bis.y);
    return l > EPS ? { x: bis.x / l, y: bis.y / l } : next;
  };
  // each segment's posts, its first and last at its ends
  const posts: Post[][] = [];
  let count = 0;
  for (const [i, sg] of segs.entries()) {
    const first = i === 0 && !closed;
    const last = i === segs.length - 1 && !closed;
    const row: Post[] = [{ s: 0, u: first ? sg.u : corner(i), stands: first ? f.startPost : true }];
    const bays = panel || f.spacing === "fixed" ? Math.ceil(sg.len / step - EPS) : Math.max(1, Math.round(sg.len / step));
    count += bays;
    if (count > MAX_FENCE_POSTS) return `A fence draws at most ${MAX_FENCE_POSTS} posts: set a wider spacing or draw a shorter fence.`;
    for (let k = 1; k < bays; k++) row.push({ s: panel || f.spacing === "fixed" ? step * k : (sg.len * k) / bays, u: sg.u, stands: true });
    row.push({ s: sg.len, u: last ? sg.u : corner(i + 1), stands: last ? f.endPost : true });
    posts.push(row);
  }

  // posts: each corner once (the next segment's first)
  for (const [i, row] of posts.entries()) {
    for (const [k, p] of row.entries()) {
      if (!p.stands || (k === row.length - 1 && (closed || i < segs.length - 1))) continue;
      const at = add(segs[i].a, segs[i].u, p.s);
      plan.postCount++;
      const round = f.draw === "roundPosts" || (f.draw === "full" && f.postShape === "round");
      if (round) plan.posts.circles.push({ center: at, radius: f.postWidth / 2 });
      else plan.posts.outlines.push(box(at, p.u, along, f.draw === "squarePosts" ? along : across));
      if (f.draw !== "full" || f.footer === "none") continue;
      for (const grow of f.drainage > 0 ? [0, f.drainage] : [0]) {
        if (f.footer === "round") plan.hidden.circles.push({ center: at, radius: f.footerWidth / 2 + grow });
        else plan.hidden.outlines.push(box(at, p.u, f.footerWidth + 2 * grow, f.footerDepth + 2 * grow));
      }
    }
  }
  if (f.draw !== "full") {
    plan.line.push(closed ? [...line, line[0]] : [...line]);
    return plan;
  }

  // the rails' centre toward the front of the posts' centre
  const railAt =
    f.railOffset === "front" ? across / 2 - f.railWidth / 2 : f.railOffset === "rear" ? f.railWidth / 2 - across / 2 : f.railOffset === "onFront" ? across / 2 + f.railWidth / 2 : f.railOffset === "custom" ? f.railCustom : 0;
  // what a bay's rail reaches past a post's centre: to its near face, or through it to the rail's extension
  const reach = f.railOffset === "onFront" ? 0 : along / 2;
  const band = (sg: Segment, s0: number, s1: number, c: number, width: number): Pt[] => box(add(add(sg.a, sg.u, (s0 + s1) / 2), sg.f, c), sg.u, s1 - s0, width);
  /** A band `width` wide along the whole fence, `c` toward the front of its line; null where it folds. */
  const whole = (c: number, width: number): Drawing | null => {
    // the front's side relative to the way the line runs
    const left = (f.face === "left" ? 1 : -1) * c;
    const near = offsetPolyline(line, closed, left - width / 2);
    const far = offsetPolyline(line, closed, left + width / 2);
    if (!near || !far) return null;
    if (closed) return { outlines: [], lines: [[...near, near[0]], [...far, far[0]]], circles: [] };
    return { outlines: [[...near, ...far.reverse()]], lines: [], circles: [] };
  };
  // the bays between standing posts: each segment's stretches, a bay's ends at posts or not
  const bays: { sg: Segment; s0: number; s1: number; post0: boolean; post1: boolean }[] = [];
  for (const [i, row] of posts.entries()) {
    for (let k = 1; k < row.length; k++) bays.push({ sg: segs[i], s0: row[k - 1].s, s1: row[k].s, post0: row[k - 1].stands, post1: row[k].stands });
  }

  if (f.rails > 0) {
    if (f.continuousRail) {
      const d = whole(railAt, f.railWidth);
      if (!d) return "The rails are too wide for the fence's corners: set narrower rails.";
      plan.rails.outlines.push(...d.outlines);
      plan.rails.lines.push(...d.lines);
    } else {
      for (const [j, b] of bays.entries()) {
        const c = f.switchSides && j % 2 === 1 ? -railAt : railAt;
        const ext = f.railExtend > 0;
        const s0 = b.s0 + (b.post0 ? (ext ? -reach - f.railExtend : reach) : 0);
        const s1 = b.s1 - (b.post1 ? (ext ? -reach - f.railExtend : reach) : 0);
        if (s1 - s0 > EPS) plan.rails.outlines.push(band(b.sg, s0, s1, c, f.railWidth));
      }
    }
  }

  // the infill on the rails' front (centred on the posts for a panel), between the posts' faces
  const railFront = f.rails > 0 ? railAt + f.railWidth / 2 : across / 2;
  const infillAt = (f.infill === "panel" ? 0 : railFront + f.infillThickness / 2) + f.infillOffset;
  const stretches = f.continuousInfill && f.infill !== "panel" ? segs.map((sg) => ({ sg, s0: 0, s1: sg.len })) : bays.map((b) => ({ sg: b.sg, s0: b.s0 + (b.post0 ? along / 2 : 0), s1: b.s1 - (b.post1 ? along / 2 : 0) }));
  if (f.infill === "horizontal" && f.continuousInfill) {
    const d = whole(infillAt, f.infillThickness);
    if (!d) return "The infill is too thick for the fence's corners: set thinner boards.";
    plan.infill.outlines.push(...d.outlines);
    plan.infill.lines.push(...d.lines);
  } else if (f.infill === "horizontal" || f.infill === "panel") {
    for (const s of stretches) if (s.s1 - s.s0 > EPS) plan.infill.outlines.push(band(s.sg, s.s0, s.s1, infillAt, f.infillThickness));
  } else if (f.infill === "vertical") {
    const turn = degToRad(f.diagonal);
    let boards = 0;
    for (const s of stretches) {
      const len = s.s1 - s.s0;
      if (!(len > EPS)) continue;
      const k = Math.max(1, Math.round(len / f.infillSpacing));
      boards += k;
      if (boards > MAX_FENCE_BOARDS) return `A fence draws at most ${MAX_FENCE_BOARDS} boards: set a wider board spacing.`;
      const u = { x: s.sg.u.x * Math.cos(turn) - s.sg.u.y * Math.sin(turn), y: s.sg.u.x * Math.sin(turn) + s.sg.u.y * Math.cos(turn) };
      for (let j = 0; j < k; j++) plan.infill.outlines.push(box(add(add(s.sg.a, s.sg.u, s.s0 + (len * (j + 0.5)) / k), s.sg.f, infillAt), u, f.infillWidth, f.infillThickness));
    }
  }
  if (f.gravelBoard) {
    for (const b of bays) {
      const s0 = b.s0 + (b.post0 ? along / 2 : 0);
      const s1 = b.s1 - (b.post1 ? along / 2 : 0);
      if (s1 - s0 > EPS) plan.infill.outlines.push(band(b.sg, s0, s1, 0, f.gravelThickness));
    }
  }
  return plan;
}
