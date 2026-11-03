// What the Railing/Fence tool draws in plan (tools/paths.ts), as plain geometry: the top rail as a
// band along the path, the posts placed as Vectorworks' Post pane places them, and the frame or
// panel between them. Kept apart from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import type { Drawing } from "./detailShapes.ts";
import { dist, offsetPolyline } from "./geom.ts";

export type RailProfile = "round" | "rect" | "octagon";
export type CornerPosts = "none" | "one" | "two";
export type PostArrangement = "approximate" | "fixed" | "number";
export type RailInfill = "none" | "vertical" | "horizontal" | "panel";

export interface Railing {
  /** the railing's line from the drawn path, to its left (negative: to its right) */
  readonly offset: number;
  readonly topRail: boolean;
  /** the top rail's diameter, or a rectangular rail's width: in plan it is a band this wide either way */
  readonly railWidth: number;
  /** the top rail runs from the first post to the last, else the whole path */
  readonly railEndsAtPost: boolean;
  /** Post (true) or No Post */
  readonly posts: boolean;
  /** posts drawn in plan */
  readonly showPosts: boolean;
  readonly postProfile: RailProfile;
  /** a post's diameter (an octagon's across its flats), or a rectangular post's width across the path */
  readonly postWidth: number;
  /** a rectangular post's depth along the path */
  readonly postDepth: number;
  readonly startPost: boolean;
  /** the start post stands this far along the path from its start, the end post this far back from its end */
  readonly startDistance: number;
  readonly endPost: boolean;
  readonly endDistance: number;
  readonly cornerPosts: CornerPosts;
  /** two posts at a corner stand this far before and after it */
  readonly cornerDistance: number;
  readonly arrangement: PostArrangement;
  /** Approximate and Fixed Distance's spacing */
  readonly spacing: number;
  /** Number of Posts' count */
  readonly count: number;
  /** the frame or panel between posts: vertical or horizontal frame bars, a panel, or none */
  readonly infill: RailInfill;
  readonly barProfile: "round" | "rect";
  readonly barSize: number;
  /** the most between frame bars */
  readonly barSpacing: number;
  readonly panelThickness: number;
}

/** What a railing draws, bottom first: the frame or panel, the top rail over it, the posts over that. */
export interface RailingPlan {
  readonly infill: Drawing;
  readonly rail: Drawing;
  readonly posts: Drawing;
  readonly postCount: number;
}

/** most posts and frame bars one railing draws */
export const MAX_POSTS = 1000;
export const MAX_BARS = 5000;

const EPS = 1e-6;
/** points round a round post or bar */
const ROUND_STEPS = 24;

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const unit = (a: Pt, b: Pt): Pt => {
  const l = dist(a, b);
  return l > 0 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : { x: 1, y: 0 };
};

/** The railing's line as a run to walk along: a closed one twice round, so a stretch may pass its start. */
interface Run {
  readonly pts: Pt[];
  readonly cum: number[];
  /** once round, or end to end */
  readonly length: number;
  readonly closed: boolean;
}

function run(line: readonly Pt[], closed: boolean): Run {
  const pts = closed ? [...line, line[0], ...line.slice(1), line[0]] : [...line];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const length = closed ? cum[line.length] : cum[cum.length - 1];
  return { pts, cum, length, closed };
}

/** The point `s` along the run and the way it runs there. */
function pointAt(r: Run, s: number): { p: Pt; u: Pt } {
  let i = 0;
  while (i < r.pts.length - 2 && r.cum[i + 1] < s) i++;
  const a = r.pts[i];
  const b = r.pts[i + 1];
  const u = unit(a, b);
  return { p: add(a, u, s - r.cum[i]), u };
}

/** The stretch of the run from `s0` to `s1`, its corners included. */
function stretch(r: Run, s0: number, s1: number): Pt[] {
  const out = [pointAt(r, s0).p];
  for (let i = 0; i < r.pts.length; i++) if (r.cum[i] > s0 + EPS && r.cum[i] < s1 - EPS) out.push(r.pts[i]);
  out.push(pointAt(r, s1).p);
  return out;
}

/** A band `width` wide centred on an open path, as one outline; null where it folds. */
function band(path: readonly Pt[], width: number): Pt[] | null {
  const left = offsetPolyline(path, false, width / 2);
  const right = offsetPolyline(path, false, -width / 2);
  return left && right ? [...left, ...right.reverse()] : null;
}

