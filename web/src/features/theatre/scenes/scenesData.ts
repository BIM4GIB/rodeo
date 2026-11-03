// The set's pieces and scenes, kept in the drawing under "scenes.data" (show.ts), and the edits the Scenes
// palette and its windows make to them. Going to a scene moves the pieces for real, as one undo step;
// a piece flown out stays where it is on the drawing. Where a piece is now is its bounds in the drawing
// (its centre) and the turn Rodeo last gave it; a turn made by hand isn't seen, so Update keeps the last one.

import { attempt, selectionEntries } from "../../../app/commands.ts";
import { appContext } from "../../../app/ext.ts";
import { unionBBox } from "../../../app/geom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { Affine, BBox, EditSession } from "../../../core/index.ts";
import { readShow, writeShow, writeShowIn } from "../show.ts";
import { isStill, moveMatrix, rectangleOf, type Piece, type Pose, type Scene, type SceneData } from "./transitions.ts";

export const SCENES_KEY = "scenes.data";

/** The spike colours a new scene takes in turn, "#rrggbb". */
export const TAPE_COLOURS: readonly string[] = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#fb8c00", "#8e24aa", "#ec407a", "#00acc1"];

/** Each piece's turn as the drawing has it now, from the last Go or the scene the drawing was in when it was opened. */
const turned = new Map<string, number>();
let turnedFor: EditSession | null = null;

function turns(): Map<string, number> {
  if (turnedFor !== store.session) {
    turned.clear();
    turnedFor = store.session;
  }
  return turned;
}

/** The show's scenes data, empty when there is none or no drawing is open. */
export function sceneData(): SceneData {
  const d = readShow<Partial<SceneData>>(SCENES_KEY, {});
  return { pieces: d.pieces ?? [], scenes: d.scenes ?? [], current: d.current ?? null };
}

/** The scene with `id`, or undefined. */
export function sceneNamed(d: SceneData, id: string | null | undefined): Scene | undefined {
  return d.scenes.find((s) => s.id === id);
}

/** The scene the drawing is in now, if the drawing is in one. */
export function currentScene(d: SceneData): Scene | undefined {
  return sceneNamed(d, d.current);
}

/** Each scene and the one after it, in order. */
export function transitionsOf(d: SceneData): [Scene, Scene][] {
  return d.scenes.slice(0, -1).map((a, i) => [a, d.scenes[i + 1]]);
}

/** The next spike colour: the first of the tape colours no scene has, else in turn. */
export function nextColour(scenes: readonly Scene[]): string {
  const used = new Set(scenes.map((s) => s.color.toLowerCase()));
  return TAPE_COLOURS.find((c) => !used.has(c)) ?? TAPE_COLOURS[scenes.length % TAPE_COLOURS.length];
}

/** A new id for a scene or piece of the show. */
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The drawn bounds of object `id` and everything in it, or null when it is gone. */
export function boundsOf(id: string): BBox | null {
  const ctx = appContext();
  if (!ctx || !store.session) return null;
  let box: BBox | null = null;
  for (const { obj } of ctx.scene.expand([id])) box = unionBBox(box, obj.shape?.bbox ?? obj.bounds ?? null);
  return box;
}

/**
 * The rectangle object `id` is now, when it is one (its corners read by rectangleOf): with `wantW`, only
 * while its size still matches that width and `h`. Null for anything else.
 */
export function drawnRect(id: string, wantW?: number, wantH?: number): { x: number; y: number; deg: number; w: number; h: number } | null {
  const ctx = appContext();
  if (!ctx || !store.session) return null;
  const parts = ctx.scene.expand([id]);
  if (parts.length !== 1) return null;
  const shape = parts[0].obj.shape;
  if (!shape || (shape.kind !== "rect" && shape.kind !== "polygon")) return null;
  const r = rectangleOf(shape.points, wantW);
  if (!r) return null;
  if (wantW !== undefined && wantH !== undefined) {
    const tol = 1 + 0.005 * Math.max(wantW, wantH);
    if (Math.abs(r.w - wantW) > tol || Math.abs(r.h - wantH) > tol) return null;
  }
  return r;
}

