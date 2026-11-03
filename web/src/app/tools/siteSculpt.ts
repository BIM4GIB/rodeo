// Site model Surface Sculpting, from AEC > Terrain's Edit Existing Surface and Edit Proposed Surface: the Sculptor, Add
// Vertex and Swale/Berm tools as one tool with modes. Each edit is a site modifier of its own, its height and shape in
// its record, that the site model takes straight away: delete it and the ground goes back. It works on the plan, where
// a drag up raises the ground and a drag down lowers it.

import type { Pt } from "../../core/index.ts";
import { h } from "../dom.ts";
import { showDialog } from "../menubar.ts";
import { ACCENT } from "../renderer.ts";
import { addSurfaceEdit, setSiteEditOnExisting, siteEditOnExisting, siteEditSurface } from "../siteModel.ts";
import { surfaceElement, type SwaleProfile } from "../siteModelShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { modeForKey, strokeScreen, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatLength, formatLengthValue, parseLength } from "../units.ts";
import { OutlineTool } from "./planning.ts";

const ACTIONS = [
  { id: "sculptor", label: "Sculptor", key: "1" },
  { id: "vertex", label: "Add Vertex", key: "2" },
  { id: "swale", label: "Swale/Berm", key: "3" },
] as const;
type Action = (typeof ACTIONS)[number]["id"];

const SURFACES = [
  { id: "existing", label: "Existing Surface" },
  { id: "proposed", label: "Proposed Surface" },
];
const REACH = [
  { id: "single", label: "Single Element", key: "4" },
  { id: "radius", label: "Radius", key: "5" },
];
const SOFT = [
  { id: "soft", label: "Soft Selection" },
  { id: "hard", label: "Even Selection" },
];
const DETAIL = [
  { id: "tessellate", label: "Tessellation" },
  { id: "plain", label: "No Tessellation" },
];
const PROFILES: readonly SwaleProfile[] = ["Flat", "Rounded", "Sharp"];

/** How far a press may wander and still be a click, px. */
const CLICK_PX = 4;
/** How close to a vertex or an edge a Single Element pick counts, px. */
const ELEMENT_PX = 8;

export class SiteSculptTool extends OutlineTool {
  readonly id = "sitesculpt";
  protected readonly modeLabel = "Outline";
  private action: Action = "sculptor";
  private single = false;
  private soft = true;
  private tessellate = false;
  private radius = 3048;
  private falloff = 50;
  private maxDistance = 609.6;
  private width = 3048;
  private height = 609.6;
  private profile: SwaleProfile = "Rounded";
  private follow = true;
  private press: { at: Pt; screen: Pt; y: number; elements: Pt[] | null } | null = null;
  private hover: Pt | null = null;

  constructor(env: ConstructorParameters<typeof OutlineTool>[0]) {
    super(env);
    super.setMode("polygon");
  }

  modes(): readonly ToolModes[] {
    const groups: ToolModes[] = [
      { label: "Surface", options: SURFACES, active: siteEditOnExisting() ? "existing" : "proposed" },
      { label: "Tool", options: ACTIONS.map((a) => ({ id: a.id, label: a.label, key: a.key })), active: this.action },
    ];
    if (this.action === "sculptor") {
      groups.push({ label: "Reach", options: REACH, active: this.single ? "single" : "radius" });
      if (!this.single) {
        groups.push({ label: "Selection", options: SOFT, active: this.soft ? "soft" : "hard" });
        groups.push({ label: "Detail", options: DETAIL, active: this.tessellate ? "tessellate" : "plain" });
      }
    }
    return groups;
  }

  setMode(id: string): void {
    this.press = null;
    if (id === "existing" || id === "proposed") setSiteEditOnExisting(id === "existing");
    else if (ACTIONS.some((a) => a.id === id)) this.action = id as Action;
    else if (id === "single" || id === "radius") this.single = id === "single";
    else if (id === "soft" || id === "hard") this.soft = id === "soft";
    else if (id === "tessellate" || id === "plain") this.tessellate = id === "tessellate";
  }

