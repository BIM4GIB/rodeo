// AEC > Create Roof…, Vectorworks' command of that name: a roof over the selected walls, polygons
// or polylines, one for each outline they make. Its dialog takes the eave's cut, the thickness and
// the four levels, any of which Calculate works out from the others, and shows the roof in plan,
// where clicking an edge makes it a gable. Vectorworks makes a roof object you can go on editing;
// here each roof is a group of its plan and a solid, so a change means making it again.

import type { Pt } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { bearingHeightFor, buildRoof, doubleCutHorizontal, doubleCutVertical, eaveHeightFor, overhangFor, pitchFor, roofOutline, roofProblem, type EaveProfile, type Roof, type RoofSection, type RoofSpec } from "./roofShapes.ts";
import { store } from "./state.ts";
import { closedOutline, hasClosedSelection } from "./surfaces.ts";
import { toast } from "./toast.ts";
import { addPart, type Part } from "./tools/detailing.ts";
import { metalAttrs } from "./tools/solidTool.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";
import { wallPolys } from "./wallPolys.ts";

/** Vectorworks' wall object type */
const WALL = 68;
const SVG = "http://www.w3.org/2000/svg";
const GABLE_COLOUR = "#e5484d";
const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 170;

const EAVES: readonly { readonly value: EaveProfile; readonly label: string }[] = [
  { value: "square", label: "Square" },
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
  { value: "double", label: "Double" },
];

/** the last values (mm, radians) */
const last = { eave: "square" as EaveProfile, vertical: 100, thickness: 200, inset: 100, pitch: (30 * Math.PI) / 180, bearing: 2700, overhang: 450, wall: 200, showWall: true, retain: true };

export function canCreateRoof(): boolean {
  const doc = store.session?.doc;
  return !!doc && (hasClosedSelection(1) || [...store.selection].some((id) => doc.object(id)?.type === WALL));
}

/** What the selection stands on: the outside of each run of walls, and each closed shape. */
function selectedOutlines(): Pt[][] {
  const s = store.session;
  if (!s) return [];
  const walls: string[] = [];
  const rings: Pt[][] = [];
  for (const id of store.selection) {
    const o = s.doc.object(id);
    if (o?.type === WALL) walls.push(id);
    else if (o?.shape) {
      const ring = closedOutline(o.shape);
      if (ring) rings.push(ring);
    }
  }
  if (walls.length) rings.push(...wallPolys(s.wallFootprints(walls), false));
  return rings.map(roofOutline).filter((r) => r.length >= 3);
}

function formatPitch(rad: number): string {
  return `${Number(((rad * 180) / Math.PI).toFixed(3))}°`;
}

/** A pitch typed as degrees, or as a rise and run such as 6:12. */
function parsePitch(text: string): number | null {
  const ratio = /^\s*(\d*\.?\d+)\s*[:/]\s*(\d*\.?\d+)\s*$/.exec(text);
  if (ratio) {
    const run = Number(ratio[2]);
    return run > 0 ? Math.atan2(Number(ratio[1]), run) : null;
  }
  const deg = Number(text.replace(/°\s*$/, ""));
  return text.trim() && Number.isFinite(deg) ? (deg * Math.PI) / 180 : null;
}

