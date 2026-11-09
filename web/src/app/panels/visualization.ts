// The Visualization palette: how the 3D view is looked at and lit, as Vectorworks' Visualization
// palette, Lighting Options and Heliodon set it: the projection, the drawing's Renderworks cameras
// (click one to look through it, or point it the way the 3D view looks), the sun (following the
// view, or placed for a latitude, date and solar time), shadows, ambient light, the drawing's light
// objects (click one to select what holds it), and the clip cube that cuts the model open along each
// axis. The settings belong to this window, not to the file. As Vectorworks 2025 splits it, the
// palette has two tabs, Lights and Cameras, each of which can come out as a palette of its own.
import "./visualization.css";
import type { CameraInfo, Light3D } from "../../core/index.ts";
import { attempt, setActiveLayer, setSelection } from "../commands.ts";
import { tabbed } from "../dock.ts";
import { h } from "../dom.ts";
import { appContext } from "../ext.ts";
import { TAB_ICON } from "../icons.ts";
import { DEFAULT_VIZ, MAX_LAMPS, dayLabel, hourLabel, sunPlace, type ClipRange, type Viz3D } from "../heliodon.ts";
import { setViz, store } from "../state.ts";
import { foldingSection } from "./sections.ts";

type Axis = "x" | "y" | "z";

function section(title: string, ...children: Node[]): HTMLElement {
  return foldingSection("visualization", title, ...children);
}

function field(label: string, control: Node): HTMLElement {
  return h("label", { cls: "field" }, h("span", { cls: "field-label", text: label }), control);
}

function check(label: string, onChange: (on: boolean) => void): { row: HTMLElement; box: HTMLInputElement } {
  const box = h("input", { attrs: { type: "checkbox" } });
  box.addEventListener("change", () => onChange(box.checked));
  return { row: h("label", { cls: "class-style-item viz-check" }, box, h("span", { text: label })), box };
}

