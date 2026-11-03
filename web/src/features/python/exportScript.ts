// File > Export > Export Script, as Vectorworks has it: the drawing written as a Vectorscript that
// draws it again (File > Import > Import Script…, here or in Vectorworks). Each design layer's 2D
// objects are written in their stacking order with the calls that make them (Rect, RRect, Oval,
// Arc, BeginPoly with AddPoint, CurveTo, CurveThrough and ArcTo, CreateText, Locus, BeginGroup), in
// their class, with their name and attributes, turned where they are turned. Coordinates are in
// the drawing's units, so the script first checks the drawing it runs in has the same units.
// Symbols, plug-in objects, 3D objects, images and sheet layers aren't written: the script's
// header counts them, as the message after the export does. Export Simple VectorScript (3D only)
// writes the 3D objects instead, as simpleScript.ts words them, in Front view or the current view.

import type { Attributes, ByClassGroup, ObjectInfo, Pt, Shape, VwxDocument } from "../../core/index.ts";
import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { withoutHidden } from "../../app/hiddenObjects.ts";
import { showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { scriptUnits } from "./runner.ts";
import { FRONT_BASIS, simpleScript, viewBasis, type Basis } from "./simpleScript.ts";

/** Objects a procedure of the script draws, so no procedure grows past what Vectorworks compiles quickly. */
const PART = 400;
/** Characters of text in one string literal: Vectorscript's strings stop at 255. */
const CHUNK = 200;
/** Object types the script redraws, as Vectorworks numbers them (2 line ... 21 polyline, 11 group). */
const DRAWN: ReadonlySet<number> = new Set([2, 3, 4, 5, 6, 10, 11, 13, 17, 21]);
/** The vs call that takes each attribute group from the object's class. */
const BY_CLASS_CALL: Readonly<Record<ByClassGroup, string>> = {
  fill: "SetFPatByClass",
  lineStyle: "SetLSByClass",
  penColor: "SetPenColorByClass",
  lineWeight: "SetLWByClass",
  opacity: "SetOpacityByClass",
};

/** A number as Vectorscript writes it: up to six decimals, no exponent. */
function num(v: number): string {
  const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

/** A string literal: quotes doubled, line breaks as Chr(13), long text in pieces Concat joins. */
function str(text: string): string {
  const pieces: string[] = [];
  text.split(/\r\n|\r|\n/).forEach((line, i) => {
    if (i > 0) pieces.push("Chr(13)");
    for (let at = 0; at < line.length; at += CHUNK) pieces.push(`'${line.slice(at, at + CHUNK).replace(/'/g, "''")}'`);
  });
  if (pieces.length === 0) return "''";
  return pieces.length === 1 && pieces[0].startsWith("'") ? pieces[0] : `Concat(${pieces.join(", ")})`;
}

/** A palette colour as the vs colour calls take it: red, green and blue from 0 to 65535. */
function rgb16(css: string | undefined): string {
  const n = css && /^#[0-9a-f]{6}$/i.test(css) ? parseInt(css.slice(1), 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => String(c * 257)).join(", ");
}

class Writer {
  readonly lines: string[] = [];
  /** the settings the script has made for new objects so far */
  private readonly made = new Map<string, string>();
  private cls = "";
  readonly left = new Map<string, number>();
  dashed = 0;
  resources = 0;
  through = 0;
  drawn = 0;

  constructor(
    private readonly u: number,
    private readonly colors: ReadonlyMap<number, string>,
  ) {}

  private x(v: number): string {
    return num(v / this.u);
  }

  private pt(p: Pt): string {
    return `${this.x(p.x)}, ${this.x(p.y)}`;
  }

  line(text: string): void {
    this.lines.push(`        ${text}`);
  }

  /** A setting for new objects, written only when it changes. */
  private set(key: string, call: string): void {
    if (this.made.get(key) === call) return;
    this.made.set(key, call);
    this.line(call);
  }

  setLayer(name: string): void {
    this.made.delete("layer");
    this.set("layer", `Layer(${str(name)});`);
  }

  leave(o: ObjectInfo): void {
    const what = o.typeName || `type ${o.type}`;
    this.left.set(what, (this.left.get(what) ?? 0) + 1);
  }

  private attrs(a: Attributes): void {
    let fill = a.fillPattern;
    if (fill < 0) {
      // a hatch, gradient, tile or image fill names a resource the script can't make
      fill = 1;
      this.resources++;
    }
    let pen = a.lineStyle;
    if (pen < 0) {
      // a dashed line type, likewise
      pen = 2;
      this.dashed++;
    }
    this.set("fillPat", `FillPat(${fill});`);
    this.set("fillFore", `FillFore(${rgb16(this.colors.get(a.fillFore))});`);
    this.set("fillBack", `FillBack(${rgb16(this.colors.get(a.fillBack))});`);
    this.set("penPat", `PenPat(${pen});`);
    this.set("penFore", `PenFore(${rgb16(this.colors.get(a.penFore))});`);
    this.set("penBack", `PenBack(${rgb16(this.colors.get(a.penBack))});`);
    this.set("penSize", `PenSize(${Math.round(a.lineWeight)});`);
  }

  /** What follows making an object: its opacity, the attributes it takes from its class, its name. */
  private after(o: ObjectInfo): void {
    const a = o.attrs;
    if (a && (a.fillOpacity !== 100 || a.penOpacity !== 100)) {
      this.line(a.fillOpacity === a.penOpacity ? `SetOpacity(LNewObj, ${a.fillOpacity});` : `SetOpacityN(LNewObj, ${a.fillOpacity}, ${a.penOpacity});`);
    }
    for (const g of o.byClass ?? []) this.line(`${BY_CLASS_CALL[g]}(LNewObj);`);
    if (o.name) this.line(`SetName(LNewObj, ${str(o.name)});`);
  }

  private klass(name: string): void {
    if (this.cls === name) return;
    this.cls = name;
    this.line(`NameClass(${str(name)});`);
  }

  /** Writes one object (a group with what it holds); false when it isn't one the script can make. */
  object(o: ObjectInfo, kids: ReadonlyMap<string, ObjectInfo[]>, layerScale: number): boolean {
    if (!DRAWN.has(o.type)) return false;
    if (o.kind === "group") {
      const start = this.lines.length;
      const before = this.drawn;
      this.line("BeginGroup;");
      for (const k of kids.get(o.id) ?? []) if (!this.object(k, kids, layerScale)) this.leave(k);
      if (this.drawn === before) {
        // nothing in it could be written, and Vectorworks makes no group of nothing
        this.lines.splice(start);
        return true;
      }
      this.line("EndGroup;");
      if (o.className !== this.cls) this.line(`SetClass(LNewObj, ${str(o.className)});`);
      if (o.name) this.line(`SetName(LNewObj, ${str(o.name)});`);
      this.drawn++;
      return true;
    }
    const g = o.shape;
    if (!g) return false;
    const made = this.shape(o, g, layerScale);
    if (made) {
      this.after(o);
      this.drawn++;
    }
    return made;
  }

  private shape(o: ObjectInfo, g: Shape, layerScale: number): boolean {
    const pre = (): void => {
      this.klass(o.className);
      if (o.attrs) this.attrs(o.attrs);
    };
    const rr = g.roundRect;
    // a rounded rectangle's shape is its outline, with the frame and radii it was made from
    if (rr) return this.frame(pre, rr.corners, (x0, y0, x1, y1) => `RRect(${x0}, ${y1}, ${x1}, ${y0}, ${this.x(rr.rx * 2)}, ${this.x(rr.ry * 2)});`);
    switch (g.kind) {
      case "line": {
        if (g.points.length < 2) return false;
        pre();
        this.line(`MoveTo(${this.pt(g.points[0])});`);
        this.line(`LineTo(${this.pt(g.points[1])});`);
        return true;
      }
      case "rect": {
        if (g.points.length !== 4) return false;
        return this.frame(pre, g.points, (x0, y0, x1, y1) => `Rect(${x0}, ${y1}, ${x1}, ${y0});`);
      }
      case "arc": {
        if (!g.center || g.rx === undefined) return false;
        const c = g.center;
        const rx = g.rx;
        const ry = g.ry ?? rx;
        const box = `${this.x(c.x - rx)}, ${this.x(c.y + ry)}, ${this.x(c.x + rx)}, ${this.x(c.y - ry)}`;
        pre();
        const sweep = g.sweepAngle ?? 360;
        this.line(Math.abs(sweep) >= 360 - 1e-9 ? `Oval(${box});` : `Arc(${box}, ${num(g.startAngle ?? 0)}, ${num(sweep)});`);
        return true;
      }
      case "polygon":
      case "polyline": {
        const verts = g.vertices ?? g.points.map((p) => ({ p, kind: "corner" as const, radius: 0 }));
        if (verts.length < 2) return false;
        pre();
        this.set("closed", g.closed ? "ClosePoly;" : "OpenPoly;");
        this.line("BeginPoly;");
        for (const v of verts) {
          const at = this.pt(v.p);
          if (v.kind === "bezier") this.line(`CurveTo(${at});`);
          else if (v.kind === "cubic") this.line(`CurveThrough(${at});`);
          else if (v.kind === "through") {
            // BeginPoly has no call for a radius vertex: the nearest is a vertex the curve passes
            this.through++;
            this.line(`CurveThrough(${at});`);
          } else if (v.kind === "arc") this.line(`ArcTo(${at}, ${this.x(v.radius)});`);
          else this.line(`AddPoint(${at});`);
        }
        this.line("EndPoly;");
        return true;
      }
      case "text": {
        if (g.text === undefined || !g.anchor) return false;
        pre();
        const pts = (g.textSize ?? 0) > 0 ? (g.textSize ?? 0) / (layerScale || 1) / (25.4 / 72) : 10;
        this.set("textSize", `TextSize(${num(Math.round(pts * 100) / 100)});`);
        this.set("textJust", `TextJust(${g.hAlign ?? 1});`);
        this.set("textVAlign", `TextVerticalAlign(${g.vAlign ?? 1});`);
        this.line(`TextOrigin(${this.pt(g.anchor)});`);
        this.line(`CreateText(${str(g.text)});`);
        if (g.textAngle) this.line(`HRotate(LNewObj, ${this.pt(g.anchor)}, ${num(g.textAngle)});`);
        return true;
      }
      case "locus": {
        if (!g.points[0]) return false;
        pre();
        this.line(`Locus(${this.pt(g.points[0])});`);
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * A rectangle from its corners (counter-clockwise from its origin): drawn square to the axes at
   * its origin, then turned about the origin when its sides aren't.
   */
  private frame(pre: () => void, c: readonly Pt[], call: (x0: string, y0: string, x1: string, y1: string) => string): boolean {
    if (c.length < 3) return false;
    const [p0, p1, p2] = c;
    const w = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (w === 0) return false;
    const ux = (p1.x - p0.x) / w;
    const uy = (p1.y - p0.y) / w;
    // the height along the side's left normal: negative when the corners run clockwise
    const h = (p2.x - p1.x) * -uy + (p2.y - p1.y) * ux;
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    pre();
    this.line(call(this.x(p0.x), this.x(p0.y + Math.min(0, h)), this.x(p0.x + w), this.x(p0.y + Math.max(0, h))));
    if (Math.abs(angle) > 1e-7) this.line(`HRotate(LNewObj, ${this.pt(p0)}, ${num(angle)});`);
    return true;
  }
}

export interface ScriptExport {
  readonly text: string;
  /** objects written (a group counts once) */
  readonly drawn: number;
  /** what was left out, by object type */
  readonly left: ReadonlyMap<string, number>;
  readonly notes: readonly string[];
}

/** The open drawing as a Vectorscript. */
export function drawingScript(doc: VwxDocument, file: string): ScriptExport {
  const units = scriptUnits(doc.info.units);
  const upi = 25.4 / units.mm;
  const unitName = (doc.info.units || units.mark).toLowerCase();
  const colors = new Map(doc.colors().map((c) => [c.index, c.css]));
  const w = new Writer(units.mm, colors);
  const parts: string[][] = [];
  let sheets = 0;
  for (const layer of doc.layers()) {
    const objects = doc.objects(layer.id);
    if (layer.kind !== "design") {
      sheets += objects.filter((o) => o.parentId === null).length;
      continue;
    }
    const kids = new Map<string, ObjectInfo[]>();
    for (const o of objects) {
      if (o.parentId === null) continue;
      const list = kids.get(o.parentId);
      if (list) list.push(o);
      else kids.set(o.parentId, [o]);
    }
    const top = objects.filter((o) => o.parentId === null);
    if (top.length === 0) continue;
    let named = false;
    for (const o of top) {
      if (!named || w.lines.length === 0) {
        w.setLayer(layer.name);
        named = true;
      }
      if (!w.object(o, kids, layer.scale)) w.leave(o);
      if (w.drawn - parts.length * PART >= PART) {
        // the next objects go in a procedure of their own, starting on this layer
        parts.push(w.lines.splice(0));
        named = false;
      }
    }
  }
  if (w.lines.length > 0) parts.push(w.lines.splice(0));

  const notes: string[] = [];
  if (w.resources) notes.push(`${w.resources} hatch, gradient, tile or image ${w.resources === 1 ? "fill is" : "fills are"} written as solid`);
  if (w.dashed) notes.push(`${w.dashed} dashed ${w.dashed === 1 ? "line is" : "lines are"} written as solid`);
  if (w.through) notes.push(`${w.through} radius ${w.through === 1 ? "vertex is" : "vertices are"} written as CurveThrough vertices`);
  if (sheets) notes.push(`sheet layers aren't written (${sheets} ${sheets === 1 ? "object" : "objects"})`);
  const left = [...w.left].sort((a, b) => b[1] - a[1]);

  const out: string[] = [];
  out.push(`{ ${file}: written by Rodeo (File > Export > Export Script) on ${new Date().toISOString().slice(0, 10)}. }`);
  out.push(`{ It draws the drawing's 2D objects again on design layers of the same names: ${w.drawn} ${w.drawn === 1 ? "object" : "objects"}, in ${unitName}. }`);
  if (left.length) out.push(`{ Left out: ${left.map(([what, n]) => `${n} ${what}`).join(", ")}. }`);
  for (const n of notes) out.push(`{ Also: ${n}. }`);
  out.push("PROCEDURE Drawing;");
  out.push("VAR");
  out.push("    fraction, display : LONGINT;");
  out.push("    format : INTEGER;");
  out.push("    upi : REAL;");
  out.push("    unitName, areaName : STRING;");
  parts.forEach((lines, i) => {
    out.push("");
    out.push(`    PROCEDURE Part${i + 1};`);
    out.push("    BEGIN");
    out.push(...lines);
    out.push("    END;");
  });
  out.push("");
  out.push("BEGIN");
  out.push("    GetUnits(fraction, display, format, upi, unitName, areaName);");
  out.push(`    IF Abs(upi - ${num(upi)}) > ${num(upi * 1e-6)} THEN`);
  out.push(`        AlrtDialog(${str(`This script draws in ${unitName}: set the drawing's units so (File > Document Settings > Units), then run it again.`)})`);
  if (parts.length === 0) {
    out.push("    ELSE");
    out.push(`        Message('The drawing had no 2D objects to draw.');`);
  } else {
    out.push("    ELSE BEGIN");
    for (let i = 0; i < parts.length; i++) out.push(`        Part${i + 1};`);
    out.push("    END;");
  }
  out.push("END;");
  out.push("RUN(Drawing);");
  return { text: out.join("\n") + "\n", drawn: w.drawn, left: w.left, notes };
}

/** File > Export > Export Script: downloads the drawing's script as a .vs file. */
export function exportScript(): void {
  const s = store.session;
  if (!s) return;
  const base = fileBase();
  const got = drawingScript(s.doc, `${base}.vwx`);
  downloadBlob(`${base}.vs`, new Blob([got.text], { type: "text/plain;charset=utf-8" }));
  const left = [...got.left.values()].reduce((a, b) => a + b, 0);
  toast(
    `Exported ${base}.vs: ${got.drawn} ${got.drawn === 1 ? "object" : "objects"}` +
      (left ? `; ${left} left out (symbols, plug-ins, 3D and images aren't written: the script's first lines count them)` : "") +
      ".",
    "info",
  );
}

/** The drawing's file name without its extension, safe for a download's name. */
function fileBase(): string {
  return (store.fileName || "Untitled").replace(/\.[^.]*$/, "").replace(/[\\/:*?"<>|]+/g, "-") || "Untitled";
}

/** File > Export > Export Simple VectorScript (3D only): Front view or the current view, then the 3D objects on the visible design layers as a .vs file. */
export async function exportSimpleScript(): Promise<void> {
  const s = store.session;
  const ctx = appContext();
  if (!s || !ctx) return;
  let layers = ctx.scene.drawnLayers(store.activeLayerId).filter((l) => l.kind === "design");
  if (!layers.length) layers = ctx.scene.layers().filter((l) => l.kind === "design" && l.visibility !== "hidden");
  const shown = new Set(layers.map((l) => l.id));
  // each top-level object's triangles together, whatever parts and materials it shows them in
  const byObject = new Map<string, number[]>();
  for (const m of withoutHidden(s.doc).model3d()) {
    if (!shown.has(m.layerId) || !m.triangles.length) continue;
    let list = byObject.get(m.objectId);
    if (!list) byObject.set(m.objectId, (list = []));
    for (const v of m.triangles) list.push(v);
  }
  if (!byObject.size) {
    toast("No 3D objects on the visible design layers.", "info");
    return;
  }
  const v3 = ctx.view3d();
  const in3d = !!v3?.visible;
  const rotation = ctx.view.rotation;
  const here = in3d ? "the 3D view" : rotation ? "Rotated Top/Plan" : "Top/Plan";
  const radio = (on: boolean, label: string): HTMLInputElement => h("input", { checked: on, attrs: { type: "radio", name: "simple-script-view", "aria-label": label } }) as HTMLInputElement;
  const front = radio(true, "Front view");
  const current = radio(false, "Current view");
  const asFront = await showDialog<boolean>({
    title: "Export Simple VectorScript",
    okLabel: "Export",
    body: [
      h("p", { cls: "menu-dialog-label", text: "Export in" }),
      h("label", { cls: "menu-dialog-check" }, front, "Front view"),
      h("label", { cls: "menu-dialog-check" }, current, `Current view (${here})`),
      h("p", { cls: "muted", text: "The 3D objects on the visible design layers, each flat face a 3D polygon, turned so the view chosen looks down on them." }),
    ],
    check: () => ({ value: front.checked }),
  });
  if (asFront === null) return;
  let basis: Basis = FRONT_BASIS;
  if (!asFront && in3d && v3) {
    const c = v3.cameraState();
    basis = viewBasis(c.position, c.target);
  } else if (!asFront) {
    // Top/Plan as it shows on screen, turned by the plan's rotation
    basis = [
      [Math.cos(rotation), -Math.sin(rotation), 0],
      [Math.sin(rotation), Math.cos(rotation), 0],
      [0, 0, 1],
    ];
  }
  const units = scriptUnits(s.doc.info.units);
  const base = fileBase();
  // feet and inches are written as inches
  const unitName = units.mm === 25.4 ? "inches" : (s.doc.info.units || units.mark).toLowerCase();
  const got = simpleScript([...byObject.values()].map((triangles) => ({ triangles })), basis, units.mm, unitName, `${base}.vwx`, asFront ? "Front view" : here);
  downloadBlob(`${base}.vs`, new Blob([got.text], { type: "text/plain;charset=utf-8" }));
  toast(`Exported ${base}.vs: ${got.objects} ${got.objects === 1 ? "object" : "objects"} as ${got.faces} 3D ${got.faces === 1 ? "polygon" : "polygons"}.`, "info");
}
