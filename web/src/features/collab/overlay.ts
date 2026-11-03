// The 2D drawing's collaborator marks, drawn over it (ext.registerOverlay): for each collaborator
// in the 2D plan on the active layer, their cursor (an arrow with their name) and an outline of
// what they have selected, dashed, in their colour.

import { appContext } from "../../app/ext.ts";
import type { Painter } from "../../app/tools.ts";
import { store } from "../../app/state.ts";
import type { Peer, Presence } from "../../platform/protocol.ts";
import { collab, type CollabSession } from "./engine.ts";
import { inkFor, peerColor, pillPath } from "./live.ts";

/** the arrow cursor, its tip at the origin, in CSS pixels */
const ARROW: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 15.5],
  [4.1, 11.9],
  [7, 18.2],
  [9.4, 17.1],
  [6.6, 11.3],
  [11.6, 11.3],
];
const NAME_FONT = "600 11px system-ui, sans-serif";
const PILL_H = 18;

export function drawPeers(p: Painter): void {
  const s = collab();
  if (!s) return;
  for (const peer of s.peers()) {
    const pr = s.presence(peer.clientId);
    if (!pr || pr.mode !== "2d" || pr.layerId !== store.activeLayerId) continue;
    outline(p, peer, pr);
    if (pr.cursor) cursor(p, peer, pr.cursor);
  }
}

function outline(p: Painter, peer: Peer, pr: Presence): void {
  const doc = store.session?.doc;
  const scene = appContext()?.scene;
  if (!doc || !scene || pr.selection.length === 0) return;
  const { ctx } = p;
  ctx.save();
  ctx.strokeStyle = peerColor(peer.color);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  for (const id of pr.selection) {
    const obj = doc.object(id);
    const b = obj ? scene.geometry(obj)?.bbox : null;
    if (!b) continue;
    const a = p.toScreen({ x: b.x0, y: b.y0 });
    const c = p.toScreen({ x: b.x1, y: b.y1 });
    ctx.strokeRect(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(c.x - a.x), Math.abs(c.y - a.y));
  }
  ctx.restore();
}

function cursor(p: Painter, peer: Peer, at: { x: number; y: number }): void {
  const { ctx } = p;
  const colour = peerColor(peer.color);
  const tip = p.toScreen(at);
  ctx.save();
  ctx.setLineDash([]);
  ctx.translate(tip.x, tip.y);
  ctx.beginPath();
  ARROW.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.font = NAME_FONT;
  const x = 12;
  const y = 14;
  const w = ctx.measureText(peer.name).width + 12;
  pillPath(ctx, x, y, w, PILL_H, PILL_H / 2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.fillStyle = inkFor(peer.color);
  ctx.textBaseline = "middle";
  ctx.fillText(peer.name, x + 6, y + PILL_H / 2 + 0.5);
  ctx.restore();
}

/** Redraws the drawing as collaborators move, for as long as the session lasts. */
export function attachOverlay(s: CollabSession): () => void {
  return s.onPeers(() => appContext()?.requestDraw());
}
