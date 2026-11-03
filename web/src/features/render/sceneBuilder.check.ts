// Checks the render scene builder under Node: its three.js objects work here, WebGL does not. Run
// from web/:
//   npx tsx src/features/render/sceneBuilder.check.ts
// It builds scenes from synthetic faces, content and lights, and reads or writes no file.

import * as THREE from "three";
import { DEFAULT_VIZ, MAX_LAMPS, type Viz3D } from "../../app/heliodon.ts";
import type { ModelFace } from "../../app/view3d.ts";
import type { Light3D } from "../../core/index.ts";
import { DEFAULT_RENDER, materialKey, type RenderSettings } from "./settings.ts";
import { buildScene, type RenderScene, type SceneChange, type SceneSource } from "./sceneBuilder.ts";
import { RENDER_SPACE } from "./space.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

function close(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return a.distanceTo(b) < 1e-6;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** A face of the 3D view: its geometry (world mm, z up), colour and opacity. */
function face(geometry: THREE.BufferGeometry, color = "#c8b89a", opacity = 1): ModelFace {
  return { geometry, color, opacity, texture: -1, resource: null, map: null, alphaMap: null, recessed: false };
}

/** An indexed geometry from flat corner coordinates (mm) and triangle indices. */
function indexed(corners: number[], index: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(corners, 3));
  g.setIndex(index);
  return g;
}

/** A box from (0,0,0) to (1000, 2000, 3000) mm: the model whose render-space box is x 0..1, y 0..3, z −2..0 m. */
function unitBox(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1000, 2000, 3000).translate(500, 1000, 1500);
}

/** A light object at world mm (x = 1000 i), on the ground's side of the model, shining down. */
function lamp(i: number, kind: Light3D["kind"], brightness: number, spread = 1.2, beam = 0.6): Light3D {
  const position: [number, number, number] = [1000 * i, 0, 2000];
  const direction: [number, number, number] = [0, 0, -1];
  return { id: `L${i}`, objectId: `O${i}`, layerId: "layer", classIndex: 0, kind, on: true, position, direction, own: { position, direction }, color: "#ffeecc", brightness, spread, beam, placedBy: "drawing" };
}

function build(faces: ModelFace[], content: THREE.Object3D[] = [], lights: Light3D[] = [], settings: RenderSettings = DEFAULT_RENDER, viz: Viz3D = DEFAULT_VIZ): RenderScene {
  const src: SceneSource = { faces, content, lights };
  return buildScene(src, settings, viz);
}

function rootOf(s: RenderScene): THREE.Group {
  const root = s.scene.children.find((o): o is THREE.Group => o instanceof THREE.Group);
  if (!root) throw new Error("the scene has no root group");
  return root;
}

function meshesOf(o: THREE.Object3D): THREE.Mesh[] {
  return o.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
}

/** Whether exactly the named flags are set. */
function only(c: SceneChange, flags: readonly (keyof SceneChange)[]): boolean {
  return (["geometry", "materials", "lights", "environment"] as const).every((k) => c[k] === flags.includes(k));
}

function show(c: SceneChange): string {
  return (["geometry", "materials", "lights", "environment"] as const).filter((k) => c[k]).join(", ") || "nothing";
}

