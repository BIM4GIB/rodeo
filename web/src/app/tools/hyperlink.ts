// Dims/Notes' Hyperlink. A click inserts a hyperlink: a Hyperlink plug-in object holding its label,
// function and target, drawn as a chain link with its label (Vectorworks draws a symbol here), or as
// the QR code of its text. Object Info edits it and draws it again, and its Open Link button, Open
// Link on its right-click menu or Cmd-click (Ctrl-click) with the Selection tool follows it
// (hyperlink.ts). Each click places one, selected, and the tool stays for more.

import type { EditSession, NewShape, PluginFieldSpec, Pt, RecordValue } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { registerPluginDrivers, type PluginDriver, type PluginWidget, type PluginWidgetStates } from "../ext.ts";
import {
  FIELD,
  followHyperlink,
  FUNCTIONS,
  HYPERLINK,
  hyperlinkParams,
  LABEL_MM,
  PATH_FUNCTIONS,
  QR_WIDTH_MM,
  SAVE_AS,
  type HyperlinkFunction,
  type HyperlinkParams,
} from "../hyperlink.ts";
import { hyperlinkLabel, hyperlinkQr } from "../hyperlinkShapes.ts";
import { savedViews } from "../panels/views.ts";
import { colorMatcher } from "../pdfImport.ts";
import { store } from "../state.ts";
import { errorMessage, toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, type PointerInfo } from "../tools.ts";
import { layerScale } from "./detailing.ts";
import { markerParts } from "./markers.ts";

const TEXT = 4;
const NUMBER = 3;
const POPUP = 8;
/** a hyperlink's ink, a link's blue */
const LINK_BLUE = { r: 0, g: 0.33, b: 0.8 };

/** what the tool places, and what Create Similar Object places */
const settings = {
  label: "Vectorworks Help",
  fn: "Open Webpage" as HyperlinkFunction,
  webpage: "https://app-help.vectorworks.net",
  path: "",
  saveAs: SAVE_AS[0] as string,
  view: "",
  sheet: "",
  qrText: "https://rodeo.build",
  qrWidth: QR_WIDTH_MM,
  labelSize: LABEL_MM,
};

/** The settings' target for their function. */
function targetOf(): string {
  switch (settings.fn) {
    case "Open Webpage":
      return settings.webpage;
    case "Activate Saved View":
      return settings.view;
    case "Activate Sheet Layer":
      return settings.sheet;
    case "QR Code":
      return settings.qrText;
    default:
      return settings.path;
  }
}

const fields = (): PluginFieldSpec[] => [
  { name: FIELD.label, type: TEXT, value: settings.label },
  { name: FIELD.fn, type: POPUP, value: settings.fn },
  { name: FIELD.target, type: TEXT, value: targetOf().trim() },
  { name: FIELD.saveAs, type: POPUP, value: settings.saveAs },
  { name: FIELD.qrWidth, type: NUMBER, value: settings.qrWidth },
  { name: FIELD.labelSize, type: NUMBER, value: settings.labelSize },
];

/** What a hyperlink with `p` draws at a layer scale of 1:`scale`, in its own frame; or why it can't be drawn. */
function drawing(p: HyperlinkParams, scale: number): { shape: NewShape; attrs: Record<string, number> }[] | string {
  const match = colorMatcher();
  if (p.fn === "QR Code") {
    const d = hyperlinkQr(p.target.trim(), p.qrWidth * scale);
    if (typeof d === "string") return d;
    const solid = (c: number) => ({ fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100, lineStyle: 0 });
    return [
      { shape: { kind: "polygon", points: d.qr!.back, closed: true }, attrs: solid(match({ r: 1, g: 1, b: 1 })) },
      { shape: { kind: "polygon", points: d.qr!.dark, closed: true }, attrs: solid(match({ r: 0, g: 0, b: 0 })) },
    ];
  }
  const text = p.label.trim() || p.target.trim() || HYPERLINK;
  const d = hyperlinkLabel(text, p.labelSize * scale);
  const ink = match(LINK_BLUE);
  return markerParts({ outlines: d.links, lines: [], circles: [], filled: [], texts: d.texts }).map((part) => ({
    shape: "shape" in part ? part.shape : part,
    attrs: { penFore: ink, fillPattern: 0 },
  }));
}

