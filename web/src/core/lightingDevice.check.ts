// Checks a Spotlight lighting device's light under Node: reading it from the device's parameters, its
// beam from Pan and Tilt and back, and the parameters a change writes. Run from web/:
//   npx tsx src/core/lightingDevice.check.ts

import type { Vec3 } from "./types.ts";
import { axisOf, colorOfRgb, deviceAxis, deviceLightValues, isLightingDevice, panTiltFor, readDeviceLight, rgbOfColor } from "./lightingDevice.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}
const near = (a: Vec3, b: Vec3): boolean => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

console.log("plug-in names");
check(isLightingDevice("Lighting Device") && isLightingDevice("Light Instrument") && !isLightingDevice("Door") && !isLightingDevice(null), "Spotlight's device formats, in any case, and nothing else");

console.log("reading");
{
  // as the showcase's Robe Robin Tetra X saves it
  const fields = [
    { name: "Light On", value: false },
    { name: "RGBColor", value: "65535,32896,0" },
    { name: "Brightness", value: 1 },
    { name: "Field Angle", value: 45 },
    { name: "Beam Angle", value: 4 },
    { name: "Pan", value: 180 },
    { name: "Tilt", value: 0 },
    { name: "Invert pan", value: false },
    { name: "Invert tilt", value: true },
    { name: "Lit Fog", value: false },
  ];
  const d = readDeviceLight(fields);
  check(d.on === false && d.color === "#ff8000" && d.brightness === 1, "on, colour (16 bits a channel) and brightness");
  check(Math.abs((d.spread ?? 0) - (45 * Math.PI) / 180) < 1e-12 && Math.abs((d.beam ?? 0) - (4 * Math.PI) / 180) < 1e-12, "field and beam angles in radians");
  check(d.pan === 180 && d.tilt === 0 && d.invertTilt && !d.invertPan, "pan, tilt and the invert flags as saved");
  const narrow = readDeviceLight([{ name: "Field Angle", value: 10 }, { name: "Beam Angle", value: 20 }]);
  check(Math.abs((narrow.beam ?? 0) - (narrow.spread ?? 1)) < 1e-12, "a beam wider than its field is taken as the field");
  check(readDeviceLight([]).on === undefined && readDeviceLight([]).color === undefined, "an older format without them leaves them undefined");
}

console.log("colours");
check(colorOfRgb("0,0,0") === "#000000" && colorOfRgb("65535,65535,65535") === "#ffffff" && colorOfRgb("1,2") === null, "RGBColor as #rrggbb, null when it doesn't read");
check(rgbOfColor("#ff8000") === "65535,32896,0" && rgbOfColor("orange") === null, "#rrggbb as RGBColor");

console.log("aim");
check(near(deviceAxis(0, 0), [0, 0, -1]), "no tilt shines straight down");
check(near(deviceAxis(0, 90), [0, 1, 0]), "tilted 90° it shines along +y");
check(near(deviceAxis(90, 90), [-1, 0, 0]), "panned 90° then, along -x");
for (const [pan, tilt] of [[30, 45], [-120, 80], [170, 135], [0, 10]]) {
  const back = panTiltFor(deviceAxis(pan, tilt));
  check(Math.abs(back.pan - pan) < 1e-3 && Math.abs(back.tilt - tilt) < 1e-3, `pan ${pan}, tilt ${tilt} round trip`);
}
check(panTiltFor([0, 0, -5]).tilt === 0 && panTiltFor([0, 0, -5]).pan === 0, "straight down: tilt 0, pan 0");
const inverted = readDeviceLight([{ name: "Pan", value: 30 }, { name: "Tilt", value: 45 }, { name: "Invert pan", value: true }, { name: "Invert tilt", value: true }]);
check(near(axisOf(inverted), deviceAxis(-30, -45)), "Invert pan and tilt turn the other way");

console.log("writing");
{
  const now = readDeviceLight([
    { name: "Field Angle", value: 45 },
    { name: "Beam Angle", value: 20 },
    { name: "Invert tilt", value: true },
  ]);
  const deg = Math.PI / 180;
  const v = deviceLightValues(now, { on: true, color: "#00ff00", brightness: 0.5 });
  check(v["Light On"] === true && v.RGBColor === "0,65535,0" && v.Brightness === 0.5 && !("Pan" in v), "on, colour and brightness, nothing else");
  const narrowed = deviceLightValues(now, { spread: 10 * deg });
  check(narrowed["Field Angle"] === 10 && narrowed["Beam Angle"] === 10, "a field narrowed past the beam takes the beam with it");
  const aimed = deviceLightValues(now, { direction: deviceAxis(30, 60) });
  check(aimed.Pan === 30 && aimed.Tilt === -60, "a direction as pan and tilt, Invert tilt kept");
  let threw = false;
  try {
    deviceLightValues(now, { color: "red" });
  } catch {
    threw = true;
  }
  check(threw, "a colour that isn't #rrggbb is refused");
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
