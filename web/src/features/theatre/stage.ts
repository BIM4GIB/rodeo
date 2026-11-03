// The stage's own frame, as theatre drawings measure: across from the centre line (CL), up and down
// stage from the plaster line (PL), the two lines' crossing as origin. Across is positive toward stage
// left (the performer's left facing the audience, the audience's right); up is positive upstage. Saved
// in the drawing (show.ts). With none set, the drawing's origin stands in, upstage up the page.

import type { Pt } from "../../core/index.ts";

export interface StageFrame {
  /** where the centre line crosses the plaster line */
  readonly x: number;
  readonly y: number;
  /** the direction upstage, degrees anticlockwise from +x (90 is up the page) */
  readonly upDeg: number;
}

/** A point in stage terms, mm. */
export interface StagePoint {
  /** positive toward stage left */
  readonly across: number;
  /** positive upstage of the plaster line */
  readonly up: number;
}

export const STAGE_KEY = "stage";
export const DEFAULT_STAGE: StageFrame = { x: 0, y: 0, upDeg: 90 };

/** A drawing point in stage terms. */
export function toStage(f: StageFrame, p: Pt): StagePoint {
  const t = (f.upDeg * Math.PI) / 180;
  const ux = Math.cos(t);
  const uy = Math.sin(t);
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  return { across: dx * uy - dy * ux, up: dx * ux + dy * uy };
}

/** A stage point as a drawing point. */
export function fromStage(f: StageFrame, s: StagePoint): Pt {
  const t = (f.upDeg * Math.PI) / 180;
  const ux = Math.cos(t);
  const uy = Math.sin(t);
  return { x: f.x + s.up * ux + s.across * uy, y: f.y + s.up * uy - s.across * ux };
}

/** "1.20 m SL · 3.00 m US", the lengths written by `format`: left or right of CL, up or down of PL. */
export function stageText(s: StagePoint, format: (mm: number) => string): string {
  const across = Math.abs(s.across) < 0.5 ? "on CL" : `${format(Math.abs(s.across))} ${s.across > 0 ? "SL" : "SR"}`;
  const up = Math.abs(s.up) < 0.5 ? "on PL" : `${format(Math.abs(s.up))} ${s.up > 0 ? "US" : "DS"}`;
  return `${across} · ${up}`;
}