/** A post's or bar's outline at `p`, `u` the way the path runs there. */
function section(profile: RailProfile, width: number, depth: number, p: Pt, u: Pt): Pt[] {
  const n = { x: -u.y, y: u.x };
  if (profile === "rect") {
    const a = depth / 2;
    const b = width / 2;
    return [add(add(p, u, -a), n, -b), add(add(p, u, a), n, -b), add(add(p, u, a), n, b), add(add(p, u, -a), n, b)];
  }
  const sides = profile === "octagon" ? 8 : ROUND_STEPS;
  // an octagon's diameter is across its flats, its flats square to the path
  const r = profile === "octagon" ? width / 2 / Math.cos(Math.PI / 8) : width / 2;
  const turn = Math.atan2(u.y, u.x) + (profile === "octagon" ? Math.PI / 8 : 0);
  return Array.from({ length: sides }, (_, k) => {
    const t = turn + (2 * Math.PI * k) / sides;
    return { x: p.x + r * Math.cos(t), y: p.y + r * Math.sin(t) };
  });
}

/** A post's place along the run, and the way it faces (a corner's posts square to the corner's bisector). */
interface Post {
  readonly s: number;
  readonly drawn: boolean;
  readonly u?: Pt;
}

/** Where the drawn posts stand along the run, in order, or why they can't. */
function placePosts(r: Run, corners: readonly { s: number; u: Pt }[], rail: Railing): Post[] | string {
  const { closed, length: L } = r;
  // the fixed posts in order along the run (a closed one from its first corner)
  const fixed: Post[] = [];
  const start = closed ? 0 : rail.startDistance;
  const end = closed ? L : L - rail.endDistance;
  if (!closed && !(end - start > EPS)) return "The start and end posts' distances leave no railing between them: draw a longer path or set shorter distances.";
  if (!closed) fixed.push({ s: start, drawn: rail.startPost });
  const twoAt = rail.cornerPosts === "two";
  if (twoAt && !(rail.cornerDistance > 0)) return "Two posts at a corner need a distance from the corner more than 0.";
  for (const c of corners) {
    if (rail.cornerPosts === "one") fixed.push({ s: c.s, drawn: true, u: c.u });
    else if (twoAt) fixed.push({ s: c.s - rail.cornerDistance, drawn: true }, { s: c.s + rail.cornerDistance, drawn: true });
  }
  if (closed && twoAt) {
    // the first corner's post before it lies at the end of the loop
    const first = fixed.shift()!;
    fixed.push({ ...first, s: first.s + L });
  } else if (closed && rail.cornerPosts === "none") fixed.push({ s: 0, drawn: true });
  if (!closed) fixed.push({ s: end, drawn: rail.endPost });
  for (let i = 1; i < fixed.length; i++) {
    if (!(fixed[i].s - fixed[i - 1].s > EPS)) return "Posts at the corners overlap each other or the start and end posts: set a shorter corner distance.";
  }
  if (!closed && (fixed[0].s < -EPS || fixed[fixed.length - 1].s > L + EPS)) return "Posts at the corners lie past the path's ends: set a shorter corner distance.";

  // the posts between: a closed loop's last stretch runs from its last fixed post round to its first
  const stretches: [number, number][] = [];
  for (let i = 1; i < fixed.length; i++) stretches.push([fixed[i - 1].s, fixed[i].s]);
  if (closed) stretches.push([fixed[fixed.length - 1].s, fixed[0].s + L]);
  const between: Post[] = [];
  if (rail.arrangement === "number") {
    const count = Math.round(rail.count);
    if (!(count >= (closed ? 1 : 2))) return closed ? "Number of Posts must be 1 or more." : "Number of Posts must be 2 or more: the start's and the end's.";
    if (count > MAX_POSTS) return `A railing draws at most ${MAX_POSTS} posts: set fewer.`;
    const steps = closed ? count : count - 1;
    for (let k = closed ? 0 : 1; k < (closed ? count : count - 1); k++) between.push({ s: start + ((end - start) * k) / steps, drawn: true });
  } else {
    if (!(rail.spacing > 0)) return "Set a post spacing more than 0.";
    for (const [s0, s1] of stretches) {
      // two posts either side of a corner have no posts between them
      if (twoAt && corners.some((c) => Math.abs((s0 + s1) / 2 - c.s) < EPS || Math.abs((s0 + s1) / 2 - c.s - L) < EPS)) continue;
      const len = s1 - s0;
      const bays = rail.arrangement === "approximate" ? Math.max(1, Math.round(len / rail.spacing)) : Math.ceil(len / rail.spacing - EPS);
      if (between.length + bays > MAX_POSTS) return `A railing draws at most ${MAX_POSTS} posts: set a wider spacing.`;
      for (let k = 1; k < bays; k++) between.push({ s: s0 + (rail.arrangement === "approximate" ? (len * k) / bays : rail.spacing * k), drawn: true });
    }
  }
  // a closed loop's posts once round; posts in one place drawn once
  const all = [...fixed, ...between].filter((p) => p.drawn).map((p) => (closed ? { ...p, s: p.s % L } : p));
  all.sort((a, b) => a.s - b.s);
  return all.filter((p, i) => i === 0 || p.s - all[i - 1].s > EPS);
}

