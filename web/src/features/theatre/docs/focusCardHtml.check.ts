// Checks the focus card markup: escaping, the plan's pools (a 45° beam's pool is 1/sin 45° = 1.414 times as
// long as it is wide), the QR code, and six cards to a printed page. Run from web/:
//   npx tsx src/features/theatre/docs/focusCardHtml.check.ts

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import { cardOf, type FocusCard } from "./focusCards.ts";
import { cardHtml, esc, gridHtml, planSvg, pagesHtml, qrSvg, sheetDocument } from "./focusCardHtml.ts";

const fmt = (mm: number): string => `${(mm / 1000).toFixed(2)} m`;
const frame = { x: 0, y: 0, upDeg: 90 };

const base: Fixture = {
  id: "base",
  layerId: "layer",
  classIndex: 0,
  native: true,
  at: { x: 1200, y: 7300 },
  type: "profile26",
  label: "Profile 26°",
  glyph: "ellipsoidal",
  position: "1st Electric",
  unit: "3",
  channel: "21",
  universe: 1,
  address: 101,
  footprint: 1,
  dimmer: "",
  circuit: "",
  color: "L201",
  gobo: "",
  purpose: "Key",
  accessory: "",
  notes: "",
  watts: 750,
  weightKg: 7.7,
  beamDeg: 18,
  fieldDeg: 26,
  lumens: 10500,
  heightMm: 6000,
  focus: { x: 1200, y: 3000, z: 1700 },
  aimDeg: -90,
};

// escaping: a name typed with markup stays text
assert.equal(esc(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");

const focusedCard: FocusCard = cardOf(base, frame, fmt);
const html = cardHtml(focusedCard);
assert.ok(html.includes("Unit 3 @ 1st Electric"));
assert.ok(html.includes("1.20 m SL · 3.00 m US"));
assert.ok(!html.includes("Not focused yet"));

// the pools: two ellipses, the beam's long axis over its short one = 1/sin(45°)
const plan = planSvg(focusedCard);
const ellipses = [...plan.matchAll(/<ellipse[^>]*rx="([\d.]+)" ry="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
assert.equal(ellipses.length, 2);
for (const [rx, ry] of ellipses) assert.ok(Math.abs(rx / ry - Math.SQRT2) < 0.01, `pool ratio ${rx / ry}`);
// the plan carries the distances from CL and from PL
assert.ok(plan.includes(">1.20 m<"));
assert.ok(plan.includes(">3.00 m<"));

// an unfocused card: its warning, and no pools
const bare = cardOf({ ...base, focus: null }, frame, fmt);
const bareHtml = cardHtml(bare);
assert.ok(bareHtml.includes(`<span class="th-warn docs-unfocused">Not focused yet</span>`));
assert.ok(!planSvg(bare).includes("<ellipse"));

// the QR code: a square of modules with a quiet zone, and the text in its title
const qr = qrSvg(focusedCard.qr);
assert.ok(qr.startsWith("<svg viewBox="));
assert.ok(qr.includes("<path d="));
assert.ok(qr.includes(`<title>Unit 3 @ 1st Electric Ch 21 Hot spot 1.20 m SL 3.00 m US</title>`));

// a text too long for any QR code gives none, not a broken one
assert.equal(qrSvg("x".repeat(4000)), "");

// the markup of a name with markup in it is escaped everywhere it appears
const hostile = cardOf({ ...base, unit: "<3>", position: `"A&B"` }, frame, fmt);
const hostileHtml = cardHtml(hostile);
assert.ok(hostileHtml.includes("Unit &lt;3&gt; @ &quot;A&amp;B&quot;"));
assert.ok(!hostileHtml.includes("<3>"));

// printed pages: six cards each; thirteen cards make three pages
const cards = Array.from({ length: 13 }, (_, i) => cardOf({ ...base, id: `i${i}`, unit: String(i + 1) }, frame, fmt));
const pages = pagesHtml(cards);
assert.equal((pages.match(/class="docs-page"/g) ?? []).length, 3);
assert.equal((pages.match(/class="docs-card"/g) ?? []).length, 13);
const doc = sheetDocument(cards, "A4", ".docs-card{}");
assert.ok(doc.includes("@page { size: A4; margin: 10mm; }"));
assert.ok(doc.includes(`<body class="docs-paper-A4">`));
assert.ok(doc.startsWith("<!doctype html>"));
const letter = sheetDocument(cards.slice(0, 1), "Letter", "");
assert.ok(letter.includes("@page { size: letter;"));
// the preview is one grid of the same cards
assert.equal((gridHtml(cards).match(/class="docs-card"/g) ?? []).length, 13);

console.log("focusCardHtml.check: all checks pass");
