// The 3D viewing tools: Flyover (Basic, Visualization), Translate View and Walkthrough
// (Visualization). Each sets what a left drag does in the 3D view (view3d.ts Navigation), and picking
// one in Top/Plan shows the 3D view, as Vectorworks switches to a 3D view for them. The middle button
// still zooms and the right pans, and the walk keys still walk, whichever is chosen.
//
// Flyover turns the view about its centre: View Center keeps the centre it has, Interactive Origin
// sets it with a click on the model, Object Center puts it in the middle of the selection (or of the
// visible model); Rotation Sensitivity sets how far a drag turns it. Translate View slides the view
// across the screen, or with Perspective Move In-Out moves it along the sightline. Walkthrough walks
// (dragging up goes forward, sideways turns), looks around from where the viewer stands, or rides up
// and down as an elevator; it switches to a perspective projection and starts the viewer the Viewer
// Height above the active layer's plane.

import type { Navigation } from "../view3d.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";

type FlyoverCentre = "view" | "origin" | "objects";
type TranslateMode = "pan" | "move";
type WalkMode = "walk" | "look" | "elevator";

const CENTRES: readonly { readonly id: FlyoverCentre; readonly label: string }[] = [
  { id: "view", label: "View Center" },
  { id: "origin", label: "Interactive Origin" },
  { id: "objects", label: "Object Center" },
];
const TRANSLATES: readonly { readonly id: TranslateMode; readonly label: string }[] = [
  { id: "pan", label: "Translate View" },
  { id: "move", label: "Perspective Move In-Out" },
];
const WALKS: readonly { readonly id: WalkMode; readonly label: string }[] = [
  { id: "walk", label: "Walk" },
  { id: "look", label: "Look Around" },
  { id: "elevator", label: "Elevator" },
];

/** the tools' settings, which the 3D view follows (navigationFor) */
const settings = {
  centre: "view" as FlyoverCentre,
  sensitivity: 1,
  translate: "pan" as TranslateMode,
  walk: "walk" as WalkMode,
  /** mm above the active layer's plane */
  viewerHeight: 1600,
};

/** What the 3D view does with tool `id`: its left drag, how fast it turns, and what choosing it does first. */
export interface ToolNavigation {
  readonly nav: Navigation;
  readonly sensitivity: number;
  /** turn about the middle of the selection (Object Center) */
  readonly objectCentre: boolean;
  /** stand the viewer this high above the active layer's plane, looking level, in perspective (Walkthrough) */
  readonly viewerHeight: number | null;
  /** the drag is the tool (Flyover, Translate View, Walkthrough), so the view shows an open hand */
  readonly viewing: boolean;
}

/** How tool `id` steers the 3D view, or null when it's no viewing tool (a left drag orbits then). */
export function navigationFor(id: string): ToolNavigation | null {
  const plain = { sensitivity: 1, objectCentre: false, viewerHeight: null, viewing: false };
  switch (id) {
    case "flyover":
      return { ...plain, nav: settings.centre === "origin" ? "origin" : "orbit", sensitivity: settings.sensitivity, objectCentre: settings.centre === "objects", viewing: true };
    case "translateview":
      return { ...plain, nav: settings.translate, viewing: true };
    case "walkthrough":
      return { ...plain, nav: settings.walk, viewerHeight: settings.viewerHeight, viewing: true };
    // these pick faces in the 3D view, a drag still orbiting
    case "chamferedge":
    case "filletedge":
    case "shellsolid":
    case "taperface":
    case "pushpull":
    case "offsetedge":
    case "deform":
    case "extract":
    case "project":
    case "analysis":
    case "loftsurface":
    case "alignplane":
      return { ...plain, nav: "orbit" };
    default:
      return null;
  }
}

/** shows the 3D view, once the app has said how */
let show3d: (() => void) | null = null;

/** How the viewing tools show the 3D view when pressed in Top/Plan. */
export function onShow3d(fn: () => void): void {
  show3d = fn;
}

/** Shows the 3D view, for a tool that works there pressed in Top/Plan. */
export function requestShow3d(): void {
  show3d?.();
}

/** A viewing tool: its modes from `list`, a press in Top/Plan showing the 3D view. */
abstract class ViewingTool<T extends string> extends BaseTool {
  readonly cursor = "grab";
  protected abstract readonly list: readonly { readonly id: T; readonly label: string }[];
  protected abstract readonly group: string;
  protected abstract current(): T;
  protected abstract choose(id: T): void;

  modes(): readonly ToolModes[] {
    return [{ label: this.group, options: this.list.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.current() }];
  }

  setMode(id: string): void {
    const m = this.list.find((x) => x.id === id);
    if (m) this.choose(m.id);
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) show3d?.();
  }
}

export class FlyoverTool extends ViewingTool<FlyoverCentre> {
  readonly id = "flyover";
  protected readonly list = CENTRES;
  protected readonly group = "Center";

  protected current(): FlyoverCentre {
    return settings.centre;
  }

  protected choose(id: FlyoverCentre): void {
    settings.centre = id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Flyover Preferences",
      [{ kind: "number", key: "sensitivity", label: "Rotation Sensitivity", value: settings.sensitivity, min: 0.1, max: 5 }],
      "How far a drag turns the view: 1 as the 3D view turns it, less for finer turns, more for faster ones.",
    );
    if (v) settings.sensitivity = v.num("sensitivity");
  }

  hint(): string {
    const how = settings.centre === "origin" ? "click the model to set the centre, then drag" : "drag";
    return `In the 3D view, ${how} to fly over the model · 1–3 centre`;
  }
}

export class TranslateViewTool extends ViewingTool<TranslateMode> {
  readonly id = "translateview";
  protected readonly list = TRANSLATES;
  protected readonly group = "Mode";

  protected current(): TranslateMode {
    return settings.translate;
  }

  protected choose(id: TranslateMode): void {
    settings.translate = id;
  }

  hint(): string {
    return settings.translate === "pan"
      ? "In the 3D view, drag to slide the view across the screen · 1–2 mode"
      : "In the 3D view, drag up to move in along the sightline, down to move out · 1–2 mode";
  }
}

export class WalkthroughTool extends ViewingTool<WalkMode> {
  readonly id = "walkthrough";
  protected readonly list = WALKS;
  protected readonly group = "Mode";

  protected current(): WalkMode {
    return settings.walk;
  }

  protected choose(id: WalkMode): void {
    settings.walk = id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Walkthrough Preferences",
      [{ kind: "length", key: "height", label: "Viewer Height", value: settings.viewerHeight, zero: true }],
      "Where the viewer's eye starts above the active layer's plane each time the tool is picked, looking level. Walk: drag up to go forward, down to go back, sideways to turn. Look Around: drag to turn and tilt the view where the viewer stands. Elevator: drag up and down to ride up and down. W A S D or the arrows still walk, Q and E go down and up.",
    );
    if (v) settings.viewerHeight = v.num("height");
  }

  hint(): string {
    const how = { walk: "drag up to walk forward, sideways to turn", look: "drag to look around", elevator: "drag up and down to ride up and down" }[settings.walk];
    return `In the 3D view, ${how} · 1–3 mode`;
  }
}
