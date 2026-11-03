// npx tsx src/features/theatre/connectcad/cableRouteShapes.check.ts
import { dropName, joinAtDrop, joinAtOutline, nearestOnPath, network, nodesAt, nodesInside, nodesNear, pathLength3, ROUTE_LETTERS, routeCorners, routeLetter, routeRank, shortestRoute, shortestRoutes, spareNumber, splitPath } from "./cableRouteShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-6;
const p3 = (x: number, y: number, z = 0) => ({ x, y, z });
const text = (ps: readonly { x: number; y: number; z: number }[]): string => ps.map((p) => `${p.x},${p.y},${p.z}`).join(" ");

// corners: a rise where the height changes, at the corner before
ok(text(routeCorners([p3(0, 0, 2400), p3(1000, 0, 2400), p3(1000, 1000, 3000)])) === "0,0,2400 1000,0,2400 1000,0,3000 1000,1000,3000", "a rise at the corner before the new height");
ok(text(routeCorners([p3(0, 0), p3(0, 0), p3(500, 0)])) === "0,0,0 500,0,0", "a click twice in one place is one corner");
ok(near(pathLength3(routeCorners([p3(0, 0, 0), p3(300, 0, 0), p3(300, 400, 600)])), 300 + 600 + 400), "length counts the rise");

// a point on a path, and the path split there
const L = [p3(0, 0, 100), p3(1000, 0, 100), p3(1000, 1000, 300)];
const on = nearestOnPath(L, { x: 400, y: 30 })!;
ok(on.i === 0 && near(on.t, 0.4) && near(on.d, 30) && near(on.at.z, 100), `nearest (${JSON.stringify(on)})`);
const up = nearestOnPath(L, { x: 1010, y: 500 })!;
ok(up.i === 1 && near(up.at.z, 200), "a height along a sloping piece");
const halves = splitPath(L, 0, 0.4)!;
ok(text(halves[0]) === "0,0,100 400,0,100" && text(halves[1]) === "400,0,100 1000,0,100 1000,1000,300", "split mid-piece");
const atCorner = splitPath(L, 0, 1)!;
ok(text(atCorner[0]) === "0,0,100 1000,0,100" && text(atCorner[1]) === "1000,0,100 1000,1000,300", "split at a corner");
ok(splitPath(L, 0, 0) === null && splitPath(L, 1, 1) === null, "no split at an end");

// names: A to Z without I and O, then two letters
const taken = new Set<string>();
const names: string[] = [];
for (let k = 0; k < 26; k++) {
  const n = dropName(taken);
  taken.add(n);
  names.push(n);
}
ok(names.slice(0, 9).join("") === "ABCDEFGHJ" && !names.includes("I") && !names.includes("O") && names[23] === "Z" && names[24] === "AA" && names[25] === "AB", `names (${names.join(",")})`);
ok(dropName(new Set(["A", "C"])) === "B", "the first free one");

// a network: a trunk at 2400 with a branch joined at its corner, and a path off on its own
const trunk = { id: "T", points: [p3(0, 0, 2400), p3(5000, 0, 2400)] };
const left = { id: "L", points: [p3(0, 0, 2400), p3(0, 0, 0)] };
const branch = { id: "B", points: [p3(5000, 0, 2400), p3(5000, 3000, 2400), p3(5000, 3000, 300)] };
const alone = { id: "X", points: [p3(9000, 9000, 2400), p3(9500, 9000, 2400)] };
const net = network([trunk, left, branch, alone]);
ok(net.nodes.length === 7 && net.edges.length === 5, `joined at shared corners (${net.nodes.length} nodes, ${net.edges.length} edges)`);
const floor = nodesNear(net, { x: 0, y: 0 }, 50);
ok(floor.length === 2, "two corners over one place, at different heights");
const start = new Map(nodesNear(net, { x: 0, y: 0 }, 50).filter((k) => net.nodes[k].z === 0).map((k) => [k, 0]));
const end = new Map(nodesNear(net, { x: 5000, y: 3000 }, 50).filter((k) => net.nodes[k].z === 300).map((k) => [k, 0]));
const r = shortestRoute(net, start, end)!;
ok(near(r.length, 2400 + 5000 + 3000 + 2100) && r.edges.map((e) => net.edges[e].path).join("") === "LTBB", `the way through (${r.length}, ${r.edges.map((e) => net.edges[e].path)})`);
// the extra to reach a corner counts: from the floor the drop is shorter than going up first
const both = new Map([...nodesNear(net, { x: 0, y: 0 }, 50)].map((k) => [k, net.nodes[k].z === 0 ? 0 : 5000]));
ok(near(shortestRoute(net, both, end)!.length, 2400 + 5000 + 3000 + 2100), "the cheaper way in");
ok(shortestRoute(net, start, new Map(nodesNear(net, { x: 9000, y: 9000 }, 50).map((k) => [k, 0]))) === null, "a path off on its own isn't reached");
ok(nodesInside(net, [{ x: 4900, y: 2900 }, { x: 5100, y: 2900 }, { x: 5100, y: 3100 }, { x: 4900, y: 3100 }]).length === 2, "corners inside an outline");
ok(near(shortestRoute(net, start, start)!.length, 0), "the same place");

