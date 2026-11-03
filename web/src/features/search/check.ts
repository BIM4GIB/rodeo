// Checks the search feature's pure modules (fuzzy scorer, usages, query language)
// against a drawing, in node, with no browser:
//
//   cd web && npx tsx src/features/search/check.ts ../samples/sample.vwx
//
// Prints the counts for each query and usage search, and exits non-zero when a
// check that should hold does not.

import { readFileSync } from "node:fs";
import { openVwx } from "../../core/index.ts";
import { namesOf, labelOf, kindName } from "./describe.ts";
import { fuzzyMatch } from "./fuzzy.ts";
import { runQuery } from "./query.ts";
import { findUsages, objectsWithin, targetLabel, usageTargetsOf, type UsageTarget } from "./usages.ts";

const file = process.argv[2] ?? "../samples/sample.vwx";
const session = openVwx(new Uint8Array(readFileSync(file)), file.split("/").pop() ?? "drawing.vwx");
const doc = session.doc;
const names = namesOf(doc);
let failures = 0;

function check(ok: boolean, what: string): void {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${what}`);
  }
}

// ---- fuzzy scorer ----------------------------------------------------------------

console.log("fuzzy");
const fuzzyCases: [string, string, boolean][] = [
  ["edc", "Edit › Copy", true],
  ["edit copy", "Edit › Copy", true],
  ["zzq", "Edit › Copy", false],
  ["walls", "A-Wall", false],
  ["wal", "A-Wall", true],
  ["", "anything", true],
  ["fc", "fillColour", true],
];
for (const [q, text, want] of fuzzyCases) {
  const got = fuzzyMatch(q, text) !== null;
  check(got === want, `fuzzy ${JSON.stringify(q)} in ${JSON.stringify(text)} expected ${want}`);
}
const classes = doc.classes();
const ranked = classes
  .map((c) => ({ name: c.name, m: fuzzyMatch("wall", c.name) }))
  .filter((x) => x.m !== null)
  .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0))
  .slice(0, 5);
console.log(`  "wall" ranks: ${ranked.map((x) => `${x.name} (${x.m?.score.toFixed(1)})`).join(", ") || "no class matches"}`);
const symbolHits = doc.symbolDefs().filter((s) => fuzzyMatch("drb", s.name));
console.log(`  "drb" matches ${symbolHits.length} of ${doc.symbolDefs().length} symbol names`);

// ---- usages ---------------------------------------------------------------------

console.log("usages");
const layerObjects = doc.layers().flatMap((l) => doc.objects(l.id));
const instanceCount = new Map<number, number>();
let nestedParts = 0;
for (const o of layerObjects) {
  if (o.kind === "symbol" && o.symbol !== undefined && !o.id.includes("/")) {
    instanceCount.set(o.symbol, (instanceCount.get(o.symbol) ?? 0) + 1);
  }
  if (o.id.includes("/") && o.symbol !== undefined) nestedParts++;
}
const busiest = [...instanceCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
const targets: UsageTarget[] = [];
for (const [index] of busiest) {
  const def = doc.symbolDefs().find((d) => d.index === index);
  if (def) targets.push({ kind: "symbol", index, name: def.name });
}
for (const c of classes.slice(0, 2)) targets.push({ kind: "class", index: c.index, name: c.name });
for (const t of doc.lineTypes().slice(0, 2)) targets.push({ kind: "lineType", style: t.style, name: t.name });
const formats = new Map<number, string>();
for (const o of doc.objects(doc.layers()[0]?.id ?? "").slice(0, 500)) {
  for (const r of doc.records(o.id)) formats.set(r.format, r.name);
}
const [firstFormat] = [...formats.entries()];
if (firstFormat) targets.push({ kind: "record", format: firstFormat[0], name: firstFormat[1] });
console.log(`  nested symbol parts in the drawing: ${nestedParts}`);
for (const t of targets) {
  const started = Date.now();
  const uses = findUsages(doc, t);
  const first = uses[0];
  console.log(
    `  ${targetLabel(t)}: ${uses.length} use${uses.length === 1 ? "" : "s"}${first ? ` (first: ${first.label}, ${first.how})` : ""} [${Date.now() - started} ms]`,
  );
  if (t.kind === "symbol") {
    check(uses.every((u) => doc.object(u.id)?.kind === "symbol" || u.how.startsWith("Nested")), `symbol usages are instances: ${t.name}`);
  }
}
const sampleInstance = layerObjects.find((o) => o.kind === "symbol" && !o.id.includes("/"));
if (sampleInstance) {
  const found = usageTargetsOf(doc, objectsWithin(doc, [sampleInstance.id]));
  console.log(`  targets of ${labelOf(sampleInstance, names)}: ${found.map(targetLabel).join(", ")}`);
  check(found.some((t) => t.kind === "symbol" && t.index === sampleInstance.symbol), "a symbol instance uses its definition");
}
const sample = layerObjects.find((o) => !o.id.includes("/") && o.attrs);
if (sample) {
  const found = usageTargetsOf(doc, objectsWithin(doc, [sample.id]));
  console.log(`  targets of ${labelOf(sample, names)} (${kindName(sample)}): ${found.map(targetLabel).join(", ")}`);
  check(found.some((t) => t.kind === "class" && t.index === sample.classIndex), "class of an object is one of its usage targets");
}

// ---- queries --------------------------------------------------------------------

console.log("queries");
const onLayer = JSON.stringify(doc.layers()[1]?.name ?? doc.layers()[0]?.name ?? "");
const queries: string[] = [
  "objects",
  "lines",
  "text",
  "text where text contains \"fire\"",
  "rectangles where area > 10m2",
  "polygons where area > 1m2",
  "lines where length > 2000",
  "lines where length >= 1m and length < 3m",
  `objects where class = "None" on ${onLayer}`,
  `lines where layer = ${onLayer}`,
  "objects where lineweight >= 0.25mm",
  "objects where fill = none",
  "objects where width > 5000 and height > 5000",
  "objects where x > 100000 or y > 100000",
  "symbols where symbol startswith \"Break\"",
  "walls",
  "objects where record.Nothing = 1",
  "objects where kind = line and pen = \"1\"",
  "polygons where linetype != \"none\"",
  "objects on all",
];
const errors: string[] = [
  "lines where",
  "lines where width = ",
  "lines where foo = 1",
  "lines on \"No Such Layer\"",
  "lines where area > 10m",
  "lines where width contains 5",
  "lines where name = \"unclosed",
  "lines where width = 5 xyz",
];
for (const q of queries) {
  const t0 = Date.now();
  const out = runQuery(doc, q, { visible: (o) => session.doc.object(o.id) !== null });
  const ms = Date.now() - t0;
  if (out.ok) {
    console.log(`  ${String(out.run.hits.length).padStart(6)}  ${q}  (kind count ${out.run.kindCount}, ${ms} ms)`);
  } else {
    console.log(`  ERROR  ${q}  -> ${out.error} at ${out.pos}`);
  }
}
for (const q of errors) {
  const out = runQuery(doc, q);
  if (out.ok) {
    console.log(`  ${String(out.run.hits.length).padStart(6)}  ${q}  (no error)`);
  } else {
    console.log(`  error  ${q}  -> ${out.error} at ${out.pos}`);
    check(out.pos >= 0, `error position for ${q}`);
  }
}

// invariants: a query for every object agrees with the drawing's own counts
const everything = runQuery(doc, "objects");
const lines = runQuery(doc, "lines");
const textHits = runQuery(doc, 'text where text contains "fire"');
check(everything.ok && lines.ok && textHits.ok, "queries parse");
if (everything.ok && lines.ok && textHits.ok) {
  check(lines.run.hits.every((h) => {
    const o = doc.object(h.id);
    return o?.kind === "line";
  }), "every line hit is a line");
  check(everything.run.hits.length >= lines.run.hits.length, "objects includes lines");
}

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
