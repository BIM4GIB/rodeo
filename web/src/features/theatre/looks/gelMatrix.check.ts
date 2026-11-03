// Checks for gelMatrix.ts, with each expected figure worked out by hand in the comments.

import assert from "node:assert/strict";
import { colorOf } from "../gels.ts";
import { cellOf, hueOf, luminance, matrix, type Paint } from "./gelMatrix.ts";

const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const rgb = (hex: string) => colorOf(hex);

// white paint is unchanged by any gel, so its lit colour is the gel's own colour: L201 is #8fb6ff
{
  const white: Paint = { name: "White", rgb: { r: 1, g: 1, b: 1 } };
  const cell = matrix([white], ["L201"])[0][0];
  const L201 = colorOf("L201");
  near(cell.lit.r, L201.r, 1e-12, "red");
  near(cell.lit.g, L201.g, 1e-12, "green");
  near(cell.lit.b, L201.b, 1e-12, "blue");
  near(cell.lit.r, 143 / 255, 1e-12, "L201 red is 143/255");
  assert.equal(cell.flag, "");
  assert.equal(cell.loss, 1 - luminance(L201) / 1);
}

// pure red #e6001e under Congo Blue L181 (#200a8c): paint = (0.902, 0, 0.118), gel = (0.125, 0.039, 0.549).
// lit = (0.113, 0, 0.065). Brightness before 0.2126*0.902 + 0.0722*0.118 = 0.2003, after 0.0287, so loss is
// 1 - 0.0287/0.2003 = 0.857, over 0.75: dead. Hue turns from 352 to 326, 26 degrees: not shifted.
{
  const red: Paint = { name: "Red", rgb: rgb("#e6001e") };
  const cell = cellOf(red, "L181");
  assert.equal(cell.flag, "dead");
  near(cell.loss, 0.857, 0.001, "loss under Congo Blue");
  near(cell.hueShift, 26.4, 0.2, "hue turn under Congo Blue");
}

// a mid grey (0.5, 0.5, 0.5) under R80 (#0050c8): lit = (0, 0.157, 0.392), brightness 0.1405 against 0.5,
// so loss 0.719, under 0.75: not dead. Grey has no hue, so nothing is shifted: no flag at all.
{
  const grey: Paint = { name: "Grey", rgb: { r: 0.5, g: 0.5, b: 0.5 } };
  const cell = cellOf(grey, "R80");
  near(cell.loss, 0.719, 0.001, "loss of grey under R80");
  assert.equal(cell.hueShift, 0);
  assert.equal(cell.flag, "");
}

// a grey paint under L201: loss 0.298 and no hue: no flag
{
  assert.equal(cellOf({ name: "Grey", rgb: { r: 0.5, g: 0.5, b: 0.5 } }, "L201").flag, "");
}

// a paint (0.8, 0.8, 0.2) under cyan light (#00ffff, an LED colour): lit = (0, 0.8, 0.2). Its hue is 60 before
// (r is the top channel and g - b over the span gives 60) and 135 after (g is the top channel): 75 degrees, over
// 60, so shifted. Brightness falls from 0.757 to 0.587, a loss of 0.22: not dead.
{
  const cell = cellOf({ name: "Yellow", rgb: { r: 0.8, g: 0.8, b: 0.2 } }, "#00ffff");
  assert.equal(cell.flag, "shifted");
  near(cell.hueShift, 75, 1e-9, "hue turn");
  near(cell.loss, 0.2248, 0.001, "loss");
}

// hue of the primaries and of greys
{
  assert.equal(hueOf({ r: 1, g: 0, b: 0 }), 0);
  assert.equal(hueOf({ r: 0, g: 1, b: 0 }), 120);
  assert.equal(hueOf({ r: 0, g: 0, b: 1 }), 240);
  assert.equal(hueOf({ r: 0.3, g: 0.3, b: 0.3 }), null);
}

// the matrix's shape: a row per paint, a cell per gel, in order
{
  const m = matrix([{ name: "A", rgb: { r: 1, g: 1, b: 1 } }, { name: "B", rgb: { r: 0, g: 0, b: 0 } }], ["L201", "R80", ""]);
  assert.equal(m.length, 2);
  assert.ok(m.every((row) => row.length === 3));
  // black paint has no brightness to lose: loss 0, and it stays black
  assert.equal(m[1][0].loss, 0);
}

console.log("gelMatrix.check.ts: all passed");