// joining equipment: at a rack's outline (a corner just behind it counts), and through a drop point
const rack = [{ x: -300, y: -40 }, { x: 300, y: -40 }, { x: 300, y: -1000 }, { x: -300, y: -1000 }];
const atRack = joinAtOutline(net, rack, 1000);
ok(atRack.size === 2 && near(atRack.get(nodesNear(net, { x: 0, y: 0 }, 1).find((k) => net.nodes[k].z === 0)!), 1000) && near(atRack.get(nodesNear(net, { x: 0, y: 0 }, 1).find((k) => net.nodes[k].z === 2400)!), 1400), `rack joins within 50 mm (${[...atRack]})`);
ok(joinAtOutline(net, rack, 1000, 30).size === 0, "too far off");
const viaDrop = joinAtDrop(net, { x: 5000, y: 3010 }, { x: 5400, y: 3310 }, 300);
ok(viaDrop.size === 2 && near(Math.min(...viaDrop.values()), 500), `drop point to equipment 500 across (${[...viaDrop]})`);
ok(nodesAt(net, [{ x: 4990, y: -10 }, { x: 5010, y: -10 }, { x: 5010, y: 10 }, { x: 4990, y: 10 }]).length === 1, "corners at an outline");

// alternative routes: a ring with a spur, so two ways round from one end to the other
//     b
//   a   c       (b raised, so the top way is the longer)
//   │   │
//   d ─ e ─ f
const ring = network([
  { id: "ab", points: [p3(0, 0), p3(1000, -500)] },
  { id: "bc", points: [p3(1000, -500), p3(2000, 0)] },
  { id: "ad", points: [p3(0, 0), p3(0, 1000)] },
  { id: "de", points: [p3(0, 1000), p3(2000, 1000)] },
  { id: "ce", points: [p3(2000, 0), p3(2000, 1000)] },
  { id: "ef", points: [p3(2000, 1000), p3(3000, 1000)] },
]);
const nodeAt = (x: number, y: number): number => nodesNear(ring, { x, y }, 1)[0];
const ways = shortestRoutes(ring, new Map([[nodeAt(0, 0), 0]]), new Map([[nodeAt(3000, 1000), 0]]));
const named = (w: { edges: number[] }): string => w.edges.map((e) => ring.edges[e].path).join(" ");
ok(ways.length === 2 && named(ways[0]) === "ad de ef" && near(ways[0].length, 4000) && named(ways[1]) === "ab bc ce ef" && near(ways[1].length, 2 * Math.hypot(1000, 500) + 2000), `two ways round, shortest first (${ways.map(named).join(" | ")})`);
ok(near(ways[0].length, shortestRoute(ring, new Map([[nodeAt(0, 0), 0]]), new Map([[nodeAt(3000, 1000), 0]]))!.length), "the first is the shortest");
ok(shortestRoutes(ring, new Map([[nodeAt(0, 0), 0]]), new Map([[nodeAt(3000, 1000), 0]]), 1).length === 1, "as many as asked");
// joined at two corners at one end: going past one to the other isn't another way
const wide = shortestRoutes(ring, new Map([[nodeAt(0, 0), 0], [nodeAt(1000, -500), 0]]), new Map([[nodeAt(2000, 0), 0]]));
ok(wide.length === 2 && named(wide[0]) === "bc" && named(wide[1]) === "ad de ce", `no way that only adds a piece (${wide.map(named).join(" | ")})`);
ok(shortestRoutes(ring, new Map([[nodeAt(0, 0), 0]]), new Map([[nodeAt(0, 0), 0]])).length === 1, "the same place: one way, no pieces");
ok(shortestRoutes(net, start, new Map(nodesNear(net, { x: 9000, y: 9000 }, 50).map((k) => [k, 0]))).length === 0, "no way at all");
ok(routeLetter(0) === "A" && routeLetter(2) === "C" && routeRank("") === 0 && routeRank("b") === 1 && routeRank("Z") === 0 && ROUTE_LETTERS.length === 6, "letters");
ok(spareNumber("A", "B", ["A-B-1", "A-B-3", "B-A-7", "A-B-x"]) === "A-B-4" && spareNumber("A", "C", []) === "A-C-1", "spare numbers");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
