// Callout tool: a note with a leader, as the Vectorworks Callout draws one. Click
// where the leader points, then where it meets the note, and type the note (Enter
// commits, Shift+Enter starts a new line, Esc cancels). The leader has a marker at
// its point (an arrow, a dot or none) and a short shoulder level with the note,
// which may sit in a box or a rounded box. Sizes are paper millimetres times the
// layer scale. The pieces are plain lines, text and polygons, grouped and
// selected, as dimensions are: the format of the plug-in object is not known.

import { roundedRectPoints, type NewShape, type Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { dist, unitVector } from "../geom.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

type Box = "plain" | "box" | "rounded";
type Marker = "arrow" | "dot" | "nomarker";

const BOXES: readonly { readonly id: Box; readonly label: string }[] = [
  { id: "plain", label: "No Box" },
  { id: "box", label: "Box" },
  { id: "rounded", label: "Rounded" },
];
const MARKERS: readonly { readonly id: Marker; readonly label: string }[] = [
  { id: "arrow", label: "Arrow" },
  { id: "dot", label: "Dot" },
  { id: "nomarker", label: "No Marker" },
];
/** the modes in key order: 1-3 the box, 4-6 the marker */
const MODE_KEYS: readonly string[] = [...BOXES, ...MARKERS].map((m) => m.id);

/** sizes on paper, mm */
const TEXT_MM = 2.5;
const SHOULDER_MM = 3;
const TEXT_GAP_MM = 1;
const ARROW_MM = 3;
const ARROW_WIDTH_MM = 1.2;
const DOT_MM = 0.6;
const BOX_PAD_MM = 1.2;
/** average width of a character as a share of the text height, and line pitch, for sizing the box */
const CHAR_WIDTH = 0.6;
const LINE_PITCH = 1.25;
/** Object Info's justification and vertical alignment values */
const H_LEFT = 1;
const H_RIGHT = 3;
const V_CENTRE = 3;
/** clicks closer than this (CSS px) count as the same point */
const SAME_PX = 3;

/** Where a callout's pieces go, from its two clicks and its settings, in world units. */
interface Layout {
  readonly leader: Pt[];
  /** +1 when the note is to the right of the shoulder, -1 to the left */
  readonly side: number;
  /** where the shoulder ends: the box's edge, or a gap short of the note */
  readonly end: Pt;
  /** text height */
  readonly height: number;
}

export class CalloutTool extends BaseTool {
  readonly id = "callout";
  readonly cursor = "crosshair";

  private box: Box = "plain";
  private marker: Marker = "arrow";
  /** text height and shoulder length, paper mm */
  private textMm = TEXT_MM;
  private shoulderMm = SHOULDER_MM;
  /** the point the leader starts from, once clicked */
  private start: Pt | null = null;
  /** the shoulder, once clicked; the note is being typed */
  private shoulder: Pt | null = null;
  private cursorAt: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [
      { label: "Box", options: BOXES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.box },
      {
        label: "Marker",
        options: MARKERS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1 + BOXES.length) })),
        active: this.marker,
      },
    ];
  }

  setMode(id: string): void {
    const box = BOXES.find((m) => m.id === id);
    if (box) this.box = box.id;
    const marker = MARKERS.find((m) => m.id === id);
    if (marker) this.marker = marker.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Callout Preferences",
      [
        { kind: "number", key: "text", label: "Text height", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
        { kind: "number", key: "shoulder", label: "Shoulder length", value: this.shoulderMm, min: 0, max: 100, unit: "mm" },
        { kind: "choice", key: "box", label: "Box", value: this.box, options: BOXES.map((m) => ({ value: m.id, label: m.label })) },
        { kind: "choice", key: "marker", label: "Marker", value: this.marker, options: MARKERS.map((m) => ({ value: m.id, label: m.label })) },
      ],
      "Sizes are on paper: a layer at 1:n draws them n times larger.",
    );
    if (!v) return;
    this.textMm = v.num("text");
    this.shoulderMm = v.num("shoulder");
    this.setMode(v.choice("box"));
    this.setMode(v.choice("marker"));
  }

  hint(): string {
    if (this.shoulder) return "Type the note · Enter places · Shift+Enter new line";
    if (this.start) return "Click where the leader meets the note";
    return "Click where the leader points · 1–3 box · 4–6 marker";
  }

  down(p: PointerInfo): void {
    if (this.shoulder) return;
    if (!this.start) {
      this.start = p.pos;
      return;
    }
    if (dist(p.pos, this.start) * this.env.view.scale <= SAME_PX) return;
    this.shoulder = p.pos;
    this.type();
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    const mode = /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey ? MODE_KEYS[Number(e.key) - 1] : undefined;
    if (mode && !this.shoulder) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || !this.start) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const start = this.start;
    const shoulder = this.shoulder ?? this.cursorAt;
    if (!start || !shoulder) return;
    const scale = this.scale();
    if (scale === null) return;
    const l = layout(start, shoulder, this.textMm * scale, this.shoulderMm * scale);
    withPreview(g, () => {
      strokeScreen(g, l.leader, false);
      for (const shape of markerShapes(this.marker, l.leader, scale)) {
        if (shape.kind === "polygon") strokeScreen(g, shape.points, true);
      }
    });
  }

  /** Opens the text editor at the note; committing it draws the callout. */
  private type(): void {
    const start = this.start;
    const shoulder = this.shoulder;
    const scale = this.scale();
    if (!start || !shoulder || scale === null) return;
    const l = layout(start, shoulder, this.textMm * scale, this.shoulderMm * scale);
    const at = this.noteAt(l, scale);
    this.env.text.open({
      at: { x: at.x, y: at.y + l.height / 2 },
      text: "",
      heightWorld: l.height,
      onCommit: (text) => {
        this.reset();
        this.commit(l, text, scale);
      },
      // committed or not, the tool is ready for the next callout
      onClose: () => {
        this.reset();
        if (store.tool === this.id) store.setHint(this.hint());
        this.env.requestDraw();
      },
    });
  }

  /** The note's anchor (its left or right edge, at its vertical centre): inside the box, or a gap past the shoulder. */
  private noteAt(l: Layout, scale: number): Pt {
    const offset = this.box === "plain" ? (TEXT_GAP_MM / TEXT_MM) * l.height : BOX_PAD_MM * scale;
    return { x: l.end.x + l.side * offset, y: l.end.y };
  }

  private commit(l: Layout, text: string, scale: number): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const classIndex = store.activeClassIndex;
    const attrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
    const at = this.noteAt(l, scale);
    const pieces: NewShape[] = [{ kind: "polyline", points: l.leader, closed: false }, ...markerShapes(this.marker, l.leader, scale)];
    if (this.box !== "plain") pieces.push(boxShape(this.box, l, text, BOX_PAD_MM * scale));
    const note: NewShape = { kind: "text", at, text, height: l.height };
    const r = attempt("Callout", (s) =>
      s.batch(() => {
        const ids = pieces.map((shape) => s.addObject(layerId, shape, classIndex, attrs));
        const id = s.addObject(layerId, note, classIndex, attrs);
        // justifying the text moves its origin, so the origin goes back on the anchor after
        s.setTextStyle([id], { hAlign: l.side > 0 ? H_LEFT : H_RIGHT, vAlign: V_CENTRE });
        s.setGeometry(id, note);
        ids.push(id);
        return s.groupObjects(ids);
      }),
    );
    // the group goes on the layer, not into the group being edited, as addAndSelect does
    if (r) setEditGroup(null, [r.value]);
  }

  /** The active layer's scale (1:n gives n), or null without a layer. */
  private scale(): number | null {
    const layerId = store.activeLayerId;
    const layer = layerId ? this.env.scene.layer(layerId) : undefined;
    return layer ? layer.scale || 1 : null;
  }

  private reset(): void {
    this.start = null;
    this.shoulder = null;
  }
}