/** Draws hyperlink `id` from its parameters, in the session's open batch. */
function drawInto(s: EditSession, id: string): void {
  const obj = s.doc.object(id);
  const p = hyperlinkParams(s.doc, id);
  if (!obj || !p) throw new Error("That isn't a hyperlink.");
  const scale = s.doc.layers().find((l) => l.id === obj.layerId)?.scale || 1;
  const parts = drawing(p, scale);
  if (typeof parts === "string") throw new Error(parts);
  // drawn in its own frame on its layer, then moved into it
  s.setPluginDrawing(
    id,
    parts.map((part) => s.addObject(obj.layerId, part.shape, obj.classIndex, part.attrs)),
  );
}

/** Places a hyperlink with the settings at `at` on `layerId` and selects it. */
function place(layerId: string, at: Pt): void {
  const r = attempt("Hyperlink", (s) =>
    s.batch(() => {
      const specs = fields();
      const values = Object.fromEntries(specs.map((f) => [f.name, f.value]));
      const id = s.addPluginObject(layerId, HYPERLINK, specs, values, at, 0, store.activeClassIndex);
      drawInto(s, id);
      return id;
    }),
  );
  if (r) setEditGroup(null, [r.value]);
}

const LABELS: Readonly<Record<string, string>> = {
  [FIELD.label]: "Label",
  [FIELD.fn]: "Function",
  [FIELD.target]: "Target",
  [FIELD.saveAs]: "Save Path As",
  [FIELD.qrWidth]: "Image Width (mm on paper)",
  [FIELD.labelSize]: "Label Size (mm on paper)",
};
const SAVE_AS_ROW = 4;
const QR_ROW = 5;
const SIZE_ROW = 6;
const OPEN = 7;
const WIDGETS: readonly PluginWidget[] = [
  { id: 1, kind: "param", field: FIELD.label, label: "", level: 0 },
  { id: 2, kind: "param", field: FIELD.fn, label: "", level: 0 },
  { id: 3, kind: "param", field: FIELD.target, label: "", level: 0 },
  { id: SAVE_AS_ROW, kind: "param", field: FIELD.saveAs, label: "", level: 1 },
  { id: QR_ROW, kind: "param", field: FIELD.qrWidth, label: "", level: 1 },
  { id: SIZE_ROW, kind: "param", field: FIELD.labelSize, label: "", level: 0 },
  { id: OPEN, kind: "button", label: "Open Link", level: 0 },
];

