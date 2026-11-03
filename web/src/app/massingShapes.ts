// The sums for a massing model: a building shell from its outline, its walls, floors and roof as solids and what its
// roof looks like in plan.

import type { Pt } from "../core/index.ts";
import { offsetPolyline } from "./geom.ts";
import { buildRoof, roofOutline, type EaveProfile } from "./roofShapes.ts";
import { prism, type Solid } from "./solids3d.ts";

export interface MassingSpec {
  readonly outline: readonly Pt[];
  /** where it stands, as the solids want it */
  readonly base: number;
  /** to the eaves */
  readonly height: number;
  readonly floors: number;
  readonly pitched: boolean;
  readonly eave: EaveProfile;
  /** degrees */
  readonly slope: number;
  readonly overhang: number;
  readonly roofThickness: number;
  readonly drawFloors: boolean;
  readonly slabThickness: number;
  readonly wallThickness: number;
}

export interface Massing {
  readonly walls: Solid;
  readonly floors: Solid;
  readonly roof: Solid;
  /** the roof's edge in plan */
  readonly eaves: readonly Pt[];
  /** hips, valleys and ridges in plan */
  readonly lines: readonly (readonly [Pt, Pt])[];
  /** a pitched roof that couldn't be worked out for this outline, drawn flat */
  readonly fellBack: boolean;
}

export const outlineArea = (ring: readonly Pt[]): number =>
  Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0)) / 2;

export const grossArea = (ring: readonly Pt[], floors: number): number => outlineArea(ring) * Math.max(1, floors);

export function massing(s: MassingSpec): Massing | null {
  const outline = roofOutline(s.outline);
  if (outline.length < 3 || !(s.height > 0)) return null;
  const top = s.base + s.height;
  const inner = s.wallThickness > 0 ? offsetPolyline(outline, true, s.wallThickness) : null;
  const walls = prism(inner && inner.length === outline.length ? [outline, inner] : [outline], s.base, top);
  const floors: number[][] = [];
  if (s.drawFloors && s.slabThickness > 0) {
    const count = Math.max(1, Math.floor(s.floors));
    for (let i = 0; i < count; i++) {
      const z = s.base + (i * s.height) / count;
      floors.push(...prism([inner ?? outline], z, z + s.slabThickness));
    }
  }
  const pitched = s.pitched
    ? buildRoof({
        outline,
        gables: new Set<number>(),
        pitch: (s.slope * Math.PI) / 180,
        bearingHeight: top,
        overhang: s.overhang,
        gableWall: 0,
        eave: s.eave,
        vertical: 0,
        thickness: s.roofThickness,
        bearingInset: 0,
      })
    : null;
  if (pitched) return { walls, floors, roof: pitched.solid, eaves: pitched.eaves, lines: pitched.lines, fellBack: false };
  const eaves = (s.overhang > 0 ? offsetPolyline(outline, true, -s.overhang) : outline) ?? outline;
  return { walls, floors, roof: prism([eaves], top, top + s.roofThickness), eaves, lines: [], fellBack: s.pitched };
}

/** Grade limits this far outside an outline, whichever way round its corners run. */
export function limitsRing(ring: readonly Pt[], reach: number): Pt[] {
  const outline = roofOutline(ring);
  return offsetPolyline(outline, true, -reach) ?? outline;
}

/** The shadow an outline casts along a vector on the ground: the outline moved, and what each side sweeps. */
export function shadowRings(ring: readonly Pt[], dx: number, dy: number): Pt[][] {
  const moved = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  return [...ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return [p, q, moved(q), moved(p)];
  }), ring.map(moved)];
}

/** Floor usage kept as Vectorworks' FloorUsageData reports it, one for each floor. */
export function floorUsages(text: string, floors: number): string[] {
  const had = text ? text.split(";") : [];
  return Array.from({ length: Math.max(1, Math.floor(floors)) }, (_, i) => had[i]?.trim() || "Unspecified");
}
