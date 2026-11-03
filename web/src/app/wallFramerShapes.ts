// Wall Framer's sums (wallFramer.ts draws them): a wall's studs, plates, and the framing round its
// doors and windows, as pieces in the wall's own elevation (along it from its start, up from its
// bottom); each piece is the lumber's long side deep across the wall. Plain data, lengths in mm.

/** A lumber size: its short side (a stud's width along the wall, a plate's thickness) and its long side, across the wall. */
export interface Lumber {
  readonly name: string;
  readonly size: number;
  readonly by: number;
}

const IN = 25.4;
export const LUMBER: readonly Lumber[] = [
  { name: '2" x 4"', size: 1.5 * IN, by: 3.5 * IN },
  { name: '2" x 6"', size: 1.5 * IN, by: 5.5 * IN },
  { name: '2" x 10"', size: 1.5 * IN, by: 9.25 * IN },
];

/** A wall class's framing, as the Wall Class dialog sets it. */
export interface ClassOptions {
  readonly spacing: number;
  readonly sheetWidth: number;
  readonly sheetHeight: number;
  readonly maxPlate: number;
  readonly lumber: Lumber;
  readonly fireBlocking: boolean;
  readonly doubleEnd: boolean;
  readonly doubleTop: boolean;
  readonly doubleBottom: boolean;
}

/** A door or window: along the wall from its start, and its sill and head above the wall's bottom. */
export interface Opening {
  readonly from: number;
  readonly to: number;
  readonly sill: number;
  readonly head: number;
}

export type PieceKind = "stud" | "king" | "jack" | "cripple" | "bottom" | "top" | "header" | "sill" | "block";

export const PIECE_LABEL: Record<PieceKind, string> = {
  stud: "Stud",
  king: "King Stud",
  jack: "Jack Stud",
  cripple: "Cripple",
  bottom: "Bottom Plate",
  top: "Top Plate",
  header: "Header",
  sill: "Sill",
  block: "Fire Block",
};

