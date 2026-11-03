// Event Design's Create Screen (Spotlight > Event in Vectorworks; Stage > Event here): pick a kind
// of screen, then click where the middle of its face goes and click the way it faces. It is drawn
// as the Video Screen, LED Screen and Television tools draw one (screenShapes.ts), grouped in the
// active class; Vectorworks makes a video screen plug-in object that Object Info edits.

import type { Pt } from "../../../core/index.ts";
import { placeAtNextClick } from "../../../app/placeAt.ts";
import { ledScreen, television, videoScreen, type ScreenPlan, type VideoScreen } from "../../../app/screenShapes.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { addPieces, type Part } from "../../../app/tools/detailing.ts";
import { screenParts } from "../../../app/tools/screens.ts";
import { millimetresPerUnit } from "../../../app/units.ts";

/** a screen's face is its own −y, a quarter turn from its +x */
const FACING = Math.PI / 2;

const KINDS = [
  { value: "front", label: "Front Projection Screen (goalpost)" },
  { value: "tripod", label: "Front Projection Screen (tripod)" },
  { value: "rear", label: "Rear Projection Screen" },
  { value: "led", label: "LED Video Screen" },
  { value: "modules", label: "LED Screen (tile array)" },
  { value: "tv", label: "Flat Panel Television" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

let last: { kind: Kind; width: number } | null = null;

const screen = (type: VideoScreen["type"], width: number, support: VideoScreen["support"]): VideoScreen => ({
  type,
  width,
  height: (width * 9) / 16,
  frame: type === "led" ? "frame" : "border",
  borderLeft: type === "led" ? 0 : 150,
  borderRight: type === "led" ? 0 : 150,
  frameDepth: 75,
  support: type === "led" ? "none" : support,
  feet: "both",
  caseDepth: 200,
  motor: "none",
  centreline: false,
  projector: type !== "led",
  cone: type !== "led",
  throwRatio: 1.5,
  coverage: { show: false, reference: "height", maxAngle: 45, near: 2, far: 6 },
});

/** What the kind draws `width` wide (a television's diagonal). */
function planOf(kind: Kind, width: number): ScreenPlan | string {
  if (kind === "tv") return television({ type: "flat", aspect: 16 / 9, diagonal: width, stand: false, coverage: { show: false, reference: "width", maxAngle: 45, near: 1.5, far: 6 } });
  if (kind === "modules") return ledScreen({ shape: "tileFlat", width: 500, capDepth: 30, tubeVertical: true, tubeLength: 1000, basis: "dimsSpacing", arrayWidth: width, spacing: 0, count: 8, base: "frame" });
  return videoScreen(screen(kind === "tripod" ? "front" : kind, width, kind === "tripod" ? "tripod" : "goalpost"));
}

/** Stage > Event > Create Screen…: the kind of screen, then a click where its face's middle goes and a click the way it faces. */
export async function createScreen(): Promise<void> {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s) return;
  if (!layerId || s.doc.layers().find((l) => l.id === layerId)?.kind !== "design") {
    toast("Make a design layer active to place a screen.", "info");
    return;
  }
  const perUnit = millimetresPerUnit(s.doc.info.units);
  const imperial = perUnit === 25.4 || perUnit === 304.8;
  const d = last ?? { kind: "front" as Kind, width: imperial ? 3657.6 : 3600 };
  const v = await toolPrefs(
    "Create Screen",
    [
      { kind: "choice", key: "kind", label: "Screen", value: d.kind, options: KINDS, wide: true },
      { kind: "length", key: "width", label: "Width (a television's diagonal)", value: d.width },
    ],
    "Click where the middle of the screen's face goes, then click the way it faces the audience. A projection screen's image is 16:9 with a border, its projector the throw (1.5 times its width) away in front, or behind for rear projection; an LED video screen is framed without a projector; a tile array fills its width with as many 500 mm tiles as fit; a television is a flat panel. Its settings change with the Video Screen, LED Screen and Television tools' Preferences.",
  );
  if (!v || store.session !== s) return;
  const kind = KINDS.find((k) => k.value === v.choice("kind"))?.value ?? "front";
  const width = v.num("width");
  last = { kind, width };
  const plan = planOf(kind, width);
  if (typeof plan === "string") {
    toast(`Create Screen: ${plan}`, "info");
    return;
  }
  const label = KINDS.find((k) => k.value === kind)!.label;
  const parts = (at: Pt, angle: number): Part[] => screenParts(plan, at, angle + FACING);
  const facing = (at: Pt, to: Pt): number => (Math.hypot(to.x - at.x, to.y - at.y) < 1e-9 ? -FACING : Math.atan2(to.y - at.y, to.x - at.x));
  placeAtNextClick({
    what: label,
    hint: `${label}: click where the middle of its face goes · Esc cancels`,
    preview: (at) => parts(at, -FACING),
    place: (at) =>
      void placeAtNextClick({
        what: label,
        hint: "Click the way the screen faces · Shift 15° · Esc cancels",
        from: at,
        preview: (to) => [...parts(at, facing(at, to)), { kind: "line", a: at, b: to }],
        place: (to) => addPieces("Create Screen", [parts(at, facing(at, to))]),
      }),
  });
}
