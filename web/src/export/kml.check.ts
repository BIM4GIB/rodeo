// Node check of the KML writer. Run from web/: npx tsx src/export/kml.check.ts

import assert from "node:assert/strict";
import type { Mesh3D } from "../core/types.ts";
import { kmlDocument } from "./kml.ts";

const mesh = (objectId: string, layerId: string, color: string, z = 0, opacity = 1): Mesh3D =>
  ({ objectId, layerId, classIndex: 1, triangles: new Float32Array([0, 0, z, 1000, 0, z, 0, 1000, z + 2000]), edges: new Float32Array(), color, opacity, texture: -1 }) as unknown as Mesh3D;

const kml = kmlDocument([mesh("a", "L1", "#ff8000"), mesh("a", "L1", "#ff8000", 5000), mesh("b", "L2", "#0000ff", 0, 0.5)], {
  name: "A & B",
  layerName: (id) => `Layer <${id}>`,
  objectName: (id) => `Object ${id}`,
  place: (p) => ({ lat: 51 + p.y / 1e6, lon: -1 + p.x / 1e6 }),
  zOffset: 1000,
});

assert.match(kml, /^<\?xml version="1.0"/);
assert.ok(kml.includes("<name>A &amp; B</name>"));
assert.ok(kml.includes("<name>Layer &lt;L1&gt;</name>"));
// a folder for each layer, a placemark for each object, a polygon for each triangle
assert.equal(kml.match(/<Folder>/g)?.length, 2);
assert.equal(kml.match(/<Placemark>/g)?.length, 2);
assert.equal(kml.match(/<Polygon>/g)?.length, 3);
// longitude first, heights in metres above the offset, the ring closed
assert.ok(kml.includes("<coordinates>-1,51,1 -0.999,51,1 -1,51.001,3 -1,51,1</coordinates>"), kml);
assert.ok(kml.includes("-1,51,6 "));
// colours are aabbggrr
assert.ok(kml.includes("<color>ff0080ff</color>"));
assert.ok(kml.includes("<color>80ff0000</color>"));

console.log("all checks passed");
