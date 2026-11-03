// MEP's Receptacle, Switch, Comm Device and Incandescent Fixture (mepShapes.ts). Vectorworks
// makes plug-in objects of them, with records for circuiting and a plate in 3D; these draw the
// indicator each shows in Top/Plan, as plain 2D objects grouped in the active class. Mounting
// heights, text styles, records and 3D aren't kept.
//
// Each takes a click, or a press dragged to turn it (Shift in 15° steps). An indicator stays the
// same size on paper, its 2D Scale Factor times the active layer's scale: on a wall the end of its
// stem goes on the point (the wall), the symbol standing off toward the drag, up the screen for a
// click; on the ceiling or floor (and a switch's ceiling pull) its circle is centred there.

import type { Pt } from "../../core/index.ts";
import { placed } from "../detailShapes.ts";
import {
  commDevice,
  fixture,
  receptacle,
  wallSwitch,
  type CommConfig,
  type CommDevice,
  type DeviceLocation,
  type Fixture,
  type FixtureMounting,
  type FixtureType,
  type IndicatorDrawing,
  type Receptacle,
  type ReceptacleConfig,
  type ReceptacleType,
  type Switch,
  type SwitchConfig,
} from "../mepShapes.ts";
import { store } from "../state.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import { placedDrawing } from "./circulation.ts";
import { PlaceTool, type Part } from "./detailing.ts";
import { BLACK, markerParts } from "./markers.ts";

/** a drag points an indicator's stem off the wall: its own +y, a quarter turn from its +x */
const UP = Math.PI / 2;

type Options<T extends string> = readonly { readonly value: T; readonly label: string }[];
const pick = <T extends string>(list: Options<T>, v: string, fallback: T): T => list.find((o) => o.value === v)?.value ?? fallback;

const RECEPTACLE_CONFIGS: Options<ReceptacleConfig> = [
  { value: "simplex", label: "Simplex" },
  { value: "duplex", label: "Duplex" },
  { value: "triplex", label: "Triplex" },
  { value: "quad", label: "Quad" },
];
const RECEPTACLE_TYPES: Options<ReceptacleType> = [
  { value: "regular", label: "Regular" },
  { value: "split", label: "Split-Wired" },
  { value: "special", label: "Special Purpose" },
  { value: "range", label: "Electric Range" },
  { value: "junction", label: "Junction Box" },
];
const LOCATIONS: Options<DeviceLocation> = [
  { value: "floor", label: "Floor" },
  { value: "wall", label: "Wall" },
  { value: "ceiling", label: "Ceiling" },
];
const SWITCH_CONFIGS: Options<SwitchConfig> = [
  { value: "regular", label: "Regular" },
  { value: "ceilingPull", label: "Ceiling Pull" },
  { value: "singleRecep", label: "w/ Single Recep" },
  { value: "doubleRecep", label: "w/ Double Recep" },
];
const COMM_CONFIGS: Options<CommConfig> = [
  { value: "telephone", label: "Telephone" },
  { value: "data", label: "Data" },
  { value: "dataVoice", label: "Data/Voice" },
  { value: "tv", label: "TV/Cable" },
  { value: "watchman", label: "Watchman" },
  { value: "sound", label: "Sound" },
  { value: "staff", label: "Staff" },
  { value: "paging", label: "Paging" },
  { value: "fireAlarm", label: "Fire Alarm" },
  { value: "clock", label: "Clock" },
  { value: "nurseCall", label: "Nurse Call" },
  { value: "pushbutton", label: "Pushbutton" },
  { value: "bell", label: "Bell/Buzzer" },
  { value: "bellTransformer", label: "Bell Transformer" },
  { value: "chime", label: "Chime" },
  { value: "doorOpener", label: "Electric Door Opener" },
];
const MOUNTINGS: Options<FixtureMounting> = [
  { value: "surface", label: "Surface" },
  { value: "recessed", label: "Recessed" },
  { value: "pendant", label: "Pendant" },
];
const FIXTURE_LOCATIONS: Options<Fixture["location"]> = [
  { value: "wall", label: "Wall" },
  { value: "ceiling", label: "Ceiling" },
];
const FIXTURE_TYPES: Options<FixtureType> = [
  { value: "downLight", label: "Down Light" },
  { value: "wallWash", label: "Wall Wash" },
  { value: "standard", label: "Standard Light" },
];

