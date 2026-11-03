// npx tsx src/features/theatre/devices/deviceShapes.check.ts
import { aimOfTurn, typeForName } from "./deviceShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const cases: [string, string][] = [
  ["Source Four 26deg", "profile26"],
  ["S4 LED Series 2", "profile26"],
  ["ETC_Source_Four_LED_Profile", "ledprofile"],
  ["Leko 36°", "profile36"],
  ["Zoom Profile 15-30", "zoomprofile"],
  ["Fresnel 2kW", "fresnel2k"],
  ["6in Fresnel", "fresnel1k"],
  ["PAR64 MFL", "parmfl"],
  ["PAR 64 VNSP", "parvnsp"],
  ["LED PAR 7x15", "ledpar"],
  ["Moving Head Wash", "washmover"],
  ["Beam 230", "beammover"],
  ["Moving Head Spot", "spotmover"],
  ["Cyc Flood", "cycflood"],
  ["LED Batten 1m", "ledbatten"],
  ["Followspot 1200", "followspot"],
  ["Set Piece Lamp", "profile26"],
];
for (const [name, key] of cases) ok(typeForName(name) === key, `${name} → ${typeForName(name)}, not ${key}`);

ok(aimOfTurn(0) === -90, "unturned: down the page");
ok(aimOfTurn(90) === 0, "a quarter turn: to the right");
ok(aimOfTurn(180) === 90, "a half turn: up the page");
ok(aimOfTurn(-90) === 180 || aimOfTurn(-90) === -180, "a quarter turn back: to the left");
ok(aimOfTurn(450) === 0, "past a whole turn");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