console.log("\nfaces");
{
  // four separate triangles, 12 corners: the index draws the first two only
  const corners: number[] = [];
  for (let k = 0; k < 4; k++) corners.push(k * 1000, 0, 0, k * 1000 + 500, 0, 0, k * 1000, 500, 0);
  const g = indexed(corners, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  g.setDrawRange(0, 6);
  const s = build([face(g)]);
  const meshes = meshesOf(rootOf(s));
  check(meshes.length === 1, "one face group, one mesh");
  const pos = meshes[0].geometry.attributes.position;
  const got: number[] = [];
  for (let i = 0; i < pos.count; i++) got.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  const want = [0, 0, 0, 500, 0, 0, 0, 500, 0, 1000, 0, 0, 1500, 0, 0, 1000, 500, 0];
  check(got.length === want.length && got.every((v, i) => near(v, want[i])), "compacted to the two drawn triangles, not all four");
  const normal = meshes[0].geometry.attributes.normal;
  let flat = normal !== undefined && normal.count === 6;
  for (let i = 0; flat && i < normal.count; i++) flat = near(Math.abs(normal.getZ(i)), 1);
  check(flat, "normals exist for every corner and point out of the flat triangles");

  // left out: a face under 1 % opaque, and one with nothing drawn
  const nearlyClear = face(indexed(corners, [0, 1, 2]), "#ffffff", 0.005);
  const undrawn = indexed(corners, [0, 1, 2]);
  undrawn.setDrawRange(0, 0);
  check(meshesOf(rootOf(build([face(g), nearlyClear, face(undrawn)]))).length === 1, "faces under 1 % opacity and with nothing drawn are left out");
}

console.log("\nbounds and the root");
{
  const s = build([face(unitBox())]);
  const bounds = s.bounds;
  const want = { min: new THREE.Vector3(0, 0, -2), max: new THREE.Vector3(1, 3, 0) };
  check(close(bounds.min, want.min) && close(bounds.max, want.max), `box in render space: x 0..1, y 0..3, z −2..0 m (min ${fmt(bounds.min)} max ${fmt(bounds.max)})`);
  const root = rootOf(s);
  check(!root.matrixAutoUpdate && root.matrix.equals(RENDER_SPACE), "the root carries the model into render space");
  const world = new THREE.Box3().setFromObject(meshesOf(root)[0]);
  check(close(world.min, bounds.min) && close(world.max, bounds.max), "the face's box in the scene matches the bounds");

  const empty = build([]);
  const size = empty.bounds.getSize(new THREE.Vector3());
  check(close(size, new THREE.Vector3(10, 10, 10)) && close(empty.bounds.getCenter(new THREE.Vector3()), new THREE.Vector3()), "no model: a 10 m cube at the origin");
}

console.log("\nmaterials");
{
  const a = face(new THREE.BoxGeometry(1000, 1000, 1000), "#ff0000");
  const b = face(new THREE.BoxGeometry(1000, 1000, 1000), "#FF0000");
  const c = face(new THREE.BoxGeometry(1000, 1000, 1000), "#0000ff");
  const d = face(new THREE.BoxGeometry(1000, 1000, 1000), "#00ff00", 0.5);
  const s = build([a, b, c, d]);
  const meshes = meshesOf(rootOf(s));
  check(s.materials.size === 3, "faces of one colour share a material (three materials for three colours and opacities)");
  check(s.materials.get(materialKey(a))?.faces.length === 2, "the two red faces are on one material");
  check(meshes[0].material === meshes[1].material && meshes[0].material !== meshes[2].material, "their meshes hold the same material object");
  check(meshes[0].castShadow && !meshes[3].castShadow, "an opaque face casts shadows, a see-through one does not");
  check(meshes.every((m) => m.receiveShadow), "every face takes shadows");
}

console.log("\ncontent");
{
  const obj = new THREE.Object3D();
  obj.position.set(5000, 0, 0);
  const src = new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000).translate(0, 0, 500), new THREE.MeshStandardMaterial({ color: "#ff0000" }));
  obj.add(src);
  const s = build([], [obj]);
  const meshes = meshesOf(rootOf(s));
  check(meshes.length === 1, "content is one mesh under the root");
  check(meshes[0].geometry === src.geometry, "the content's geometry is shared, not copied");
  const m = meshes[0].material as THREE.MeshPhysicalMaterial;
  check(m.color.getHexString() === "ff0000" && m.side === THREE.DoubleSide && near(m.roughness, 0.9), "content takes its colour, roughness 0.9, both sides");
  check(close(s.bounds.min, new THREE.Vector3(4.5, 0, -0.5)) && close(s.bounds.max, new THREE.Vector3(5.5, 1, 0.5)), "content is in the bounds");
}

