// Checks for mvr.ts, with the expected text worked out by hand in the comments. Run with:
//   npx tsx src/features/theatre/patch/mvr.check.ts

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import { DEFAULT_STAGE } from "../stage.ts";
import { colourOf, instrumentTypeOf, mvrXml, parseMvr, unescapeXml, uuidOf } from "./mvr.ts";

const base: Fixture = {
  id: "",
  layerId: "L",
  classIndex: 0,
  native: true,
  at: { x: 0, y: 0 },
  type: "profile26",
  label: "Profile 26°",
  glyph: "ellipsoidal",
  position: "",
  unit: "",
  channel: "",
  universe: 0,
  address: 0,
  footprint: 1,
  dimmer: "",
  circuit: "",
  color: "",
  gobo: "",
  purpose: "",
  accessory: "",
  notes: "",
  watts: 750,
  weightKg: 7.7,
  beamDeg: 18,
  fieldDeg: 26,
  lumens: 10500,
  heightMm: 6000,
  focus: null,
  aimDeg: -90,
};
const fx = (id: string, o: Partial<Fixture> = {}): Fixture => ({ ...base, id, ...o });
const frame = DEFAULT_STAGE;

// instrument types by GDTF name
assert.equal(instrumentTypeOf("Robe Spot 250.gdtf"), "spotmover");
assert.equal(instrumentTypeOf("PAR 64 VNSP.gdtf"), "parnsp");
assert.equal(instrumentTypeOf("Followspot 1200.gdtf"), "followspot");
assert.equal(instrumentTypeOf("LED Wash Mover.gdtf"), "washmover");
assert.equal(instrumentTypeOf("Fresnel 650 W.gdtf"), "fresnel1k");
assert.equal(instrumentTypeOf("Generic.gdtf"), "profile26", "no keyword: the default profile");

// uuids: 8-4-4-4-12 upper case, version 4, the same every time
const uuid = uuidOf("fixture-1");
assert.match(uuid, /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
assert.equal(uuidOf("fixture-1"), uuid);
assert.notEqual(uuidOf("fixture-2"), uuid);

// colour: no gel is white in CIE xyY (D65), Y 100 per cent
assert.equal(colourOf(""), "{0.3127,0.329,100}");

// entities
assert.equal(unescapeXml("Box &amp; Boom &lt;1&gt; &quot;q&quot; &#65;&#x42;"), 'Box & Boom <1> "q" AB');

// A: universe 2 address 10 (absolute 522), hung at (1200.5, -300) with its lens at 2500 mm, on "Box & Boom"
// B: unpatched, at (-2000, 8000), lens at 6000 mm (the default), on "1st Electric"
// C: universe 1 address 1, at (3000.25, 1000), lens at 4000.5 mm, unit 12, on "1st Electric"
const A = fx("A", { label: "Fresnel & Co", position: "Box & Boom", unit: "3", universe: 2, address: 10, at: { x: 1200.5, y: -300 }, heightMm: 2500 });
const B = fx("B", { label: "Profile 26°", position: "1st Electric", at: { x: -2000, y: 8000 } });
const C = fx("C", { label: "PAR 64 NSP", position: "1st Electric", unit: "12", universe: 1, address: 1, at: { x: 3000.25, y: 1000 }, heightMm: 4000.5 });
const xml = mvrXml([A, B, C], frame, "Show & Tour");
assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>'));
assert.ok(
  xml.includes(
    '<GeneralSceneDescription verMajor="1" verMinor="5" provider="Rodeo" providerVersion="1"><UserData><Data provider="Rodeo" ver="1"><Drawing name="Show &amp; Tour"/></Data></UserData><Scene><AUXData/><Layers>',
  ),
);
assert.ok(xml.includes('<Layer name="Box &amp; Boom" uuid="'), "the layer's name is escaped");
assert.ok(xml.includes('<Fixture name="Fresnel &amp; Co" uuid="'), "the instrument's name is escaped");
assert.ok(xml.includes("<Matrix>{1,0,0}{0,1,0}{0,0,1}{1200.5,-300,2500}</Matrix>"), "the matrix's origin is x, y and the lens height");
assert.ok(xml.includes("<GDTFSpec>Fresnel &amp; Co.gdtf</GDTFSpec>"));
assert.ok(xml.includes("<FixtureID>3</FixtureID><UnitNumber>3</UnitNumber>"));
assert.ok(xml.includes('<Addresses><Address break="0">522</Address></Addresses>'), "universe 2 address 10 is 522");
assert.equal(xml.split("<Addresses>").length - 1, 2, "B is unpatched, so it has no Addresses");
assert.equal(xml.split("<Fixture ").length - 1, 3);
assert.ok(xml.includes('<UserData/>') === false, "a named drawing has its name in the user data");
assert.ok(mvrXml([B], frame, "  ").includes("<UserData/>"), "an empty name leaves the user data empty");

// round trip: positions, heights, units, addresses and layers come back as they went
const back = parseMvr(xml);
assert.equal(back.length, 3);
const byName = new Map(back.map((f) => [f.name, f]));
assert.deepEqual(byName.get("Fresnel & Co"), { name: "Fresnel & Co", x: 1200.5, y: -300, z: 2500, unit: "3", spec: "Fresnel & Co.gdtf", address: 522, layer: "Box & Boom" });
assert.deepEqual(byName.get("Profile 26°"), { name: "Profile 26°", x: -2000, y: 8000, z: 6000, unit: "", spec: "Profile 26°.gdtf", address: 0, layer: "1st Electric" });
assert.deepEqual(byName.get("PAR 64 NSP"), { name: "PAR 64 NSP", x: 3000.25, y: 1000, z: 4000.5, unit: "12", spec: "PAR 64 NSP.gdtf", address: 1, layer: "1st Electric" });

// a file another program wrote: a declaration, a comment, a unit number but no FixtureID, and a fixture nested in another's child list
const other = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<!-- from another program -->",
  '<GeneralSceneDescription verMajor="1" verMinor="5"><Scene><Layers>',
  '<Layer name="Truss 1" uuid="X"><ChildList>',
  '<Fixture name="Robe Spot 250" uuid="Y"><Matrix>{1,0,0}{0,1,0}{0,0,1}{10,20,30}</Matrix>' +
    '<GDTFSpec>Robe Spot 250.gdtf</GDTFSpec><FixtureID></FixtureID><UnitNumber>7</UnitNumber>' +
    '<Addresses><Address break="0">513</Address></Addresses>',
  '<ChildList><Fixture name="Clamp" uuid="Z"><Matrix>{1,0,0}{0,1,0}{0,0,1}{-5,-6,-7}</Matrix><GDTFSpec>Par.gdtf</GDTFSpec></Fixture></ChildList>',
  "</Fixture>",
  "</ChildList></Layer>",
  "</Layers></Scene></GeneralSceneDescription>",
].join("\n");
assert.deepEqual(parseMvr(other), [
  { name: "Robe Spot 250", x: 10, y: 20, z: 30, unit: "7", spec: "Robe Spot 250.gdtf", address: 513, layer: "Truss 1" },
  { name: "Clamp", x: -5, y: -6, z: -7, unit: "", spec: "Par.gdtf", address: 0, layer: "Truss 1" },
]);
assert.deepEqual(parseMvr("<GeneralSceneDescription/>"), []);

console.log("mvr.check.ts: all checks passed");
