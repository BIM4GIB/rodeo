// npx tsx src/features/theatre/looks/lightScenes.check.ts
import type { Fixture } from "../fixture.ts";
import { deviceStateOf, fadeLevels, fadeSeconds, levelAt, movieTimes, parseSeconds, sceneChanges, scenesOf, type LightScene } from "./lightScenes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

const fixture = (id: string, more: Partial<Fixture> = {}): Fixture =>
  ({ id, at: { x: 0, y: 0 }, heightMm: 6000, aimDeg: 90, focus: { x: 0, y: 2000, z: 1500 }, color: "R80", channel: "1", ...more }) as Fixture;
const scene = (more: Partial<LightScene>): LightScene => ({ name: "S", number: "1", upS: 3, downS: 5, levels: null, devices: [], ...more });

// a level rises over the up time and falls over the down time
{
  ok(levelAt(0, 1, 4, 8, 0) === 0 && near(levelAt(0, 1, 4, 8, 1), 0.25) && levelAt(0, 1, 4, 8, 4) === 1 && levelAt(0, 1, 4, 8, 10) === 1, "up over 4 s");
  ok(near(levelAt(1, 0.5, 4, 8, 4), 0.75) && levelAt(1, 0.5, 4, 8, 8) === 0.5, "down over 8 s");
  ok(levelAt(0.2, 0.9, 0, 8, 0) === 0.9 && levelAt(0.4, 0.4, 3, 3, 1) === 0.4, "no time snaps; a level that stays, stays");
  ok(levelAt(0, 1, 4, 8, -2) === 0, "before the fade it holds");
}

// scenes' levels: one leaving a channel out has it off; one keeping none has every channel full
{
  const a = scene({ levels: { "1": 1, "2": 0.5 } });
  const b = scene({ levels: { "2": 1, "3": 0.6 }, upS: 2, downS: 6 });
  const at = (t: number) => Object.fromEntries(fadeLevels(a, b, ["1", "2", "3"], t));
  const one = at(1);
  ok(near(one["1"], 1 - 1 / 6) && near(one["2"], 0.75) && near(one["3"], 0.3), `one second in: ${JSON.stringify(one)}`);
  ok(fadeSeconds(a, b, ["1", "2", "3"]) === 6 && fadeSeconds(a, b, ["2", "3"]) === 2, "the fade runs as long as the times its channels use");
  const full = scene({ levels: null });
  ok(at(10)["1"] === 0 && fadeLevels(a, full, ["3"], 0).get("3") === 0 && fadeLevels(a, full, ["3"], 99).get("3") === 1, "no levels kept: full");
}

// going to a scene: only what differs, devices deleted since counted
{
  const before = [fixture("a"), fixture("b", { at: { x: 1000, y: 0 } }), fixture("gone")];
  const s = scene({ devices: before.map(deviceStateOf) });
  const now = [fixture("a", { color: "L201", focus: null }), fixture("b", { at: { x: 1500, y: -200 }, heightMm: 7000 }), fixture("new")];
  const c = sceneChanges(s, now);
  ok(c.missing === 1, "one gone");
  const ea = c.edits.find((e) => e.id === "a")?.edit;
  ok(ea?.color === "R80" && ea.focus?.y === 2000 && ea.heightMm === undefined, `a's colour and focus back: ${JSON.stringify(ea)}`);
  const eb = c.edits.find((e) => e.id === "b")?.edit;
  ok(eb?.heightMm === 6000 && eb.color === undefined, "b's height back");
  ok(c.moves.length === 1 && c.moves[0].id === "b" && c.moves[0].dx === -500 && c.moves[0].dy === 200, `b moved back: ${JSON.stringify(c.moves)}`);
  ok(sceneChanges(s, before).edits.length === 0 && sceneChanges(s, before).moves.length === 0, "nothing to change");
}

// the movie's frames and the times typed
{
  const t = movieTimes(1, 2, 1, 10);
  ok(t.length === 40 && near(t[0], -1) && near(t[10], 0) && near(t[39], 2.9), `40 frames: ${t[0]} ${t[10]} ${t[39]}`);
  ok(parseSeconds("2,5") === 2.5 && parseSeconds("0") === 0 && typeof parseSeconds("-1") === "string" && typeof parseSeconds("1000") === "string" && typeof parseSeconds("") === "string", "times");
  ok(scenesOf([{ name: "x", devices: [] }, null, 4, { name: 3 }]).length === 1 && scenesOf({}).length === 0, "what show data holds");
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