/** A piece in the wall's elevation: x along it, z up it. */
export interface Piece {
  readonly kind: PieceKind;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

const EPS = 0.01;
const UPRIGHT: ReadonlySet<PieceKind> = new Set<PieceKind>(["stud", "king", "jack", "cripple"]);

/** How long a piece is cut: up an upright, along anything else. */
export const pieceLength = (p: Piece): number => (UPRIGHT.has(p.kind) ? p.z1 - p.z0 : p.x1 - p.x0);

/** [from, to] less the cuts, as stretches. */
function less(from: number, to: number, cuts: readonly (readonly [number, number])[]): [number, number][] {
  let out: [number, number][] = [[from, to]];
  for (const [c0, c1] of cuts) out = out.flatMap(([a, b]): [number, number][] => (c1 <= a || c0 >= b ? [[a, b]] : ([[a, Math.min(b, c0)], [Math.max(a, c1), b]] as [number, number][]).filter(([x, y]) => y - x > EPS)));
  return out;
}

/** A stretch in lengths of at most `most`. */
function lengths(a: number, b: number, most: number): [number, number][] {
  const n = Math.max(1, Math.ceil((b - a) / most - 1e-9));
  return Array.from({ length: n }, (_, i): [number, number] => [a + i * most, Math.min(b, a + (i + 1) * most)]);
}

/**
 * A wall `length` long and `height` tall framed: bottom and top plates (each run cut at the longest
 * plate and through doors), end studs, studs the spacing apart from its start, and round each
 * opening king and jack studs, a header the lumber's long side doubled tall, cripples over it and,
 * under a window, a sill with cripples below; fire blocking runs between the uprights at the sheet's
 * height (or halfway up a wall no taller). Pieces, or why it can't be framed.
 */
export function frameWall(length: number, height: number, openings: readonly Opening[], o: ClassOptions): Piece[] | string {
  const t = o.lumber.size;
  const [nb, nt] = [o.doubleBottom ? 2 : 1, o.doubleTop ? 2 : 1];
  const [zb, zt] = [nb * t, height - nt * t];
  const ends = (o.doubleEnd ? 2 : 1) * t;
  if (!(t > 0) || !(o.lumber.by > 0)) return "Give the lumber a size over 0.";
  if (!(o.spacing > t)) return "Set a Stud Spacing wider than a stud.";
  if (!(length >= 2 * ends + EPS)) return "The wall is too short to frame.";
  if (!(zt - zb > t)) return "The wall is too low to frame.";
  // openings kept clear of the wall's ends and each other, with room for their header
  const kept: Opening[] = [];
  for (const op of [...openings].sort((a, b) => a.from - b.from)) {
    const from = Math.max(op.from, ends + 2 * t);
    const to = Math.min(op.to, length - ends - 2 * t);
    const head = Math.min(op.head, zt - t);
    const last = kept[kept.length - 1];
    if (to - from <= EPS || head <= Math.max(op.sill, zb) + EPS || (last && from - 2 * t < last.to + 2 * t)) continue;
    kept.push({ from, to, sill: op.sill, head });
  }
  const pieces: Piece[] = [];
  const put = (kind: PieceKind, x0: number, x1: number, z0: number, z1: number): void => {
    if (x1 - x0 > EPS && z1 - z0 > EPS) pieces.push({ kind, x0, x1, z0, z1 });
  };
  const doors = kept.filter((op) => op.sill <= zb + EPS).map((op): [number, number] => [op.from, op.to]);
  for (let k = 0; k < nb; k++) for (const [a, b] of less(0, length, doors)) for (const [x0, x1] of lengths(a, b, o.maxPlate)) put("bottom", x0, x1, k * t, (k + 1) * t);
  for (let k = 0; k < nt; k++) for (const [x0, x1] of lengths(0, length, o.maxPlate)) put("top", x0, x1, height - (k + 1) * t, height - k * t);
  for (let x = 0; x < ends - EPS; x += t) {
    put("stud", x, x + t, zb, zt);
    put("stud", length - x - t, length - x, zb, zt);
  }
  const marks = (a: number, b: number): number[] => {
    const out: number[] = [];
    for (let k = Math.ceil((a + t / 2) / o.spacing); k * o.spacing <= b - t / 2 + EPS; k++) out.push(k * o.spacing);
    return out;
  };
  for (const op of kept) {
    const top = Math.min(op.head + 2 * o.lumber.by, zt);
    put("king", op.from - 2 * t, op.from - t, zb, zt);
    put("king", op.to + t, op.to + 2 * t, zb, zt);
    put("jack", op.from - t, op.from, zb, op.head);
    put("jack", op.to, op.to + t, zb, op.head);
    put("header", op.from - t, op.to + t, op.head, top);
    for (const m of marks(op.from, op.to)) if (zt - top > t / 2) put("cripple", m - t / 2, m + t / 2, top, zt);
    if (op.sill > zb + EPS) {
      put("sill", op.from, op.to, Math.max(zb, op.sill - t), op.sill);
      for (const m of marks(op.from, op.to)) if (op.sill - t - zb > t / 2) put("cripple", m - t / 2, m + t / 2, zb, op.sill - t);
    }
  }
  for (const m of marks(ends, length - ends)) {
    if (m - t / 2 < ends - EPS || m + t / 2 > length - ends + EPS) continue;
    if (kept.some((op) => m + t / 2 > op.from - 2 * t - EPS && m - t / 2 < op.to + 2 * t + EPS)) continue;
    put("stud", m - t / 2, m + t / 2, zb, zt);
  }
  if (o.fireBlocking) {
    const at = height > o.sheetHeight + EPS ? o.sheetHeight : (zb + zt) / 2;
    const [z0, z1] = [Math.max(zb, at - t / 2), Math.min(zt, at + t / 2)];
    const uprights = pieces.filter((p) => (p.kind === "stud" || p.kind === "king") && p.z0 <= z0 + EPS && p.z1 >= z1 - EPS).sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i + 1 < uprights.length; i++) {
      const [x0, x1] = [uprights[i].x1, uprights[i + 1].x0];
      // none across an opening, where the jacks, header and sill stand
      if (kept.some((op) => x1 > op.from - t - EPS && x0 < op.to + t + EPS)) continue;
      put("block", x0, x1, z0, z1);
    }
  }
  return pieces;
}

export interface WallFrameInfo {
  readonly length: number;
  readonly height: number;
  readonly area: number;
  readonly studs: number;
  readonly plates: number;
  readonly sheets: number;
}

/** What Frame Wall Info lists for a wall: its size, its uprights, its plates' run, and the sheets that cover one face. */
export function wallInfo(length: number, height: number, openings: readonly Opening[], pieces: readonly Piece[], o: ClassOptions): WallFrameInfo {
  const holes = openings.reduce((sum, op) => sum + Math.max(0, op.to - op.from) * Math.max(0, op.head - op.sill), 0);
  const area = Math.max(0, length * height - holes);
  const sheet = o.sheetWidth * o.sheetHeight;
  return {
    length,
    height,
    area,
    studs: pieces.filter((p) => UPRIGHT.has(p.kind)).length,
    plates: pieces.filter((p) => p.kind === "bottom" || p.kind === "top").reduce((sum, p) => sum + (p.x1 - p.x0), 0),
    sheets: sheet > 0 ? Math.ceil(area / sheet - 1e-9) : 0,
  };
}

/** Pieces alike in kind and length (to the mm), counted, in the order the kinds are framed. */
export function countPieces(pieces: readonly Piece[]): { kind: PieceKind; length: number; count: number }[] {
  const order = Object.keys(PIECE_LABEL) as PieceKind[];
  const rows = new Map<string, { kind: PieceKind; length: number; count: number }>();
  for (const p of pieces) {
    const length = Math.round(pieceLength(p));
    const key = `${p.kind}|${length}`;
    const was = rows.get(key);
    rows.set(key, { kind: p.kind, length, count: (was?.count ?? 0) + 1 });
  }
  return [...rows.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.length - a.length);
}