const NOTE =
  "The indicator stays the same size on paper: the 2D Scale Factor times the layer's scale. On a wall the end of its stem goes on the click, the symbol standing off toward the drag (up the screen for a click); on the ceiling or floor its middle goes there. The mounting height, text style, circuiting record and 3D plate aren't kept.";

/** An indicator's shared fields: its size, and whether its label turns with it. */
interface Common {
  readonly factor: number;
  readonly rotateLabel: boolean;
}

const commonFields = (c: Common): PrefField[] => [
  { kind: "number", key: "factor", label: "2D Scale Factor", value: c.factor, min: 0.1, max: 20 },
  { kind: "check", key: "rotateLabel", label: "Rotate Label with Object", value: c.rotateLabel },
];
const commonFrom = (v: PrefValues): Common => ({ factor: v.num("factor"), rotateLabel: v.flag("rotateLabel") });

/**
 * An indicator's parts placed at `at`, turned by `turn` radians: its shaded halves filled at half
 * strength, its label level unless it turns with it. A label turned upside down is flipped to read
 * (placedDrawing), so it ends at its point instead, running away from the symbol as before.
 */
function indicatorParts(d: IndicatorDrawing, at: Pt, turn: number, rotateLabel: boolean): Part[] {
  const ink = store.drawAttrs.penFore ?? BLACK;
  const deg = (turn * 180) / Math.PI;
  const own = d.label && (rotateLabel ? d.label : { ...d.label, angle: -deg });
  const reads = own && ((((own.angle ?? 0) + deg) % 360) + 360) % 360;
  const label = own && reads !== undefined && reads > 90 && reads <= 270 ? { ...own, justify: "right" as const } : own;
  return [
    ...markerParts(placedDrawing({ ...d, texts: label ? [...d.texts, label] : d.texts }, at, turn)),
    ...d.shaded.map((pts): Part => ({ shape: { kind: "polygon", points: placed(pts, at, turn), closed: true }, attrs: { fillPattern: 1, fillFore: ink, fillBack: ink, fillOpacity: 50 } })),
  ];
}

abstract class IndicatorTool extends PlaceTool {
  readonly cursor = "crosshair";
  protected readonly clickAngle = UP;
  protected common: Common = { factor: 1, rotateLabel: true };
  /** the indicator at `k` drawing mm to the paper mm */
  protected abstract drawing(k: number): IndicatorDrawing;

  hint(): string {
    return `${super.hint()} · on a wall the stem's end on the point, the symbol toward the drag`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    return scale === null ? null : indicatorParts(this.drawing(this.common.factor * scale), at, angle - UP, this.common.rotateLabel);
  }

  protected refusal(): string {
    return `Make a design layer active to place a ${this.label.toLowerCase()}.`;
  }
}

export class ReceptacleTool extends IndicatorTool {
  readonly id = "receptacle";
  protected readonly label = "Receptacle";
  private r: Receptacle = { type: "regular", config: "duplex", location: "wall", label: "" };

