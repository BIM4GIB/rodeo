// Focus Instrument: click a lighting instrument near its hanging point (within 20 px) to pick it up, move
// to where its beam should land and click to set its focus. Its beam and field pools follow the pointer
// and the hint reads the spot in stage terms with the throw and pool sizes. It stays ready for the next
// instrument; Esc puts the picked one back. A focus keeps the height it had, else Preferences' height.

import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../../../app/tools.ts";
import type { Pt } from "../../../core/index.ts";
import { aimTo, FOCUS_PLANE_MM, type Fixture } from "../fixture.ts";
import { editFixtures, fixtures } from "../instrument.ts";
import { lengthText, stageHint } from "../stageTool.ts";
import { poolOutline, poolSize, throwMm } from "./photometry.ts";

/** how close the pointer must be to an instrument's hanging point to pick it, screen px */
const PICK_PX = 20;

/** The instrument with its focus at `at` on the plane `z`: what its pools would be. */
function focused(f: Fixture, at: Pt, z: number): Fixture {
  return { ...f, focus: { x: at.x, y: at.y, z } };
}

export class FocusInstrumentTool extends BaseTool {
  readonly id = "focusinstrument";
  readonly cursor = "crosshair";
  private picked: Fixture | null = null;
  private cursorAt: Pt | null = null;
  private height = FOCUS_PLANE_MM;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Focus Instrument Preferences",
      [{ kind: "length", key: "height", label: "Focus Height", value: this.height, zero: true }],
      "A new focus lands on a plane this high above the stage floor (a performer's head is about 1.7 m). " +
        "An instrument that's already focused keeps its own height.",
    );
    if (!v) return;
    this.height = v.num("height");
  }

  hint(): string {
    if (!this.picked) return "Click an instrument to pick it up, then click where its beam should land";
    const at = this.cursorAt ?? this.picked.at;
    const f = focused(this.picked, at, this.focusZ());
    const beam = lengthText(poolSize(f, f.beamDeg));
    const field = lengthText(poolSize(f, f.fieldDeg));
    return `${stageHint(at)} · Throw ${lengthText(throwMm(f))} · Beam pool ${beam} · Field pool ${field} · Esc goes back`;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0 || p.detail > 1) return;
    if (this.picked) {
      const picked = this.picked;
      this.picked = null;
      const focus = { x: p.pos.x, y: p.pos.y, z: this.focusZ() };
      editFixtures("Focus", [{ id: picked.id, edit: { focus, aimDeg: aimTo(picked.at, focus) } }]);
      return;
    }
    const near = this.nearest(p.screen);
    if (!near) {
      toast("No instrument within 20 px of that point. Click closer to its hanging point.", "info");
      return;
    }
    if (!near.native) {
      toast("That's a Vectorworks device, whose focus Rodeo doesn't set. Use a Rodeo instrument.", "info");
      return;
    }
    this.picked = near;
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  cancel(): void {
    this.picked = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.picked) return false;
    this.picked = null;
    return true;
  }

  overlay(g: Painter): void {
    const f0 = this.picked;
    const at = this.cursorAt;
    if (!f0 || !at) return;
    const f = focused(f0, at, this.focusZ());
    const beam = poolOutline(f, this.focusZ(), f.beamDeg);
    const field = poolOutline(f, this.focusZ(), f.fieldDeg);
    withPreview(g, () => {
      strokeScreen(g, beam, true);
      strokeScreen(g, field, true);
      strokeScreen(g, [f.at, at], false);
    });
  }

  /** The focus plane for the picked instrument: its own height, else the preference. */
  private focusZ(): number {
    return this.picked?.focus?.z ?? this.height;
  }

  private nearest(screen: Pt): Fixture | null {
    let best: Fixture | null = null;
    let bestPx = PICK_PX;
    for (const f of fixtures()) {
      const s = this.env.view.toScreen(f.at);
      const d = Math.hypot(s.x - screen.x, s.y - screen.y);
      if (d <= bestPx) {
        best = f;
        bestPx = d;
      }
    }
    return best;
  }
}

