// Run with: npx tsx src/app/adjacencyShapes.check.ts
import assert from "node:assert/strict";
import {
  adjacencyScore,
  bubbleGrid,
  clampStrength,
  fingerprint,
  linkEnds,
  linkWeight,
  matrixDrawing,
  parseAdjacency,
  splitRows,
  stackDrawing,
  type AdjacencyTable,
  type StackRow,
} from "./adjacencyShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const square = (cx: number, cy: number, half: number): { x: number; y: number }[] => [
  { x: cx - half, y: cy - half },
  { x: cx + half, y: cy - half },
  { x: cx + half, y: cy + half },
  { x: cx - half, y: cy + half },
];

// strengths and weights
{
  assert.equal(clampStrength(0), 1);
  assert.equal(clampStrength(99), 18);
  assert.equal(clampStrength(4.4), 4);
  assert.equal(clampStrength(Number.NaN), 1);
  assert.equal(linkWeight(1), 7);
  assert.equal(linkWeight(18), 126);
  assert.ok(linkWeight(9) > linkWeight(2));
}

// a link is the part between its spaces
{
  const [a, b] = linkEnds({ x: 0, y: 0 }, square(0, 0, 100), { x: 1000, y: 0 }, square(1000, 0, 200));
  near(a.x, 100);
  near(a.y, 0);
  near(b.x, 800);
  // overlapping spaces are joined centre to centre
  const [c, d] = linkEnds({ x: 0, y: 0 }, square(0, 0, 500), { x: 100, y: 0 }, square(100, 0, 500));
  assert.deepEqual([c.x, d.x], [0, 100]);
  // on a slant
  const [e, f] = linkEnds({ x: 0, y: 0 }, square(0, 0, 100), { x: 1000, y: 1000 }, square(1000, 1000, 100));
  near(e.x, 100);
  near(e.y, 100);
  near(f.x, 900);
}

// the score: length × strength, summed
{
  assert.equal(adjacencyScore([]), 0);
  assert.equal(adjacencyScore([{ length: 10, strength: 5 }, { length: 4, strength: 2 }]), 58);
}

// the matrix's diamonds
{
  const m = matrixDrawing(["Abc", "Def", "Ghi"], [{ i: 0, j: 1, strength: 5 }, { i: 0, j: 2, strength: 2 }], 10, 1, 1);
  assert.equal(m.boxes.length, 3);
  // three lines down and three up
  assert.equal(m.lines.length, 6);
  const nameWidth = m.boxes[0][1].x;
  near(m.width, nameWidth + 3 * 10);
  near(m.height, 60);
  // neighbours meet by the line between their rows, one half cell along
  const first = m.texts.find((t) => t.text === "5");
  near(first?.at.x ?? 0, nameWidth + 10);
  near(first?.at.y ?? 0, -20);
  // the first and last meet at the middle row, a whole cell further on
  const far = m.texts.find((t) => t.text === "2");
  near(far?.at.x ?? 0, nameWidth + 20);
  near(far?.at.y ?? 0, -30);
  // all the lines stay inside the triangle
  for (const [, end] of m.lines) assert.ok(end.x <= m.width + 1e-6 && end.y <= 1e-6 && end.y >= -m.height - 1e-6);
  // the apex is the point of the last lines down and up
  const tips = m.lines.map(([, end]) => end).filter((p) => Math.abs(p.x - m.width) < 1e-6);
  assert.equal(tips.length, 2);
  near(tips[0].y, -30);
  // scales
  const wide = matrixDrawing(["Abc"], [], 10, 2, 3);
  near(wide.height, 40);
  near(wide.width, wide.boxes[0][1].x + 20 * 3);
  assert.equal(matrixDrawing([], [], 10, 1, 1).boxes.length, 0);
}

// the stacking diagram
{
  const rows: StackRow<string>[] = [
    { name: "Ground", elevation: 0, spaces: [{ name: "A", department: "1", area: 100, fill: "a" }, { name: "B", department: "2", area: 100, fill: "b" }, { name: "C", department: "1", area: 200, fill: "c" }] },
    { name: "Upper", elevation: 3000, spaces: [{ name: "A rather long name for its width", department: "", area: 1, fill: "d" }, { name: "E", department: "", area: 199, fill: "e" }] },
  ];
  const options = { textHeight: 10, heightScale: 1, widthScale: 1, gapScale: 1, showTotals: true, areaText: (n: number) => `${n} sq ft` };
  const d = stackDrawing(rows, options);
  // the highest floor is on top
  assert.equal(d.outlines.length, 2);
  assert.ok(d.outlines[0][0].y > d.outlines[1][0].y);
  assert.ok(d.texts.some((t) => t.text === "Upper  200 sq ft" && Math.abs(t.at.y - (d.outlines[0][0].y + d.outlines[0][2].y) / 2) < 1e-6));
  assert.ok(d.texts.some((t) => t.text === "Total  600 sq ft"));
  assert.ok(!stackDrawing(rows, { ...options, showTotals: false }).texts.some((t) => t.text.startsWith("Total")));
  // spaces are as wide as their areas, the largest floor as wide as the diagram asks
  const widths = d.segments.map((s) => s.points[1].x - s.points[0].x);
  near(widths.reduce((a, b) => a + b, 0), 600 * (600 / 400));
  near(d.outlines[1][1].x - d.outlines[1][0].x, 600);
  // a department's spaces come together, a thin line between them and a heavy one between departments
  const ground = d.segments.slice(2).map((s) => s.fill);
  assert.deepEqual(ground, ["a", "c", "b"]);
  assert.equal(d.thin.length, 1);
  assert.equal(d.heavy.length, 2);
  // a name that doesn't fit its space goes above it
  const long = d.texts.find((t) => t.text.startsWith("A rather"));
  assert.ok((long?.at.y ?? 0) > d.outlines[0][0].y);
  // scales
  const taller = stackDrawing(rows, { ...options, heightScale: 2, gapScale: 3 });
  near(taller.outlines[0][0].y - taller.outlines[0][2].y, 60);
  near(taller.outlines[0][2].y - taller.outlines[1][0].y, 120);
  assert.equal(stackDrawing([], options).segments.length, 0);
}

