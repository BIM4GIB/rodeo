// Run with: npx tsx src/app/treeSurveyShapes.check.ts
import assert from "node:assert/strict";
import { bracketedPairs, guessSurveyParameter, guessSurveyUnit, locates, rowFields, siteOf, surveyTable, treeMappings, usesDegrees, type ColumnMapping } from "./treeSurveyShapes.ts";

const FT = 304.8;
const rows = [["Site survey"], ["Tag", "Species", "X (m)", "Y (m)", "Tag"], ["T1", "Oak", "10", "20", "x"], ["", "", "", "", ""], ["T2", "Ash", "30", "40"]];

// the header is the row at the number, and data follows it, blanks left out
{
  const t = surveyTable(rows, 2, true);
  assert.deepEqual(t.columns, ["Tag", "Species", "X (m)", "Y (m)", "Tag (2)"]);
  assert.equal(t.data.length, 2);
  assert.equal(t.data[1][0], "T2");
}
// no header: columns numbered, data starts at the row
{
  const t = surveyTable(rows, 3, false);
  assert.deepEqual(t.columns, ["1", "2", "3", "4", "5"]);
  assert.equal(t.data[0][0], "T1");
}
assert.deepEqual(surveyTable([], 1, true), { columns: [], data: [] });

// what a name suggests
const guesses: Record<string, string> = { X: "x", "Y (m)": "y", Easting: "x", NORTHING: "y", Elevation: "z", Latitude: "lat", Lng: "lon", "Lat/Long": "latlon", "Lon Lat": "lonlat", "XY Pair": "xy", "YX": "yx", Species: "botanical", "Common Name": "common", "DBH (in)": "dbh", Tag: "number", Colour: "none" };
for (const [name, want] of Object.entries(guesses)) assert.equal(guessSurveyParameter(name), want, name);
assert.equal(guessSurveyUnit("DBH (in)"), "in");
assert.equal(guessSurveyUnit("Canopy (ft)"), "ft");
assert.equal(guessSurveyUnit("Y (m)"), "m");
assert.equal(guessSurveyUnit("Height in metres"), "m");
assert.equal(guessSurveyUnit("Tag"), "auto");

// pairs in brackets
assert.deepEqual(bracketedPairs("[10, 20]"), { one: true, pairs: [[10, 20]] });
assert.deepEqual(bracketedPairs("[[10, 10], [10, 20], [20, 20]]"), { one: false, pairs: [[10, 10], [10, 20], [20, 20]] });
assert.equal(bracketedPairs("10, 20"), null);
assert.equal(bracketedPairs("[10]"), null);
assert.equal(bracketedPairs("[oops"), null);

const map = (...m: [string, ColumnMapping["parameter"], ColumnMapping["unit"]?][]): ColumnMapping[] => m.map(([column, parameter, unit]) => ({ column, parameter, unit: unit ?? "auto" }));
const nowhere = (): null => null;
const units = "millimeters";

// X, Y and Z columns, each in its unit
{
  const m = map(["E", "x", "m"], ["N", "y", "ft"], ["H", "z", "m"]);
  assert.deepEqual(siteOf({ E: "10", N: "20", H: "3" }, m, units, nowhere), { kind: "point", at: { x: 10000, y: 20 * FT }, z: 3000 });
  assert.deepEqual(siteOf({ E: "10", N: "20", H: "" }, m, units, nowhere), { kind: "point", at: { x: 10000, y: 20 * FT }, z: null });
  assert.equal(siteOf({ E: "10", N: "", H: "" }, m, units, nowhere), null);
  assert.equal(siteOf({ E: "here", N: "20", H: "" }, m, units, nowhere), null);
  assert.equal(locates(m), true);
  assert.equal(usesDegrees(m), false);
}
// pairs, either way round, and an area
{
  const xy = map(["P", "xy", "m"]);
  assert.deepEqual(siteOf({ P: "[1, 2]" }, xy, units, nowhere), { kind: "point", at: { x: 1000, y: 2000 }, z: null });
  assert.deepEqual(siteOf({ P: "[1, 2]" }, map(["P", "yx", "m"]), units, nowhere), { kind: "point", at: { x: 2000, y: 1000 }, z: null });
  assert.deepEqual(siteOf({ P: "[[1,1],[1,2],[2,2]]" }, xy, units, nowhere), { kind: "area", ring: [{ x: 1000, y: 1000 }, { x: 1000, y: 2000 }, { x: 2000, y: 2000 }] });
  // two aren't an area
  assert.equal(siteOf({ P: "[[1,1],[1,2]]" }, xy, units, nowhere), null);
}
// degrees go through the drawing's georeferencing
{
  const at = (p: { lat: number; lon: number }): { x: number; y: number } => ({ x: p.lon * 100, y: p.lat * 100 });
  const m = map(["La", "lat"], ["Lo", "lon"]);
  assert.deepEqual(siteOf({ La: "39.5", Lo: "-76" }, m, units, at), { kind: "point", at: { x: -7600, y: 3950 }, z: null });
  assert.equal(siteOf({ La: "139.5", Lo: "-76" }, m, units, at), null);
  assert.equal(usesDegrees(m), true);
  assert.deepEqual(siteOf({ P: "[39.5, -76]" }, map(["P", "latlon"]), units, at), { kind: "point", at: { x: -7600, y: 3950 }, z: null });
  assert.deepEqual(siteOf({ P: "[-76, 39.5]" }, map(["P", "lonlat"]), units, at), { kind: "point", at: { x: -7600, y: 3950 }, z: null });
  // not georeferenced
  assert.equal(siteOf({ La: "39.5", Lo: "-76" }, m, units, nowhere), null);
}
// no location
assert.equal(locates(map(["A", "x"])), false);
assert.equal(locates(map(["A", "number"], ["B", "z"])), false);

// a tree's own parameters, without the location or what isn't mapped
assert.deepEqual(treeMappings(map(["A", "x"], ["B", "dbh", "in"], ["C", "none"], ["D", "number"])), [{ field: "B", parameter: "dbh", unit: "in" }, { field: "D", parameter: "number", unit: "auto" }]);
assert.deepEqual(rowFields({ A: "1" }), [{ name: "A", kind: "text", value: "1" }]);

console.log("treeSurveyShapes ok");
