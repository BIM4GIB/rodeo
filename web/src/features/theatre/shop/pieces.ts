// The Scene Shop's pieces as the drawing keeps them: each flat or platform as a ShopPiece in the list under SHOP_KEY,
// and its details (the spec flats.ts works from) under "shop.specs" by the piece's id. The prices a cut list costs
// are under "shop.prices". All of it is show data, so it travels with the file and each change is one undo step.

import type { EditSession } from "../../../core/index.ts";
import { readShow, writeShowIn } from "../show.ts";
import { SHOP_KEY, type ShopPiece } from "../showTypes.ts";
import type { ShopSpec } from "./flats.ts";

export const SPECS_KEY = "shop.specs";
export const PRICES_KEY = "shop.prices";

export function shopPieces(): ShopPiece[] {
  return readShow<ShopPiece[]>(SHOP_KEY, []);
}

export function shopSpecs(): Record<string, ShopSpec> {
  return readShow<Record<string, ShopSpec>>(SPECS_KEY, {});
}

/** Prices by key: "stick:<length mm>" for a stock length, "sheet" for a sheet. */
export function shopPrices(): Record<string, number> {
  return readShow<Record<string, number>>(PRICES_KEY, {});
}

export function newPieceId(): string {
  const c = globalThis.crypto;
  return c && typeof c.randomUUID === "function" ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Adds a piece and its details, within the caller's batch. */
export function addPieceIn(s: EditSession, piece: ShopPiece, spec: ShopSpec): void {
  writeShowIn(s, SHOP_KEY, [...shopPieces(), piece]);
  writeShowIn(s, SPECS_KEY, { ...shopSpecs(), [piece.id]: spec });
}

/** Removes a piece and its details, within the caller's batch. The drawing it made stays where it is. */
export function removePieceIn(s: EditSession, id: string): void {
  writeShowIn(s, SHOP_KEY, shopPieces().filter((p) => p.id !== id));
  const specs = { ...shopSpecs() };
  delete specs[id];
  writeShowIn(s, SPECS_KEY, specs);
}

/** Sets how many of a piece are built, within the caller's batch. */
export function setCountIn(s: EditSession, id: string, count: number): void {
  writeShowIn(
    s,
    SHOP_KEY,
    shopPieces().map((p) => (p.id === id ? { ...p, count } : p)),
  );
}
