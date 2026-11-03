// The hanging positions a Load Check reads: each position's instruments and the batten they hang on. The batten's
// axis is the line fitted through the hanging points, running from its stage-right end. It runs END_MARGIN_MM past
// the outermost instrument at each end unless a length is set, and its hoists sit where set or at its two ends.
// checkOf adds the pipe, solves the batten (beam.ts) and words its status. Pure: lengths in mm, weights in kg, the
// stage frame from stage.ts. It leaves out cable, shackles, bridles and dynamic loads.

import type { Pt } from "../../../core/index.ts";
import { naturalCompare, type Fixture } from "../fixture.ts";
import type { PositionInfo } from "../showTypes.ts";
import { DEFAULT_STAGE, fromStage, toStage, type StageFrame } from "../stage.ts";
import { solveBeam, type BeamResult, type PointLoad } from "./beam.ts";

/** The batten runs this far past its outermost instrument at each end, mm. */
export const END_MARGIN_MM = 500;
/** Instruments with no Position hang on no batten, so they carry no pipe and no hoists. */
export const NO_POSITION = "No Position";
/** Schedule 40 steel pipe, kg per m. */
export const PIPE_KG_PER_M = 3;

/** An instrument on a batten: `offsetMm` from the batten's stage-right end. */
export interface Hang {
  readonly fixture: Fixture;
  readonly offsetMm: number;
}

/** One hanging position and what hangs on it, before the pipe is counted. */
export interface LoadPosition {
  readonly name: string;
  /** the instruments, from the stage-right end */
  readonly hangs: readonly Hang[];
  readonly instrumentKg: number;
  /** the batten's length, mm */
  readonly lengthMm: number;
  /** the hoists, mm from the stage-right end, in order */
  readonly supportsMm: readonly number[];
  readonly capacityKg: number;
  /** what one hoist may carry, kg (0 for not set) */
  readonly supportCapacityKg: number;
}

/** A position with its pipe counted, solved and worded. */
export interface PositionCheck {
  readonly pipeKg: number;
  readonly totalKg: number;
  readonly beam: BeamResult;
  /** the biggest hoist load, either way, kg */
  readonly maxReactionKg: number;
  /** the total as a share of the capacity, % (null when no capacity is set) */
  readonly usePct: number | null;
  readonly status: string;
  readonly level: "ok" | "unset" | "bad";
}

/** The limits stored for a position, or none set. */
export function infoOf(name: string, infos: readonly PositionInfo[]): PositionInfo {
  return infos.find((i) => i.name === name) ?? { name, capacityKg: 0, lengthMm: 0, supportsMm: [], supportCapacityKg: 0 };
}