/**
 * A railing along `path` (closed: round it) in plan, or why it can't be drawn. Posts stand at the
 * start and end (their distances in from the ends), at each corner (one, or two the corner
 * distance either side of it), and between those: Approximate Distance divides each stretch into
 * equal bays near the spacing, Fixed Distance steps the spacing from the stretch's start (its
 * last bay shorter), Number of Posts spreads that many evenly from the start post to the end post
 * (round a closed one). The frame or panel fills each bay between drawn posts.
 */
export function railing(path: readonly Pt[], closed: boolean, rail: Railing): RailingPlan | string {
  const line = offsetPolyline(path, closed, rail.offset);
  if (!line) return "The offset from the path folds the railing back on itself: draw a longer path or set a smaller offset.";
  const r = run(line, closed);
  const n = line.length;
  // the corners, where they lie along the run and the way their bisector runs
  const corners: { s: number; u: Pt }[] = [];
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const prev = line[(i - 1 + n) % n];
    const next = line[(i + 1) % n];
    const a = unit(prev, line[i]);
    const b = unit(line[i], next);
    const bis = { x: a.x + b.x, y: a.y + b.y };
    const l = Math.hypot(bis.x, bis.y);
    corners.push({ s: r.cum[i], u: l > EPS ? { x: bis.x / l, y: bis.y / l } : b });
  }

  const posts = rail.posts ? placePosts(r, corners, rail) : [];
  if (typeof posts === "string") return posts;

  const postsDrawing: Drawing = { outlines: [], lines: [], circles: [] };
  if (rail.posts && rail.showPosts) {
    if (!(rail.postWidth > 0) || (rail.postProfile === "rect" && !(rail.postDepth > 0))) return "Set the posts' size more than 0.";
    for (const post of posts) {
      const at = pointAt(r, post.s);
      const u = post.u ?? at.u;
      if (rail.postProfile === "round") postsDrawing.circles.push({ center: at.p, radius: rail.postWidth / 2 });
      else postsDrawing.outlines.push(section(rail.postProfile, rail.postWidth, rail.postDepth, at.p, u));
    }
  }

  const railDrawing: Drawing = { outlines: [], lines: [], circles: [] };
  if (rail.topRail) {
    if (!(rail.railWidth > 0)) return "Set the top rail's width more than 0.";
    if (closed) {
      // both edges as lines round the loop, so the area inside isn't filled
      for (const side of [1, -1]) {
        const edge = offsetPolyline(line, true, (side * rail.railWidth) / 2);
        if (!edge) return "The top rail is too wide for the path's corners: set a narrower rail.";
        railDrawing.lines.push([...edge, edge[0]]);
      }
    } else {
      const ends = rail.railEndsAtPost && posts.length >= 2 ? [posts[0].s, posts[posts.length - 1].s] : [0, r.length];
      const outline = band(stretch(r, ends[0], ends[1]), rail.railWidth);
      if (!outline) return "The top rail is too wide for the path's corners: set a narrower rail.";
      railDrawing.outlines.push(outline);
    }
  }

  const infill: Drawing = { outlines: [], lines: [], circles: [] };
  if (rail.posts && rail.infill !== "none") {
    const bays: [number, number][] = [];
    for (let i = 1; i < posts.length; i++) bays.push([posts[i - 1].s, posts[i].s]);
    if (closed && posts.length) bays.push([posts[posts.length - 1].s, posts[0].s + r.length]);
    if (rail.infill === "panel" && !(rail.panelThickness > 0)) return "Set the panel's thickness more than 0.";
    if (rail.infill === "vertical" && !(rail.barSize > 0 && rail.barSpacing > 0)) return "Set the frame bars' size and spacing more than 0.";
    let bars = 0;
    for (const [s0, s1] of bays) {
      if (!(s1 - s0 > EPS)) continue;
      if (rail.infill === "panel") {
        const outline = band(stretch(r, s0, s1), rail.panelThickness);
        if (!outline) return "The panel is too thick for the path's corners: set a thinner panel.";
        infill.outlines.push(outline);
      } else if (rail.infill === "horizontal") infill.lines.push(stretch(r, s0, s1));
      else {
        const k = Math.ceil((s1 - s0) / rail.barSpacing - EPS);
        bars += k - 1;
        if (bars > MAX_BARS) return `A railing draws at most ${MAX_BARS} frame bars: set a wider bar spacing.`;
        for (let j = 1; j < k; j++) {
          const at = pointAt(r, s0 + ((s1 - s0) * j) / k);
          if (rail.barProfile === "round") infill.circles.push({ center: at.p, radius: rail.barSize / 2 });
          else infill.outlines.push(section("rect", rail.barSize, rail.barSize, at.p, at.u));
        }
      }
    }
  }
  return { infill, rail: railDrawing, posts: postsDrawing, postCount: rail.posts ? posts.length : 0 };
}
