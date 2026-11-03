// The application preferences Edit > Preferences… sets (prefsDialog.ts), kept in this browser: whether
// Duplicate offsets its copies, what the mouse wheel does, tool help, the 3D conversion resolution and
// whether the 3D view keeps its render mode, autosave, the Interactive pane's cursor boxes,
// pre-selection highlighting and animated view changes, and the colours the Appearance pane sets for
// them (appearance.ts applies those). The theme, the black background, zoomed
// line thickness and the snap radius keep their own settings (theme.ts, state.ts).

const PREFS_KEY = "openvwx.prefs.v1";
/** drawings larger than this aren't copied (autosave.ts) */
export const AUTOSAVE_MAX_BYTES = 150 * 1024 * 1024;

/** How a view change moves (Interactive, "Animate view transitions"). */
export type ViewMotion = "decelerate" | "accelerate" | "smooth" | "linear";
export const VIEW_MOTIONS: readonly ViewMotion[] = ["decelerate", "accelerate", "smooth", "linear"];

/** How finely curves become faces in 3D (3D, "3D conversion resolution"). */
export type Resolution3d = "low" | "medium" | "high" | "very high";
/** points per full turn of a circle at each 3D conversion resolution */
export const TURN_STEPS: Record<Resolution3d, number> = { low: 24, medium: 48, high: 96, "very high": 192 };

export interface Prefs {
  autosave: boolean;
  /** minutes between copies */
  autosaveMinutes: number;
  /** Edit > Duplicate places its copies a grid step up and to the right (else on the originals) */
  offsetDuplicates: boolean;
  /** crosshairs across the whole drawing at the pointer */
  fullCursor: boolean;
  /** the mouse wheel zooms (else it scrolls, and zooms with ⌘ or Ctrl held, or a pinch) */
  wheelZooms: boolean;
  /** the Mode bar shows the active tool's help (its steps and keys) */
  toolHelp: boolean;
  /** while a group is edited the objects outside it show, grayed (else only the group's) */
  showOthersEditing: boolean;
  resolution3d: Resolution3d;
  /** the 3D view opens in the render mode and projection it last had, in a later visit too */
  remember3d: boolean;
  /** a box at the pointer showing how near an object must be to be clicked */
  selectBox: boolean;
  /** that box's side, CSS px: objects within half of it of the pointer are hit */
  selectBoxPx: number;
  /** a box at the pointer showing how far snapping reaches (the Snapping palette's radius) */
  snapBox: boolean;
  /** the Selection tool outlines what a click would select, once the pointer rests on it */
  preselect: boolean;
  /** how long the pointer rests first, ms */
  preselectMs: number;
  /** Fit, Zoom to Selection, saved views and Previous/Next View move there rather than jump */
  animateViews: boolean;
  viewSeconds: number;
  viewMotion: ViewMotion;
  /** the selection's outline and handles, and the tools' previews (#rrggbb) */
  selectionColor: string;
  /** the pre-selection highlight */
  preselectColor: string;
  /** snap markers and their names, smart points and their guides, and the snap box */
  snapColor: string;
  /** the full-screen cursor and the selection box; "" follows the canvas (dark on white, light on black) */
  cursorColor: string;
}

/** The colours the Appearance pane starts with, and goes back to. */
export const APPEARANCE_DEFAULTS = {
  selectionColor: "#2f6fdb",
  preselectColor: "#2f6fdb",
  snapColor: "#2f6fdb",
  cursorColor: "",
} as const satisfies Partial<Prefs>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const DEFAULTS: Prefs = {
  autosave: true,
  autosaveMinutes: 5,
  offsetDuplicates: true,
  fullCursor: false,
  wheelZooms: true,
  toolHelp: true,
  showOthersEditing: true,
  resolution3d: "medium",
  remember3d: true,
  selectBox: false,
  selectBoxPx: 12,
  snapBox: false,
  preselect: true,
  preselectMs: 150,
  animateViews: true,
  viewSeconds: 0.35,
  viewMotion: "smooth",
  ...APPEARANCE_DEFAULTS,
};

/** the bounds the dialog's sliders keep each number in */
export const PREF_RANGES = {
  autosaveMinutes: [1, 600],
  selectBoxPx: [4, 40],
  preselectMs: [0, 1000],
  viewSeconds: [0.1, 2],
} as const;

let current: Prefs | null = null;
const listeners = new Set<() => void>();

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Record<keyof Prefs, unknown>> | null;
    const out: Record<string, unknown> = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof Prefs)[]) {
      const v = raw?.[key];
      const d = DEFAULTS[key];
      if (typeof d === "boolean" && typeof v === "boolean") out[key] = v;
      else if (typeof d === "number" && typeof v === "number" && Number.isFinite(v)) {
        const range = (PREF_RANGES as Record<string, readonly [number, number]>)[key];
        out[key] = range ? Math.min(range[1], Math.max(range[0], v)) : v;
      }
    }
    for (const key of Object.keys(APPEARANCE_DEFAULTS) as (keyof typeof APPEARANCE_DEFAULTS)[]) {
      const v = raw?.[key];
      if (typeof v === "string" && (HEX_COLOR.test(v) || (v === "" && key === "cursorColor"))) out[key] = v.toLowerCase();
    }
    if (VIEW_MOTIONS.includes(raw?.viewMotion as ViewMotion)) out.viewMotion = raw?.viewMotion;
    if (typeof raw?.resolution3d === "string" && raw.resolution3d in TURN_STEPS) out.resolution3d = raw.resolution3d;
    return out as unknown as Prefs;
  } catch {
    return { ...DEFAULTS };
  }
}

/** The preferences as set now. */
export function prefs(): Readonly<Prefs> {
  return (current ??= load());
}

/** Sets and keeps the preferences, and tells those listening. */
export function setPrefs(next: Prefs): void {
  current = { ...next };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(current));
  } catch {
    // storage blocked: the preferences last for this visit only
  }
  for (const fn of listeners) fn();
}

/** Calls `fn` whenever the preferences change; returns a function that stops it. */
export function onPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const LAST_3D_KEY = "openvwx.last3d.v1";

/** The render mode and projection the 3D view last had (kept while Preferences > 3D remembers them). */
export interface Last3d {
  mode: string;
  projection: "perspective" | "orthogonal";
}

/** The 3D view's last render mode and projection, or null when none is kept or remembering is off. */
export function last3d(): Last3d | null {
  if (!prefs().remember3d) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_3D_KEY) ?? "null") as Partial<Last3d> | null;
    if (typeof raw?.mode !== "string" || (raw.projection !== "perspective" && raw.projection !== "orthogonal")) return null;
    return { mode: raw.mode, projection: raw.projection };
  } catch {
    return null;
  }
}

/** Keeps the 3D view's render mode and projection for the next visit, while Preferences say to. */
export function keep3d(v: Last3d): void {
  if (!prefs().remember3d) return;
  try {
    localStorage.setItem(LAST_3D_KEY, JSON.stringify(v));
  } catch {
    // storage blocked: the next visit starts from the defaults
  }
}