console.log("\nground plane and sun");
{
  const s = build([face(unitBox())]);
  const ground = meshesOf(s.scene)[0];
  check(ground !== undefined && ground.visible && ground.receiveShadow && !ground.castShadow, "a ground plane, shown, taking shadows");
  check(ground !== undefined && near(ground.position.y, s.bounds.min.y - 0.002), "the ground plane sits 2 mm under the model");
  const gb = new THREE.Box3().setFromObject(ground).getSize(new THREE.Vector3());
  check(gb.x >= 1000 && gb.z >= 1000, `the ground plane is at least 1 km across (${gb.x.toFixed(0)} m)`);

  const centre = s.bounds.getCenter(new THREE.Vector3());
  const r = s.bounds.getSize(new THREE.Vector3()).length() / 2;
  const sun = s.sunLight;
  check(sun.castShadow && sun.shadow.mapSize.x === 4096, "the sun casts shadows from a 4096 map");
  check(near(sun.position.distanceTo(centre), 4 * r), "the sun stands four radii from the model's centre");
  check(close(sun.target.position, centre) && s.scene.children.includes(sun.target), "the sun aims at the centre, its target in the scene");
  check(near(s.sun.dir.length(), 1), "the sun's direction is a unit vector");
  check(near(sun.shadow.radius, 1 + DEFAULT_RENDER.sun.softness * 4), "the sun's shadow edges soften with its softness");
  check(sun.intensity === (s.sun.up ? 3 : 0), `the sun's intensity is 3 when it is up, else 0 (${sun.intensity})`);

  const off = build([face(unitBox())], [], [], { ...DEFAULT_RENDER, sun: { ...DEFAULT_RENDER.sun, on: false } });
  check(off.sunLight.intensity === 0, "sun off: intensity 0");
  const night = build([face(unitBox())], [], [], DEFAULT_RENDER, { ...DEFAULT_VIZ, hour: 0 });
  check(!night.sun.up && night.sunLight.intensity === 0, "midnight: the sun is down, intensity 0");
  const noon = build([face(unitBox())], [], [], DEFAULT_RENDER, { ...DEFAULT_VIZ, hour: 12 });
  check(noon.sun.up && noon.sunLight.intensity === 3, "noon in June: the sun is up, intensity 3");
}

console.log("\nlamps");
{
  // one directional and seventeen points: the directional comes first, the two dimmest points are skipped
  const many: Light3D[] = [lamp(0, "directional", 0.5)];
  for (let i = 1; i <= MAX_LAMPS + 1; i++) many.push(lamp(i, "point", i / 10));
  const s = build([face(unitBox())], [], many);
  check(s.lamps.length === 18 && s.lamps[0].type === "DirectionalLight", "every lamp is in the scene, the directional one first");
  check(s.lamps.slice(0, MAX_LAMPS).every((l) => !l.userData.rasterSkip), `the first ${MAX_LAMPS} are lit by the Realistic engine too`);
  const skipped = s.lamps.slice(MAX_LAMPS);
  check(skipped.length === 2 && skipped.every((l) => l.userData.rasterSkip === true), "the two dimmest beyond MAX_LAMPS are marked rasterSkip");
  check(near(skipped[0].intensity, 0.6) && near(skipped[1].intensity, 0.3), "those are the dimmest points, at 3 cd per 100 %");

  // shadows: a directional, two spots and a point light, as the 3D view does: one directional, two spots, one point
  const mixed: Light3D[] = [lamp(0, "directional", 1), lamp(1, "spot", 1), lamp(2, "spot", 0.9), lamp(3, "spot", 0.8), lamp(4, "point", 1), lamp(5, "point", 0.5)];
  const m = build([face(unitBox())], [], mixed);
  const shadowed = m.lamps.filter((l) => l.castShadow).map((l) => l.type);
  check(shadowed.filter((t) => t === "DirectionalLight").length === 1 && shadowed.filter((t) => t === "SpotLight").length === 2 && shadowed.filter((t) => t === "PointLight").length === 1, "shadows: one directional, two spots, one point light");

  const spot = m.lamps.find((l) => l.type === "SpotLight") as THREE.SpotLight;
  check(near(spot.angle, 0.6) && near(spot.penumbra, 0.5), "a spot's cone is half its spread, its penumbra from the beam");
  check(close(spot.position, new THREE.Vector3(1, 2, 0)), "a lamp at world (1000, 0, 2000) mm is at render (1, 2, 0) m");
  check(close(spot.target.position.clone().sub(spot.position), new THREE.Vector3(0, -1, 0)), "a spot's target lies one metre along its direction");
  const dl = m.lamps[0] as THREE.DirectionalLight;
  const centre = m.bounds.getCenter(new THREE.Vector3());
  check(dl.position.y > centre.y && close(dl.target.position, centre), "a directional lamp stands above the model and aims down at its centre");
  check(m.lamps.every((l) => l.visible), "lamps are shown when the lights are on");

  const dark = build([face(unitBox())], [], mixed, { ...DEFAULT_RENDER, lights: { on: false, intensity: 1, haze: 0 } });
  check(dark.lamps.every((l) => !l.visible), "lights off: no lamp is shown");
  const doubled = build([face(unitBox())], [], [lamp(4, "point", 1)], { ...DEFAULT_RENDER, lights: { on: true, intensity: 2, haze: 0 } });
  check(near(doubled.lamps[0].intensity, 6), "the lights' strength multiplies the lamps' (point at 100 %: 3 cd, doubled: 6)");
}