/** The turn a piece has now when it isn't a rectangle: the one Rodeo last gave it, else its scene's, else its base. */
export function turnOf(piece: Piece, d: SceneData): number {
  return turns().get(piece.id) ?? currentScene(d)?.poses[piece.id]?.deg ?? piece.deg0;
}

/**
 * Where a piece is on the drawing now: a rectangle's own centre and turn; for anything else its bounds'
 * centre and the turn Rodeo last gave it. Null when its object is gone.
 */
export function livePose(piece: Piece, d: SceneData): Pose | null {
  const rect = drawnRect(piece.id, piece.w, piece.h);
  if (rect) return { x: rect.x, y: rect.y, deg: rect.deg };
  const box = boundsOf(piece.id);
  if (!box) return null;
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, deg: turnOf(piece, d) };
}

/** Where a piece is now for a scene's record: on the drawing, else its pose in the current scene, else its base. */
function hereOf(piece: Piece, d: SceneData): Pose {
  const now = livePose(piece, d);
  if (now) return now;
  return currentScene(d)?.poses[piece.id] ?? { x: piece.x0, y: piece.y0, deg: piece.deg0 };
}

/** The name a new piece takes from its object: its own name, else its type. */
function nameOf(id: string): string {
  const o = store.session?.doc.object(id);
  return o?.name || o?.typeName || "Piece";
}

/** Makes each selected object a piece: its bounds' centre is its reference point, and it stands there in every scene. */
export function addSelectedPieces(): void {
  const ctx = appContext();
  if (!ctx || !store.session) return;
  const entries = selectionEntries(ctx.scene);
  if (entries.length === 0) {
    toast("Select the objects to make pieces of, then add them.", "info");
    return;
  }
  const d = sceneData();
  const known = new Set(d.pieces.map((p) => p.id));
  // a rectangle is its own footprint, turned as it is; anything else is taken as its bounds, unturned
  const found: Piece[] = entries
    .filter((e) => !known.has(e.id))
    .map(({ id, box }) => {
      const rect = drawnRect(id);
      if (rect) return { id, name: nameOf(id), w: Math.max(10, rect.w), h: Math.max(10, rect.h), x0: rect.x, y0: rect.y, deg0: rect.deg };
      return {
        id,
        name: nameOf(id),
        w: Math.max(10, box.x1 - box.x0),
        h: Math.max(10, box.y1 - box.y0),
        x0: (box.x0 + box.x1) / 2,
        y0: (box.y0 + box.y1) / 2,
        deg0: 0,
      };
    });
  // names stay apart: a second "rectangle" becomes "rectangle 2"
  const taken = new Set(d.pieces.map((p) => p.name));
  const added = found.map((p) => {
    let name = p.name;
    for (let n = 2; taken.has(name); n++) name = `${p.name} ${n}`;
    taken.add(name);
    return { ...p, name };
  });
  if (added.length === 0) {
    toast("Those are pieces already.", "info");
    return;
  }
  const poses = Object.fromEntries(added.map((p) => [p.id, { x: p.x0, y: p.y0, deg: p.deg0 }]));
  const scenes = d.scenes.map((sc) => ({ ...sc, poses: { ...sc.poses, ...poses } }));
  for (const p of added) turns().set(p.id, p.deg0);
  writeShow(added.length === 1 ? "Add Piece" : "Add Pieces", SCENES_KEY, { pieces: [...d.pieces, ...added], scenes, current: d.current });
}

/** Captures the drawing as a new scene, which becomes the current one. */
export function newScene(name: string): void {
  const d = sceneData();
  if (d.pieces.length === 0) {
    toast("Add the set's pieces first: select objects and use Add Selected as Pieces.", "info");
    return;
  }
  const was = currentScene(d);
  const poses: Record<string, Pose> = {};
  for (const piece of d.pieces) {
    const here = hereOf(piece, d);
    poses[piece.id] = was?.poses[piece.id]?.out ? { ...here, out: true } : { ...here };
  }
  const scene: Scene = { id: newId("scene"), name, note: "", color: nextColour(d.scenes), poses };
  writeShow("New Scene", SCENES_KEY, { ...d, scenes: [...d.scenes, scene], current: scene.id });
}

