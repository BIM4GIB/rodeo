// Node check for Survey Input's sums: `npx tsx src/app/surveyShapes.check.ts`.

import assert from "node:assert/strict";
import { gridPoints, guessDelimiter, guessFormat, idParts, pastedCells, readSurvey, surveyCentre, surveyFormatLabel, surveyRows, SURVEY_UNITS } from "./surveyShapes.ts";

const near = (a: number, b: number, tol = 1e-9): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

assert.equal(surveyFormatLabel("PNEZD"), "Point, Northing, Easting, Elevation, Description");
assert.equal(guessDelimiter("a\tb,c\n"), "\t");
assert.equal(guessDelimiter("\n1,2,3\n"), ",");
assert.equal(guessDelimiter("1;2;3"), ";");
assert.equal(guessDelimiter("1 2 3"), " ");

// a space counts however many there are, the others one by one and quotes hold
assert.deepEqual(surveyRows("1   2 3\r\n\n 4 5  6 \n", " "), [["1", "2", "3"], ["4", "5", "6"]]);
assert.deepEqual(surveyRows('1,2,"tree, oak"\n\n,,\n3,4,5\n', ","), [["1", "2", "tree, oak"], ["3", "4", "5"]]);

const rows = surveyRows("Point,N,E,Z,Desc\n7,100,200,30.5,Oak tree\nA9,1e2,-5,+3,\nbad,row\n,,,\n8,x,1,2,no\n", ",");
const read = readSurvey(rows, "PNEZD", 1000);
assert.equal(read.points.length, 2);
assert.equal(read.skipped, 3);
assert.deepEqual(read.points[0], { id: "7", x: 200000, y: 100000, z: 30500, description: "Oak tree" });
assert.deepEqual(read.points[1], { id: "A9", x: -5000, y: 100000, z: 3000, description: "" });

// each order
assert.deepEqual(readSurvey([["1", "2", "3", "4"]], "PENZ", 1).points[0], { id: "1", x: 2, y: 3, z: 4, description: "" });
assert.deepEqual(readSurvey([["2", "3", "4"]], "NEZ", 1).points[0], { id: "", x: 3, y: 2, z: 4, description: "" });
assert.deepEqual(readSurvey([["2", "3", "4"]], "ENZ", 1).points[0], { id: "", x: 2, y: 3, z: 4, description: "" });
assert.deepEqual(readSurvey([["2", "3", "4", "big", "oak"]], "ENZD", 1).points[0], { id: "", x: 2, y: 3, z: 4, description: "big oak" });
assert.deepEqual(readSurvey([["1", "2", "3", "4", "d"]], "PENZD", 1).points[0], { id: "1", x: 2, y: 3, z: 4, description: "d" });

// a good guess at the format
assert.equal(guessFormat([["x", "y", "z"], ["1", "2", "3"]]), "ENZ");
assert.equal(guessFormat([["1", "2", "3", "4"]]), "PNEZ");
assert.equal(guessFormat([["1", "2", "3", "oak"]]), "ENZD");
assert.equal(guessFormat([["1", "2", "3", "4", "oak"]]), "PNEZD");
assert.equal(guessFormat([["no", "figures"]]), "PNEZD");

// survey feet are a touch longer
const usFoot = SURVEY_UNITS.find((u) => u.label === "US Survey Feet")?.mm ?? 0;
near(usFoot, 304.8006096012192, 1e-9);

// across then down from the upper left
assert.deepEqual(gridPoints({ x: 10, y: 20 }, 2, 3, 5), [{ x: 10, y: 20 }, { x: 15, y: 20 }, { x: 20, y: 20 }, { x: 10, y: 15 }, { x: 15, y: 15 }, { x: 20, y: 15 }]);

assert.deepEqual(surveyCentre([{ id: "", x: 0, y: 10, z: 0, description: "" }, { id: "", x: 4, y: 20, z: 0, description: "" }, { id: "", x: 1, y: 11, z: 0, description: "" }]), { x: 2, y: 15 });
assert.deepEqual(surveyCentre([]), { x: 0, y: 0 });

assert.deepEqual(idParts("A12"), { prefix: "A", number: 12 });
assert.deepEqual(idParts("7"), { prefix: "", number: 7 });
assert.deepEqual(idParts("STN"), { prefix: "STN", number: 0 });
assert.equal(idParts(""), null);

assert.deepEqual(pastedCells("1\t2\r\n3\t4\r\n"), [["1", "2"], ["3", "4"]]);
assert.deepEqual(pastedCells("5"), [["5"]]);

console.log("surveyShapes ok");