console.log("\nupdate");
{
  const a = face(new THREE.BoxGeometry(1000, 1000, 1000), "#ff0000");
  const key = materialKey(a);
  const s = build([a], [], [lamp(0, "point", 1)]);
  const ground = meshesOf(s.scene)[0];
  let cur: RenderSettings = DEFAULT_RENDER;

  check(only(s.update(cur, DEFAULT_VIZ), []), "the same settings change nothing");

  cur = { ...cur, fog: { ...cur.fog, on: true, distance: 100 } };
  check(only(s.update(cur, DEFAULT_VIZ), []), "fog alone changes nothing in the scene");

  cur = { ...cur, materials: { [key]: { preset: "metal" } } };
  const material = s.update(cur, DEFAULT_VIZ);
  check(only(material, ["materials"]), `a material override: materials only (${show(material)})`);
  check(only(s.update(cur, DEFAULT_VIZ), []), "the same override again changes nothing");

  cur = { ...cur, environment: { ...cur.environment, groundPlane: false } };
  const plane = s.update(cur, DEFAULT_VIZ);
  check(only(plane, ["geometry"]) && !ground.visible, `ground plane off: geometry only, and hidden (${show(plane)})`);
  cur = { ...cur, environment: { ...cur.environment, groundPlane: true } };
  check(only(s.update(cur, DEFAULT_VIZ), ["geometry"]) && ground.visible, "ground plane on again: geometry, shown");

  cur = { ...cur, environment: { ...cur.environment, groundColor: "#333333" } };
  check(only(s.update(cur, DEFAULT_VIZ), ["materials"]), "ground colour: materials only");

  const groundMaterial = ground.material as THREE.MeshPhysicalMaterial;
  const matte = groundMaterial.roughness;
  cur = { ...cur, environment: { ...cur.environment, groundGloss: 1 } };
  check(only(s.update(cur, DEFAULT_VIZ), ["materials"]) && groundMaterial.roughness < 0.05 && matte > 0.9, `ground gloss: materials only, matte ${matte.toFixed(2)} to mirror ${groundMaterial.roughness.toFixed(2)}`);

  const boxMaterial = s.materials.get(key)?.material;
  cur = { ...cur, clay: { on: true, color: "#ecebe7" } };
  check(only(s.update(cur, DEFAULT_VIZ), ["materials"]) && boxMaterial?.color.getHexString() === "ecebe7" && boxMaterial.metalness === 0, "clay on: materials only, the metal box turns clay");
  cur = { ...cur, clay: { on: false, color: "#ecebe7" } };
  check(only(s.update(cur, DEFAULT_VIZ), ["materials"]) && boxMaterial?.metalness === 1, "clay off: the metal finish is back");

  cur = { ...cur, sun: { ...cur.sun, intensity: 2 } };
  const sunChange = s.update(cur, DEFAULT_VIZ);
  // the path tracer's sky holds the sun, and the ground under the physical sky is lit by it
  check(only(sunChange, s.sun.up ? ["lights", "environment"] : ["lights"]) && s.sunLight.intensity === (s.sun.up ? 6 : 0), `sun intensity: lights, and the skies while the sun is up (${show(sunChange)})`);

  cur = { ...cur, environment: { ...cur.environment, intensity: 2 } };
  check(only(s.update(cur, DEFAULT_VIZ), ["environment"]), "environment intensity: the sky only");

  cur = { ...cur, lights: { on: false, intensity: 1, haze: 0 } };
  check(only(s.update(cur, DEFAULT_VIZ), ["lights"]) && !s.lamps[0].visible, "lights off: lights only, the lamp hidden");
  cur = { ...cur, lights: { on: true, intensity: 1, haze: 0 } };
  check(only(s.update(cur, DEFAULT_VIZ), ["lights"]) && s.lamps[0].visible, "lights on again: the lamp shown");

  const night = s.update(cur, { ...DEFAULT_VIZ, hour: 0 });
  check(night.lights && night.environment && !s.sun.up && s.sunLight.intensity === 0, `the sun goes down: lights and sky (${show(night)})`);
  s.dispose();
}

