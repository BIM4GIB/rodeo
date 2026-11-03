// Stage > Lighting > Show Beam Pools: each focused instrument's beam (the half-peak pool) and field (the
// tenth-peak pool) on its focus plane, in its gel's colour and multiplied onto the paper so the drawing
// still shows through, the field's edge dashed and a thin line from its hanging point to its hot spot.
// Off, Selected or All. Pools are drawn from the instruments each time, so nothing goes stale; a channel
// at level 0 draws nothing.

import { appContext, registerOverlay } from "../../../app/ext.ts";
import type { Row } from "../../../app/menu.ts";
import { store } from "../../../app/state.ts";
import type { Painter } from "../../../app/tools.ts";
import type { Pt } from "../../../core/index.ts";
import { colorOf } from "../gels.ts";
import { fixtures } from "../instrument.ts";
import { levelOf } from "../levels.ts";
import { poolOutline } from "./photometry.ts";

export type PoolMode = "off" | "selected" | "all";

const MODES: readonly { readonly id: PoolMode; readonly label: string }[] = [
  { id: "off", label: "Off" },
  { id: "selected", label: "Selected" },
  { id: "all", label: "All" },
];

/** how much of the paper each pool covers at full level */
const BEAM_ALPHA = 0.45;
const FIELD_ALPHA = 0.25;
/** an open (white) beam has no colour to show, so it reads as this light grey on paper, 0 to 255 */
const OPEN_GREY = 200;

let mode: PoolMode = "off";

/** The menu rows of Show Beam Pools: a submenu with the three modes as radio rows. */
export function beamPoolRows(enabled: () => boolean): Row[] {
  return [
    {
      label: "Show Beam Pools",
      enabled,
      items: MODES.map((m) => ({
        label: m.label,
        checked: () => mode === m.id,
        run: () => {
          mode = m.id;
          appContext()?.requestDraw();
        },
      })),
    },
  ];
}

/** The paper colour of a gel (or an open beam), 0 to 255 per channel. */
export function paintOf(color: string): [number, number, number] {
  const c = colorOf(color);
  if (c.r > 0.97 && c.g > 0.97 && c.b > 0.97) return [OPEN_GREY, OPEN_GREY, OPEN_GREY];
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

/** A closed outline filled in `rgb` at `alpha`, multiplied onto what's under it. */
function fillPool(p: Painter, pts: readonly Pt[], rgb: readonly number[], alpha: number): void {
  const { ctx } = p;
  ctx.beginPath();
  pts.forEach((q, i) => {
    const s = p.toScreen(q);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  ctx.fill();
}

function drawPools(p: Painter): void {
  const s = store.session;
  if (mode === "off" || !s) return;
  const ctx = p.ctx;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.lineWidth = 1;
  for (const f of fixtures()) {
    if (!f.native || !f.focus) continue;
    if (mode === "selected" && !store.selection.has(f.id)) continue;
    const level = levelOf(f.channel);
    if (!(level > 0)) continue;
    const rgb = paintOf(f.color);
    const field = poolOutline(f, f.focus.z, f.fieldDeg);
    const beam = poolOutline(f, f.focus.z, f.beamDeg);
    fillPool(p, field, rgb, FIELD_ALPHA * level);
    fillPool(p, beam, rgb, BEAM_ALPHA * level);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = `rgba(${rgb[0] * 0.8}, ${rgb[1] * 0.8}, ${rgb[2] * 0.8}, ${0.8 * level})`;
    ctx.beginPath();
    field.forEach((q, i) => {
      const t = p.toScreen(q);
      if (i === 0) ctx.moveTo(t.x, t.y);
      else ctx.lineTo(t.x, t.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // the hanging point to the hot spot
    const at = p.toScreen(f.at);
    const hot = p.toScreen({ x: f.focus.x, y: f.focus.y });
    ctx.strokeStyle = `rgba(30, 30, 30, ${0.5 * level})`;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(hot.x, hot.y);
    ctx.stroke();
    ctx.fillStyle = `rgba(30, 30, 30, ${0.6 * level})`;
    ctx.beginPath();
    ctx.arc(hot.x, hot.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

registerOverlay(drawPools);
