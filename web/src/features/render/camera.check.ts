// Checks the shots and the render-space cameras under Node. Run from web/:
//   npx tsx src/features/render/camera.check.ts
// Projects points through the cameras the path tracer shoots with: the two-point lens must hold the
// target and vertical lines, the one-point lens must centre the target, and the lens, focus and
// reuse rules must hold. Nothing is drawn.

import * as THREE from "three";
import { PhysicalCamera } from "three-gpu-pathtracer";
import type { CameraInfo } from "../../core/index.ts";
import { renderCamera, shotOfCamera, shotOfView, type Shot, type ViewOffset } from "./camera.ts";
import type { RenderSettings } from "./settings.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

const DEG = Math.PI / 180;
type Lens = RenderSettings["camera"];
const TWO_POINT: Lens = { twoPoint: true, dof: false, fStop: 5.6, blurScale: 1, focus: 0 };
const ONE_POINT: Lens = { ...TWO_POINT, twoPoint: false };
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

/** A perspective shot from a world eye and target (mm, z up). */
function persp(eye: [number, number, number], target: [number, number, number], fov = 45): Shot {
  const d = Math.hypot(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
  return { name: "test", perspective: true, eye, target, fov, halfHeight: d * Math.tan((fov / 2) * DEG) };
}

/** A point in render space projected through the camera, as NDC. */
function ndc(cam: THREE.Camera, p: THREE.Vector3): THREE.Vector3 {
  return p.clone().project(cam);
}

/** A camera 4 m from its target, 19.5° below it: the tilt that two-point perspective must level. */
const EYE: [number, number, number] = [0, 0, 1600];
const TARGET: [number, number, number] = [4000, 2000, 0];
const TILTED = persp(EYE, TARGET, 45);
const TARGET_R = new THREE.Vector3(4, 0, -2);

// ---- shots --------------------------------------------------------------------

console.log("shots");
{
  const info: CameraInfo = { id: "c1", name: "Cam 1", layerId: "L", eye: [0, 0, 2000], target: [6000, 0, 0], viewAngle: 60, aspect: 2, perspective: true };
  const s = shotOfCamera(info);
  const fov = (2 * Math.atan(Math.tan(30 * DEG) / 2)) / DEG;
  check(s.name === "Cam 1" && s.perspective && near(s.fov, fov, 1e-9), `a 60° picture 2:1 wide has a ${s.fov.toFixed(4)}° vertical fov (${fov.toFixed(4)}°)`);
  const far = Math.hypot(6000, 0, -2000);
  check(near(s.halfHeight, far * Math.tan((fov / 2) * DEG), 1e-6), `its half-height is distance × tan(fov/2) (${s.halfHeight.toFixed(2)} mm)`);
  const square = shotOfCamera({ ...info, aspect: 1 });
  check(near(square.fov, 60, 1e-9), `on a square picture the vertical fov is the view angle (${square.fov.toFixed(4)}°)`);
  const ortho = shotOfCamera({ ...info, perspective: false });
  check(!ortho.perspective && ortho.fov === 35, "orthographic shots are 35° in the fov");
  check(near(ortho.halfHeight, Math.hypot(6000, 0, -2000) * Math.tan(17.5 * DEG), 1e-6), `its half-height is distance × tan(17.5°) (${ortho.halfHeight.toFixed(2)} mm)`);

  const pc = new THREE.PerspectiveCamera(50, 1.5, 1, 1e5);
  pc.position.set(0, 0, 10000);
  const v = shotOfView(pc, new THREE.Vector3(0, 0, 0));
  check(v.name === "Current view" && v.perspective && v.fov === 50, "the 3D view's perspective shot is named and keeps its fov");
  check(near(v.halfHeight, 10000 * Math.tan(25 * DEG), 1e-6), `its half-height is the distance × tan(fov/2) (${v.halfHeight.toFixed(1)} mm)`);
  const oc = new THREE.OrthographicCamera(-100, 100, 50, -50, 1, 1000);
  const ov = shotOfView(oc, new THREE.Vector3());
  check(!ov.perspective && near(ov.halfHeight, 50, 1e-9), `the 3D view's orthographic half-height is (top − bottom)/2/zoom (${ov.halfHeight})`);
}

// ---- conversion ----------------------------------------------------------------

console.log("render space");
{
  const cam = renderCamera(persp([1000, 2000, 3000], [4000, 2000, 3000]), 1.5, ONE_POINT);
  check(near(cam.position.x, 1, 1e-12) && near(cam.position.y, 3, 1e-12) && near(cam.position.z, -2, 1e-12), `a point at (1000, 2000, 3000) mm is at (1, 3, −2) m (${cam.position.toArray().join(", ")})`);
  const fwd = cam.getWorldDirection(new THREE.Vector3());
  check(near(fwd.x, 1, 1e-9) && near(fwd.y, 0, 1e-9) && near(fwd.z, 0, 1e-9), "a shot due east in the model looks along +x in render space");
  check(cam instanceof PhysicalCamera && near(cam.aspect, 1.5, 1e-12) && near(cam.fov, 45, 1e-9), "a perspective shot is a PhysicalCamera with its fov and aspect");
  check(near(cam.near, 0.02, 1e-12) && near(cam.far, 5000, 1e-9), `near and far suit a few metres (${cam.near}, ${cam.far})`);
}

// ---- two-point perspective ------------------------------------------------------

console.log("two-point perspective");
{
  const two = renderCamera(TILTED, 1.5, TWO_POINT) as PhysicalCamera;
  const one = renderCamera(TILTED, 1.5, ONE_POINT) as PhysicalCamera;
  const t2 = ndc(two, TARGET_R);
  check(near(t2.y, 0, 1e-6), `the target lands at the centre's height with the lens shifted (y ${t2.y.toExponential(2)})`);
  const t1 = ndc(one, TARGET_R);
  check(near(t1.x, 0, 1e-9) && near(t1.y, 0, 1e-9), `without two-point the target is the picture's centre (${t1.x.toFixed(6)}, ${t1.y.toFixed(6)})`);

  // a vertical segment off the camera's median plane (the target's own vertical line would sit on it)
  const bottom = new THREE.Vector3(5, 0, -2), top = new THREE.Vector3(5, 3, -2);
  const x2a = ndc(two, bottom).x, x2b = ndc(two, top).x;
  check(near(x2a, x2b, 1e-9) && Math.abs(x2a) > 0.01, `two-point: a vertical segment projects to one x (${x2a.toFixed(6)}, ${x2b.toFixed(6)})`);
  const x1a = ndc(one, bottom).x, x1b = ndc(one, top).x;
  check(Math.abs(x1a - x1b) > 1e-3, `one-point, the same segment leans in (${x1a.toFixed(4)}, ${x1b.toFixed(4)})`);

  const down = persp([0, 0, 2000], [6000, 0, -1464.1], 40);
  const tilt30 = renderCamera(down, 1.5, TWO_POINT);
  const level = new THREE.Vector3();
  tilt30.getWorldDirection(level);
  check(near(level.y, 0, 1e-9), "a camera looking 30° down is held level");
  const t30 = ndc(tilt30, new THREE.Vector3(6, -1.4641, 0));
  check(near(t30.y, 0, 1e-4), `the target 30° down lands at the centre (y ${t30.y.toExponential(2)})`);

  // beyond 80° the camera is not levelled: the lens is left alone and the shot is as one-point
  const steep = persp([0, 0, 0], [500, 0, -5700], 45);
  const s2 = renderCamera(steep, 1.5, TWO_POINT) as PhysicalCamera;
  const s1 = renderCamera(steep, 1.5, ONE_POINT) as PhysicalCamera;
  check(s2.projectionMatrix.elements.every((e, k) => near(e, s1.projectionMatrix.elements[k], 1e-12)), "beyond 80° of tilt the lens is not shifted");

  // with an offset, the target keeps the height the tilted camera gives it
  const offset: ViewOffset = { fullWidth: 1000, fullHeight: 1000, x: 0, y: 250, width: 1000, height: 1000 };
  const o1 = renderCamera(down, 1.5, ONE_POINT, null, offset);
  const o2 = renderCamera(down, 1.5, TWO_POINT, null, offset);
  const q = new THREE.Vector3(6, -1.4641, 0);
  check(near(ndc(o1, q).y, ndc(o2, q).y, 1e-9), `with an offset the target stays where the tilted camera put it (${ndc(o1, q).y.toFixed(6)})`);
}

// ---- orthographic ----------------------------------------------------------------

console.log("orthographic");
{
  // the eye 10 m out on the model's −y side, which is render space's +z: looking along −z, up is +y
  const cam = renderCamera({ name: "o", perspective: false, eye: [0, -10000, 0], target: [0, 0, 0], fov: 35, halfHeight: 5000 }, 1.5, TWO_POINT);
  check(cam instanceof THREE.OrthographicCamera && !(cam instanceof PhysicalCamera), "an orthographic shot is an OrthographicCamera");
  const o = cam as THREE.OrthographicCamera;
  check(near(o.top, 5, 1e-12) && near(o.bottom, -5, 1e-12) && near(o.right, 7.5, 1e-12) && near(o.left, -7.5, 1e-12), `the frustum is 5 m high and 7.5 m half-wide on 3:2 (${o.left}, ${o.right}, ${o.bottom}, ${o.top})`);
  check(near(o.position.z, 10, 1e-12) && near(o.position.y, 0, 1e-12), "the eye is 10 m out on z");
  const t = ndc(o, new THREE.Vector3(0, 0, 0));
  check(near(t.x, 0, 1e-9) && near(t.y, 0, 1e-9), "the target is the picture's centre");
}

// ---- depth of field ------------------------------------------------------------

console.log("lens");
{
  const dist = Math.hypot(4, 1.6, 2);
  const off = renderCamera(TILTED, 1.5, { ...TWO_POINT, dof: false }) as PhysicalCamera;
  check(off.bokehSize === 0, "no depth of field: no aperture");
  check(near(off.focusDistance, dist, 1e-9), `focus is the eye to the target, in metres (${off.focusDistance.toFixed(4)} m)`);
  check(off.apertureBlades === 6, "six aperture blades");

  const on = renderCamera(TILTED, 1.5, { ...TWO_POINT, dof: true, fStop: 5.6 }) as PhysicalCamera;
  const focal = on.getFocalLength();
  check(near(on.bokehSize, focal / 5.6, 1e-9), `the aperture is the focal length over the f-number (${focal.toFixed(2)} mm / 5.6 = ${on.bokehSize.toFixed(3)} mm)`);
  // the path tracer scales bokehSize mm to metres itself: the radius is the real half-aperture in metres
  const radius = on.bokehSize * 0.5 * 1e-3;
  check(radius > 0.001 && radius < 0.004, `a real f/5.6 lens: its aperture's radius is ${(radius * 1000).toFixed(2)} mm (metres in the tracer)`);
  check(on.fStop === 5.6, "the f-number is the lens's, unscaled");
  check(near(on.focusDistance, dist, 1e-9), "focus defaults to the target's distance");

  const given = renderCamera(TILTED, 1.5, { ...TWO_POINT, dof: true, fStop: 5.6, focus: 12 }) as PhysicalCamera;
  check(near(given.focusDistance, 12, 1e-12), "a focus given is the focus used");
}

// ---- reuse and offsets -----------------------------------------------------------

console.log("reuse");
{
  const pc = new PhysicalCamera();
  const oc = new THREE.OrthographicCamera();
  const ortho: Shot = { name: "o", perspective: false, eye: [0, 0, 10000], target: [0, 0, 0], fov: 35, halfHeight: 5000 };
  check(renderCamera(TILTED, 1.5, TWO_POINT, pc) === pc, "a PhysicalCamera is reused for a perspective shot");
  check(renderCamera(ortho, 1.5, TWO_POINT, oc) === oc, "an OrthographicCamera is reused for an orthographic shot");
  const a = renderCamera(TILTED, 1.5, TWO_POINT, oc);
  check(a !== oc && a instanceof PhysicalCamera, "an orthographic camera is not reused for a perspective shot");
  const b = renderCamera(ortho, 1.5, TWO_POINT, pc);
  check(b !== pc && b instanceof THREE.OrthographicCamera, "a PhysicalCamera is not reused for an orthographic shot");
  const full: ViewOffset = { fullWidth: 1000, fullHeight: 1000, x: 0, y: 0, width: 1000, height: 1000 };
  const plain = renderCamera(TILTED, 1.5, ONE_POINT);
  const same = renderCamera(TILTED, 1.5, ONE_POINT, null, full);
  check(plain.projectionMatrix.elements.every((e, k) => near(e, same.projectionMatrix.elements[k], 1e-12)), "a whole-picture offset changes nothing");
  check(near(plain.matrixWorld.elements[12], 0, 1e-12) && near(plain.matrixWorld.elements[13], 1.6, 1e-12), "the world matrix is current on return");
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
