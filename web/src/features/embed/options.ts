// The embed's address contract: which options a viewer address carries, how they are read and
// written, and the addresses a share link, an embed and a public file are opened at. DOM-free, so
// the check runs in node. The web component and the server's link previews build the same
// addresses, so change this file and those together.

import type { RenderMode, ViewPreset } from "../../app/view3d.ts";

/** The view an embed starts in: the 2D drawing or the 3D model. */
export type EmbedView = "2d" | "3d";
/** The look of the embed's controls: follow the visitor's system, or fixed light or dark. */
export type EmbedTheme = "auto" | "light" | "dark";
/** How much of the embed's controls show: all, a minimal set, or none. */
export type EmbedUi = "full" | "min" | "none";
/** The 3D render modes an embed can start in. The realistic ones need the render feature, so they are left out. */
export type EmbedRender = Extract<RenderMode, "shaded" | "textured" | "hidden" | "dashed" | "wireframe" | "sketch">;
/** A point in document units: x, y, z. */
export type Xyz = readonly [number, number, number];
/** A 3D start view: where the camera stands and the point it looks at. */
export interface CameraSpec {
  readonly position: Xyz;
  readonly target: Xyz;
}
/** A 2D start view: the centre and the width shown, in document units. */
export interface PlanSpot {
  readonly x: number;
  readonly y: number;
  readonly span: number;
}
/** Everything an embed address can ask for. null means the drawing's own choice. */
export interface EmbedOptions {
  readonly view: EmbedView | null;
  readonly layer: string | null;
  readonly at: PlanSpot | null;
  readonly cam: CameraSpec | null;
  readonly preset: ViewPreset | null;
  readonly render: EmbedRender | null;
  readonly rotate: boolean;
  readonly theme: EmbedTheme;
  readonly ui: EmbedUi;
}
/** What an embed shows: a share link's drawing, or a public file's address. */
export type EmbedSource = { readonly token: string } | { readonly url: string };

/** The options an embed starts with when the address says nothing. */
export const DEFAULT_OPTIONS: EmbedOptions = {
  view: null,
  layer: null,
  at: null,
  cam: null,
  preset: null,
  render: null,
  rotate: false,
  theme: "auto",
  ui: "full",
};

/** The option keys in the order an address writes them. */
export const OPTION_KEYS = ["view", "layer", "at", "cam", "preset", "render", "rotate", "theme", "ui"] as const;

/** The standard 3D views, in the order the editor's view menu lists them. */
export const VIEW_PRESETS: readonly ViewPreset[] = [
  "top",
  "bottom",
  "front",
  "back",
  "left",
  "right",
  "iso",
  "leftIso",
  "rightRearIso",
  "leftRearIso",
  "lowerRightIso",
  "lowerLeftIso",
  "lowerRightRearIso",
  "lowerLeftRearIso",
];

/** The 3D render modes an address can name. */
export const RENDER_MODES: readonly EmbedRender[] = ["shaded", "textured", "hidden", "dashed", "wireframe", "sketch"];

/** The longest layer or sheet name an address may carry; a longer one is ignored. */
const MAX_LAYER = 200;
/** Coordinates and spans beyond this are refused: they are not a drawing anyone can see. */
const LIMIT = 1e9;
/** A plain decimal number, with an optional exponent. Number() alone would take "" and "0x1F". */
const NUMBER_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/** Splits "a,b,c" into exactly `count` finite numbers, each within the limit; null otherwise. */
function numbersOf(text: string, count: number): number[] | null {
  const parts = text.split(",");
  if (parts.length !== count) return null;
  const out: number[] = [];
  for (const part of parts) {
    const t = part.trim();
    if (!NUMBER_TEXT.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || Math.abs(n) > LIMIT) return null;
    out.push(n);
  }
  return out;
}

