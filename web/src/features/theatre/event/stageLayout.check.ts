// npx tsx src/features/theatre/event/stageLayout.check.ts
import type { Pt } from "../../../core/index.ts";
import { placed } from "../../../app/detailShapes.ts";
import { stageDeck, stagePlug, type StagePlan } from "../../../app/stageShapes.ts";
import { longestSide, MAX_PIECES, minimizeLegs, pieceSolid, roomRing, stageLayout, stepsFor, stepsSolid, type StagePiece } from "./stageLayout.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const area = (pts: readonly Pt[]): number => Math.abs(pts.reduce((a, p, i) => a + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0)) / 2;
const pieceArea = (p: StagePiece): number => (p.kind === "deck" ? p.width * p.depth : area(p.outline));
const decks = (ps: StagePiece[]) => ps.filter((p): p is Extract<StagePiece, { kind: "deck" }> => p.kind === "deck");
const plugs = (ps: StagePiece[]) => ps.filter((p): p is Extract<StagePiece, { kind: "plug" }> => p.kind === "plug");
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// a rectangle a whole number of decks: decks alone, filling it
{
  const r = stageLayout(rect(0, 0, 8000, 4000), 2000, 1000);
  ok(Array.isArray(r) && r.length === 16 && decks(r).length === 16, "8 m × 4 m in 2 m × 1 m decks is 16 decks");
  if (Array.isArray(r)) {
    ok(r.every((p) => p.kind === "deck" && near(p.width, 2000) && near(p.depth, 1000) && near(p.angle, 0)), "all standard, square to x");
    ok(near(r.reduce((a, p) => a + pieceArea(p), 0), 32e6), "they cover it");
    const mids = decks(r).map((d) => `${d.at.x},${d.at.y}`);
    ok(mids.includes("1000,500") && mids.includes("7000,3500"), "middles on the grid from the corner: " + mids.slice(0, 3).join(" "));
  }
}

// a rectangle that isn't: the last row and column are smaller decks, no plugs
{
  const r = stageLayout(rect(0, 0, 5000, 2500), 2000, 1000);
  ok(Array.isArray(r) && plugs(r).length === 0, "a rectangle takes decks alone");
  if (Array.isArray(r)) {
    ok(r.length === 9, `3 × 3 pieces (${r.length})`);
    ok(near(r.reduce((a, p) => a + pieceArea(p), 0), 12.5e6), "they cover it");
    ok(decks(r).some((d) => near(d.width, 1000) && near(d.depth, 500)), "the corner deck is 1 m × 0.5 m");
  }
}

// a rectangle turned 30°: the decks turn with it
{
  const t = Math.PI / 6;
  const r = stageLayout(placed(rect(0, 0, 6000, 2000), { x: 100, y: 200 }, t), 2000, 1000);
  ok(Array.isArray(r) && r.length === 6 && decks(r).every((d) => near(d.angle, t, 1e-9)), "a turned rectangle's decks turn with it");
}

// its longest side sets the way: an upright rectangle's decks run up the page
ok(near(longestSide(rect(0, 0, 2000, 8000)), Math.PI / 2), "upright rectangle runs up");
ok(near(longestSide([...rect(0, 0, 8000, 2000)].reverse()), 0), "a side drawn leftward lays the same grid");

// a triangle: whole decks inside, plugs along the slope, all of it covered
{
  const tri: Pt[] = [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 0, y: 3000 },
  ];
  const r = stageLayout(tri, 2000, 1000);
  ok(Array.isArray(r) && decks(r).length > 0 && plugs(r).length > 0, "a triangle takes decks and plugs");
  if (Array.isArray(r)) ok(near(r.reduce((a, p) => a + pieceArea(p), 0), 9e6, 1), `they cover it (${r.reduce((a, p) => a + pieceArea(p), 0)})`);
}

// a U shape: a cell the notch cuts in two gives two plugs
{
  const u: Pt[] = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 2000 },
    { x: 2000, y: 2000 },
    { x: 2000, y: 1000 },
    { x: 1000, y: 1000 },
    { x: 1000, y: 2000 },
    { x: 0, y: 2000 },
  ];
  const r = stageLayout(u, 3000, 2000);
  ok(Array.isArray(r) && r.length === 1 && r[0].kind === "plug", "one 3 m × 2 m cell over a U is one plug");
  const r2 = stageLayout(u, 3000, 500);
  ok(Array.isArray(r2) && r2.length === 6 && decks(r2).length === 6, "rows below the notch are decks; above, each arm a deck");
  const r3 = stageLayout(u, 3000, 1500);
  ok(Array.isArray(r3) && r3.length === 3 && plugs(r3).length === 1 && decks(r3).length === 2, "a cell round the notch's foot is a U plug, the arms above two decks: " + JSON.stringify(Array.isArray(r3) ? r3.map((p) => p.kind) : r3));
}

