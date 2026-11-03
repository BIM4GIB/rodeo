// A continuous beam, such as a pipe between its hoists, under point loads and its own weight. Solved by the
// direct stiffness method with Euler-Bernoulli elements at EI = 1, so the answers are forces, not deflections.
// Pure. Lengths go in and come out in mm; inside, the solve is in metres and kilograms, so moments are kg·m.
// Reactions are upward positive, and shear and moment at each station follow from them by statics. It leaves
// out the hoists' own stiffness, sway, and anything that moves.

/** A load of `kg` (downward) at `atMm` along the beam from one end. */
export interface PointLoad {
  readonly atMm: number;
  readonly kg: number;
}

/** The forces at one station along the beam. */
export interface BeamStation {
  readonly atMm: number;
  /** upward force on the part of the beam before the station, kg; just after it where a load or support sits */
  readonly shearKg: number;
  /** the shear just before the station, kg: where a load or hoist sits, the shear jumps from this value to shearKg */
  readonly shearBeforeKg: number;
  /** kg·m, positive where the beam sags */
  readonly momentKgM: number;
}

export interface BeamResult {
  /** each support's upward reaction, in the order the supports were given, kg */
  readonly reactionsKg: readonly number[];
  /** the largest bending moment either way, kg·m */
  readonly maxMomentKgM: number;
  /** the largest shear either way, kg */
  readonly maxShearKg: number;
  readonly stations: readonly BeamStation[];
  /** fewer than two supports: held at one point (or none), so nothing bends */
  readonly unstable: boolean;
}

/** Stations are this many equal parts along the beam, plus one at each node. */
const PARTS = 40;
/** Points this close (mm) are one node. */
const MERGE_MM = 0.5;
/** Tolerance for "at or before a station", mm. */
const EPS_MM = 1e-6;

/** The values sorted, with each one within MERGE_MM of the one before dropped. */
function distinctMm(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (out.length === 0 || v - out[out.length - 1] > MERGE_MM) out.push(v);
  return out;
}

/** The index of the node nearest `mm`. */
function nearest(nodes: readonly number[], mm: number): number {
  let best = 0;
  for (let i = 1; i < nodes.length; i++) if (Math.abs(nodes[i] - mm) < Math.abs(nodes[best] - mm)) best = i;
  return best;
}

/** The even stations along a length, end to end, mm. */
function gridMm(lengthMm: number): number[] {
  return Array.from({ length: PARTS + 1 }, (_, k) => (lengthMm * k) / PARTS);
}

/** Solves a·x = b by Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    if (m[c][c] === 0) throw new Error("The beam can't be solved: its supports don't hold it.");
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

/**
 * The beam from one end (0) to the other (`lengthMm`), held up at `supportsMm`, carrying `pointLoads` and the
 * uniform load `udlKgPerM` (its own weight) along all of it. Fewer than two distinct supports is unstable: one
 * hoist takes the whole weight and nothing bends.
 */
