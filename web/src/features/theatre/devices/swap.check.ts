// Node check of Swap Lighting Devices' sums. Run from web/: npx tsx src/features/theatre/devices/swap.check.ts

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import { swapDevices, swapOptionsOf, SWAP_DEFAULTS } from "./swap.ts";

const base = { layerId: "L", classIndex: 1, native: true, label: "", glyph: "profile", footprint: 1, color: "", gobo: "", purpose: "", accessory: "", notes: "", watts: 0, weightKg: 0, beamDeg: 0, fieldDeg: 0, lumens: 0, focus: null, aimDeg: 0 } as unknown as Fixture;
const a: Fixture = { ...base, id: "a", at: { x: 0, y: 0 }, type: "fresnel1k", position: "1st Electric", unit: "1", channel: "11", universe: 1, address: 1, dimmer: "D1", circuit: "C1", heightMm: 6000, color: "R02", accessory: "Barn Door" };
const b: Fixture = { ...base, id: "b", at: { x: 3000, y: -500 }, type: "profile36", position: "FOH", unit: "4", channel: "40", universe: 2, address: 101, dimmer: "D9", circuit: "C9", heightMm: 8000 };

// the defaults: everything in the dialog stays where it hangs
const [ma, mb] = swapDevices(a, b, SWAP_DEFAULTS);
assert.deepEqual([ma.id, ma.dx, ma.dy], ["a", 3000, -500], "a goes to b's point");
assert.deepEqual([mb.id, mb.dx, mb.dy], ["b", -3000, 500], "and b to a's");
assert.deepEqual(ma.edit, { heightMm: 8000, unit: "4", position: "FOH", circuit: "C9", dimmer: "D9", universe: 2, address: 101 });
assert.deepEqual(mb.edit, { heightMm: 6000, unit: "1", position: "1st Electric", circuit: "C1", dimmer: "D1", universe: 1, address: 1 });
// its type, channel, colour and accessory aren't touched: they go with it
for (const k of ["type", "channel", "color", "accessory"]) assert.ok(!(k in ma.edit), k);

// the circuit and patch ticked to move with the device: it keeps its own
const [ka] = swapDevices(a, b, { circuit: true, dimmer: false, patch: true });
assert.deepEqual(ka.edit, { heightMm: 8000, unit: "4", position: "FOH", dimmer: "D9" });

// options kept on this machine
assert.deepEqual(swapOptionsOf(null), { ...SWAP_DEFAULTS, shiftSkips: true });
assert.deepEqual(swapOptionsOf({ circuit: true, dimmer: "yes", shiftSkips: false }), { circuit: true, dimmer: false, patch: false, shiftSkips: false });
console.log("swap: all passed");
