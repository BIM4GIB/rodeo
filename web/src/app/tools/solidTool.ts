// A "- 3D" tool from its 2D tool: the same Preferences and sizes, a click (a press dragged turns it)
// placing a group on the active layer in the active class: the tool's solid as one mesh, with the
// view it draws from above for its plan.

import type { Attributes, EditSession, Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { colorMatcher } from "../pdfImport.ts";
import { placedSolid, type Solid } from "../solids3d.ts";
import { store, type ToolId } from "../state.ts";
import { toast } from "../toast.ts";
import type { ToolEnv, ToolModes } from "../tools.ts";
import { addPart, PlaceTool, type Part } from "./detailing.ts";
import { noteToolEnv, registerTwin, type PartTwin } from "./partRecord.ts";

const METAL = { r: 0.72, g: 0.74, b: 0.77 };
/** the degrees a sweep's facet takes, as Rodeo's Sphere */
const SWEEP_FACET = 5.625;

/** A filled colour, for a solid shaded as metal unless the drawing's fill says otherwise. */
export function metalAttrs(): Partial<Attributes> {
  const grey = colorMatcher()(METAL);
  return store.drawAttrs.fillPattern ? store.drawAttrs : { fillPattern: 1, fillFore: grey, fillBack: grey, fillOpacity: 100 };
}

/** Adds a plan and a solid already placed, grouped, in one undo step, and selects them: a mesh grouped with a plan drawing leaves plan to it, and Rodeo's 3D view shows no plan drawings, so the two together show as a hybrid does. */
export function addHybrid(label: string, parts: readonly Part[], solid: Solid, attrs: Partial<Attributes> = metalAttrs()): void {
  const layer = store.activeLayerId;
  if (!layer) return;
  const made = attempt(label, (s) =>
    s.batch(() => {
      const plan = parts.map((part) => addPart(s, layer, part));
      const mesh = s.addMeshes(layer, [solid], store.activeClassIndex, attrs);
      return s.groupObjects([...plan, ...mesh]);
    }),
  );
  if (made) setEditGroup(null, [made.value]);
}

/** A tool that places a drawing and knows its solid. */
declare class WithSolid extends PlaceTool {
  readonly id: ToolId;
  readonly cursor: string;
  protected readonly label: string;
  protected shapes(at: Pt, angle: number): Part[] | null;
  solid?(): Solid | null;
  sweepProfile?(): Pt[] | null;
}

/**
 * The 3D twin of `Base`, its preview in the view named `plan` where it has views; with `views`, it keeps them to choose from, as a hybrid object's 2D view is chosen.
 * It is also what Create 3D Object From 2D builds a part `Base` placed with (partRecord.ts).
 */
export function as3D(Base: new (env: ToolEnv) => { solid?(): Solid | null; sweepProfile?(): Pt[] | null }, id: ToolId, label: string, plan?: string, views = false): new (env: ToolEnv) => PlaceTool {
  const Twin = class extends (Base as unknown as new (env: ToolEnv) => WithSolid) implements PartTwin {
    override readonly id: ToolId = id;
    protected override readonly label: string = label;
    private last: { at: Pt; angle: number } | null = null;

    constructor(env: ToolEnv) {
      super(env);
      noteToolEnv(env);
      this.planView();
    }

    /** The view its plan is drawn in, and no centre lines until its Preferences say otherwise. */
    private planView(): void {
      if (plan) this.setMode?.(plan);
      // its plan is the outline only, until its Preferences say otherwise
      const drawn = this as unknown as { centreLines?: boolean; centreLine?: boolean; parts?: { centreLines?: boolean }; config?: { centreLine?: boolean } };
      if ("centreLines" in drawn) drawn.centreLines = false;
      if ("centreLine" in drawn) drawn.centreLine = false;
      if (drawn.parts && "centreLines" in drawn.parts) drawn.parts.centreLines = false;
      if (typeof drawn.config === "object" && "centreLine" in drawn.config) drawn.config.centreLine = false;
    }

    override modes(): readonly ToolModes[] {
      return views ? (super.modes?.() ?? []) : [];
    }

    override hint(): string {
      return views ? super.hint() : "Click to place, or press and drag to turn it";
    }

    protected override shapes(at: Pt, angle: number): Part[] | null {
      this.last = { at, angle };
      return super.shapes(at, angle);
    }

    protected override place(parts: readonly Part[]): void {
      const layer = store.activeLayerId;
      const { at, angle } = this.last ?? { at: { x: 0, y: 0 }, angle: 0 };
      if (!layer) return;
      const placed = attempt(label, (s) => s.batch(() => this.build(s, layer, store.activeClassIndex, parts, at, angle)));
      if (!placed) return;
      if (typeof placed.value === "string") toast(placed.value, "info");
      else setEditGroup(null, placed.value);
    }

    placeIn(s: EditSession, layerId: string, classIndex: number, at: Pt, angle: number): string[] | string {
      this.planView();
      const parts = this.shapes(at, angle);
      return parts ? this.build(s, layerId, classIndex, parts, at, angle) : this.refusal();
    }

    /** Adds its plan and solid, grouped as a hybrid (a hole's sweep beside it); why not, when its sizes make none. */
    private build(s: EditSession, layer: string, classIndex: number, parts: readonly Part[], at: Pt, angle: number): string[] | string {
      const profile = this.sweepProfile?.();
      const solid = this.solid?.();
      if (!solid?.length && !profile) return this.refusal();
      const attrs = metalAttrs();
      const plan = parts.map((part) => addPart(s, layer, part));
      if (profile) {
        // a real sweep hanging from the layer's level, to subtract, so beside its plan: Subtract Solids takes only what's selected at the top
        const ys = profile.map((p) => p.y);
        const [low, high] = [Math.min(...ys), Math.max(...ys)];
        const points = profile.map((p) => ({ x: at.x + p.x, y: at.y + p.y - (low + high) / 2 }));
        const [sweep] = s.sweepObjects([s.addObject(layer, { kind: "polygon", points, closed: true }, classIndex, attrs)], 360, SWEEP_FACET);
        s.moveObjects3D([sweep], 0, 0, low - high);
        const group = s.groupObjects(plan);
        s.setObjectClass([group], classIndex);
        return [group, sweep];
      }
      const mesh = s.addMeshes(layer, [placedSolid(solid!, at, angle)], classIndex, attrs);
      const group = s.groupObjects([...plan, ...mesh]);
      s.setObjectClass([group], classIndex);
      return [group];
    }
  };
  registerTwin(Base, id, Twin);
  return Twin;
}