/** The drawing direction of stage left (the way "across" rises), as an angle in radians. */
function acrossAngle(frame: StageFrame): number {
  const a = fromStage(frame, { across: 0, up: 0 });
  const b = fromStage(frame, { across: 1000, up: 0 });
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Each point's distance along the line through them, mm, from the end that is stage right. The line is the points'
 * principal axis; where they all coincide it runs across the stage. A line running straight up and down the stage
 * starts at its downstage end.
 */
function alongOf(points: readonly Pt[], frame: StageFrame): number[] {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = sxx + syy < 1e-6 ? acrossAngle(frame) : 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  // run so that moving along the line takes it toward stage left
  const a = toStage(frame, { x: mx, y: my });
  const b = toStage(frame, { x: mx + dx, y: my + dy });
  const across = b.across - a.across;
  if (across < -1e-9 || (Math.abs(across) <= 1e-9 && b.up - a.up < 0)) {
    dx = -dx;
    dy = -dy;
  }
  const t = points.map((p) => (p.x - mx) * dx + (p.y - my) * dy);
  const lo = Math.min(...t);
  return t.map((v) => v - lo);
}

/** One position from its instruments, with its stored limits. */
function positionOf(name: string, list: readonly Fixture[], info: PositionInfo, frame: StageFrame): LoadPosition {
  const along = alongOf(
    list.map((f) => f.at),
    frame,
  );
  const span = Math.max(...along);
  const lengthMm = info.lengthMm > 0 ? info.lengthMm : span + 2 * END_MARGIN_MM;
  const hangs = list.map((fixture, i) => ({ fixture, offsetMm: along[i] + END_MARGIN_MM })).sort((a, b) => a.offsetMm - b.offsetMm);
  const set = info.supportsMm.filter((mm) => mm >= 0 && mm <= lengthMm).sort((a, b) => a - b);
  const supportsMm = name === NO_POSITION ? [] : set.length ? set : [0, lengthMm];
  return {
    name,
    hangs,
    instrumentKg: list.reduce((s, f) => s + f.weightKg, 0),
    lengthMm,
    supportsMm,
    capacityKg: info.capacityKg,
    supportCapacityKg: info.supportCapacityKg,
  };
}

/**
 * The hanging positions of `fixtures`, by name (instruments with none under NO_POSITION, last), each with its
 * instruments' axis and length, and its hoists from `infos` (the stored limits) where set.
 */
export function positionsOf(fixtures: readonly Fixture[], infos: readonly PositionInfo[] = [], frame: StageFrame = DEFAULT_STAGE): LoadPosition[] {
  const groups = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    const name = f.position.trim() || NO_POSITION;
    const list = groups.get(name) ?? [];
    list.push(f);
    groups.set(name, list);
  }
  const names = [...groups.keys()].sort((a, b) => (a === NO_POSITION ? 1 : b === NO_POSITION ? -1 : naturalCompare(a, b)));
  return names.map((name) => positionOf(name, groups.get(name) ?? [], infoOf(name, infos), frame));
}

/**
 * A position with its pipe (`pipeKgPerM`, none on NO_POSITION) counted, its batten solved, and its status: "OK", or
 * the words for what is over, such as "Over capacity" and "Hoist 2 over by 40 kg", or "No capacity set".
 */
export function checkOf(p: LoadPosition, pipeKgPerM: number): PositionCheck {
  const batten = p.name !== NO_POSITION;
  const pipeKg = batten ? (pipeKgPerM * p.lengthMm) / 1000 : 0;
  const totalKg = p.instrumentKg + pipeKg;
  const loads: PointLoad[] = p.hangs.map((h) => ({ atMm: h.offsetMm, kg: h.fixture.weightKg }));
  const beam = solveBeam(p.lengthMm, p.supportsMm, loads, batten ? pipeKgPerM : 0);
  const reactions = beam.reactionsKg.map((r) => Math.abs(r));
  const maxReactionKg = reactions.length ? Math.max(...reactions) : 0;
  if (!batten) return { pipeKg, totalKg, beam, maxReactionKg, usePct: null, status: "No batten to check", level: "unset" };

  const words: string[] = [];
  let level: PositionCheck["level"] = "ok";
  if (p.capacityKg > 0) {
    if (totalKg > p.capacityKg) {
      words.push("Over capacity");
      level = "bad";
    }
  } else {
    words.push("No capacity set");
    level = "unset";
  }
  if (p.supportCapacityKg > 0 && reactions.length) {
    const over = reactions.map((r) => r - p.supportCapacityKg);
    // the first hoist at the top, so equal hoists name the first one
    const most = Math.max(...over);
    const worst = over.findIndex((o) => most - o < 1e-6);
    if (over[worst] > 0) {
      words.push(`Hoist ${worst + 1} over by ${Math.ceil(over[worst])} kg`);
      level = "bad";
    }
  }
  if (words.length === 0) words.push("OK");
  return {
    pipeKg,
    totalKg,
    beam,
    maxReactionKg,
    usePct: p.capacityKg > 0 ? (totalKg / p.capacityKg) * 100 : null,
    status: words.join(" · "),
    level,
  };
}