console.log("\nground plane");
{
  /** A sheet over size × size mm of cells × cells squares, its height z(x, y) mm. */
  function sheet(cells: number, size: number, z: (x: number, y: number) => number): THREE.BufferGeometry {
    const corners: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= cells; j++) {
      for (let i = 0; i <= cells; i++) {
        const x = (i / cells) * size;
        const y = (j / cells) * size;
        corners.push(x, y, z(x, y));
      }
    }
    const row = cells + 1;
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const a = j * row + i;
        index.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      }
    }
    return indexed(corners, index);
  }
  const groundOf = (s: RenderScene) => meshesOf(s.scene)[0];

  const box = build([face(unitBox())]);
  check(groundOf(box).visible, "under a box: shown");
  box.dispose();

  // a seat 450 mm up on four legs: most of its footprint is one level, though not the lowest
  const chair = build([
    face(new THREE.BoxGeometry(500, 500, 40).translate(250, 250, 470)),
    ...[
      [20, 20],
      [480, 20],
      [20, 480],
      [480, 480],
    ].map(([x, y]) => face(new THREE.BoxGeometry(30, 30, 450).translate(x, y, 225))),
  ]);
  check(groundOf(chair).visible, "under a chair: shown");
  chair.dispose();

  // 300 m of rolling site rising 40 m across it, as a sheet
  const hills = (x: number, y: number) => (40000 * x) / 300000 + 6000 * Math.sin(x / 40000) * Math.cos(y / 50000);
  const site = build([face(sheet(60, 300000, hills))]);
  check(!groundOf(site).visible, "under a sloping site: hidden");
  const on = site.update({ ...DEFAULT_RENDER, environment: { ...DEFAULT_RENDER.environment, groundPlane: false } }, DEFAULT_VIZ);
  check(!on.geometry && !groundOf(site).visible, "a sloping site: turning the plane off changes nothing");
  site.dispose();

  // a gentle site, 4 m over 300 m
  const gentle = build([face(sheet(60, 300000, (x, y) => (4000 * (x + y)) / 600000))]);
  check(!groundOf(gentle).visible, "under a gentle slope: hidden");
  gentle.dispose();

  // the same sheet, level, with a house on it
  const level = build([face(sheet(60, 300000, () => 0)), face(new THREE.BoxGeometry(10000, 8000, 6000).translate(150000, 150000, 3000))]);
  check(groundOf(level).visible, "under a level site: shown");
  level.dispose();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;

function fmt(v: THREE.Vector3): string {
  return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
}