/** AEC > Create Roof…: the roof's settings and gables, then a roof over each outline. */
export async function createRoofDialog(): Promise<void> {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId) return;
  let outlines: Pt[][];
  try {
    outlines = selectedOutlines();
  } catch (e) {
    toast(`Create Roof: ${(e as Error).message}`, "error");
    return;
  }
  if (!outlines.length) {
    toast("Select walls, or a closed polygon or polyline, for the roof to stand on.", "info");
    return;
  }
  const sources = [...store.selection];
  const units = s.doc.info.units;
  const suffix = lengthSuffix(units);
  const gables = outlines.map(() => new Set<number>());

  const input = (label: string, text: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value: text, attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const length = (label: string, mm: number): HTMLInputElement => input(label, formatLengthValue(mm, units));
  const check = (on: boolean): HTMLInputElement => h("input", { checked: on, attrs: { type: "checkbox" } });
  const field = (label: string, el: HTMLElement, unit: string, calc?: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null, calc ?? null);
  const calculate = (label: string, fn: () => void): HTMLButtonElement => {
    const b = h("button", { cls: "btn", text: "Calculate", attrs: { type: "button", "aria-label": `Calculate ${label}` } });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      fn();
      draw();
    });
    return b;
  };

  const eave = h(
    "select",
    { cls: "menu-dialog-input", attrs: { "aria-label": "Eave Profile" } },
    ...EAVES.map(({ value, label }) => {
      const o = h("option", { text: label, attrs: { value } });
      o.selected = value === last.eave;
      return o;
    }),
  );
  const vertical = length("Vertical", last.vertical);
  const horizontal = length("Horizontal", 0);
  const thickness = length("Thickness", last.thickness);
  const inset = length("Bearing Inset", last.inset);
  const pitch = input("Roof Pitch", formatPitch(last.pitch));
  const bearing = length("Bearing Height", last.bearing);
  const eaveHeight = length("Eave Height", 0);
  const overhang = length("Eave Overhang", last.overhang);
  const wall = length("Gable Wall Thickness", last.wall);
  const showWall = check(last.showWall);
  const retain = check(last.retain);
  const parse = (el: HTMLInputElement): number | null => parseLength(el.value, units);

  const section = (): RoofSection | null => {
    const v = parse(vertical);
    const t = parse(thickness);
    const i = parse(inset);
    return v === null || t === null || i === null ? null : { eave: eave.value as EaveProfile, vertical: v, thickness: t, bearingInset: i };
  };
  const put = (el: HTMLInputElement, mm: number | null): void => {
    if (mm !== null && Number.isFinite(mm)) el.value = formatLengthValue(mm, units);
  };
  const calcEave = (): void => {
    const sec = section();
    const p = parsePitch(pitch.value);
    const b = parse(bearing);
    const o = parse(overhang);
    if (sec && p !== null && b !== null && o !== null) put(eaveHeight, eaveHeightFor(sec, p, b, o));
  };
  const calcBearing = (): void => {
    const sec = section();
    const p = parsePitch(pitch.value);
    const e = parse(eaveHeight);
    const o = parse(overhang);
    if (sec && p !== null && e !== null && o !== null) put(bearing, bearingHeightFor(sec, p, e, o));
  };
  const calcOverhang = (): void => {
    const sec = section();
    const p = parsePitch(pitch.value);
    const e = parse(eaveHeight);
    const b = parse(bearing);
    if (sec && p !== null && e !== null && b !== null) put(overhang, overhangFor(sec, p, e, b));
  };
  const calcPitch = (): void => {
    const sec = section();
    const e = parse(eaveHeight);
    const b = parse(bearing);
    const o = parse(overhang);
    if (!sec || e === null || b === null || o === null) return;
    const p = pitchFor(sec, e, b, o);
    if (p !== null) pitch.value = formatPitch(p);
  };
  const calcHorizontal = (): void => {
    const sec = section();
    const p = parsePitch(pitch.value);
    if (sec && p !== null) put(horizontal, doubleCutHorizontal(sec, p));
  };

  const specFor = (outline: readonly Pt[], index: number): RoofSpec | null => {
    const sec = section();
    const p = parsePitch(pitch.value);
    const b = parse(bearing);
    const o = parse(overhang);
    const w = parse(wall);
    if (!sec || p === null || b === null || o === null || w === null) return null;
    return { ...sec, outline, gables: gables[index], pitch: p, bearingHeight: b, overhang: o, gableWall: showWall.checked ? w : 0 };
  };

  // the roof as it stands, with its outlines' edges to click
  const plan = document.createElementNS(SVG, "svg");
  plan.setAttribute("width", "100%");
  plan.setAttribute("height", String(PREVIEW_HEIGHT));
  plan.setAttribute("role", "group");
  plan.setAttribute("aria-label", "The roof in plan: click an edge to make it a gable");
  const everywhere = outlines.flat();
  const xs = everywhere.map((p) => p.x);
  const ys = everywhere.map((p) => p.y);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const margin = Math.max(spread * 0.15, (parse(overhang) ?? 0) * 1.2);
  const [vx, vy, vw, vh] = [Math.min(...xs) - margin, -Math.max(...ys) - margin, Math.max(...xs) - Math.min(...xs) + 2 * margin, Math.max(...ys) - Math.min(...ys) + 2 * margin];
  plan.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  const stroke = Math.max(vw / PREVIEW_WIDTH, vh / PREVIEW_HEIGHT);
  const line = (a: Pt, b: Pt, colour: string, width: number, dashed = false): SVGLineElement => {
    const l = document.createElementNS(SVG, "line");
    l.setAttribute("x1", String(a.x));
    l.setAttribute("y1", String(-a.y));
    l.setAttribute("x2", String(b.x));
    l.setAttribute("y2", String(-b.y));
    l.setAttribute("stroke", colour);
    l.setAttribute("stroke-width", String(width * stroke));
    if (dashed) l.setAttribute("stroke-dasharray", `${stroke * 4} ${stroke * 3}`);
    return l;
  };
  const note = h("p", { cls: "muted" });
  function draw(): void {
    plan.replaceChildren();
    let failed = false;
    outlines.forEach((outline, r) => {
      const spec = specFor(outline, r);
      const roof = spec ? buildRoof(spec) : null;
      if (!roof) failed = true;
      roof?.eaves.forEach((p, i) => plan.append(line(p, roof.eaves[(i + 1) % roof.eaves.length], "currentColor", 1, true)));
      roof?.lines.forEach(([a, b]) => plan.append(line(a, b, "currentColor", 1)));
      outline.forEach((p, i) => {
        const q = outline[(i + 1) % outline.length];
        const gable = gables[r].has(i);
        const shown = line(p, q, gable ? GABLE_COLOUR : "currentColor", gable ? 3 : 1.5);
        const hit = line(p, q, "transparent", 12);
        hit.style.cursor = "pointer";
        const label = document.createElementNS(SVG, "title");
        label.textContent = gable ? "Gable: click for an eave" : "Eave: click for a gable";
        hit.append(label);
        hit.addEventListener("click", () => {
          if (gable) gables[r].delete(i);
          else gables[r].add(i);
          draw();
        });
        plan.append(shown, hit);
      });
    });
    note.textContent = failed ? "This roof can't be worked out yet: check its values, and that its overhang fits the outline." : "Click an edge to make it a gable, shown red. The dashes are the roof's edge.";
  }

  const follow = (): void => {
    calcEave();
    calcHorizontal();
    draw();
  };
  for (const el of [thickness, inset, pitch, bearing, overhang, vertical]) el.addEventListener("input", follow);
  eave.addEventListener("change", follow);
  for (const el of [wall, showWall]) el.addEventListener("input", draw);
  eaveHeight.addEventListener("input", () => {
    calcBearing();
    draw();
  });
  horizontal.addEventListener("input", () => {
    const sec = section();
    const p = parsePitch(pitch.value);
    const hz = parse(horizontal);
    if (sec && p !== null && hz !== null) put(vertical, doubleCutVertical(sec, p, hz));
    calcEave();
    draw();
  });
  calcEave();
  calcHorizontal();
  draw();

  const v = await showDialog<Roof[]>({
    title: "Create Roof",
    okLabel: "OK",
    body: [
      plan,
      note,
      field("Eave Profile", eave, ""),
      field("Vertical (Double)", vertical, suffix),
      field("Horizontal (Double)", horizontal, suffix),
      field("Thickness", thickness, suffix),
      field("Bearing Inset", inset, suffix),
      field("Roof Pitch (° or rise:run)", pitch, "", calculate("Roof Pitch", calcPitch)),
      field("Bearing Height", bearing, suffix, calculate("Bearing Height", calcBearing)),
      field("Eave Height", eaveHeight, suffix, calculate("Eave Height", calcEave)),
      field("Eave Overhang", overhang, suffix, calculate("Eave Overhang", calcOverhang)),
      field("Gable Wall Thickness", wall, suffix),
      h("label", { cls: "menu-dialog-check" }, showWall, "Show Gable Wall"),
      h("label", { cls: "menu-dialog-check" }, retain, "Retain Original Objects"),
    ],
    check: () => {
      const roofs: Roof[] = [];
      for (let r = 0; r < outlines.length; r++) {
        const spec = specFor(outlines[r], r);
        if (!spec) return { error: "Enter a length for each size, and a pitch in degrees or as a rise:run." };
        const problem = roofProblem(spec);
        if (problem) return { error: problem };
        const roof = buildRoof(spec);
        if (!roof) return { error: "This roof can't be worked out: the overhang may be too long for a short edge of the outline, or the outline may cross itself." };
        roofs.push(roof);
      }
      return { value: roofs };
    },
  });
  if (!v) return;
  const sec = section();
  const p = parsePitch(pitch.value);
  Object.assign(last, {
    eave: eave.value as EaveProfile,
    vertical: sec?.vertical ?? last.vertical,
    thickness: sec?.thickness ?? last.thickness,
    inset: sec?.bearingInset ?? last.inset,
    pitch: p ?? last.pitch,
    bearing: parse(bearing) ?? last.bearing,
    overhang: parse(overhang) ?? last.overhang,
    wall: parse(wall) ?? last.wall,
    showWall: showWall.checked,
    retain: retain.checked,
  });
  const attrs = metalAttrs();
  const made = attempt("Create Roof", (s) =>
    s.batch(() => {
      const groups = v.map((roof) => {
        const parts: Part[] = [{ shape: { kind: "polygon", points: roof.eaves, closed: true }, attrs: { fillPattern: 0 } }, ...roof.lines.map(([a, b]): Part => ({ kind: "line", a, b }))];
        const drawn = parts.map((part) => addPart(s, layerId, part));
        const mesh = s.addMeshes(layerId, [roof.solid], store.activeClassIndex, attrs);
        return s.groupObjects([...drawn, ...mesh]);
      });
      if (!last.retain) s.deleteObjects(sources);
      return groups;
    }),
  );
  if (!made) return;
  setSelection(made.value);
  toast(`Made ${made.value.length === 1 ? "a roof" : `${made.value.length} roofs`}. It's a plain group: to change it, make it again.`, "info");
}
