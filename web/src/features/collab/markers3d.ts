// Collaborators in the 3D view: a ball where each one's pointer meets the model, a cone at their
// camera pointing where they look, and their name over it, all in their colour. Each is sized
// against the view, so it stays about the same size on screen wherever it is. three.js is
// loaded the first time there is a collaborator to show, as the 3D view loads it.

import type * as THREE from "three";
import type { View3D } from "../../app/view3d.ts";
import type { Peer } from "../../platform/protocol.ts";
import type { CollabSession } from "./engine.ts";
import { inkFor, peerColor, pillPath } from "./live.ts";

type Lib = typeof THREE;

/** a marker's radius as a share of the height of the view at its distance */
const RADIUS_SHARE = 0.01;
/** the name's place above the marker, and its size, in radii */
const LABEL_LIFT = 3.2;
const LABEL_WIDTH = 9.5;
const LABEL_HEIGHT = 2.4;
/** drawn over the model: a collaborator is not hidden behind a wall */
const RENDER_ORDER = 1000;

interface Kit {
  readonly T: Lib;
  readonly ball: THREE.SphereGeometry;
  readonly cone: THREE.ConeGeometry;
  readonly up: THREE.Vector3;
}

interface Marker {
  readonly clientId: string;
  readonly key: string;
  readonly ball: THREE.Mesh;
  readonly cone: THREE.Mesh;
  readonly label: THREE.Sprite;
  readonly materials: THREE.Material[];
  readonly textures: THREE.Texture[];
}

let kit: Kit | null = null;
let view: View3D | null = null;
let session: CollabSession | null = null;
const markers = new Map<string, Marker>();

async function load(): Promise<Kit> {
  if (!kit) {
    const T = await import("three");
    kit = {
      T,
      ball: new T.SphereGeometry(1, 16, 12),
      cone: new T.ConeGeometry(0.45, 1.4, 12),
      up: new T.Vector3(0, 1, 0),
    };
  }
  return kit;
}

/** Called once the 3D view exists: its frames place the markers, and the view is kept for the sessions after. */
export function mountMarkers(v: View3D): void {
  view = v;
  v.beforeRender.add(place);
  load().then(sync, () => {
    // three.js failed to load: no markers, the 3D view itself reports that
  });
}

/** Shows the markers of a live session's collaborators; the returned function ends it. */
export function attachMarkers(s: CollabSession): () => void {
  session = s;
  const off = s.onPeers(sync);
  sync();
  return () => {
    off();
    session = null;
    sync();
  };
}

function keyOf(p: Peer): string {
  return `${p.name}\n${p.color}`;
}

/** Adds markers for collaborators in 3D, drops those who left or went to 2D, and redraws when that changed. */
function sync(): void {
  const k = kit;
  const v = view;
  const s = session;
  const wanted = new Map<string, Peer>();
  if (k && v && s) {
    for (const p of s.peers()) if (s.presence(p.clientId)?.mode === "3d") wanted.set(p.clientId, p);
  }
  let changed = false;
  for (const [id, m] of markers) {
    const p = wanted.get(id);
    if (!p || keyOf(p) !== m.key) {
      remove(m);
      markers.delete(id);
      changed = true;
    }
  }
  if (k && v) {
    for (const p of wanted.values()) {
      if (markers.has(p.clientId)) continue;
      markers.set(p.clientId, build(k, v, p));
      changed = true;
    }
  }
  if (v && (changed || markers.size > 0)) v.redraw();
}

function build(k: Kit, v: View3D, p: Peer): Marker {
  const { T } = k;
  const colour = peerColor(p.color);
  const ballMat = new T.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.9 });
  const coneMat = new T.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.85 });
  const map = labelTexture(T, p.name, colour);
  const labelMat = new T.SpriteMaterial({ map, depthTest: false, transparent: true });
  const ball = new T.Mesh(k.ball, ballMat);
  const cone = new T.Mesh(k.cone, coneMat);
  const label = new T.Sprite(labelMat);
  ball.renderOrder = RENDER_ORDER;
  cone.renderOrder = RENDER_ORDER;
  label.renderOrder = RENDER_ORDER;
  v.threeScene.add(ball, cone, label);
  return { clientId: p.clientId, key: keyOf(p), ball, cone, label, materials: [ballMat, coneMat, labelMat], textures: [map] };
}

function labelTexture(T: Lib, name: string, colour: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    g.font = "600 26px system-ui, sans-serif";
    pillPath(g, 2, 8, 252, 48, 24);
    g.fillStyle = colour;
    g.fill();
    g.fillStyle = inkFor(colour);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(fitText(g, name, 224), 128, 33);
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  return map;
}

/** The name, shortened with an ellipsis until it fits the width. */
function fitText(g: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  let out = text;
  while (out.length > 1 && g.measureText(out).width > maxWidth) out = `${out.slice(0, -2)}…`;
  return out;
}

function remove(m: Marker): void {
  m.ball.removeFromParent();
  m.cone.removeFromParent();
  m.label.removeFromParent();
  for (const mat of m.materials) mat.dispose();
  for (const t of m.textures) t.dispose();
}

/** The radius that makes a marker a fixed share of the view's height, at its distance from the camera. */
function radiusAt(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera, at: THREE.Vector3): number {
  if ("fov" in cam) return RADIUS_SHARE * 2 * cam.position.distanceTo(at) * Math.tan((cam.fov * Math.PI) / 360);
  return (RADIUS_SHARE * (cam.top - cam.bottom)) / cam.zoom;
}

/** Moves each marker to where its collaborator is now, sized to the view. Runs before each frame. */
function place(): void {
  const k = kit;
  const v = view;
  const s = session;
  if (!k || !v || !s || markers.size === 0) return;
  const cam = v.activeCamera;
  for (const m of markers.values()) {
    const pr = s.presence(m.clientId);
    const pointer = pr?.mode === "3d" ? pr.pointer3d : null;
    const camera = pr?.mode === "3d" ? pr.camera : null;
    const anchor = camera?.position ?? pointer;
    if (!anchor) {
      m.ball.visible = false;
      m.cone.visible = false;
      m.label.visible = false;
      continue;
    }
    const at = new k.T.Vector3(anchor[0], anchor[1], anchor[2]);
    const r = radiusAt(cam, at);
    m.ball.visible = pointer !== null;
    if (pointer) m.ball.position.set(pointer[0], pointer[1], pointer[2]);
    m.ball.scale.setScalar(r);
    m.cone.visible = camera !== null;
    if (camera) {
      const from = new k.T.Vector3(camera.position[0], camera.position[1], camera.position[2]);
      const toward = new k.T.Vector3(camera.target[0], camera.target[1], camera.target[2]).sub(from);
      m.cone.position.copy(from);
      if (toward.lengthSq() > 1e-9) m.cone.quaternion.setFromUnitVectors(k.up, toward.normalize());
      m.cone.scale.setScalar(r);
    }
    m.label.visible = true;
    m.label.position.set(at.x, at.y, at.z + LABEL_LIFT * r);
    m.label.scale.set(LABEL_WIDTH * r, LABEL_HEIGHT * r, 1);
  }
}