/** The leader from `start` to `shoulder`, then level towards the side the note is on. */
function layout(start: Pt, shoulder: Pt, height: number, shoulderLength: number): Layout {
  const side = shoulder.x >= start.x ? 1 : -1;
  const end = { x: shoulder.x + side * shoulderLength, y: shoulder.y };
  const leader = shoulderLength > 0 ? [start, shoulder, end] : [start, shoulder];
  return { leader, side, end, height };
}

/** The marker at the leader's point: a closed arrowhead or a small circle. */
function markerShapes(marker: Marker, leader: readonly Pt[], scale: number): NewShape[] {
  const tip = leader[0];
  if (marker === "dot") return [{ kind: "arc", center: tip, radius: DOT_MM * scale, startAngle: 0, sweepAngle: 360 }];
  if (marker !== "arrow") return [];
  const u = unitVector(leader[1], tip);
  const n = { x: -u.y, y: u.x };
  const base = { x: tip.x - u.x * ARROW_MM * scale, y: tip.y - u.y * ARROW_MM * scale };
  const w = (ARROW_WIDTH_MM * scale) / 2;
  return [
    {
      kind: "polygon",
      points: [tip, { x: base.x + n.x * w, y: base.y + n.y * w }, { x: base.x - n.x * w, y: base.y - n.y * w }],
      closed: true,
    },
  ];
}

/** The box round the note from the shoulder's end, sized from its characters and lines (the font's own widths are not known here). */
function boxShape(box: Box, l: Layout, text: string, pad: number): NewShape {
  const lines = text.split("\n");
  const longest = lines.reduce((m, line) => Math.max(m, line.length), 0);
  const w = longest * CHAR_WIDTH * l.height + 2 * pad;
  const h = (lines.length - 1) * LINE_PITCH * l.height + l.height + 2 * pad;
  const x0 = l.side > 0 ? l.end.x : l.end.x - w;
  const y0 = l.end.y - h / 2;
  if (box === "box") return { kind: "rect", x0, y0, x1: x0 + w, y1: y0 + h };
  const r = Math.min(pad * 1.5, h / 2);
  return { kind: "polygon", points: roundedRectPoints({ o: { x: x0, y: y0 }, u: { x: 1, y: 0 }, w, h }, r, r), closed: true };
}
