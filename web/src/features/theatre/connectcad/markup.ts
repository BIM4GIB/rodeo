// ConnectCAD's Check Drawing and Clear Markup: the schematic's problems (ccadChecks.ts has the sums) each
// marked with an outline in its severity's colour, a markup object ('Rodeo ConnectCAD Markup') in the
// class ConnectCAD Markup, whose Object Info gives the problem and steps to the other markup of the
// same finding. A new check takes away the markup an earlier one left on the layers it checks.

import type { Attributes, EditSession, NewShape, PluginFieldSpec, Pt, RecordValue } from "../../../core/index.ts";
import { attempt, setSelection, zoomToSelection } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { appContext, registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { CHECK_KINDS, findIssues, SEVERITIES, type CheckKind, type Issue, type Severity } from "./ccadChecks.ts";
import { PITCH_MM } from "./ccadShapes.ts";
import { adapterOnSocket, circuitFacts, circuitsIn, deviceOutline, devicesOn, endOf, portsOf } from "./schematic.ts";
import { layerScaleOf } from "../../../app/spaces.ts";

export const MARKUP = "Rodeo ConnectCAD Markup";
export const MARKUP_CLASS = "ConnectCAD Markup";

const PLUGIN = 86;
const TEXT = 4;

const FIELD = {
  category: "Status Category",
  type: "Status Type",
  problem: "Problem",
  information: "Information",
  group: "Group",
  outline: "Outline",
  color: "Color",
} as const;

/** each severity's markup colour, as the dialog last had them */
export const colours: Record<Severity, string> = { Error: "#e5484d", Warning: "#f5a524", Notify: "#2f80ed" };
const checking = { kinds: new Set<CheckKind>(CHECK_KINDS), allLayers: false };
/** markup lines, mils */
const MARKUP_MILS = 20;

interface MarkupRec {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  readonly at: Pt;
  value(field: string): RecordValue | undefined;
}

function markupOf(s: EditSession, id: string): MarkupRec | null {
  const obj = s.doc.object(id);
  const rec = obj?.type === PLUGIN ? s.doc.records(id).find((r) => r.parametric && r.name === MARKUP) : undefined;
  return obj && rec && obj.insertion ? { id, layerId: obj.layerId, format: rec.format, at: obj.insertion, value: (f) => rec.fields.find((x) => x.name === f)?.value } : null;
}

function markupsIn(s: EditSession, layerIds?: ReadonlySet<string>): MarkupRec[] {
  if (!s.doc.hasPluginFormat(MARKUP)) return [];
  const out: MarkupRec[] = [];
  for (const layer of s.doc.layers()) {
    if (layerIds && !layerIds.has(layer.id)) continue;
    for (const o of s.doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const m = markupOf(s, o.id);
      if (m) out.push(m);
    }
  }
  return out;
}

const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));
const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

/** Draws markup `id` from its outline, in the session's open batch. */
function drawMarkup(s: EditSession, id: string): void {
  const m = markupOf(s, id);
  if (!m) throw new Error("That isn't ConnectCAD markup.");
  let outline: Pt[] = [];
  try {
    const raw: unknown = JSON.parse(str(m.value(FIELD.outline)) || "[]");
    if (Array.isArray(raw)) outline = raw.flatMap((p): Pt[] => (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [{ x: Number(p[0]), y: Number(p[1]) }] : []));
  } catch {
    outline = [];
  }
  const hex = /^#[0-9a-f]{6}$/i.test(str(m.value(FIELD.color))) ? str(m.value(FIELD.color)) : colours.Error;
  const ink = colorMatcher()(hexToRgb(hex));
  const look: Partial<Attributes> = { penFore: ink, fillPattern: 0, lineStyle: 2, lineWeight: MARKUP_MILS };
  const classIndex = s.doc.object(id)?.classIndex ?? store.activeClassIndex;
  const shapes: NewShape[] = outline.length >= 3 ? [{ kind: "polygon", points: outline, closed: true }] : [];
  s.setPluginDrawing(id, s.addObjects(m.layerId, shapes, classIndex, shapes.map(() => look)));
}

/** The class markup goes in, made when the drawing hasn't one. */
function markupClass(s: EditSession): number {
  return s.doc.classes().find((c) => c.name === MARKUP_CLASS)?.index ?? s.createClass(MARKUP_CLASS);
}

