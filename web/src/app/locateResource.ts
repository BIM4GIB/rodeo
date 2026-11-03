// The right-click menu's Locate [resource] in Resource Manager, as Vectorworks has it: for an
// object that uses one of the drawing's resources (a symbol instance its definition, a worksheet
// image its worksheet, a fill its hatch, gradient, tile or image fill, a pen its line type, a text
// its text style, a 3D object its texture), the Resources palette shown with that resource's tile
// selected and scrolled to, its search and kind filter cleared and its folder opened
// (panels/resources.ts). A symbol becomes the one the Symbol tool places, as choosing its tile
// makes it, without switching tools. One row for each resource the object uses.

import type { ResourceKind } from "../core/index.ts";
import { store } from "./state.ts";

/** A resource an object uses: its kind and name-table index. */
export interface UsedResource {
  readonly kind: ResourceKind;
  readonly index: number;
}

/** Each resource kind's name in the command, as Vectorworks words it. */
export const RESOURCE_NAME: Readonly<Record<ResourceKind, string>> = {
  symbol: "Symbol",
  texture: "Texture",
  hatch: "Hatch",
  tile: "Tile",
  gradient: "Gradient",
  "image-fill": "Image Fill",
  material: "Material",
  "wall-style": "Wall Style",
  "slab-style": "Slab Style",
  "roof-style": "Roof Style",
  "line-type": "Line Type",
  "text-style": "Text Style",
  "render-style": "Render Style",
  background: "Background",
  worksheet: "Worksheet",
  "record-format": "Record Format",
};

const FILLS: readonly ResourceKind[] = ["hatch", "gradient", "tile", "image-fill"];

/** The resources object `id` uses that the Resources palette lists, in the order its rows go. */
export function resourcesOf(id: string | null): UsedResource[] {
  const doc = store.session?.doc;
  const o = id === null ? null : doc?.object(id);
  if (!doc || !o) return [];
  const listed = doc.resources();
  const found = (index: number, kinds: readonly ResourceKind[]): UsedResource[] => {
    const r = listed.find((x) => x.index === index && kinds.includes(x.kind));
    return r ? [{ kind: r.kind, index: r.index }] : [];
  };
  const used: UsedResource[] = [];
  if (o.symbol !== undefined) used.push({ kind: "symbol", index: o.symbol });
  if (o.worksheet !== undefined) used.push(...found(o.worksheet, ["worksheet"]));
  // fill patterns and line styles select a resource as its index made negative
  if (o.attrs && o.attrs.fillPattern < 0) used.push(...found(-o.attrs.fillPattern, FILLS));
  if (o.attrs && o.attrs.lineStyle < 0) used.push(...found(-o.attrs.lineStyle, ["line-type"]));
  const style = o.shape?.textStyle;
  if (style !== undefined && style > 0) used.push(...found(style, ["text-style"]));
  const texture = doc.objectTextures(o.id)?.find((p) => p.texture > 0)?.texture;
  if (texture !== undefined) used.push(...found(texture, ["texture"]));
  return used;
}

/** The Resources palette's handler, while it is mounted: true when it found and selected the tile. */
let locator: ((r: UsedResource) => boolean) | null = null;

export function setResourceLocator(fn: ((r: UsedResource) => boolean) | null): void {
  locator = fn;
}

/** Locate in Resource Manager: `r`'s tile selected in the Resources palette, shown first by `show`. */
export function locateResource(r: UsedResource, show: () => void): void {
  show();
  locator?.(r);
}
