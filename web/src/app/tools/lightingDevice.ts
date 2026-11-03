// Spotlight's Lighting Device: a click where the device hangs and a second click (or a drag) where it
// focuses places a Rodeo Instrument (features/theatre/instrument.ts), a plug-in object holding its type,
// patch, colour, photometrics and focus. Object Info edits them, and Stage's paperwork, beams and load
// checks read them. Its outline is generic for its type; Vectorworks inserts a library symbol here.
// Automatic Numbering counts the unit number and channel on after each device. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { countOn, lightingDevice } from "../lightingDeviceShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";
import { aimTo, DEFAULT_HEIGHT_MM, DEFAULT_TYPE, FIXTURE_TYPES, FOCUS_PLANE_MM, fixtureType } from "../../features/theatre/fixture.ts";
import { positionAt } from "../../features/theatre/hanging/positions.ts";
import { placeInstrument } from "../../features/theatre/instrument.ts";
import { dist, snapAngle, ANGLE_STEP_DEG } from "../geom.ts";
import { placedDrawing } from "./circulation.ts";
import { layerScale, preview } from "./detailing.ts";
import { markerParts } from "./markers.ts";

/** a press dragged at least this far is a drag to the focus, not a click */
const CLICK_PX = 4;

export class LightingDeviceTool extends BaseTool {
  readonly id = "lightdevice";
  readonly cursor = "crosshair";
  private from: Pt | null = null;
  private pressScreen: Pt | null = null;
  private cursorAt: Pt | null = null;
  private type = DEFAULT_TYPE;
  private position = "";
  private unit = "1";
  private channel = "1";
  private color = "";
  private gobo = "";
  private purpose = "";
  private heightMm = DEFAULT_HEIGHT_MM;
  private planeMm = FOCUS_PLANE_MM;
  private auto = true;
  private unitStep = 1;
  private channelStep = 1;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Lighting Device Preferences",
      [
        { kind: "choice", key: "type", label: "Instrument Type", value: this.type, options: FIXTURE_TYPES.map((t) => ({ value: t.key, label: t.label })) },
        { kind: "text", key: "position", label: "Position", value: this.position },
        { kind: "text", key: "unit", label: "Unit Number", value: this.unit },
        { kind: "text", key: "channel", label: "Channel", value: this.channel },
        { kind: "text", key: "color", label: "Color", value: this.color },
        { kind: "text", key: "gobo", label: "Gobo", value: this.gobo },
        { kind: "text", key: "purpose", label: "Purpose", value: this.purpose },
        { kind: "length", key: "height", label: "Lens Height", value: this.heightMm },
        { kind: "length", key: "plane", label: "Focus Height", value: this.planeMm, zero: true },
        { kind: "check", key: "auto", label: "Automatic Numbering", value: this.auto },
        { kind: "number", key: "unitStep", label: "Unit Number Increment", value: this.unitStep, min: -1000, max: 1000 },
        { kind: "number", key: "channelStep", label: "Channel Increment", value: this.channelStep, min: -1000, max: 1000 },
      ],
      "Click where the device hangs, then click (or drag) where it focuses; Shift keeps the aim to 15° steps. Each device keeps its type, patch, colour, gobo, wattage, weight, beam and focus, which Object Info edits and the Stage menu's paperwork, patching, beam and load tools read. Its outline is generic for its type, with its real size. Automatic Numbering counts the last number in the unit number and channel on by their increments after each device. Types' figures are typical, not a maker's data: change them on the device. Library symbols, multi-cell devices and label legends' layouts aren't kept.",
    );
    if (!v) return;
    this.type = fixtureType(v.choice("type"))?.key ?? this.type;
    this.position = v.choice("position");
    this.unit = v.choice("unit");
    this.channel = v.choice("channel");
    this.color = v.choice("color");
    this.gobo = v.choice("gobo");
    this.purpose = v.choice("purpose");
    this.heightMm = v.num("height");
    this.planeMm = v.num("plane");
    this.auto = v.flag("auto");
    this.unitStep = Math.round(v.num("unitStep"));
    this.channelStep = Math.round(v.num("channelStep"));
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  hint(): string {
    return this.from
      ? `Click or release where it focuses · Shift ${ANGLE_STEP_DEG}°`
      : `Click where the ${fixtureType(this.type)?.label ?? "device"} hangs, then where it focuses · unit ${this.unit || "—"}, channel ${this.channel || "—"}`;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0 || p.detail > 1) return;
    if (!this.from) {
      if (layerScale(this.env) === null) {
        toast("Make a design layer active to place a lighting device.", "info");
        return;
      }
      this.from = p.pos;
      this.pressScreen = p.screen;
      return;
    }
    this.pressScreen = null;
    this.finish(this.at(p));
  }

  move(p: PointerInfo): void {
    this.cursorAt = this.at(p);
  }

  up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.from && press && dist(p.screen, press) > CLICK_PX) this.finish(this.at(p));
  }

  cancel(): void {
    this.from = null;
    this.pressScreen = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.from) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    const a = this.from;
    const b = this.cursorAt;
    const scale = layerScale(this.env) ?? 1;
    const under = a ?? b;
    const on = !this.position && under ? positionAt(under) : null;
    if (on) {
      const { x0, y0, x1, y1 } = on.box;
      preview(g, [{ kind: "polyline", points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true }, { kind: "text", at: { x: x0, y: y1 + 1.5 * scale }, text: on.name, height: 3 * scale }]);
    }
    if (!a || !b) return;
    const glyph = fixtureType(this.type)?.glyph ?? "ellipsoidal";
    const aim = (aimTo(a, b) * Math.PI) / 180;
    const d = lightingDevice(glyph, 1, { channel: this.channel, unit: this.unit, color: this.color, purpose: "" }, 2.5 * scale, aim);
    preview(g, markerParts(placedDrawing(d, a, 0)));
    preview(g, [{ kind: "line", a, b }]);
  }

  private at(p: PointerInfo): Pt {
    return this.from && p.shift ? snapAngle(this.from, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private finish(focus: Pt): void {
    const at = this.from;
    const layerId = store.activeLayerId;
    this.from = null;
    if (!at || !layerId) return;
    // on a hanging position it takes the name, and hangs at its trim once it has one
    const on = this.position ? null : positionAt(at);
    const edit = {
      position: on?.name ?? this.position,
      unit: this.unit,
      channel: this.channel,
      color: this.color,
      gobo: this.gobo,
      purpose: this.purpose,
      heightMm: on && on.trim > 0 ? on.trim : this.heightMm,
      focus: { x: focus.x, y: focus.y, z: this.planeMm },
      aimDeg: aimTo(at, focus),
    };
    const r = attempt("Lighting Device", (s) => s.batch(() => placeInstrument(s, layerId, at, this.type, edit)));
    if (!r) return;
    setEditGroup(null, [r.value]);
    if (this.auto) {
      this.unit = countOn(this.unit, this.unitStep);
      this.channel = countOn(this.channel, this.channelStep);
    }
  }
}
