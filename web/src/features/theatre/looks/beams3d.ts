// Show Beams in 3D (Stage > Lighting): each focused instrument's beam drawn in the 3D view, a faint cone from its
// lens to the stage floor in its colour, with a brighter pool where it lands. Each beam is dimmed or put out by its
// channel's level in the look being shown (levels.ts), so a look recolours them without drawing them again. They are
// rebuilt when the drawing changes, kept through the 3D view's model rebuilds (its content isn't cleared), and the
// view frames them when they are first shown. The shapes are worked out in beamShape.ts.

import * as THREE from "three";
import { appContext } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { View3D } from "../../../app/view3d.ts";
import type { Fixture, FocusPoint } from "../fixture.ts";
import { colorOf } from "../gels.ts";
import { fixtures } from "../instrument.ts";
import { levelOf, onLevels } from "../levels.ts";
import { beamShape, type BeamShape } from "./beamShape.ts";

/** how much a beam's colour shows: faint, so overlapping beams mix into one another */
const BEAM_OPACITY = 0.12;
/** the pool on the floor is brighter than the beam above it. Normal blending, not additive: the 3D view's background is light, where added colour turns white. */
const POOL_OPACITY = 0.35;
/** the pool sits just above the floor, so it doesn't flicker against it */
const POOL_LIFT_MM = 2;

let shown = false;
let view: View3D | null = null;
let groups = new Map<string, THREE.Group>();
let signature = "";
let stops: (() => void)[] = [];

/** Whether the beams are shown in the 3D view. */
export function beamsShown(): boolean {
  return shown;
}

/** Stage > Lighting > Show Beams in 3D: shows the beams in the 3D view, framed, or takes them away. */
export async function toggleBeams(): Promise<void> {
  if (shown) {
    shown = false;
    stop();
    return;
  }
  shown = true;
  const v = (await appContext()?.show3d()) ?? null;
  if (!shown) return;
  if (!v) {
    shown = false;
    toast("The 3D view needs WebGL, which this browser can't give.", "info");
    return;
  }
  use(v);
  if (groups.size === 0) toast("No instrument has a focus yet, so there are no beams to draw.", "info");
  else v.fit();
}

/** Called when the 3D view is made: the beams join it if they are shown. */
export function beams3dCreated(v: View3D): void {
  if (shown) use(v);
}

/** Makes `v` the view the beams are in, following the drawing and the levels from now on. */
function use(v: View3D): void {
  if (view !== v) {
    clear();
    view = v;
  }
  if (stops.length === 0) stops = [store.on("session", onDrawingChange), onLevels(recolour)];
  rebuild();
}

let syncQueued = false;
/** The drawing changed: the beams follow once the drawing's own listeners have cleared their reads, so they read the drawing as it is now. */
function onDrawingChange(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    sync();
  });
}

/** Takes the beams out of their view and stops following the drawing and the levels. */
function stop(): void {
  clear();
  view = null;
  for (const off of stops) off();
  stops = [];
}

/** Takes every beam out of the view it is in, and frees its geometry and material. */
function clear(): void {
  for (const g of groups.values()) {
    view?.removeContent(g);
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
  }
  groups = new Map();
  signature = "";
}

/** The drawing changed: the beams follow it, in whichever 3D view there is now. */
function sync(): void {
  if (!shown) return;
  const v = appContext()?.view3d() ?? null;
  if (!v) {
    clear();
    view = null;
    return;
  }
  use(v);
}

/** Draws the beams again when the focused instruments changed; one group per layer, so a hidden layer hides its beams. */
function rebuild(): void {
  const v = view;
  if (!v) return;
  const lit = fixtures().filter((f): f is Fixture & { focus: FocusPoint } => f.focus !== null);
  const sig = JSON.stringify(lit.map((f) => [f.id, f.layerId, f.at, f.heightMm, f.focus, f.fieldDeg, f.color, f.channel]));
  if (sig === signature) return;
  clear();
  signature = sig;
  for (const f of lit) {
    let group = groups.get(f.layerId);
    if (!group) {
      group = new THREE.Group();
      groups.set(f.layerId, group);
    }
    group.add(...beamMeshes(f, f.focus));
  }
  for (const [layer, group] of groups) v.addContent(group, layer);
  v.redraw();
}

/** The levels changed: each beam fades with its channel's level now, without being drawn again; at 0 it is gone. */
function recolour(): void {
  if (!view) return;
  for (const group of groups.values()) {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const alpha = mesh.userData.alpha as number | undefined;
      if (alpha === undefined) return;
      const level = levelOf(mesh.userData.channel as string);
      (mesh.material as THREE.MeshBasicMaterial).opacity = alpha * level;
      mesh.visible = level > 0;
    });
  }
  view.redraw();
}

/** One instrument's beam: its cone, and its pool on the floor when it lands in one. */
function beamMeshes(f: Fixture, focus: FocusPoint): THREE.Mesh[] {
  const lens = { x: f.at.x, y: f.at.y, z: f.heightMm };
  const shape: BeamShape = beamShape(lens, focus, f.fieldDeg);
  const rgb = colorOf(f.color);
  const tint = new THREE.Color().setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace);
  const out = [fan([shape.apex, ...shape.rim], BEAM_OPACITY, f.channel, tint)];
  if (shape.pools && shape.spot) {
    const lift = (p: FocusPoint): FocusPoint => ({ x: p.x, y: p.y, z: p.z + POOL_LIFT_MM });
    out.push(fan([lift(shape.spot), ...shape.rim.map(lift)], POOL_OPACITY, f.channel, tint));
  }
  return out;
}

/** A closed surface of triangles from the first point round the rest, its opacity set by the channel's level. */
function fan(points: readonly FocusPoint[], alpha: number, channel: string, tint: THREE.Color): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
  const last = points.length - 1;
  const index: number[] = [];
  for (let i = 1; i <= last; i++) index.push(0, i, i === last ? 1 : i + 1);
  geometry.setIndex(index);
  const level = levelOf(channel);
  const material = new THREE.MeshBasicMaterial({ color: tint.clone(), transparent: true, opacity: alpha * level, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = level > 0;
  mesh.userData = { channel, alpha };
  return mesh;
}