// reading a file's rows
{
  assert.deepEqual(splitRows('a,"b,c",d\r\n,"say ""hi"""\n', ","), [["a", "b,c", "d"], ["", 'say "hi"']]);
  assert.deepEqual(splitRows("a\tb\n\nc", "\t"), [["a", "b"], [""], ["c"]]);
  assert.deepEqual(splitRows("", ","), []);
}

// the worksheet's own diamond: n columns along, n rows below the one space and n above the other
{
  const text = [
    "Space Name\tArea",
    "",
    "Maintenance Bay\t800",
    "\t\t5",
    "Shop\t400\t\t3",
    "\t\t-\t\t9",
    "Air Pack Room\t1,000",
    "\t\t1",
    "Storage",
    "",
  ].join("\n");
  const table = parseAdjacency(splitRows(text, "\t"), { headerRows: 2, rowSpacing: 1, columns: { department: 0, space: 1, area: 2, relationships: 3 } }) as AdjacencyTable;
  assert.deepEqual(table.spaces.map((s) => s.name), ["Maintenance Bay", "Shop", "Air Pack Room", "Storage"]);
  assert.deepEqual(table.spaces.map((s) => s.area), [800, 400, 1000, 0]);
  assert.deepEqual(table.links, [
    { a: 0, b: 1, strength: 5 },
    { a: 0, b: 2, strength: 3 },
    { a: 0, b: 3, strength: 9 },
    { a: 2, b: 3, strength: 1 },
  ]);
  assert.equal(table.leftOut, 0);
}

// a relationship with nothing there is counted, a department read, and a value past 18 held at 18
{
  const rows = [
    ["D1", "One", "10", "99"],
    ["", "", "", "", "4"],
    ["D1", "Two", "20"],
  ];
  const table = parseAdjacency(rows, { headerRows: 0, rowSpacing: 1, columns: { department: 1, space: 2, area: 3, relationships: 4 } }) as AdjacencyTable;
  assert.deepEqual(table.spaces.map((s) => s.department), ["D1", "D1"]);
  assert.equal(table.links.length, 0);
  assert.equal(table.leftOut, 2);
  const held = parseAdjacency([["A", "1"], ["", "", "99"], ["B", "2"]], { headerRows: 0, rowSpacing: 1, columns: { department: 0, space: 1, area: 2, relationships: 3 } }) as AdjacencyTable;
  assert.deepEqual(held.links, [{ a: 0, b: 1, strength: 18 }]);
}

// a space on every row
{
  const rows = [
    ["A", "10", "5", "2"],
    ["B", "20", "3"],
    ["C", "30", "7"],
  ];
  const table = parseAdjacency(rows, { headerRows: 0, rowSpacing: 0, columns: { department: 0, space: 1, area: 2, relationships: 3 } }) as AdjacencyTable;
  assert.deepEqual(table.links, [
    { a: 0, b: 1, strength: 5 },
    { a: 0, b: 2, strength: 2 },
    { a: 1, b: 2, strength: 3 },
  ]);
  assert.equal(table.leftOut, 1);
}

// wrong settings say so
{
  const options = { headerRows: 0, rowSpacing: 1, columns: { department: 0, space: 1, area: 2, relationships: 3 } } as const;
  assert.equal(typeof parseAdjacency([], options), "string");
  assert.match(parseAdjacency([["A"], [""], [""], [""], ["B"]], options) as string, /Row 3/);
}

// bubbles: as much area as asked, none touching
{
  const { rings, width, height } = bubbleGrid([400, 100, 100, 100, 100], { x: 1000, y: 2000 });
  assert.equal(rings.length, 5);
  near(rings[0][3].x - rings[0][0].x, 20);
  near(rings[0][0].y - rings[0][1].y, 20);
  near(rings[1][3].x - rings[1][0].x, 10);
  near(width, 90);
  near(height, 60);
  for (const ring of rings) for (const p of ring) assert.ok(p.x >= 1000 && p.x <= 1090 && p.y <= 2000 && p.y >= 1940);
  // rows of three: the fourth is under the first
  assert.ok(rings[3][0].y < rings[0][1].y);
  assert.ok(rings[1][0].x > rings[0][3].x);
}

// fingerprints
{
  assert.equal(fingerprint({ a: 1 }), fingerprint({ a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
}

console.log("adjacencyShapes ok");