const driver: PluginDriver = {
  name: HYPERLINK,
  shape: "point",
  builtIn: true,
  label: (field) => LABELS[field],
  readOnly: () => false,
  choices(field) {
    if (field === FIELD.fn) return FUNCTIONS.map((f) => ({ value: f, label: f }));
    if (field === FIELD.saveAs) return SAVE_AS.map((f) => ({ value: f, label: f }));
    return undefined;
  },
  place(layerId, at) {
    place(layerId, at);
  },
  edit(id: string, values: Readonly<Record<string, RecordValue>>) {
    attempt("Edit Hyperlink", (s) =>
      s.batch(() => {
        const rec = s.doc.records(id).find((r) => r.parametric && r.name === HYPERLINK);
        if (!rec) throw new Error("That isn't a hyperlink.");
        for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
        drawInto(s, id);
      }),
    );
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawInto(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const doc = store.session?.doc;
    const p = doc ? hyperlinkParams(doc, id) : null;
    if (!p) return;
    const qr = p.fn === "QR Code";
    const states: PluginWidgetStates = new Map([
      [SAVE_AS_ROW, { enabled: true, visible: PATH_FUNCTIONS.has(p.fn) }],
      [QR_ROW, { enabled: true, visible: qr }],
      [SIZE_ROW, { enabled: true, visible: !qr }],
    ]);
    apply(states);
  },
  press(id, widget) {
    if (widget === OPEN) followHyperlink(id);
  },
};
registerPluginDrivers(() => [driver]);

export class HyperlinkTool extends BaseTool {
  readonly id = "hyperlink";
  readonly cursor = "crosshair";

  async preferences(): Promise<void> {
    const views = savedViews()?.names() ?? [];
    const sheets = store.session?.doc.layers().filter((l) => l.kind === "sheet") ?? [];
    const v = await toolPrefs(
      "Hyperlink Settings",
      [
        { kind: "text", key: "label", label: "Label", value: settings.label },
        { kind: "choice", key: "fn", label: "Function", value: settings.fn, options: FUNCTIONS.map((f) => ({ value: f, label: f })) },
        { kind: "text", key: "webpage", label: "Webpage", value: settings.webpage },
        views.length
          ? { kind: "choice", key: "view", label: "Saved View", value: views.includes(settings.view) ? settings.view : views[0]!, options: views.map((n) => ({ value: n, label: n })) }
          : { kind: "text", key: "view", label: "Saved View", value: settings.view },
        sheets.length
          ? {
              kind: "choice",
              key: "sheet",
              label: "Sheet Layer",
              value: sheets.some((l) => l.name === settings.sheet) ? settings.sheet : sheets[0]!.name,
              options: sheets.map((l) => ({ value: l.name, label: l.title ? `${l.name} ${l.title}` : l.name })),
            }
          : { kind: "text", key: "sheet", label: "Sheet Layer", value: settings.sheet },
        { kind: "text", key: "path", label: "Application, Document or Folder", value: settings.path },
        { kind: "choice", key: "saveAs", label: "Save Path As", value: settings.saveAs, options: SAVE_AS.map((f) => ({ value: f, label: f })) },
        { kind: "text", key: "qrText", label: "QR Code Text / URL", value: settings.qrText },
        { kind: "number", key: "qrWidth", label: "QR Image Width", value: settings.qrWidth, min: 1, max: 1000, unit: "mm" },
        { kind: "number", key: "labelSize", label: "Label Size", value: settings.labelSize, min: 0.5, max: 50, unit: "mm" },
      ],
      "A click inserts a hyperlink: its label beside a chain link (the Label Size on paper), or for QR Code the code of its text or URL, the Image Width on paper across with its white margin. The Function picks its target: a webpage, a saved view, a sheet layer, or an application, document or folder. Cmd-click (Ctrl-click) on it with the Selection tool, Open Link on its right-click menu or Object Info's Open Link follows it; Object Info edits it. A browser can't launch applications or open files and folders, so Rodeo keeps those links but can't follow them; saved views are kept on the computer that saved them. Hyperlink symbols aren't kept.",
    );
    if (!v) return;
    settings.label = v.choice("label");
    settings.fn = FUNCTIONS.find((f) => f === v.choice("fn")) ?? settings.fn;
    settings.webpage = v.choice("webpage");
    settings.view = v.choice("view");
    settings.sheet = v.choice("sheet");
    settings.path = v.choice("path");
    settings.saveAs = v.choice("saveAs");
    settings.qrText = v.choice("qrText");
    settings.qrWidth = v.num("qrWidth");
    settings.labelSize = v.num("labelSize");
  }

  hint(): string {
    const target = targetOf().trim();
    const shown = target.length > 40 ? `${target.slice(0, 39)}…` : target || "no target";
    return `Click to insert the hyperlink · ${settings.fn}: ${shown}`;
  }

  down(p: PointerInfo): void {
    if (p.detail > 1 || p.button !== 0) return;
    const layerId = store.activeLayerId;
    const scale = layerScale(this.env);
    if (!layerId || scale === null) {
      toast("Make a layer active to insert a hyperlink.", "info");
      return;
    }
    const qr = settings.fn === "QR Code" ? hyperlinkQr(targetOf().trim(), settings.qrWidth * scale) : null;
    if (typeof qr === "string") {
      toast(qr, "info");
      return;
    }
    place(layerId, p.pos);
  }
}