  async preferences(): Promise<void> {
    const r = this.r;
    const v = await toolPrefs(
      "Receptacle Preferences",
      [
        { kind: "choice", key: "config", label: "Config", value: r.config, options: RECEPTACLE_CONFIGS },
        { kind: "text", key: "label", label: "Config Label", value: r.label },
        { kind: "choice", key: "type", label: "Type", value: r.type, options: RECEPTACLE_TYPES },
        { kind: "choice", key: "location", label: "Location", value: r.location, options: LOCATIONS },
        ...commonFields(this.common),
      ],
      `${NOTE} Special Purpose, Electric Range and Junction Box keep their own lines whatever the Config.`,
    );
    if (!v) return;
    this.r = { config: pick(RECEPTACLE_CONFIGS, v.choice("config"), "duplex"), label: v.choice("label"), type: pick(RECEPTACLE_TYPES, v.choice("type"), "regular"), location: pick(LOCATIONS, v.choice("location"), "wall") };
    this.common = commonFrom(v);
  }

  protected drawing(k: number): IndicatorDrawing {
    return receptacle(this.r, k);
  }
}

export class SwitchTool extends IndicatorTool {
  readonly id = "switch";
  protected readonly label = "Switch";
  private s: Switch = { config: "regular", label: "" };

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Switch Preferences",
      [
        { kind: "choice", key: "config", label: "Config", value: this.s.config, options: SWITCH_CONFIGS },
        { kind: "text", key: "label", label: "Config Label", value: this.s.label },
        ...commonFields(this.common),
      ],
      `${NOTE} A regular switch's $ stands just off the wall, its label (3, 4, D, P…) low beside it; a ceiling pull is centred on the point.`,
    );
    if (!v) return;
    this.s = { config: pick(SWITCH_CONFIGS, v.choice("config"), "regular"), label: v.choice("label") };
    this.common = commonFrom(v);
  }

  protected drawing(k: number): IndicatorDrawing {
    return wallSwitch(this.s, k);
  }
}

export class CommDeviceTool extends IndicatorTool {
  readonly id = "commdevice";
  protected readonly label = "Comm Device";
  private c: CommDevice = { config: "telephone", label: "" };

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Comm Device Preferences",
      [
        { kind: "choice", key: "config", label: "Config", value: this.c.config, options: COMM_CONFIGS },
        { kind: "text", key: "label", label: "Config Label", value: this.c.label },
        ...commonFields(this.common),
      ],
      `${NOTE} Every device stands on a stem from the wall.`,
    );
    if (!v) return;
    this.c = { config: pick(COMM_CONFIGS, v.choice("config"), "telephone"), label: v.choice("label") };
    this.common = commonFrom(v);
  }

  protected drawing(k: number): IndicatorDrawing {
    return commDevice(this.c, k);
  }
}

export class IncandescentFixtureTool extends IndicatorTool {
  readonly id = "incandescent";
  protected readonly label = "Incandescent Fixture";
  private f: Fixture = { mounting: "surface", location: "ceiling", type: "standard", emergency: false, label: "" };

  async preferences(): Promise<void> {
    const f = this.f;
    const v = await toolPrefs(
      "Incandescent Fixture Preferences",
      [
        { kind: "choice", key: "mounting", label: "Mounting", value: f.mounting, options: MOUNTINGS },
        { kind: "choice", key: "location", label: "Location", value: f.location, options: FIXTURE_LOCATIONS },
        { kind: "choice", key: "type", label: "Type", value: f.type, options: FIXTURE_TYPES },
        { kind: "text", key: "label", label: "Config Label", value: f.label },
        { kind: "check", key: "emergency", label: "Emergency", value: f.emergency },
        ...commonFields(this.common),
      ],
      `${NOTE} A wall washer's half and an emergency light's half are filled in the pen's colour at half strength.`,
    );
    if (!v) return;
    this.f = {
      mounting: pick(MOUNTINGS, v.choice("mounting"), "surface"),
      location: pick(FIXTURE_LOCATIONS, v.choice("location"), "ceiling"),
      type: pick(FIXTURE_TYPES, v.choice("type"), "standard"),
      label: v.choice("label"),
      emergency: v.flag("emergency"),
    };
    this.common = commonFrom(v);
  }

  protected drawing(k: number): IndicatorDrawing {
    return fixture(this.f, k);
  }
}
