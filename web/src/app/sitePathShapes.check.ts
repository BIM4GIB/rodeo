// Run with: npx tsx src/app/sitePathShapes.check.ts
import assert from "node:assert/strict";
import {
  boundarySections,
  fittedProfile,
  gridFaces,
  halves,
  lineLength,
  pathGrid,
  pathOutline,
  pathwaySections,
  profileBreaks,
  profileHeight,
  realigned,
  riseAcross,
  sectionAt,
  sectionsLength,
  stationed,
  stationOf,
} from "./sitePathShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

// a straight path: its sides lie a half width off
{
  const line = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
  const s = pathwaySections(line, 200);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].left, { x: 0, y: 100 });
  assert.deepEqual(s[1].right, { x: 1000, y: -100 });
  near(sectionsLength(s), 1000);
  assert.equal(pathOutline(s).length, 4);
  near(lineLength(line), 1000);
}

// a corner is mitred, and a sharp one held to the limit
{
  const s = pathwaySections([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], 200);
  near(s[1].left.x, 900); near(s[1].left.y, 100);
  near(s[1].right.x, 1100); near(s[1].right.y, -100);
  near(s[2].at, 2000);
  const sharp = pathwaySections([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 10 }], 200);
  near(halves(sharp[1]).left, 300, 1);
}

// a long rectangle's centre line runs between its short ends, whichever corner it's drawn from
{
  for (const ring of [
    [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 200 }, { x: 0, y: 200 }],
    [{ x: 1000, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 0 }, { x: 1000, y: 0 }],
    [{ x: 0, y: 200 }, { x: 1000, y: 200 }, { x: 1000, y: 0 }, { x: 0, y: 0 }],
  ]) {
    const s = boundarySections(ring);
    near(sectionsLength(s), 1000);
    near(s[0].c.y, 100); near(s[s.length - 1].c.y, 100);
    near(Math.abs(s[0].left.y - s[0].right.y), 200);
    // the left really is to the left of the way it runs
    const [a, b] = [s[0].c, s[s.length - 1].c];
    const turn = (b.x - a.x) * (s[0].left.y - a.y) - (b.y - a.y) * (s[0].left.x - a.x);
    assert.ok(turn > 0);
  }
}

// a boundary that widens
{
  const s = boundarySections([{ x: 0, y: -100 }, { x: 1000, y: -300 }, { x: 1000, y: 300 }, { x: 0, y: 100 }]);
  // it can run either way
  const [thin, wide] = s[0].c.x < 500 ? [s[0], s[s.length - 1]] : [s[s.length - 1], s[0]];
  near(thin.c.x, 0);
  near(wide.c.x, 1000);
  near(halves(thin).left, 100);
  near(halves(wide).left, 300);
}

// heights go straight between the profile's points and hold past its ends
{
  const profile = [{ at: 100, z: 10 }, { at: 300, z: 30 }];
  near(profileHeight(profile, 0), 10);
  near(profileHeight(profile, 200), 20);
  near(profileHeight(profile, 400), 30);
  assert.deepEqual(realigned([{ at: 0, z: 0 }, { at: 50, z: 99 }, { at: 100, z: 10 }]).map((p) => p.z), [0, 5, 10]);
}

// transverse profiles: across their breaks, shading between stations, and holding on past the last
{
  const s = pathwaySections([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 200);
  const flat = { name: "A", at: 0, points: [{ off: 100, rise: 0 }, { off: -100, rise: 0 }] };
  const crown = { name: "B", at: 500, points: [{ off: 100, rise: -10 }, { off: 0, rise: 0 }, { off: -100, rise: -20 }] };
  near(riseAcross(s, [crown], 500, 1), -10);
  near(riseAcross(s, [crown], 500, -1), -20);
  near(riseAcross(s, [crown], 500, 0.5), -5);
  near(riseAcross(s, [crown], 0, 1), -10);
  near(riseAcross(s, [flat, crown], 250, 1), -5);
  near(riseAcross(s, [flat, crown], 900, -1), -20);
  near(riseAcross(s, [], 500, 1), 0);
}

// the grid has every break, and rows at the stations, corners and evenly along
{
  const s = pathwaySections([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 200);
  const profile = [{ at: 0, z: 100 }, { at: 1000, z: 200 }];
  const crown = { name: "B", at: 500, points: [{ off: 100, rise: -10 }, { off: 30, rise: 5 }, { off: 0, rise: 0 }, { off: -100, rise: -20 }] };
  const grid = pathGrid(s, profile, [crown]);
  const middle = grid.find((row) => Math.abs(row[0][0] - 500) < 1e-6);
  assert.ok(middle);
  // across at the break, 30 to the left
  const onBreak = middle.find((p) => Math.abs(p[1] - 30) < 1e-6);
  assert.ok(onBreak);
  near(onBreak[2], 155);
  near(grid[0][0][2], 100 - 20);
  near(grid[grid.length - 1][grid[0].length - 1][2], 200 - 10);
  assert.ok(grid.length >= 11);
  assert.equal(gridFaces(grid, 0).length, (grid.length - 1) * (grid[0].length - 1));
  assert.equal(gridFaces(grid, 7)[0][2], grid[0][0][2] + 7);
}

// stations, fitting and the nearest place
{
  const s = pathwaySections([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], 200);
  near(stationOf(s, { x: 500, y: 50 }), 500);
  near(stationOf(s, { x: 1050, y: 300 }), 1300);
  near(sectionAt(s, 1500).c.y, 500);
  assert.equal(stationed(s, [250], 100000).length, 4);
  const fit = fittedProfile(s, (x, y) => (y > 900 ? null : x / 10), 500);
  assert.ok(fit.length >= 4);
  near(fit[0].z, 0);
  near(fit.find((p) => p.at === 500)?.z ?? 0, 50);
  assert.ok(fit[fit.length - 1].at <= 1900);
}

// labels go where the slope changes, not too close together
{
  const straight = [{ at: 0, z: 0 }, { at: 100, z: 10 }, { at: 200, z: 20 }, { at: 300, z: 30 }];
  assert.deepEqual(profileBreaks(straight, 10).map((p) => p.at), [0, 300]);
  const bent = [{ at: 0, z: 0 }, { at: 100, z: 10 }, { at: 110, z: 50 }, { at: 200, z: 20 }, { at: 300, z: 30 }];
  assert.deepEqual(profileBreaks(bent, 50).map((p) => p.at), [0, 100, 200, 300]);
  assert.deepEqual(profileBreaks(bent, 1).map((p) => p.at), [0, 100, 110, 200, 300]);
  assert.equal(profileBreaks([{ at: 0, z: 1 }, { at: 9, z: 2 }], 100).length, 2);
}

console.log("sitePathShapes ok");
