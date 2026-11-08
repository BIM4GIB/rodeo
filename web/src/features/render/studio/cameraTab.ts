// The Render palette's camera tab: what Render takes (the 3D view as it stands, one of the drawing's
// Renderworks cameras, or every camera; a click on a camera also looks through it in the 3D view), the
// lens (projection, focal length and two-point perspective) and depth of field (f-stop, strength and
// a focus, which Pick focus takes from a click on the model). The settings belong to the drawing
// (settings.ts) and the shot to Render's output choices (output.ts). No three.js here: this loads
// with the editor.

import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { DEFAULT_VIZ, type Projection } from "../../../app/heliodon.ts";
import { setViz, store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { FacePick, View3D } from "../../../app/view3d.ts";
import type { CameraInfo } from "../../../core/index.ts";
import { DEFAULT_RENDER, onRender, patchRender, renderSettings } from "../settings.ts";
import { ALL, CAMERA_PREFIX, VIEW, chosenCamera, onOutput, outputPrefs, setOutput, type Prefs } from "./output.ts";
import { onStudio, studioTab } from "./state.ts";
import { button, group, icon, note, number, row, segmented, select, slider, switchBox, toggle } from "./ui.ts";
import "./cameraTab.css";

const PROJECTIONS: readonly (readonly [Projection, string])[] = [
  ["perspective", "Perspective"],
  ["orthogonal", "Orthogonal"],
];
/** the focal length the slider takes, in 35 mm terms */
const FOCAL_MIN = 12;
const FOCAL_MAX = 200;
/** half the height of a 35 mm frame: a focal length is read against it */
const HALF_FRAME = 12;
const F_STOPS: readonly (readonly [number, string])[] = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22].map((f): [number, string] => [f, `f/${f}`]);
/** the most a focus may be, metres (the number box's limit) */
const FOCUS_MAX = 100000;

/** A focal length (35 mm terms) as the 3D view's lens: its vertical view angle, degrees. */
const lensOf = (mm: number): number => (2 * Math.atan(HALF_FRAME / mm) * 180) / Math.PI;
/** The focal length (35 mm terms) of a lens angle in degrees. */
const focalOf = (lens: number): number => HALF_FRAME / Math.tan((Math.max(lens, 1) * Math.PI) / 360);

/** Where a camera sits: its layer, or the viewport and sheet it belongs to (as the Visualization palette shows it). */
function cameraPlace(c: CameraInfo): string {
  const doc = store.session?.doc;
  const layer = doc?.layers().find((l) => l.id === c.layerId)?.name ?? "";
  if (!c.viewportId) return layer;
  const vp = doc?.viewport(c.viewportId)?.name;
  return vp ? `${vp} · ${layer}` : `A viewport on ${layer}`;
}

/** The Shots row Render takes now: every camera when there are two or more, else the camera it takes, else the current view. */
function takenKey(p: Prefs, cams: readonly CameraInfo[]): string {
  const only = cams[0];
  if (p.camera === ALL && cams.length > 1) return ALL;
  if (p.camera === ALL && only && cams.length === 1) return CAMERA_PREFIX + only.id;
  return chosenCamera(p, cams) ? p.camera : VIEW;
}

/** Shows the 3D view through `c`: its eye, target and lens, in its projection (as the Visualization palette does). */
async function lookThrough(c: CameraInfo): Promise<void> {
  const view = await appContext()?.show3d();
  if (!view) return;
  const projection: Projection = c.perspective ? "perspective" : "orthogonal";
  if (store.viz3d.projection !== projection) setViz({ projection });
  if (c.perspective) view.lookThrough(c.eye, c.target, c.viewAngle, c.aspect);
  else view.lookAs({ toward: [c.eye[0] - c.target[0], c.eye[1] - c.target[1], c.eye[2] - c.target[2]], at: c.target, perspective: false });
}

interface ShotOptions {
  readonly title?: string;
  /** the name is a camera's, the drawing's own words: not translated */
  readonly userName?: boolean;
}

