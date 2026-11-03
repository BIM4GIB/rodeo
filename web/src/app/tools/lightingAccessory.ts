// Spotlight's Lighting Accessory: click a lighting device to add the chosen accessory to its Accessory list,
// or in Remove mode to take its last one off; Apply to Selection does the selected devices at once, removing
// all of theirs. A device draws its accessories where their part goes and carries their weight (Vectorworks'
// accessories are symbols of their own, moved and edited in an accessory edit mode, and shown in 3D).

import type { Pt } from "../../core/index.ts";
import type { Fixture } from "../../features/theatre/fixture.ts";
import { editFixtures, fixtures } from "../../features/theatre/instrument.ts";
import { ACCESSORIES, accessoryNames, accessoryWeight, withAccessory, withoutAccessory } from "../lightingDeviceShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { preview } from "./detailing.ts";

/** a device this near the pointer is the one a click means, mm on the drawing or px on screen, whichever reaches further */
const REACH_MM = 500;
const REACH_PX = 14;

type Mode = "insert" | "remove";

export class LightingAccessoryTool extends BaseTool {
  readonly id = "lightaccessory";
  readonly cursor = "crosshair";
  private mode: Mode = "insert";
  private name = ACCESSORIES[0].name;
  private pointer: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [
      {
        options: [
          { id: "insert", label: "Default Insertion", key: "1" },
          { id: "remove", label: "Remove", key: "2" },
        ],
        active: this.mode,
      },
      { options: [{ id: "apply", label: "Apply to Selection", key: "3" }], active: "" },
    ];
  }

  setMode(id: string): void {
    if (id === "apply") this.applyToSelection();
    else if (id === "insert" || id === "remove") this.mode = id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Lighting Accessory Preferences",
      [{ kind: "choice", key: "name", label: "Accessory", value: this.name, options: ACCESSORIES.map((a) => ({ value: a.name, label: a.name })) }],
      "Click a lighting device to add it: a lens accessory goes in front of the device, a body one a third of the way back, and a yoke or base one on its hanging point. Its weight goes onto the device's. The weights are generic figures, and any other accessory can be typed into Accessory in Object Info.",
    );
    if (!v) return;
    this.name = v.choice("name");
    store.setHint(this.hint());
  }

  hint(): string {
    return this.mode === "insert" ? `Click a lighting device to add ${this.name} · 3 applies it to the selection` : "Click a lighting device to take its last accessory off · 3 takes all of them off the selection";
  }

  private deviceAt(p: Pt): Fixture | null {
    const reach = Math.max(REACH_MM, REACH_PX / this.env.view.scale);
    let best: Fixture | null = null;
    let nearest = reach;
    for (const f of fixtures()) {
      const d = Math.hypot(f.at.x - p.x, f.at.y - p.y);
      if (d <= nearest) [best, nearest] = [f, d];
    }
    return best;
  }

  /** The edit that adds or removes an accessory, or null when there's nothing to do. */
  private change(f: Fixture, all: boolean): { accessory: string; weightKg: number } | null {
    const names = accessoryNames(f.accessory);
    if (this.mode === "insert") {
      if (names.includes(this.name)) return null;
      return { accessory: withAccessory(f.accessory, this.name), weightKg: f.weightKg + accessoryWeight(this.name) };
    }
    if (!names.length) return null;
    const gone = all ? names : names.slice(-1);
    return { accessory: gone.reduce(withoutAccessory, f.accessory), weightKg: Math.max(0, f.weightKg - gone.reduce((sum, n) => sum + accessoryWeight(n), 0)) };
  }

  private applyToSelection(): void {
    const chosen = fixtures().filter((f) => store.selection.has(f.id));
    if (!chosen.length) {
      toast("Select the lighting devices first.", "info");
      return;
    }
    const edits = chosen.flatMap((f) => {
      const edit = this.change(f, true);
      return edit ? [{ id: f.id, edit }] : [];
    });
    if (edits.length) editFixtures("Lighting Accessory", edits);
    else toast(this.mode === "insert" ? `They all have ${this.name} already.` : "They have no accessories.", "info");
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const f = this.deviceAt(p.pos);
    if (!f) {
      toast("Click a lighting device.", "info");
      return;
    }
    const edit = this.change(f, false);
    if (edit) editFixtures("Lighting Accessory", [{ id: f.id, edit }]);
    else toast(this.mode === "insert" ? `That device has ${this.name} already.` : "That device has no accessories.", "info");
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  overlay(g: Painter): void {
    const f = this.pointer && this.deviceAt(this.pointer);
    if (f) preview(g, [{ kind: "arc", center: f.at, radius: REACH_MM, startAngle: 0, sweepAngle: 360 }]);
  }
}