/** The options an address asks for; anything invalid is the default. */
export function parseOptions(params: URLSearchParams): EmbedOptions {
  // sheet= is read only when layer= is absent, so an empty layer= stays empty rather than falling through
  const layerText = (params.get("layer") ?? params.get("sheet") ?? "").trim();
  const view = params.get("view")?.toLowerCase();
  const preset = params.get("preset")?.toLowerCase();
  const render = params.get("render")?.toLowerCase();
  const rotate = params.get("rotate");
  const theme = params.get("theme")?.toLowerCase();
  const ui = params.get("ui")?.toLowerCase();
  return {
    view: view === "2d" || view === "3d" ? view : null,
    layer: layerText !== "" && layerText.length <= MAX_LAYER ? layerText : null,
    at: parsePlanSpot(params.get("at") ?? ""),
    cam: parseCam(params.get("cam") ?? ""),
    preset: VIEW_PRESETS.find((p) => p.toLowerCase() === preset) ?? null,
    render: RENDER_MODES.find((m) => m === render) ?? null,
    // a bare ?rotate counts as on, as does rotate=1 or rotate=true
    rotate: rotate === "" || rotate === "1" || rotate === "true",
    theme: theme === "light" || theme === "dark" ? theme : "auto",
    ui: ui === "min" || ui === "none" ? ui : "full",
  };
}

/** The options that differ from the defaults, as [key, value] pairs in OPTION_KEYS order. */
export function optionPairs(o: EmbedOptions): [string, string][] {
  const pairs: [string, string][] = [];
  if (o.view) pairs.push(["view", o.view]);
  if (o.layer) pairs.push(["layer", o.layer]);
  if (o.at) pairs.push(["at", formatPlanSpot(o.at)]);
  if (o.cam) pairs.push(["cam", formatCam(o.cam)]);
  if (o.preset) pairs.push(["preset", o.preset]);
  if (o.render) pairs.push(["render", o.render]);
  if (o.rotate) pairs.push(["rotate", "1"]);
  if (o.theme !== "auto") pairs.push(["theme", o.theme]);
  if (o.ui !== "full") pairs.push(["ui", o.ui]);
  return pairs;
}

/** encodeURIComponent, but commas stay as they are, so cam=1,2,3 reads as it was written. */
export function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%2C/g, ",");
}

/** The option pairs as a query string ("view=3d&rotate=1"), each value through encodeValue. */
export function optionQuery(o: EmbedOptions): string {
  return optionPairs(o)
    .map(([k, v]) => `${k}=${encodeValue(v)}`)
    .join("&");
}

/** The viewer's address for a share link's drawing or a public file, with the options that differ from the defaults. */
export function embedUrl(origin: string, source: EmbedSource, o: EmbedOptions = DEFAULT_OPTIONS): string {
  const head =
    "token" in source
      ? `${origin}/?embed=${encodeValue(source.token)}`
      : `${origin}/?embed&url=${encodeURIComponent(source.url)}`;
  const query = optionQuery(o);
  return query ? `${head}&${query}` : head;
}

/** A share link: origin/?share=token, with &ref=… when given. */
export function shareUrl(origin: string, token: string, ref?: string): string {
  return `${origin}/?share=${encodeValue(token)}${ref ? `&ref=${encodeValue(ref)}` : ""}`;
}

/** Where an embed's Open in Rodeo goes: the share page, or the editor opening the public file. */
export function openUrlFor(origin: string, source: EmbedSource): string {
  if ("token" in source) return shareUrl(origin, source.token, "embed");
  return `${origin}/?url=${encodeURIComponent(source.url)}&ref=embed`;
}

/** Reads "x,y,z,tx,ty,tz" as a 3D start view; null when it is not six numbers or the camera stands on its target. */
export function parseCam(text: string): CameraSpec | null {
  const v = numbersOf(text, 6);
  if (!v) return null;
  const distance = Math.hypot(v[0] - v[3], v[1] - v[4], v[2] - v[5]);
  if (!(distance > 0)) return null;
  return { position: [v[0], v[1], v[2]], target: [v[3], v[4], v[5]] };
}

/** Writes a 3D start view with whole numbers, which is what an address carries. */
export function formatCam(cam: CameraSpec): string {
  return [...cam.position, ...cam.target].map((n) => String(Math.round(n))).join(",");
}

/** Reads "x,y,span" as a 2D start view; null unless the span is above zero. */
export function parsePlanSpot(text: string): PlanSpot | null {
  const v = numbersOf(text, 3);
  if (!v || !(v[2] > 0)) return null;
  return { x: v[0], y: v[1], span: v[2] };
}

/** Writes a 2D start view with whole numbers, and a span of at least 1. */
export function formatPlanSpot(spot: PlanSpot): string {
  return `${Math.round(spot.x)},${Math.round(spot.y)},${Math.max(1, Math.round(spot.span))}`;
}

/** A file name without its extension, for titles; "Drawing" when nothing is left. */
export function displayName(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  return base || "Drawing";
}