/** A slider with its value shown beside it; `onInput` runs as it moves. */
function slider(min: number, max: number, step: number, label: string, onInput: (v: number) => void): { el: HTMLElement; input: HTMLInputElement; readout: HTMLElement } {
  const input = h("input", { cls: "attr-range", attrs: { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": label } });
  const readout = h("span", { cls: "viz-readout" });
  input.addEventListener("input", () => onInput(Number(input.value)));
  return { el: h("div", { cls: "attr-opacity" }, input, readout), input, readout };
}

function numberField(label: string, min: number, max: number, onChange: (v: number) => void): { el: HTMLElement; input: HTMLInputElement } {
  const input = h("input", { cls: "num", attrs: { type: "number", min: String(min), max: String(max), step: "any", "aria-label": label } });
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (input.value.trim() !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    // anything else goes back to the setting
    else store.emit("viz3d");
  });
  return { el: field(label, input), input };
}

/** Shows the 3D view through `c`: its eye, target and lens, in its projection. */
async function lookThrough(c: CameraInfo): Promise<void> {
  const view = await appContext()?.show3d();
  if (!view) return;
  if (store.viz3d.projection !== (c.perspective ? "perspective" : "orthogonal")) setViz({ projection: c.perspective ? "perspective" : "orthogonal" });
  if (c.perspective) view.lookThrough(c.eye, c.target, c.viewAngle, c.aspect);
  else view.lookAs({ toward: [c.eye[0] - c.target[0], c.eye[1] - c.target[1], c.eye[2] - c.target[2]], at: c.target, perspective: false });
}

/** Points `c` the way the 3D view looks: from its eye toward the point it orbits. Its lens stays. */
function matchView(c: CameraInfo): void {
  const view = appContext()?.view3d();
  if (!view) return;
  const { x, y, z } = view.activeCamera.position;
  const t = view.orbitTarget;
  attempt("Match Camera to View", (s) => s.setCameraView(c.id, [x, y, z], [t.x, t.y, t.z]));
}

/** Where a camera sits: its layer, or the viewport and sheet it belongs to. */
function cameraPlace(c: CameraInfo): string {
  const doc = store.session?.doc;
  const layer = doc?.layers().find((l) => l.id === c.layerId)?.name ?? "";
  if (!c.viewportId) return layer;
  const vp = doc?.viewport(c.viewportId)?.name;
  return vp ? `${vp} · ${layer}` : `A viewport on ${layer}`;
}

const LIGHT_KIND: Record<Light3D["kind"], string> = { point: "Point light", spot: "Spot light", directional: "Directional light" };

/** What holds a light, and where: the symbol or plug-in it is in and its layer. */
function lightPlace(l: Light3D, symbolName: (index: number) => string | undefined): string {
  const doc = store.session?.doc;
  const layer = doc?.layers().find((x) => x.id === l.layerId)?.name ?? "";
  if (l.objectId === l.id) return layer;
  const holder = doc?.object(l.objectId);
  const symbol = holder?.symbol !== undefined ? symbolName(holder.symbol) : undefined;
  const name = holder?.name || symbol || holder?.typeName || "";
  return name ? `${name} · ${layer}` : layer;
}

/** Selects what holds `l` (the light, or its symbol or plug-in) on its layer. */
function selectLight(l: Light3D): void {
  if (store.activeLayerId !== l.layerId) setActiveLayer(l.layerId);
  setSelection([l.objectId]);
}

export function visualizationPalette(): HTMLElement {
  const v = (): Viz3D => store.viz3d;

  // projection
  const projButtons = (["perspective", "orthogonal"] as const).map((p) => {
    const btn = h("button", { cls: "seg-btn", text: p === "perspective" ? "Perspective" : "Orthogonal", attrs: { type: "button" } });
    btn.addEventListener("click", () => {
      btn.blur();
      setViz({ projection: p });
    });
    return { p, btn };
  });
  const projection = section("Projection", h("div", { cls: "seg viz-seg", attrs: { role: "group", "aria-label": "Projection" } }, ...projButtons.map((b) => b.btn)));

  // the drawing's Renderworks cameras
  const cameraList = h("div", { cls: "list viz-cameras" });
  const noCameras = h("p", { cls: "muted viz-note", text: "This drawing has no Renderworks cameras." });
  const cameras = section("Renderworks Cameras", noCameras, cameraList);
  const listCameras = (): void => {
    const found = store.session?.doc.cameras() ?? [];
    noCameras.hidden = found.length > 0;
    cameraList.replaceChildren(
      ...found.map((c) => {
        const row = h(
          "div",
          { cls: "row", attrs: { role: "button", tabindex: "0" }, title: "Look through this camera in the 3D view" },
          h("div", { cls: "names" }, h("div", { cls: "name", text: c.name, attrs: { translate: "no" } }), h("div", { cls: "sub", text: cameraPlace(c) })),
          h("span", { cls: "badge", text: c.perspective ? `${Math.round(c.viewAngle)}°` : "Ortho" }),
        );
        // with the 3D view open, the camera can take the view it shows
        if (store.view3d) {
          const match = h("button", { cls: "btn small viz-match", text: "Match View", title: "Point this camera the way the 3D view looks", attrs: { type: "button" } });
          match.addEventListener("click", (e) => {
            e.stopPropagation();
            matchView(c);
          });
          match.addEventListener("keydown", (e) => e.stopPropagation());
          row.insertBefore(match, row.lastChild);
        }
        row.addEventListener("click", () => void lookThrough(c));
        row.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          void lookThrough(c);
        });
        return row;
      }),
    );
  };

  // lighting
  const sunSelect = h(
    "select",
    { cls: "select", attrs: { "aria-label": "Sun" } },
    h("option", { text: "Follows the view", attrs: { value: "view" } }),
    h("option", { text: "Heliodon", attrs: { value: "heliodon" } }),
    h("option", { text: "Off (light objects only)", attrs: { value: "off" } }),
  );
  sunSelect.addEventListener("change", () => setViz({ sun: sunSelect.value === "heliodon" || sunSelect.value === "off" ? sunSelect.value : "view" }));
  const latitude = numberField("Latitude (°)", -90, 90, (n) => setViz({ latitude: n }));
  const north = numberField("North (°)", -360, 360, (n) => setViz({ north: n }));
  const day = slider(1, 365, 1, "Date", (n) => setViz({ dayOfYear: n }));
  const hour = slider(0, 24, 0.25, "Solar time", (n) => setViz({ hour: n }));
  const sunNote = h("p", { cls: "muted viz-note" });
  const heliodon = h(
    "div",
    { cls: "viz-heliodon" },
    h("div", { cls: "grid" }, latitude.el, north.el),
    field("Date", day.el),
    field("Solar time", hour.el),
    sunNote,
  );
  const shadows = check("Casts shadows", (on) => setViz({ shadows: on }));
  const ambient = slider(0, 200, 5, "Ambient light", (n) => setViz({ ambient: n / 100 }));
  const lighting = section("Lighting", field("Sun", sunSelect), heliodon, shadows.row, field("Ambient light", ambient.el));

  // the drawing's light objects
  const lampsOn = check("Light the model with them", (on) => setViz({ lights: on }));
  const haze = slider(0, 100, 5, "Haze", (n) => setViz({ haze: n / 100 }));
  haze.el.title = "Haze in the air: the spots that are on show as beams";
  const lampNote = h("p", { cls: "muted viz-note" });
  const lightList = h("div", { cls: "list viz-cameras" });
  const noLights = h("p", { cls: "muted viz-note", text: "This drawing has no light objects." });
  const hazeField = field("Haze", haze.el);
  const lights = section("Light Objects", lampsOn.row, hazeField, noLights, lampNote, lightList);
  const listLights = (): void => {
    const found = store.session?.doc.lights3d() ?? [];
    noLights.hidden = found.length > 0;
    lampsOn.row.hidden = found.length === 0;
    hazeField.hidden = found.length === 0;
    const off = found.filter((l) => !l.on).length;
    lampNote.textContent = [
      found.length > MAX_LAMPS ? `Of these ${found.length}, the ${MAX_LAMPS} nearest where the 3D view looks light it.` : "",
      off ? `${off} ${off === 1 ? "is" : "are"} off.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    lampNote.hidden = !lampNote.textContent;
    // symbolDefs() bounds every symbol: read once for the list, not once per light (seconds in a big drawing)
    let symbols: Map<number, string> | null = null;
    const symbolName = (index: number): string | undefined =>
      (symbols ??= new Map(store.session?.doc.symbolDefs().map((d) => [d.index, d.name]))).get(index);
    lightList.replaceChildren(
      ...found.map((l) => {
        const row = h(
          "div",
          { cls: l.on ? "row" : "row viz-off-light", attrs: { role: "button", tabindex: "0" }, title: "Select what holds this light" },
          h("span", { cls: "viz-swatch", attrs: { style: `background:${l.color}`, "aria-hidden": "true" } }),
          h("div", { cls: "names" }, h("div", { cls: "name", text: l.name || LIGHT_KIND[l.kind], attrs: l.name ? { translate: "no" } : undefined }), h("div", { cls: "sub", text: lightPlace(l, symbolName) })),
          h("span", { cls: "badge", text: l.on ? `${Math.round(l.brightness * 100)} %` : "Off" }),
        );
        // a light the drawing or a lighting device places turns on and off here (a symbol's in Edit Symbol, Object Info)
        if (l.placedBy === "drawing" || l.device) {
          const box = h("input", { cls: "viz-light-on", checked: l.on, attrs: { type: "checkbox", "aria-label": l.on ? "Turn off" : "Turn on" } });
          box.addEventListener("click", (e) => e.stopPropagation());
          box.addEventListener("change", () => {
            if (!attempt(box.checked ? "Turn Light On" : "Turn Light Off", (s) => s.setLight(l.id, { on: box.checked }))) box.checked = l.on;
          });
          row.prepend(box);
        }
        row.addEventListener("click", () => selectLight(l));
        row.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          selectLight(l);
        });
        return row;
      }),
    );
  };

  // clip cube
  const clipOn = check("Clip the model", (on) => setViz({ clip: { ...v().clip, on } }));
  const axes = (["x", "y", "z"] as const).map((axis) => {
    const set = (end: 0 | 1, f: number): void => {
      const now = v().clip[axis];
      const next: ClipRange = end === 0 ? [f, now[1]] : [now[0], f];
      setViz({ clip: { ...v().clip, [axis]: next } });
    };
    const from = slider(0, 100, 1, `${axis.toUpperCase()} from`, (n) => set(0, n / 100));
    const to = slider(0, 100, 1, `${axis.toUpperCase()} to`, (n) => set(1, n / 100));
    return { axis, from, to, el: h("div", { cls: "viz-axis" }, h("span", { cls: "field-label", text: axis.toUpperCase() }), from.el, to.el) };
  });
  const resetClip = h("button", { cls: "btn small", text: "Reset", title: "Take in the whole model", attrs: { type: "button" } });
  resetClip.addEventListener("click", () => setViz({ clip: { ...DEFAULT_VIZ.clip, on: v().clip.on } }));
  const clipBody = h("div", { cls: "viz-clip" }, ...axes.map((a) => a.el), h("div", { cls: "row-end" }, resetClip));
  const clip = section("Clip Cube", clipOn.row, clipBody);

  // each tab says where its settings show till the 3D view is open; the tab scrolls, its sections
  // inside at their own height (in columns when the palette is wide, as dock.css lays them)
  const notes = [0, 1].map(() => h("p", { cls: "muted viz-note viz-off", text: "These settings show in the 3D view (View › 3D View)." }));
  const tab = (...sections: HTMLElement[]): HTMLElement => h("div", {}, h("div", { cls: "info viz" }, ...sections));
  const root = tabbed("visualization", [
    { id: "lights", label: "Lights", title: "The sun, ambient light and light objects", icon: TAB_ICON.lights, body: tab(notes[0], lighting, lights) },
    { id: "cameras", label: "Cameras", title: "Projection, Renderworks cameras and the clip cube", icon: TAB_ICON.cameras, body: tab(notes[1], projection, cameras, clip) },
  ]);

  const pct = (r: ClipRange, end: 0 | 1): string => `${Math.round(r[end] * 100)} %`;
  const sync = (): void => {
    const s = v();
    for (const note of notes) note.hidden = store.view3d;
    for (const { p, btn } of projButtons) {
      btn.classList.toggle("active", s.projection === p);
      btn.setAttribute("aria-pressed", String(s.projection === p));
    }
    sunSelect.value = s.sun;
    heliodon.hidden = s.sun !== "heliodon";
    latitude.input.value = String(s.latitude);
    north.input.value = String(s.north);
    day.input.value = String(s.dayOfYear);
    day.readout.textContent = dayLabel(s.dayOfYear);
    hour.input.value = String(s.hour);
    hour.readout.textContent = hourLabel(s.hour);
    const place = sunPlace(s);
    sunNote.textContent =
      place.altitude > 0
        ? `The sun is ${Math.round(place.altitude)}° up, ${Math.round(place.azimuth)}° from north.`
        : "The sun is below the horizon: only the ambient light shows.";
    shadows.box.checked = s.shadows;
    lampsOn.box.checked = s.lights;
    haze.input.value = String(Math.round(s.haze * 100));
    haze.readout.textContent = `${Math.round(s.haze * 100)} %`;
    haze.input.disabled = !s.lights;
    ambient.input.value = String(Math.round(s.ambient * 100));
    ambient.readout.textContent = `${Math.round(s.ambient * 100)} %`;
    clipOn.box.checked = s.clip.on;
    clipBody.hidden = !s.clip.on;
    for (const a of axes) {
      const r = s.clip[a.axis as Axis];
      a.from.input.value = String(Math.round(r[0] * 100));
      a.from.readout.textContent = pct(r, 0);
      a.to.input.value = String(Math.round(r[1] * 100));
      a.to.readout.textContent = pct(r, 1);
    }
  };
  store.on(["viz3d", "view3d"], sync);
  store.on("view3d", listCameras);
  store.on("session", () => {
    listCameras();
    listLights();
  });
  sync();
  listCameras();
  listLights();
  return root;
}
