// Crit pins in the 3D view: each 3D-anchored thread is a small numbered sprite
// in the model, kept the same size on screen whatever the zoom. Pin, in 3D,
// places a pin where the pointer meets the model. three.js is loaded only once
// the 3D view exists (the import is dynamic), so the drawing does not wait for it.

import type * as THREE from "three";
import type { View3D } from "../../app/view3d.ts";
import type { Pt } from "../../core/index.ts";
import type { Anchor } from "../../platform/protocol.ts";
import { repositionPopover } from "./popover.ts";
import { crit } from "./state.ts";

type ThreeModule = typeof THREE;

/** the sprite's height on screen, in CSS px */
const SPRITE_PX = 22;
const ACCENT = "#2f6fdb";
const GREY = "#8d8d93";

let view: View3D | null = null;
let three: ThreeModule | null = null;
let group: THREE.Group | null = null;

/** Called when the 3D view is made: builds the pins once three.js has loaded. */
export function attach3d(v: View3D): void {
  view = v;
  v.beforeRender.add(sizeSprites);
  void import("three").then((mod) => {
    three = mod;
    group = new mod.Group();
    group.name = "crit-pins";
    v.threeScene.add(group);
    rebuild();
  });
  crit.subscribe(rebuild);
}

function badge(n: number, resolved: boolean): THREE.CanvasTexture | null {
  if (!three) return null;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.beginPath();
  c.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  c.fillStyle = resolved ? GREY : ACCENT;
  c.fill();
  c.lineWidth = 8;
  c.strokeStyle = "#ffffff";
  c.stroke();
  c.fillStyle = "#ffffff";
  c.font = "600 64px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(String(n), size / 2, size / 2 + 4);
  return new three.CanvasTexture(canvas);
}

/** Rebuilds the sprites from the threads (the list is short; this runs on every change). */
function rebuild(): void {
  if (!three || !group) return;
  for (const child of group.children) {
    const sprite = child as THREE.Sprite;
    sprite.material.map?.dispose();
    sprite.material.dispose();
  }
  group.clear();
  if (!crit.active) return;
  for (const t of crit.threads()) {
    const a = t.root.anchor;
    if (a?.kind !== "3d") continue;
    const map = badge(t.number, t.root.resolved);
    if (!map) continue;
    const material = new three.SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new three.Sprite(material);
    sprite.position.set(a.x, a.y, a.z);
    sprite.renderOrder = 10;
    group.add(sprite);
  }
}

/** Each frame: keeps an open popover beside its pin as the camera moves, and scales each sprite to SPRITE_PX on screen. */
function sizeSprites(): void {
  repositionPopover();
  if (!view || !group || group.children.length === 0) return;
  const cam = view.activeCamera;
  const height = Math.max(1, view.domElement.clientHeight);
  for (const child of group.children) {
    const sprite = child as THREE.Sprite;
    const d = sprite.position.distanceTo(cam.position);
    let worldPerPx: number;
    if ("fov" in cam) worldPerPx = (2 * d * Math.tan((cam.fov * Math.PI) / 360)) / height;
    else worldPerPx = (cam.top - cam.bottom) / (cam.zoom * height);
    sprite.scale.set(worldPerPx * SPRITE_PX, worldPerPx * SPRITE_PX, 1);
  }
}

/** Where a 3D point is on screen (CSS px over the drawing), or null when it is behind the camera. */
export function project3d(p: { readonly x: number; readonly y: number; readonly z: number }): Pt | null {
  if (!view || !three) return null;
  const canvas = view.domElement;
  const ndc = new three.Vector3(p.x, p.y, p.z).project(view.activeCamera);
  if (ndc.z > 1 || ndc.z < -1) return null;
  return { x: ((ndc.x + 1) / 2) * canvas.clientWidth, y: ((1 - ndc.y) / 2) * canvas.clientHeight };
}

/** The 3D point under a pointer, as a pin's anchor (null over empty space or with no 3D view). */
export function pinAt3d(e: MouseEvent): Anchor | null {
  const hit = view?.pointAt(e);
  return hit ? { kind: "3d", x: hit.x, y: hit.y, z: hit.z } : null;
}

/** Moves the 3D camera's target to a point, keeping its direction and distance. */
export function focus3d(p: { readonly x: number; readonly y: number; readonly z: number }): void {
  if (!view) return;
  const cam = view.activeCamera.position;
  const old = view.orbitTarget;
  const dx = p.x - old.x;
  const dy = p.y - old.y;
  const dz = p.z - old.z;
  view.lookFrom({ x: cam.x + dx, y: cam.y + dy, z: cam.z + dz }, p);
}
