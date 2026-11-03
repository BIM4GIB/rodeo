// Site Planning's Site Modifiers: draws the outline of what changes a site model (or an open line, for an Open Edge
// Line), as a rectangle or a polygon, for the model to take the next time it's updated (siteModel.ts). Its elevation,
// slope and Apply To are in the Site Modifier record, in Object Info's Data tab; a Reshape changes its outline.

import type { Pt } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { showDialog } from "../menubar.ts";
import { addSiteModifier, type ModifierMode, type ModifierSettings } from "../siteModel.ts";
import { addPathModifier } from "../sitePath.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { formatLengthValue, parseLength } from "../units.ts";
import type { ToolModes } from "../tools.ts";
import { OutlineTool } from "./planning.ts";

const KINDS: readonly { readonly id: ModifierMode | "pathway" | "boundary"; readonly label: string; readonly key?: string }[] = [
  { id: "limits", label: "Grade Limits", key: "3" },
  { id: "pad", label: "Planar Pad", key: "4" },
  { id: "retaining", label: "Pad with Retaining Edge", key: "5" },
  { id: "aligned", label: "Aligned", key: "6" },
  { id: "line", label: "Open Edge Line", key: "7" },
  { id: "bed", label: "Texture Bed", key: "8" },
  { id: "spoil", label: "Spoil Pile", key: "9" },
  { id: "pathway", label: "Pathway Path", key: "0" },
  { id: "boundary", label: "Boundary Path" },
];

/** Those whose corners are clicked: an outline's rectangle wouldn't do. */
const CLICKED: ReadonlySet<string> = new Set(["line", "pathway"]);

export class SiteModifierTool extends OutlineTool {
  readonly id = "sitemodifier";
  protected readonly modeLabel = "Outline";
  private readonly settings: ModifierSettings = { kind: "pad", edgeOffset: 914.4, applyTo: "Proposed", elevation: 0, useSurface: false, slope: 0, direction: 0 };
  private active: (typeof KINDS)[number]["id"] = "pad";
  private pathWidth = 1828.8;

  modes(): readonly ToolModes[] {
    return [...super.modes(), { label: "Site Modifier", options: KINDS.map((k) => ({ id: k.id, label: k.label, ...(k.key ? { key: k.key } : {}) })), active: this.active }];
  }

  setMode(id: string): void {
    const kind = KINDS.find((k) => k.id === id);
    if (kind) {
      this.active = kind.id;
      if (kind.id !== "pathway" && kind.id !== "boundary") this.settings.kind = kind.id;
      if (CLICKED.has(kind.id)) super.setMode("polygon");
    } else if (id !== "rectangle" || !CLICKED.has(this.active)) super.setMode(id);
  }

  hint(): string {
    return `${KINDS.find((k) => k.id === this.active)?.label}: ${super.hint()}`;
  }

  async preferences(): Promise<void> {
    const k = this.settings;
    const v = await toolPrefs(
      "Site Modifiers Preferences",
      [
        { kind: "choice", key: "applyTo", label: "Apply To", value: k.applyTo ?? "Proposed", options: [{ value: "Proposed", label: "Proposed site model" }, { value: "Existing", label: "Existing site model" }] },
        { kind: "length", key: "elevation", label: "Elevation", value: k.elevation, zero: true, signed: true },
        { kind: "check", key: "useSurface", label: "Use Surface Elevation", value: k.useSurface },
        { kind: "number", key: "slope", label: "Slope", value: k.slope, min: -1000, max: 1000, unit: "%" },
        { kind: "number", key: "direction", label: "Slope Direction", value: k.direction, min: -360, max: 360, unit: "°" },
        { kind: "length", key: "edgeOffset", label: "Retaining Edge Offset", value: k.edgeOffset ?? 914.4 },
      ],
      "A pad or open edge line rises at its Slope towards the Slope Direction from its Elevation at its middle. Grade Limits and a retaining edge follow the ground; give the edge an Elevation in Object Info to hold it level. An aligned modifier's corners take the height of a pad, line or grade they touch, and this Elevation elsewhere. A spoil pile's Elevation is how much it adds, or takes off when negative. A texture bed changes nothing but how the ground looks, in the texture of its class.",
    );
    if (!v) return;
    k.elevation = v.num("elevation");
    k.useSurface = v.flag("useSurface");
    k.slope = v.num("slope");
    k.direction = v.num("direction");
    k.edgeOffset = v.num("edgeOffset");
    k.applyTo = v.choice("applyTo") === "Existing" ? "Existing" : "Proposed";
  }

  protected made(corners: Pt[]): void {
    const layerId = store.activeLayerId;
    if (!layerId || corners.length < (CLICKED.has(this.active) ? 2 : 3)) return;
    if (this.active === "pathway") {
      void this.placePathway(layerId, corners);
      return;
    }
    if (this.active === "boundary") {
      this.placePath(layerId, corners, "Boundary");
      return;
    }
    addSiteModifier(layerId, corners, this.settings);
    toast("Update the site model to take it in: its Update button in Object Info, or AEC > Terrain > Update Site Model.", "info");
  }

  /** The Site Modifier: Pathway Mode dialog, and the path. */
  private async placePathway(layerId: string, corners: readonly Pt[]): Promise<void> {
    const units = store.session?.doc.info.units ?? "";
    const width = h("input", { cls: "menu-dialog-input", value: formatLengthValue(this.pathWidth, units), attrs: { "aria-label": "Width" } });
    const asked = await showDialog<number>({
      title: "Site Modifier: Pathway Mode",
      okLabel: "OK",
      body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Width" }), width)],
      check: () => {
        const v = parseLength(width.value, units);
        return v !== null && v > 0 ? { value: v } : { error: "Enter the path's width.", focus: width };
      },
    });
    if (asked === null) return;
    this.pathWidth = asked;
    this.placePath(layerId, corners, "Pathway");
  }

  private placePath(layerId: string, corners: readonly Pt[], config: "Pathway" | "Boundary"): void {
    const k = this.settings;
    const r = attempt("Site Modifiers", (s) => s.batch(() => addPathModifier(s, layerId, corners, config, { width: this.pathWidth, applyExisting: k.applyTo === "Existing", elevation: k.elevation })));
    if (!r) return;
    setSelection([r.value]);
    toast("Add transverse profiles from Object Info if you want them, then update the site model to take it in.", "info");
  }
}