  hint(): string {
    const surface = siteEditOnExisting() ? "existing surface" : "proposed surface";
    if (this.action === "vertex") return `Add Vertex on the ${surface}: click the site model`;
    if (this.action === "swale") return `Swale/Berm on the ${surface}: ${this.height < 0 ? "swale" : "berm"}, ${super.hint()}`;
    if (this.press) return `Drag up to raise and down to lower: ${formatLength(this.dragged(this.press.y), store.session?.doc.info.units ?? "")}`;
    return `Sculptor on the ${surface}: press the site model and drag up or down; a click asks how far · 1–5 mode`;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Surface Sculpting Preferences",
      [
        { kind: "heading", key: "", label: "Sculptor" },
        { kind: "length", key: "radius", label: "Radius", value: this.radius },
        { kind: "number", key: "falloff", label: "Falloff", value: this.falloff, min: 0, max: 100, unit: "%" },
        { kind: "length", key: "maxDistance", label: "Max Distance", value: this.maxDistance },
        { kind: "heading", key: "", label: "Swale/Berm" },
        { kind: "length", key: "width", label: "Width", value: this.width },
        { kind: "length", key: "height", label: "Depth/Height", value: this.height, signed: true },
        { kind: "choice", key: "profile", label: "Profile", value: this.profile, options: PROFILES.map((p) => ({ value: p, label: p })) },
        { kind: "check", key: "follow", label: "Follow Terrain", value: this.follow },
      ],
      "A negative Depth/Height makes a swale and a positive one a berm. Off Follow Terrain, its top slopes smoothly from one end to the other.",
    );
    if (!v) return;
    this.radius = v.num("radius");
    this.falloff = v.num("falloff");
    this.maxDistance = v.num("maxDistance");
    this.width = v.num("width");
    this.height = v.num("height");
    this.profile = v.choice("profile") as SwaleProfile;
    this.follow = v.flag("follow");
  }

  down(p: PointerInfo): void {
    if (this.action === "swale") {
      super.down(p);
      return;
    }
    const doc = store.session?.doc;
    const on = doc ? siteEditSurface(doc, p.pos) : null;
    if (!on) {
      toast("Click on the site model.", "error");
      return;
    }
    if (this.action === "vertex") {
      addSurfaceEdit("Add Vertex", on.model.layerId, [p.pos], { kind: "vertex", applyTo: siteEditOnExisting() ? "Existing" : "Proposed", elevation: 0, useSurface: false, slope: 0, direction: 0 });
      return;
    }
    const elements = this.single ? surfaceElement(on.surface, p.pos, ELEMENT_PX / this.env.view.scale) : null;
    if (elements && !elements.length) {
      toast("Click on the site model.", "error");
      return;
    }
    this.press = { at: p.pos, screen: p.screen, y: p.screen.y, elements };
  }

  move(p: PointerInfo): void {
    this.hover = p.pos;
    if (this.press) {
      this.press.y = p.screen.y;
      store.setHint(this.hint());
    }
    super.move(p);
  }

  up(p: PointerInfo): void {
    if (this.action === "swale") {
      super.up(p);
      return;
    }
    const press = this.press;
    this.press = null;
    if (!press) return;
    if (Math.hypot(p.screen.x - press.screen.x, p.screen.y - press.screen.y) <= CLICK_PX) {
      void this.askDistance(press.at, press.elements);
      return;
    }
    this.sculpt(press.at, press.elements, this.dragged(p.screen.y, press.screen.y));
  }

  cancel(): void {
    this.press = null;
    super.cancel();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.press) {
      this.press = null;
      return true;
    }
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return super.key(e);
  }

  overlay(g: Painter): void {
    super.overlay(g);
    if (this.action !== "sculptor") return;
    const at = this.press?.at ?? this.hover;
    if (!at) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    if (this.press?.elements) strokeScreen(g, this.press.elements, this.press.elements.length > 2);
    else if (!this.single) {
      const circle = (r: number): Pt[] => Array.from({ length: 48 }, (_, i) => ({ x: at.x + r * Math.cos((i * Math.PI) / 24), y: at.y + r * Math.sin((i * Math.PI) / 24) }));
      strokeScreen(g, circle(this.radius), true);
      if (this.soft && this.falloff < 100) {
        ctx.setLineDash([3, 3]);
        strokeScreen(g, circle(this.radius * (1 - this.falloff / 100)), true);
      }
    }
    ctx.restore();
  }

  protected made(corners: Pt[]): void {
    if (corners.length < 2) return;
    const doc = store.session?.doc;
    const on = doc ? siteEditSurface(doc, corners[0]) ?? siteEditSurface(doc) : null;
    if (!on) {
      toast("Draw it on a site model.", "error");
      return;
    }
    addSurfaceEdit(this.height < 0 ? "Swale" : "Berm", on.model.layerId, corners, {
      kind: "swale",
      applyTo: siteEditOnExisting() ? "Existing" : "Proposed",
      elevation: this.height,
      useSurface: false,
      slope: 0,
      direction: 0,
      options: { swale: { width: this.width, profile: this.profile, follow: this.follow } },
    });
  }

  private dragged(y: number, from = this.press?.screen.y ?? y): number {
    return (from - y) / this.env.view.scale;
  }

  private async askDistance(at: Pt, elements: Pt[] | null): Promise<void> {
    const units = store.session?.doc.info.units ?? "";
    const input = h("input", { cls: "menu-dialog-input", value: formatLengthValue(0, units), attrs: { "aria-label": "Distance" } });
    const asked = await showDialog<number>({
      title: "Sculptor",
      okLabel: "OK",
      body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Distance" }), input), h("p", { cls: "muted", text: "Positive raises the ground and negative lowers it." })],
      check: () => {
        const v = parseLength(input.value, units);
        return v !== null && v !== 0 ? { value: v } : { error: "Enter how far to move it.", focus: input };
      },
    });
    if (asked !== null) this.sculpt(at, elements, asked);
  }

  private sculpt(at: Pt, elements: Pt[] | null, distance: number): void {
    const doc = store.session?.doc;
    const on = doc ? siteEditSurface(doc, at) : null;
    if (!on || distance === 0) return;
    const ring = elements
      ? elements.length > 2
        ? elements
        : elementRing(elements, ELEMENT_PX / this.env.view.scale)
      : Array.from({ length: 48 }, (_, i) => ({ x: at.x + this.radius * Math.cos((i * Math.PI) / 24), y: at.y + this.radius * Math.sin((i * Math.PI) / 24) }));
    addSurfaceEdit("Sculpt Surface", on.model.layerId, ring, {
      kind: "sculpt",
      applyTo: siteEditOnExisting() ? "Existing" : "Proposed",
      elevation: distance,
      useSurface: false,
      slope: 0,
      direction: 0,
      options: {
        sculpt: {
          centre: at,
          radius: this.radius,
          soft: this.soft ? this.falloff / 100 : null,
          spacing: this.tessellate ? this.maxDistance : null,
          ...(elements ? { elements } : {}),
        },
      },
    });
  }
}

/** A small outline round a vertex or an edge, to show where a single element was moved. */
function elementRing(elements: readonly Pt[], r: number): Pt[] {
  const [a, b] = [elements[0], elements[elements.length - 1]];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const [ux, uy] = elements.length > 1 ? [(b.x - a.x) / len, (b.y - a.y) / len] : [1, 0];
  return [
    { x: a.x - ux * r - uy * r, y: a.y - uy * r + ux * r },
    { x: b.x + ux * r - uy * r, y: b.y + uy * r + ux * r },
    { x: b.x + ux * r + uy * r, y: b.y + uy * r - ux * r },
    { x: a.x - ux * r + uy * r, y: a.y - uy * r - ux * r },
  ];
}