// slivers are left out, too many decks refused, nonsense refused
ok(typeof stageLayout(rect(0, 0, 4000.05, 1000), 2000, 1000) !== "string" && (stageLayout(rect(0, 0, 4000.05, 1000), 2000, 1000) as StagePiece[]).length === 2, "a sliver 0.05 mm wide is left out");
ok(typeof stageLayout(rect(0, 0, 1e6, 1e6), 1000, 1000) === "string", `more than ${MAX_PIECES} refused`);
ok(typeof stageLayout(rect(0, 0, 4000, 1000), 0, 1000) === "string", "a 0 width refused");

// Minimize Leg Count: two decks side by side share the legs along their meeting edge
{
  const legs = { structure: "legsBasic" as const, diameter: 50, profile: "round" as const, spacing: 1000, hideDeck: false };
  const one = stageDeck({ ...legs, shape: "rect", width: 2000, depth: 1000, radius: 0, sweep: 180, rails: [] }) as StagePlan;
  const at = (plan: StagePlan, x: number): StagePlan => ({ ...plan, hidden: plan.hidden.map((pts) => placed(pts, { x, y: 0 }, 0)), loci: plan.loci.map((p) => ({ x: p.x + x, y: p.y })) });
  const pair = [at(one, 0), at(one, 2000)];
  const legsOf = (p: StagePlan): number => p.hidden.filter((pts) => pts.length > 2).length;
  const before = pair.map(legsOf);
  const after = minimizeLegs(pair, 50);
  ok(legsOf(after[0]) === before[0], "the first deck keeps its legs");
  ok(legsOf(after[1]) === before[1] - 2, `the second drops the two at the shared edge (${before[1]} → ${legsOf(after[1])})`);
  ok(after[1].count === legsOf(after[1]), "count follows");
  const apart = minimizeLegs([at(one, 0), at(one, 3000)], 50);
  ok(legsOf(apart[1]) === before[1], "decks apart keep all their legs");
}

// 3D: a simple deck a block to the stage height; a legged one its top on legs
{
  const legs = { structure: "legsBasic" as const, diameter: 50, profile: "square" as const, spacing: 1000, hideDeck: false };
  const outline = rect(0, 0, 2000, 1000);
  const plan = stagePlug(outline, legs) as StagePlan;
  const zs = (solid: number[][]): number[] => solid.flatMap((f) => f.filter((_, i) => i % 3 === 2));
  const simple = pieceSolid(outline, plan, "simple", 600, 20);
  ok(near(Math.min(...zs(simple)), 0) && near(Math.max(...zs(simple)), 600), "a simple deck stands from the floor to its height");
  const legged = pieceSolid(outline, plan, "legsBasic", 600, 20);
  ok(near(Math.max(...zs(legged)), 600) && zs(legged).some((z) => near(z, 580)), "a legged deck's top is 20 thick");
  ok(legged.length > simple.length, "with its legs");
  const top = pieceSolid(outline, plan, "deckOnly", 600, 20);
  ok(near(Math.min(...zs(top)), 580), "deck only is its top alone");
}

// steps fitted to a stage
ok(stepsFor(600) === 3 && stepsFor(720) === 3 && stepsFor(721) === 4 && stepsFor(100) === 1 && stepsFor(180) === 1, `steps for a height: ${[600, 720, 721, 100, 180].map(stepsFor)}`);
{
  const solid = stepsSolid({ x: 0, y: 0 }, 0, 1200, 3, 300, false, 800);
  const tops = solid.flatMap((f) => f.filter((_, i) => i % 3 === 2));
  ok(near(Math.max(...tops), 600), "the top tread is a riser below the stage");
  const xs = solid.flatMap((f) => f.filter((_, i) => i % 3 === 0));
  ok(near(Math.max(...xs), 900) && near(Math.min(...xs), 0), "three treads come down along +x");
  const withTop = stepsSolid({ x: 0, y: 0 }, Math.PI / 2, 1200, 3, 300, true, 800);
  const zs = withTop.flatMap((f) => f.filter((_, i) => i % 3 === 2));
  const ys = withTop.flatMap((f) => f.filter((_, i) => i % 3 === 1));
  ok(near(Math.max(...zs), 800) && near(Math.max(...ys), 1200, 1e-6), "a top step level with the stage; turned a quarter, they come down +y");
}

// a room: the walls' inner faces on the shape, drawn either way round, their outer faces a thickness out
{
  const room = roomRing([...rect(0, 0, 6000, 4000)].reverse(), 200);
  ok(room !== null && room.inside.length === 4 && room.outside.length === 4, "a rectangle's room has four corners");
  if (room) {
    const xs = room.outside.map((p) => p.x);
    const ys = room.outside.map((p) => p.y);
    ok(near(Math.min(...xs), -200) && near(Math.max(...xs), 6200) && near(Math.min(...ys), -200) && near(Math.max(...ys), 4200), "the outside ring a thickness out");
    ok(near(area(room.outside) - area(room.inside), 6400 * 4400 - 6000 * 4000, 1e-3), "the walls' area between the rings");
  }
  ok(roomRing(rect(0, 0, 50, 50), 0) === null, "too small a room");
  const l = roomRing([{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 1000 }, { x: 3000, y: 2000 }, { x: 0, y: 2000 }], 100);
  ok(l !== null && l.inside.length === 4, "a point in a straight line is dropped");
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
