// What the Scenes palette puts over the drawing, as outlines only (nothing is moved): the pieces flown out
// in the current scene, dashed and labelled Flown where they sit; the scrub from the current scene to the
// next, each piece at its in-between pose, red where it hits another; and the ghosts of the scenes either
// side of the current one, in their colours.

import { registerOverlay } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import type { Painter } from "../../../app/tools.ts";
import type { Pt } from "../../../core/index.ts";
import { currentScene, livePose, sceneData } from "./scenesData.ts";
import { clashesAt, footprint, poseIn, posesAt, type Pose, type Scene, type SceneData } from "./transitions.ts";

/** What the palette shows: how far through the change the scrub is (0 to 1, null for none) and whether the ghosts show. */
export const overlay: { scrub: number | null; ghost: boolean } = { scrub: null, ghost: false };

const RED = "#e5484d";
const FLOWN = "rgba(128, 128, 128, 0.9)";
const LABEL_PX = 11;

function outline(p: Painter, corners: readonly Pt[], colour: string, dash: number[], width: number): void {
  const ctx = p.ctx;
  ctx.beginPath();
  corners.forEach((c, i) => {
    const q = p.toScreen(c);
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  });
  ctx.closePath();
  ctx.setLineDash(dash);
  ctx.lineWidth = width;
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.setLineDash([]);
}

function label(p: Painter, at: Pt, text: string, colour: string): void {
  const q = p.toScreen(at);
  p.ctx.font = `${LABEL_PX}px var(--font, sans-serif)`;
  p.ctx.fillStyle = colour;
  p.ctx.textAlign = "center";
  p.ctx.textBaseline = "middle";
  p.ctx.fillText(text, q.x, q.y);
}

/** The scene after `scene` in the order, if there is one. */
export function nextScene(d: SceneData, scene: Scene): Scene | undefined {
  return d.scenes[d.scenes.indexOf(scene) + 1];
}

/** The pieces that hit each other at fraction `t` of the change from the current scene to the next, by id. */
export function scrubHits(d: SceneData, t: number): Set<string> {
  const current = currentScene(d);
  const next = current && nextScene(d, current);
  const hit = new Set<string>();
  if (!current || !next) return hit;
  for (const c of clashesAt(current, next, d.pieces, t)) {
    hit.add(c.a);
    hit.add(c.b);
  }
  return hit;
}

/** The flown pieces of the current scene, where they sit on the drawing. */
function drawFlown(p: Painter, d: SceneData, current: Scene): void {
  for (const piece of d.pieces) {
    if (!current.poses[piece.id]?.out) continue;
    const now = livePose(piece, d);
    if (!now) continue;
    outline(p, footprint(piece, now), FLOWN, [5, 4], 1.2);
    label(p, now, "Flown", FLOWN);
  }
}

/** The scenes either side of the current one, thin and dashed in their colours. */
function drawGhosts(p: Painter, d: SceneData, current: Scene): void {
  const i = d.scenes.indexOf(current);
  for (const other of [d.scenes[i - 1], d.scenes[i + 1]]) {
    if (!other) continue;
    for (const piece of d.pieces) {
      const pose = other.poses[piece.id];
      if (!pose || pose.out) continue;
      outline(p, footprint(piece, pose), other.color, [2, 3], 1);
    }
  }
}

/** The pieces at the scrub's place between the current scene and the next: red where they hit. */
function drawScrub(p: Painter, d: SceneData, current: Scene, t: number): void {
  const next = nextScene(d, current);
  if (!next) return;
  const at = posesAt(current, next, t);
  const hit = scrubHits(d, t);
  for (const piece of d.pieces) {
    const pose: Pose = at[piece.id] ?? poseIn(current, piece);
    if (pose.out) {
      outline(p, footprint(piece, pose), FLOWN, [5, 4], 1.2);
      label(p, pose, "Flown", FLOWN);
      continue;
    }
    const colour = hit.has(piece.id) ? RED : current.color;
    outline(p, footprint(piece, pose), colour, [], hit.has(piece.id) ? 2 : 1.5);
    label(p, pose, piece.name, colour);
  }
}

function draw(p: Painter): void {
  if (!store.session) return;
  const d = sceneData();
  const current = currentScene(d);
  if (!current || d.pieces.length === 0) return;
  drawFlown(p, d, current);
  if (overlay.ghost) drawGhosts(p, d, current);
  if (overlay.scrub !== null) drawScrub(p, d, current, overlay.scrub);
}

registerOverlay(draw);
