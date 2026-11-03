// Shots and the render-space camera for one: what a picture looks at (the 3D view's camera or a
// Renderworks camera) in the model's world (mm, z up), and the camera the path tracer shoots it
// with (metres, y up): a PhysicalCamera for perspective, two-point and with depth of field, or an
// orthographic camera.

import * as THREE from "three";
import { PhysicalCamera } from "three-gpu-pathtracer";
import type { CameraInfo, Vec3 } from "../../core/index.ts";
import type { RenderSettings } from "./settings.ts";
import { MM, toRender } from "./space.ts";

/** What a picture looks at, in the model's world (mm, z up). */
export interface Shot {
  readonly name: string;
  readonly perspective: boolean;
  readonly eye: Vec3;
  readonly target: Vec3;
  /** vertical field of view, degrees (perspective) */
  readonly fov: number;
  /** half the picture's height, mm (orthogonal) */
  readonly halfHeight: number;
}

/** As THREE.PerspectiveCamera.setViewOffset takes it. */
export interface ViewOffset {
  readonly fullWidth: number;
  readonly fullHeight: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const DEG = Math.PI / 180;
/** half the angle an orthographic shot's picture spans: its fov reads as a 35° lens's */
const ORTHO_HALF_ANGLE = 17.5;
/** two-point perspective keeps the camera level only while the view tilts less than this, degrees */
const TWO_POINT_LIMIT = 80;
/** the aperture's blades: the path tracer's polygon for the blur */
const BLADES = 6;

/** The 3D view's shot: its camera (world mm, z up) and the point it orbits. */
export function shotOfView(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, target: THREE.Vector3): Shot {
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  const at: Vec3 = [target.x, target.y, target.z];
  if (camera instanceof THREE.PerspectiveCamera) {
    return {
      name: "Current view",
      perspective: true,
      eye,
      target: at,
      fov: camera.fov,
      halfHeight: camera.position.distanceTo(target) * Math.tan((camera.fov / 2) * DEG),
    };
  }
  return {
    name: "Current view",
    perspective: false,
    eye,
    target: at,
    fov: 35,
    halfHeight: (camera.top - camera.bottom) / 2 / camera.zoom,
  };
}

/** A Renderworks camera's shot (its viewAngle spans its picture's width, aspect wide over high). */
export function shotOfCamera(info: CameraInfo): Shot {
  const distance = Math.hypot(info.target[0] - info.eye[0], info.target[1] - info.eye[1], info.target[2] - info.eye[2]);
  if (!info.perspective) {
    return {
      name: info.name,
      perspective: false,
      eye: info.eye,
      target: info.target,
      fov: 2 * ORTHO_HALF_ANGLE,
      halfHeight: distance * Math.tan(ORTHO_HALF_ANGLE * DEG),
    };
  }
  // the angle spans the width, so the height's follows from the aspect
  const fov = (2 * Math.atan(Math.tan((info.viewAngle / 2) * DEG) / info.aspect)) / DEG;
  return {
    name: info.name,
    perspective: true,
    eye: info.eye,
    target: info.target,
    fov,
    halfHeight: distance * Math.tan((fov / 2) * DEG),
  };
}

/**
 * The render-space camera for `shot` on a picture `aspect` wide over high: a PhysicalCamera
 * (perspective, with lens.dof's focus, f-stop and blur scale; focus 0 is the shot's target) or an orthographic
 * one; with lens.twoPoint a level camera whose lens is shifted so the shot's target stays where it
 * was on the picture. `offset` shifts the picture as the 3D view's palettes do. Reuses `out` when
 * it is of the right kind. Callers must not call updateProjectionMatrix() on the result afterwards:
 * a two-point lens's shift is part of its projection and a rebuild drops it.
 */
export function renderCamera(
  shot: Shot,
  aspect: number,
  lens: RenderSettings["camera"],
  out?: PhysicalCamera | THREE.OrthographicCamera | null,
  offset?: ViewOffset | null,
): PhysicalCamera | THREE.OrthographicCamera {
  const eye = toRender(shot.eye[0], shot.eye[1], shot.eye[2]);
  const target = toRender(shot.target[0], shot.target[1], shot.target[2]);
  const view = target.clone().sub(eye);
  const distance = view.length();

  if (!shot.perspective) {
    const cam = out instanceof THREE.OrthographicCamera ? out : new THREE.OrthographicCamera();
    const h = shot.halfHeight * MM;
    cam.left = -h * aspect;
    cam.right = h * aspect;
    cam.top = h;
    cam.bottom = -h;
    cam.near = -10000;
    cam.far = 10000;
    cam.position.copy(eye);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    setOffset(cam, offset);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return cam;
  }

  const cam = out instanceof PhysicalCamera ? out : new PhysicalCamera();
  const pitch = distance > 0 ? Math.asin(clamp(view.y / distance, -1, 1)) : 0;
  const level = lens.twoPoint && distance > 0 && Math.abs(pitch) <= TWO_POINT_LIMIT * DEG;
  cam.fov = shot.fov;
  cam.aspect = aspect;
  cam.near = Math.max(0.02, distance * 0.001);
  cam.far = Math.max(distance * 100, 5000);
  cam.position.copy(eye);
  cam.up.set(0, 1, 0);
  cam.lookAt(level ? eye.clone().add(new THREE.Vector3(view.x, 0, view.z)) : target);
  setOffset(cam, offset);
  // setViewOffset takes the aspect from the offset's full picture; the picture keeps the one it was given
  cam.aspect = aspect;
  cam.updateProjectionMatrix();
  if (level) {
    // The level camera sees the target tan(pitch) (times element 5, the picture's scale) off the centre
    // line; shifting the lens by that much, in element 9, brings it back where the tilted camera had it.
    cam.projectionMatrix.elements[9] += Math.tan(pitch) * cam.projectionMatrix.elements[5];
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  // The path tracer's blur is set by bokehSize, which is the aperture's diameter in millimetres: the
  // focal length (from the 35 mm film gate) over the f-number. It scales that to metres itself, so a
  // metre scene takes the real f-number as it is; multiplying it by 1000 would make the aperture
  // a thousand times too wide. An infinite f-number is no aperture, so the blur is skipped.
  // The blur scale widens the aperture as a smaller f-number would.
  cam.fStop = lens.dof && lens.fStop > 0 ? lens.fStop / Math.max(1, lens.blurScale) : Infinity;
  cam.focusDistance = lens.focus > 0 ? lens.focus : distance;
  cam.apertureBlades = BLADES;
  cam.apertureRotation = 0;
  cam.anamorphicRatio = 1;
  cam.updateMatrixWorld();
  return cam;
}

function setOffset(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera, offset: ViewOffset | null | undefined): void {
  if (offset) cam.setViewOffset(offset.fullWidth, offset.fullHeight, offset.x, offset.y, offset.width, offset.height);
  else cam.clearViewOffset();
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
