// Run with: npx tsx src/app/lightingDeviceShapes.check.ts
import assert from "node:assert/strict";
import { accessoryNames, accessoryWeight, lightingDevice, withAccessory, withoutAccessory } from "./lightingDeviceShapes.ts";

const near = (a: number, b: number): void => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);
const none = { channel: "", unit: "", color: "", purpose: "" };
const reach = (type: Parameters<typeof lightingDevice>[0], accessories: string[], factor = 1, aim = 0): number =>
  Math.max(...lightingDevice(type, factor, { ...none, accessories }, 100, aim).outlines.flat().map((p) => p.x));

// the list in the field
assert.deepEqual(accessoryNames(" Top Hat, Barn Doors\nIris ,, "), ["Top Hat", "Barn Doors", "Iris"]);
assert.equal(withAccessory("", "Iris"), "Iris");
assert.equal(withAccessory("Top Hat", "Iris"), "Top Hat, Iris");
assert.equal(withoutAccessory("Top Hat, Iris, Top Hat", "Top Hat"), "Top Hat, Iris");
assert.equal(withoutAccessory("Top Hat", "Iris"), "Top Hat");
assert.equal(withoutAccessory("Top Hat", "Top Hat"), "");
assert.equal(accessoryWeight("Color Scroller"), 3.5);
assert.equal(accessoryWeight("Something Else"), 0);

// lens accessories stack in front of the device, scaled with it
near(reach("fresnel", []), 170);
near(reach("fresnel", ["Top Hat"]), 340);
near(reach("fresnel", ["Top Hat", "Gel Frame"]), 355);
near(reach("fresnel", ["Top Hat"], 2), 680);
// barn doors open out
const doors = lightingDevice("fresnel", 1, { ...none, accessories: ["Barn Doors"] }, 100, 0).outlines.at(-1)!;
near(Math.max(...doors.map((p) => p.y)), 225);
// the body's a third of the way back from the front: no further forward
const iris = lightingDevice("fresnel", 1, { ...none, accessories: ["Iris"] }, 100, 0);
near(reach("fresnel", ["Iris"]), 170);
near(Math.max(...iris.outlines.at(-1)!.map((p) => p.x)), 170 - 350 / 3 + 15);
// a yoke one's a circle on the hanging point, a base one a box on it
assert.equal(lightingDevice("fresnel", 1, { ...none, accessories: ["Safety Cable"] }, 100, 0).circles[0].radius, 40);
const clamp = lightingDevice("fresnel", 1, { ...none, accessories: ["C-Clamp"] }, 100, 0).outlines.at(-1)!;
near(Math.max(...clamp.map((p) => p.x)), 50);
near(Math.max(...clamp.map((p) => p.y)), 60);
// the channel's bubble is last, and moves out past the lens accessories
const labelled = lightingDevice("fresnel", 1, { ...none, channel: "12", accessories: ["Safety Cable", "Top Hat"] }, 100, 0);
near(labelled.circles.at(-1)!.center.x, 340 + 40 + 90);
// one that isn't known draws nothing
assert.equal(lightingDevice("fresnel", 1, { ...none, accessories: ["Mystery"] }, 100, 0).outlines.length, lightingDevice("fresnel", 1, none, 100, 0).outlines.length);
// aimed: it turns with the device
near(Math.max(...lightingDevice("fresnel", 1, { ...none, accessories: ["Top Hat"] }, 100, Math.PI / 2).outlines.flat().map((p) => p.y)), 340);

console.log("lightingDeviceShapes ok");
