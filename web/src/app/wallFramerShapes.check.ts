// npx tsx src/app/wallFramerShapes.check.ts
import { countPieces, frameWall, LUMBER, pieceLength, wallInfo, type ClassOptions, type Piece } from "./wallFramerShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;
const IN = 25.4;
const FT = 304.8;
const o: ClassOptions = { spacing: 16 * IN, sheetWidth: 4 * FT, sheetHeight: 8 * FT, maxPlate: 16 * FT, lumber: LUMBER[0], fireBlocking: false, doubleEnd: false, doubleTop: false, doubleBottom: false };
const of = (r: Piece[] | string, kind: string): Piece[] => (typeof r === "string" ? [] : r.filter((p) => p.kind === kind));
const t = 1.5 * IN;

const plain = frameWall(12 * FT, 8 * FT, [], o);
ok(typeof plain !== "string", "frames a plain wall");
ok(of(plain, "bottom").length === 1 && of(plain, "top").length === 1, "a plate top and bottom");
const studs = of(plain, "stud");
ok(studs.length === 10, `two end studs and eight on 16" marks (${studs.length})`);
ok(studs.every((p) => near(pieceLength(p), 8 * FT - 2 * t)), "studs stand between the plates");
ok(studs.some((p) => near(p.x0 + t / 2, 16 * IN)) && studs.some((p) => near(p.x0 + t / 2, 128 * IN)), "studs centred on the layout marks");
ok(studs.some((p) => near(p.x0, 0)) && studs.some((p) => near(p.x1, 12 * FT)), "end studs at both ends");

const doubled = frameWall(12 * FT, 8 * FT, [], { ...o, doubleTop: true, doubleBottom: true, doubleEnd: true });
ok(of(doubled, "bottom").length === 2 && of(doubled, "top").length === 2, "doubled plates");
ok(of(doubled, "stud").every((p) => near(pieceLength(p), 8 * FT - 4 * t)), "studs shorter between doubled plates");
ok(of(doubled, "stud").filter((p) => p.x0 < 2 * t + 0.01 || p.x1 > 12 * FT - 2 * t - 0.01).length === 4, "doubled end studs");

// a door: the bottom plate cut, kings, jacks, a header and cripples over it
const door = { from: 4 * FT, to: 7 * FT, sill: 0, head: 80 * IN };
const d = frameWall(12 * FT, 8 * FT, [door], o);
ok(of(d, "bottom").length === 2 && of(d, "bottom").some((p) => near(p.x1, 4 * FT)) && of(d, "bottom").some((p) => near(p.x0, 7 * FT)), "the bottom plate is cut through the door");
ok(of(d, "king").length === 2 && of(d, "jack").length === 2, "kings and jacks either side");
ok(of(d, "jack").every((p) => near(p.z1, 80 * IN)), "jacks carry the header at the door's head");
const header = of(d, "header")[0];
ok(!!header && near(header.x0, 4 * FT - t) && near(header.x1, 7 * FT + t) && near(header.z1 - header.z0, 7 * IN), "the header spans the jacks, two lumber depths tall");
ok(of(d, "cripple").length === 2, `cripples over the header on the marks (${of(d, "cripple").length})`);
ok(of(d, "stud").length === 10 - 3, `studs inside the opening's framing left out (${of(d, "stud").length})`);

// a window: a sill and cripples under it too
const win = { from: 6 * FT, to: 10 * FT, sill: 3 * FT, head: 7 * FT };
const w = frameWall(12 * FT, 8 * FT, [win], o);
const sill = of(w, "sill")[0];
ok(!!sill && near(sill.z1, 3 * FT) && near(sill.x0, 6 * FT) && near(sill.x1, 10 * FT), "a sill under the window");
ok(of(w, "cripple").filter((p) => p.z1 <= 3 * FT).length === 3 && of(w, "cripple").filter((p) => p.z0 >= 7 * FT).length === 3, "cripples under the sill and over the header");
ok(of(w, "bottom").length === 1, "a window leaves the bottom plate whole");

// fire blocking at the sheet's height on a taller wall
const tall = frameWall(12 * FT, 10 * FT, [], { ...o, fireBlocking: true });
const blocks = of(tall, "block");
ok(blocks.length === 9, `blocks between each pair of studs (${blocks.length})`);
ok(blocks.every((p) => near((p.z0 + p.z1) / 2, 8 * FT)), "at the sheet's height");
const low = of(frameWall(12 * FT, 8 * FT, [door], { ...o, fireBlocking: true }), "block");
ok(low.length > 0 && low.every((p) => near((p.z0 + p.z1) / 2, 4 * FT)) && low.every((p) => p.x1 <= 4 * FT - t + 0.01 || p.x0 >= 7 * FT + t - 0.01), "halfway up a lower wall, none across the door");

// plates no longer than the longest
const long = frameWall(20 * FT, 8 * FT, [], o);
ok(of(long, "bottom").length === 2 && of(long, "bottom").every((p) => p.x1 - p.x0 <= 16 * FT + 0.01), "plates cut at the longest plate");

// the wall's numbers
const info = wallInfo(12 * FT, 8 * FT, [], typeof plain === "string" ? [] : plain, o);
ok(near(info.area, 12 * FT * 8 * FT, 1) && info.sheets === 3 && info.studs === 10 && near(info.plates, 24 * FT), "area, sheets, studs and plate run");
const dinfo = wallInfo(12 * FT, 8 * FT, [door], typeof d === "string" ? [] : d, o);
ok(near(dinfo.area, 12 * FT * 8 * FT - 3 * FT * 80 * IN, 1), "the door's opening left out of the area");

// counted
const rows = countPieces(typeof d === "string" ? [] : d);
ok(rows[0].kind === "stud" && rows.reduce((n, r) => n + r.count, 0) === (typeof d === "string" ? 0 : d.length), "every piece counted");

// refusals
ok(typeof frameWall(50, 8 * FT, [], o) === "string", "too short");
ok(typeof frameWall(12 * FT, 80, [], o) === "string", "too low");
ok(typeof frameWall(12 * FT, 8 * FT, [], { ...o, spacing: 20 }) === "string", "spacing under a stud");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