function addMarkup(s: EditSession, layerId: string, issue: Issue, classIndex: number): string {
  const at = { x: issue.outline.reduce((n, p) => n + p.x, 0) / issue.outline.length, y: issue.outline.reduce((n, p) => n + p.y, 0) / issue.outline.length };
  const local = issue.outline.map((p) => [Math.round((p.x - at.x) * 1e4) / 1e4, Math.round((p.y - at.y) * 1e4) / 1e4]);
  const specs: PluginFieldSpec[] = [
    { name: FIELD.category, type: TEXT, value: issue.severity },
    { name: FIELD.type, type: TEXT, value: issue.kind },
    { name: FIELD.problem, type: TEXT, value: issue.problem },
    { name: FIELD.information, type: TEXT, value: issue.information },
    { name: FIELD.group, type: TEXT, value: issue.group },
    { name: FIELD.outline, type: TEXT, value: JSON.stringify(local) },
    { name: FIELD.color, type: TEXT, value: colours[issue.severity] },
  ];
  const id = s.addPluginObject(layerId, MARKUP, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, classIndex);
  drawMarkup(s, id);
  return id;
}

/**
 * Marks issues found by one kind of check on a layer, in the session's open batch, taking away the
 * markup that kind left there before (with `groups`, only that of those findings).
 */
export function markIssues(s: EditSession, layerId: string, kind: Issue["kind"], issues: readonly Issue[], groups?: ReadonlySet<string>): void {
  const old = markupsIn(s, new Set([layerId]))
    .filter((m) => str(m.value(FIELD.type)) === kind && (!groups || groups.has(str(m.value(FIELD.group)))))
    .map((m) => m.id);
  if (old.length) s.deleteObjects(old);
  if (!issues.length) return;
  const cls = markupClass(s);
  for (const issue of issues) addMarkup(s, issue.layerId || layerId, issue, cls);
}

/** The issues on the layers checked. */
export function issuesOn(s: EditSession, layerIds: ReadonlySet<string>, kinds: ReadonlySet<CheckKind>): Issue[] {
  const devices = devicesOn(s).filter((d) => layerIds.has(d.rec.layerId));
  const circuits = circuitsIn(s)
    .filter((c) => layerIds.has(c.layerId))
    .map((c) => circuitFacts(s, c));
  return findIssues(
    devices.map((d) => ({ id: d.rec.id, layerId: d.rec.layerId, name: d.name, tag: d.tag, outline: deviceOutline(d), sockets: d.sockets.map((k) => ({ id: k.id, name: k.name, tip: endOf(d, k).tip, side: k.side })), ports: portsOf(d), ...(d.kind === "adapter" ? { adapter: { onSocket: adapterOnSocket(s, d) } } : {}) })),
    circuits,
    kinds,
    PITCH_MM * layerScaleOf(store.activeLayerId ?? ""),
  );
}