/** Records the drawing's pieces as they are now in scene `id` (its flown pieces stay flown). */
export function recapture(id: string): void {
  const d = sceneData();
  const scene = sceneNamed(d, id);
  if (!scene) return;
  const poses: Record<string, Pose> = {};
  for (const piece of d.pieces) {
    const prev = scene.poses[piece.id];
    const now = livePose(piece, d);
    if (now) poses[piece.id] = prev?.out ? { ...now, out: true } : { ...now };
    else if (prev) poses[piece.id] = prev;
  }
  writeShow("Update Scene", SCENES_KEY, { ...d, scenes: d.scenes.map((s) => (s.id === id ? { ...s, poses } : s)) });
}

/** Renames a scene (an empty name keeps the old one). */
export function renameScene(id: string, name: string): void {
  const clean = name.trim();
  const d = sceneData();
  if (!clean || !sceneNamed(d, id)) return;
  writeShow("Rename Scene", SCENES_KEY, { ...d, scenes: d.scenes.map((s) => (s.id === id ? { ...s, name: clean } : s)) });
}

/** Deletes a scene; the drawing stays as it is. */
export function deleteScene(id: string): void {
  const d = sceneData();
  writeShow("Delete Scene", SCENES_KEY, { ...d, scenes: d.scenes.filter((s) => s.id !== id), current: d.current === id ? null : d.current });
}

/** Moves a scene one place earlier (-1) or later (+1) in the order. */
export function moveScene(id: string, by: number): void {
  const d = sceneData();
  const i = d.scenes.findIndex((s) => s.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= d.scenes.length) return;
  const scenes = [...d.scenes];
  [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
  writeShow("Move Scene", SCENES_KEY, { ...d, scenes });
}

/** Takes a piece off the set (its object stays in the drawing). */
export function removePiece(id: string): void {
  const d = sceneData();
  const scenes = d.scenes.map((s) => {
    const poses = { ...s.poses };
    delete poses[id];
    return { ...s, poses };
  });
  turns().delete(id);
  writeShow("Remove Piece", SCENES_KEY, { ...d, pieces: d.pieces.filter((p) => p.id !== id), scenes });
}

/** Renames a piece (an empty name keeps the old one). */
export function renamePiece(id: string, name: string): void {
  const clean = name.trim();
  const d = sceneData();
  if (!clean || !d.pieces.some((p) => p.id === id)) return;
  writeShow("Rename Piece", SCENES_KEY, { ...d, pieces: d.pieces.map((p) => (p.id === id ? { ...p, name: clean } : p)) });
}

/**
 * Moves the pieces to scene `id` for real, as one undo step, and makes it the current one. A piece
 * flown out there stays where it is; a piece with no pose in it stays too.
 */
export function goToScene(id: string): void {
  const d = sceneData();
  const target = sceneNamed(d, id);
  if (!target) return;
  const moves: { id: string; m: Affine; deg: number }[] = [];
  for (const piece of d.pieces) {
    const to = target.poses[piece.id];
    if (!to || to.out) continue;
    const now = livePose(piece, d);
    if (!now || isStill(now, to)) {
      if (now) turns().set(piece.id, to.deg);
      continue;
    }
    moves.push({ id: piece.id, m: moveMatrix(now, to), deg: to.deg });
  }
  const ok = attempt(`Go to ${target.name}`, (s) =>
    s.batch(() => {
      for (const mv of moves) s.transformObjects([mv.id], mv.m);
      writeShowIn(s, SCENES_KEY, { ...d, current: id });
    }),
  );
  if (!ok) return;
  for (const mv of moves) turns().set(mv.id, mv.deg);
  if (moves.length === 0) toast(`Already in ${target.name}: nothing moves.`, "info");
}
