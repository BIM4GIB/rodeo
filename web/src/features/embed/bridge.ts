// The messages between an embed and the page that frames it, and the layer lookups the embed and
// its host both use. Messages are plain objects marked rodeo: 1. The viewer reads only the four
// host messages below and sends only the four viewer messages. DOM-free, so the check runs in node.

import type { ViewPreset } from "../../app/view3d.ts";
import { type EmbedView, VIEW_PRESETS } from "./options.ts";

/** A command from the host page: change the view, fit, turn, or show a layer or sheet. */
export type HostMessage =
  | { readonly type: "setView"; readonly view: EmbedView; readonly preset: ViewPreset | null }
  | { readonly type: "fit" }
  | { readonly type: "rotate"; readonly on: boolean }
  | { readonly type: "layer"; readonly layer: string };

/** One object the viewer reports as selected. */
export interface SelectedObject {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly layer: string;
  readonly className: string;
}

/** A layer or sheet as the host page hears of it in `ready`. */
export interface ReadyLayer {
  readonly id: string;
  readonly name: string;
  readonly kind: "design" | "sheet";
}

/** A message from the viewer to the host page. */
export type ViewerMessage =
  | { readonly type: "ready"; readonly name: string; readonly owner: string | null; readonly view: EmbedView; readonly layers: readonly ReadyLayer[] }
  | { readonly type: "view"; readonly view: EmbedView }
  | { readonly type: "selection"; readonly objects: readonly SelectedObject[] }
  | { readonly type: "error"; readonly message: string };

/** The shape of a layer the lookups need (LayerInfo fits it). */
export interface LayerLike {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly kind: "design" | "sheet";
  readonly visibility: string;
}

/** The longest layer or sheet name a host may send; a longer one is cut. */
const MAX_LAYER = 200;

/** A host page's message, or null for anything that isn't one (wrong shape, missing rodeo: 1). */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.rodeo !== 1) return null;
  switch (m.type) {
    case "setView": {
      if (m.view !== "2d" && m.view !== "3d") return null;
      // the preset is matched without regard to case, as the address's preset is
      const wanted = typeof m.preset === "string" ? m.preset.toLowerCase() : null;
      const preset = VIEW_PRESETS.find((p) => p.toLowerCase() === wanted) ?? null;
      return { type: "setView", view: m.view, preset };
    }
    case "fit":
      return { type: "fit" };
    case "rotate":
      return typeof m.on === "boolean" ? { type: "rotate", on: m.on } : null;
    case "layer": {
      if (typeof m.layer !== "string") return null;
      // counted in characters, as the address's layer is, so a name is never cut in the middle of one
      const layer = Array.from(m.layer.trim()).slice(0, MAX_LAYER).join("");
      return layer === "" ? null : { type: "layer", layer };
    }
    default:
      return null;
  }
}

/** A message for the host page, marked as Rodeo's. */
export function outgoing(m: ViewerMessage): ViewerMessage & { readonly rodeo: 1 } {
  return { ...m, rodeo: 1 };
}

/** The layer an address or host names: by id, a design layer's name, a sheet's number, then a sheet's title (names case-insensitive). */
export function findLayer(layers: readonly LayerLike[], wanted: string): LayerLike | null {
  const text = wanted.trim();
  if (text === "") return null;
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  return (
    layers.find((l) => l.id === text) ??
    layers.find((l) => l.kind === "design" && same(l.name, text)) ??
    layers.find((l) => l.kind === "sheet" && same(l.name, text)) ??
    layers.find((l) => l.kind === "sheet" && same(l.title, text)) ??
    null
  );
}

/** A sheet's label in the picker: its number and its title ("A-101 Ground Floor"), or just the number. */
function sheetLabel(l: LayerLike): string {
  return [l.name, l.title].filter((part) => part !== "").join(" ") || "Sheet";
}

/** The picker's entries: design layers that aren't hidden, then every sheet ("A-101 Ground Floor Plan"). */
export function layerChoices(layers: readonly LayerLike[]): { readonly id: string; readonly label: string }[] {
  const design = layers.filter((l) => l.kind === "design" && l.visibility !== "hidden");
  const sheets = layers.filter((l) => l.kind === "sheet");
  return [...design, ...sheets].map((l) => ({ id: l.id, label: l.kind === "sheet" ? sheetLabel(l) : l.name }));
}
