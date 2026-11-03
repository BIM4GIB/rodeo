// Checks placing built parts in a drawing under Node. Run from web/:
//   npx tsx src/features/agents/place.check.ts [drawing.vwx ...]
// A cottage (walls with a door and windows, a floor, a thatched roof with a dormer, a chimney, a
// lawn, a hedge and a tree) is built into the blank drawing and any drawings named, in one batch:
// every part must show in 3D, in a class named for its category, filled, grouped and named as
// built; the whole build must undo in one step; and after saving and reopening, every object must
// show the same triangles where it was put. Nothing is drawn.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { blankDrawing } from "../../core/blank.ts";
import { openVwx } from "../../core/index.ts";
import type { EditSession } from "../../core/types.ts";
import { buildParts } from "./build.ts";
import { placeParts } from "./place.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const P = (x: number, y: number): { x: number; y: number } => ({ x, y });
const loop = [P(0, 0), P(8000, 0), P(8000, 5000), P(0, 5000)];
const COTTAGE = [
  {
    kind: "walls",
    path: loop,
    closed: true,
    height: 2600,
    color: "#efe6cf",
    openings: [
      { type: "door", segment: 0, at: 4000, style: "ledged", step: true },
      { type: "window", segment: 0, at: 1800, width: 1200, height: 1100 },
      { type: "window", segment: 0, at: 6200, width: 1200, height: 1100, style: "sash" },
    ],
  },
  { kind: "slab", outline: loop, thickness: 200 },
  { kind: "roof", outline: loop, eaves: 2600, material: "thatch", dormers: [{ at: P(1800, 0), style: "gable" }] },
  { kind: "chimney", at: P(8000, 2500), top: 6800 },
  { kind: "lawn", outline: [P(-3000, -5000), P(11000, -5000), P(11000, -600), P(-3000, -600)] },
  { kind: "hedge", path: [P(-3000, -5200), P(11000, -5200)] },
  { kind: "tree", at: P(-1500, -3000), name: "Oak" },
];

/** the solids on a layer as the 3D view gets them, by class: how many, their triangles and extent */
function solids(s: EditSession, layerId: string): Map<number, { count: number; triangles: number; lo: number[]; hi: number[] }> {
  const out = new Map<number, { count: number; triangles: number; lo: number[]; hi: number[] }>();
  for (const m of s.doc.model3d()) {
    if (m.layerId !== layerId) continue;
    const e = out.get(m.classIndex) ?? { count: 0, triangles: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
    e.count++;
    e.triangles += m.triangles.length / 9;
    for (let i = 0; i < m.triangles.length; i++) {
      e.lo[i % 3] = Math.min(e.lo[i % 3], m.triangles[i]);
      e.hi[i % 3] = Math.max(e.hi[i % 3], m.triangles[i]);
    }
    out.set(m.classIndex, e);
  }
  return out;
}

function run(label: string, bytes: Uint8Array): void {
  const s = openVwx(bytes, `${label}.vwx`);
  const { parts, notes } = buildParts(COTTAGE);
  check(parts.length > 50, `${label}: the cottage is ${parts.length} parts${notes.length ? ` (notes: ${notes.join("; ")})` : ""}`);
  const layersBefore = s.doc.layers().length;
  const t0 = performance.now();
  const { layer, placed } = s.batch(() => {
    const layer = s.createLayer("Cottage 3D", "design", 50);
    return { layer, placed: placeParts(s, layer, parts, P(1000, 2000)) };
  });
  const ms = performance.now() - t0;
  check(ms < 3000, `${label}: placed in ${ms.toFixed(0)} ms`);

  const elevation = s.doc.layers().find((l) => l.id === layer)!.elevation ?? 0;
  const now = solids(s, layer);
  const shown = [...now.values()].reduce((n, e) => n + e.count, 0);
  check(shown === parts.length, `${label}: one solid in 3D per part (${shown} for ${parts.length})`);
  const names = new Map(s.doc.classes().map((c) => [c.name, c.index]));
  for (const [category, n] of Object.entries(placed.counts)) check(now.get(names.get(category) ?? -2)?.count === n, `${label}: ${n} parts in class ${category} (${now.get(names.get(category) ?? -2)?.count ?? 0})`);
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const e of now.values()) {
    lo = lo.map((v, k) => Math.min(v, e.lo[k]));
    hi = hi.map((v, k) => Math.max(v, e.hi[k]));
  }
  // the lawn and the hedge set the plan's extent, moved by the offset; the floor goes below the layer
  check(lo[0] <= -2000 + 1 && Math.abs(hi[0] - 12000) < 1 && Math.abs(lo[1] - (-5200 - 300 + 2000)) < 1, `${label}: everything moved by the offset (${lo.map(Math.round)} to ${hi.map(Math.round)})`);
  check(lo[2] < elevation && hi[2] > elevation + 6000, `${label}: from under the floor to over the roof (${Math.round(lo[2] - elevation)} to ${Math.round(hi[2] - elevation)} above the layer)`);

  const leaves = s.doc.objects(layer).filter((o) => o.kind !== "group");
  check(leaves.length >= parts.length && leaves.every((o) => (o.attrs?.fillPattern ?? 0) !== 0), `${label}: every part filled`);
  check(Object.keys(placed.groups).length > 3 && Object.values(placed.groups).every((id) => s.doc.object(id)?.kind === "group"), `${label}: ${Object.keys(placed.groups).length} groups made`);
  const oak = placed.groups.Oak;
  check(!!oak && s.doc.object(oak)?.name === "Oak", `${label}: the tree's group is named Oak`);

  // saved and reopened, every class's solids as they were
  const again = solids(openVwx(s.doc.toBytes(), `${label}-saved.vwx`), layer);
  const same = [...now].every(([c, a]) => {
    const b = again.get(c);
    return !!b && b.count === a.count && b.triangles === a.triangles && a.lo.every((v, k) => Math.abs(v - b.lo[k]) < 1e-3) && a.hi.every((v, k) => Math.abs(v - b.hi[k]) < 1e-3);
  });
  check(same && again.size === now.size, `${label}: every part reopens with the same triangles where it was`);

  s.undo();
  check(s.doc.layers().length === layersBefore && !s.doc.layers().some((l) => l.id === layer), `${label}: one undo takes the whole build away`);
}

run("blank", blankDrawing("mm"));
for (const file of process.argv.slice(2)) run(basename(file, ".vwx"), new Uint8Array(readFileSync(file)));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