/** One row of the Shots list: a button, with a check where Render takes it. */
function shotRow(name: string, place: string, badge: string, onPick: () => void, opts: ShotOptions = {}): HTMLButtonElement {
  const check = icon("check", 14);
  check.classList.add("rs-camera-check");
  const names = h(
    "span",
    { cls: "rs-camera-shot-names" },
    h("span", { cls: "rs-camera-shot-name", text: name, attrs: opts.userName ? { translate: "no" } : {} }),
    place ? h("span", { cls: "rs-camera-shot-sub", text: place }) : null,
  );
  const b = h(
    "button",
    { cls: "rs-camera-shot", attrs: { type: "button", "aria-pressed": "false" }, title: opts.title },
    check,
    names,
    badge ? h("span", { cls: "rs-camera-shot-badge", text: badge }) : null,
  );
  b.addEventListener("click", onPick);
  return b;
}

/** The Render palette's camera tab: Shots, Lens, and Depth of field. */
export function cameraTab(): HTMLElement {
  // ---- Shots: what Render takes
  const shotRows = new Map<string, HTMLButtonElement>();
  const shotList = h("div", { cls: "rs-camera-shots", attrs: { role: "group", "aria-label": "Shots" } });
  const lookHint = note("Click a Renderworks camera to look through it in the 3D view.");
  const noCameras = note("The drawing has no Renderworks cameras: Render takes the current view.");
  let cams: readonly CameraInfo[] = [];
  let shotsKey: string | null = null;

  // ---- Lens
  const projection = segmented("Projection", PROJECTIONS, (p) => setViz({ projection: p }));
  const focal = slider("Focal length", {
    min: FOCAL_MIN,
    max: FOCAL_MAX,
    step: 1,
    format: (mm) => `${Math.round(mm)} mm`,
    onInput: (mm) => setViz({ lens: lensOf(mm) }),
    reset: Math.round(focalOf(DEFAULT_VIZ.lens)),
  });
  const twoPoint = toggle("Two-point perspective", (on) => patchRender("camera", { twoPoint: on }));
  twoPoint.el.classList.add("rs-camera-twopoint");

  // ---- Depth of field
  const dofSwitch = switchBox("Depth of field", (on) => patchRender("camera", { dof: on }));
  const fStop = select("f-stop", F_STOPS, (f) => patchRender("camera", { fStop: f }));
  const strength = slider("Strength", {
    min: 1,
    max: 20,
    step: 1,
    format: (n) => `×${Math.round(n)}`,
    onInput: (n) => patchRender("camera", { blurScale: n }),
    reset: DEFAULT_RENDER.camera.blurScale,
    hint: "×1 blurs as a real lens at the f-stop; more for the blur a real lens shows only up close",
  });
  const focusField = number("Focus (m)", "", 0, FOCUS_MAX, (m) => patchRender("camera", { focus: m }));
  const pick = button("Pick focus", () => void startPick(), { icon: "focus", small: true });
  pick.setAttribute("aria-pressed", "false");
  const focusRow = row("Focus (m)", h("div", { cls: "rs-camera-focus" }, focusField.input, pick));
  const focusNote = note("0: the point the view orbits.");

  // ---- Pick focus: the next click on the model sets the focus to its distance from the eye
  let pickingOn: View3D | null = null;
  let pickFn: FacePick | null = null;

  /** Ends a pick, leaving the 3D view's clicks as they were. */
  const stopPicking = (): void => {
    if (pickingOn && pickingOn.onFacePick === pickFn) pickingOn.onFacePick = null;
    pickingOn = null;
    pickFn = null;
    window.removeEventListener("keydown", onPickKey, true);
    pick.setAttribute("aria-pressed", "false");
  };

  /** Esc ends a pick. (state.ts's Esc also leaves Render Studio, unless it yields while a pick waits.) */
  const onPickKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    stopPicking();
  };

  /** Shows the 3D view, then takes the next click on the model as the focus; a click again cancels. */
  const startPick = async (): Promise<void> => {
    if (pickingOn) {
      stopPicking();
      return;
    }
    const view = await appContext()?.show3d();
    if (!view || pickingOn) return;
    const fn: FacePick = (hit) => {
      // over empty space the pick waits for the model
      if (!hit) return;
      const eye = view.activeCamera.position;
      const [x, y, z] = hit.point;
      const metres = Math.hypot(x - eye.x, y - eye.y, z - eye.z) / 1000;
      stopPicking();
      patchRender("camera", { focus: Math.min(FOCUS_MAX, Math.max(0.01, Math.round(metres * 100) / 100)), dof: true });
    };
    pickingOn = view;
    pickFn = fn;
    view.onFacePick = fn;
    window.addEventListener("keydown", onPickKey, true);
    pick.setAttribute("aria-pressed", "true");
    toast("Click the model where the picture should be sharp.", "info");
  };

  /** The Shots list, rebuilt when the drawing's cameras change (not on every edit). */
  const listCameras = (): void => {
    const found = store.session?.doc.cameras() ?? [];
    const key = found.map((c) => [c.id, c.name, c.perspective, Math.round(c.viewAngle), cameraPlace(c)].join("\u0001")).join("\u0002");
    if (key === shotsKey) return;
    shotsKey = key;
    cams = found;
    shotRows.clear();
    const rows: HTMLButtonElement[] = [];
    const current = shotRow("Current view", "", "", () => setOutput({ camera: VIEW }));
    shotRows.set(VIEW, current);
    rows.push(current);
    for (const c of found) {
      const shot = CAMERA_PREFIX + c.id;
      const label = c.name.trim();
      const b = shotRow(
        label || "Camera",
        cameraPlace(c),
        c.perspective ? `${Math.round(c.viewAngle)}°` : "Ortho",
        () => {
          setOutput({ camera: shot });
          void lookThrough(c);
        },
        { title: "Look through this camera in the 3D view", userName: label !== "" },
      );
      shotRows.set(shot, b);
      rows.push(b);
    }
    if (found.length > 1) {
      const every = shotRow("All cameras", "", "", () => setOutput({ camera: ALL }));
      shotRows.set(ALL, every);
      rows.push(every);
    }
    shotList.replaceChildren(...rows);
    lookHint.hidden = found.length === 0;
    noCameras.hidden = found.length > 0;
    sync();
  };

  /** Shows the settings and what Render takes; a focus pick ends when the 3D view goes or depth of field is off. */
  const sync = (): void => {
    const c = renderSettings().camera;
    const v = store.viz3d;
    if (pickingOn && (!store.view3d || !c.dof)) stopPicking();
    const taken = takenKey(outputPrefs(), cams);
    for (const [key, b] of shotRows) b.setAttribute("aria-pressed", String(key === taken));
    projection.set(v.projection);
    focal.set(focalOf(v.lens));
    focal.setDisabled(v.projection !== "perspective");
    twoPoint.set(c.twoPoint);
    dofSwitch.set(c.dof);
    fStop.set(c.fStop);
    strength.set(c.blurScale);
    focusField.set(c.focus);
    for (const el of [fStop.el, strength.el, focusRow, focusNote]) el.hidden = !c.dof;
  };

  // ---- the tab's groups
  const shots = group("Shots", { key: "camera.shots" }, shotList, lookHint, noCameras);
  const lens = group(
    "Lens",
    { key: "camera.lens" },
    row("Projection", projection.el),
    focal.el,
    twoPoint.el,
    note("Keeps vertical lines vertical."),
  );
  const dof = group("Depth of field", { key: "camera.dof", aside: dofSwitch.el }, fStop.el, strength.el, focusRow, focusNote);
  const root = h("div", { cls: "rs-camera-tab" }, shots.el, lens.el, dof.el);

  store.on("session", listCameras);
  store.on(["viz3d", "view3d", "session"], sync);
  onRender(sync);
  onOutput(sync);
  // a pick ends when the palette moves to another tab (onStudio also fires when Studio comes or goes)
  onStudio(() => {
    if (studioTab() !== "camera") stopPicking();
  });
  listCameras();
  sync();
  return root;
}