/** Check Drawing: the dialog, then markup for each problem found and a count. */
export async function checkDrawing(): Promise<void> {
  const s = store.session;
  const active = store.activeLayerId;
  if (!s || !active) return;
  const field = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
  const boxes = new Map(CHECK_KINDS.map((k) => [k, h("input", { checked: checking.kinds.has(k), attrs: { type: "checkbox", "aria-label": k } })]));
  const NOTES: Record<CheckKind, string> = {
    Sockets: "Sockets: a socket name used twice on a device",
    Devices: "Devices: a device name used twice or missing, a display tag used twice",
    Circuits: "Circuits: a circuit number used twice, a circuit whose device or socket has gone",
    Signals: "Signals: a circuit joining sockets of different signals",
  };
  const where = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Check items on" } }, h("option", { value: "active", text: "Active layer" }), h("option", { value: "all", text: "All layers" }));
  where.value = checking.allLayers ? "all" : "active";
  const pickers = new Map(SEVERITIES.map((sv) => [sv, h("input", { cls: "menu-dialog-input", value: colours[sv], attrs: { type: "color", "aria-label": `${sv} color`, style: "width: 64px; padding: 2px" } })]));
  const chosen = await showDialog<true>({
    title: "Check Drawing",
    okLabel: "OK",
    body: [
      ...CHECK_KINDS.map((k) => h("label", { cls: "menu-dialog-check" }, boxes.get(k)!, NOTES[k])),
      field("Check items on", where),
      ...SEVERITIES.map((sv) => field(`${sv} markup`, pickers.get(sv)!)),
      h("p", { cls: "muted", text: `Each problem is marked in the class ${MARKUP_CLASS}; select the markup to read it in Object Info. Markup from an earlier check on these layers is taken away first.` }),
    ],
    check: () => {
      const kinds = new Set(CHECK_KINDS.filter((k) => boxes.get(k)!.checked));
      if (!kinds.size) return { error: "Choose at least one thing to check.", focus: boxes.get("Sockets")! };
      checking.kinds = kinds;
      checking.allLayers = where.value === "all";
      for (const sv of SEVERITIES) colours[sv] = pickers.get(sv)!.value;
      return { value: true };
    },
  });
  if (!chosen) return;
  const r = attempt("Check Drawing", (session) =>
    session.batch(() => {
      const layerIds = new Set(checking.allLayers ? session.doc.layers().filter((l) => l.kind === "design").map((l) => l.id) : [active]);
      const old = markupsIn(session, layerIds).map((m) => m.id);
      if (old.length) session.deleteObjects(old);
      const found = issuesOn(session, layerIds, checking.kinds);
      if (!found.length) return found;
      const cls = markupClass(session);
      for (const issue of found) addMarkup(session, issue.layerId || active, issue, cls);
      return found;
    }),
  );
  if (!r) return;
  const count = (sv: Severity, one: string, many: string): string | null => {
    const n = r.value.filter((issue) => issue.severity === sv).length;
    return n ? `${n} ${n === 1 ? one : many}` : null;
  };
  const parts = [count("Error", "error", "errors"), count("Warning", "warning", "warnings"), count("Notify", "note", "notes")].filter(Boolean);
  toast(parts.length ? `Check Drawing: ${parts.join(", ")}, marked in the class ${MARKUP_CLASS}.` : "Check Drawing: no problems found.", "info");
}

/** Clear Markup: every markup object in the drawing. */
export function clearMarkup(): void {
  const s = store.session;
  if (!s) return;
  const ids = markupsIn(s).map((m) => m.id);
  if (!ids.length) {
    toast("There's no ConnectCAD markup in the drawing.", "info");
    return;
  }
  const r = attempt("Clear Markup", (session) => session.batch(() => session.deleteObjects(ids)));
  if (r) toast(`${ids.length} markup object${ids.length === 1 ? "" : "s"} cleared.`, "info");
}

/** Previous Markup and Next Markup: the markup before or after this one of the same finding, selected and in view. */
function step(id: string, by: number): void {
  const s = store.session;
  const m = s ? markupOf(s, id) : null;
  if (!s || !m) return;
  const group = str(m.value(FIELD.group));
  const all = markupsIn(s).filter((x) => str(x.value(FIELD.group)) === group);
  if (all.length < 2) {
    toast("There's no other markup for this problem.", "info");
    return;
  }
  const i = all.findIndex((x) => x.id === id);
  const next = all[(i + by + all.length) % all.length];
  setSelection([next.id]);
  const A = appContext();
  if (A) zoomToSelection(A.scene, A.view);
}

const PREVIOUS = 30;
const NEXT = 31;
const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const LAYOUT: readonly PluginWidget[] = [
  param(1, FIELD.category),
  param(2, FIELD.type),
  param(3, FIELD.problem),
  param(4, FIELD.information),
  { id: PREVIOUS, kind: "button", label: "Previous Markup", level: 0 },
  { id: NEXT, kind: "button", label: "Next Markup", level: 0 },
];

const driver: PluginDriver = {
  name: MARKUP,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: () => true,
  choices: () => undefined,
  place: () => toast("Stage > ConnectCAD > Check Drawing… marks the drawing's problems.", "info"),
  edit: () => {},
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawMarkup(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => LAYOUT,
  widgetStates(id, apply) {
    const s = store.session;
    const m = s ? markupOf(s, id) : null;
    if (!s || !m) return;
    const many = markupsIn(s).filter((x) => str(x.value(FIELD.group)) === str(m.value(FIELD.group))).length > 1;
    apply(
      new Map([
        [PREVIOUS, { enabled: many, visible: true }],
        [NEXT, { enabled: many, visible: true }],
      ]),
    );
  },
  press(id, widget) {
    if (widget === PREVIOUS) step(id, -1);
    else if (widget === NEXT) step(id, 1);
  },
};

registerPluginDrivers(() => [driver]);