export function solveBeam(lengthMm: number, supportsMm: readonly number[], pointLoads: readonly PointLoad[], udlKgPerM: number): BeamResult {
  if (!(lengthMm > 0)) throw new Error("A beam needs a length above zero.");
  const clamp = (mm: number): number => Math.min(lengthMm, Math.max(0, mm));
  const supports = supportsMm.map(clamp);
  const loadsMm = pointLoads.map((p) => clamp(p.atMm));
  const totalKg = pointLoads.reduce((sum, p) => sum + p.kg, 0) + (udlKgPerM * lengthMm) / 1000;
  if (distinctMm(supports).length < 2) {
    const each = supports.length ? totalKg / supports.length : 0;
    const stations = distinctMm([...gridMm(lengthMm), ...supports, ...loadsMm]).map((mm) => ({ atMm: mm, shearKg: 0, shearBeforeKg: 0, momentKgM: 0 }));
    return { reactionsKg: supports.map(() => each), maxMomentKgM: 0, maxShearKg: 0, stations, unstable: true };
  }

  // nodes at the ends, every support and every load; elements between neighbours, two dofs (deflection, rotation) each
  const nodes = distinctMm([0, lengthMm, ...supports, ...loadsMm]);
  const n = nodes.length;
  const dofs = 2 * n;
  const K = Array.from({ length: dofs }, () => new Array<number>(dofs).fill(0));
  const F = new Array<number>(dofs).fill(0);
  const w = udlKgPerM;
  for (let e = 0; e + 1 < n; e++) {
    const l = (nodes[e + 1] - nodes[e]) / 1000;
    const l2 = l * l;
    const l3 = l2 * l;
    const ke = [
      [12 / l3, 6 / l2, -12 / l3, 6 / l2],
      [6 / l2, 4 / l, -6 / l2, 2 / l],
      [-12 / l3, -6 / l2, 12 / l3, -6 / l2],
      [6 / l2, 2 / l, -6 / l2, 4 / l],
    ];
    const d = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) K[d[a]][d[b]] += ke[a][b];
    // the uniform load as equivalent nodal forces; the load is down, so these are upward positive
    const fe = [(-w * l) / 2, (-w * l2) / 12, (-w * l) / 2, (w * l2) / 12];
    for (let a = 0; a < 4; a++) F[d[a]] += fe[a];
  }
  pointLoads.forEach((p, i) => {
    F[2 * nearest(nodes, loadsMm[i])] -= p.kg;
  });

  // pinned deflection at each support; the free dofs are solved, then each support's reaction is what it must make up
  const supportNodes = supports.map((mm) => nearest(nodes, mm));
  const pinned = new Set(supportNodes.map((node) => 2 * node));
  const free = Array.from({ length: dofs }, (_, i) => i).filter((i) => !pinned.has(i));
  const sol = solveLinear(
    free.map((i) => free.map((j) => K[i][j])),
    free.map((i) => F[i]),
  );
  const u = new Array<number>(dofs).fill(0);
  free.forEach((dof, k) => {
    u[dof] = sol[k];
  });
  const reactionOf = new Map<number, number>();
  for (const node of supportNodes) {
    if (reactionOf.has(node)) continue;
    let force = 0;
    for (let j = 0; j < dofs; j++) force += K[2 * node][j] * u[j];
    reactionOf.set(node, force - F[2 * node]);
  }
  // two supports at one node share its reaction
  const count = new Map<number, number>();
  for (const node of supportNodes) count.set(node, (count.get(node) ?? 0) + 1);
  // rounded to a billionth, so a reaction of exactly 29.75 kg isn't shown as 29.7 for a rounding error
  const reactionsKg = supportNodes.map((node) => Math.round(((reactionOf.get(node) ?? 0) / (count.get(node) ?? 1)) * 1e9) / 1e9);

  // shear and moment by statics from the reactions and loads before each station
  const reactions = [...reactionOf].map(([node, kg]) => ({ mm: nodes[node], kg }));
  const loads = pointLoads.map((p, i) => ({ mm: nodes[nearest(nodes, loadsMm[i])], kg: p.kg }));
  const at = (mm: number): { shear: number; moment: number } => {
    const x = mm / 1000;
    let shear = -w * x;
    let moment = (-w * x * x) / 2;
    for (const r of reactions)
      if (r.mm <= mm + EPS_MM) {
        shear += r.kg;
        moment += r.kg * (x - r.mm / 1000);
      }
    for (const p of loads)
      if (p.mm <= mm + EPS_MM) {
        shear -= p.kg;
        moment -= p.kg * (x - p.mm / 1000);
      }
    return { shear, moment };
  };
  const stations: BeamStation[] = distinctMm([...nodes, ...gridMm(lengthMm)]).map((mm) => {
    const v = at(mm);
    return { atMm: mm, shearKg: v.shear, shearBeforeKg: at(mm - 2 * EPS_MM).shear, momentKgM: v.moment };
  });
  let maxShear = 0;
  let maxMoment = 0;
  for (const s of stations) {
    // just before a station too, where a load or support makes the shear jump
    maxShear = Math.max(maxShear, Math.abs(s.shearKg), Math.abs(s.shearBeforeKg));
    maxMoment = Math.max(maxMoment, Math.abs(s.momentKgM));
  }
  // under the uniform load the shear falls in a straight line between stations, so the moment peaks where it is zero
  if (w > 0) {
    for (let i = 0; i + 1 < stations.length; i++) {
      const a = stations[i];
      const x = a.atMm + (1000 * a.shearKg) / w;
      if (x > a.atMm + EPS_MM && x < stations[i + 1].atMm - EPS_MM) maxMoment = Math.max(maxMoment, Math.abs(at(x).moment));
    }
  }
  return { reactionsKg, maxMomentKgM: maxMoment, maxShearKg: maxShear, stations, unstable: false };
}
