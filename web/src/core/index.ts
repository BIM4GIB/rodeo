// Public entry point of the format library.
// openVwx() parses bytes and returns an EditSession (session.doc is the read view).

import { type ByteSource, readContainerStream, type StreamOptions } from "./container.ts";
import { Session } from "./edit.ts";
import { Model } from "./model.ts";
import type { EditSession } from "./types.ts";

export type * from "./types.ts";
export {
  blobSource,
  type ByteSource,
  bytesSource,
  type Deflate,
  deflateChunks,
  type Inflate,
  type StreamOptions,
  type VwxSink,
  type WriteOptions,
  type Written,
} from "./container.ts";
export { FileStream, HeldEntry, heldTables, withHeldImages } from "./held.ts";
export { clipboardHolds, expandClipboard } from "./edit.ts";
export { type FilletArc, filletArcs, imageBytes, polylineOutline, roundedRectPoints, TEXT_ASCENT, TEXT_LINE_HEIGHT, TEXT_STYLE_BY_CLASS, textTop } from "./geometry.ts";
export { BY_CLASS_KEYS, drawsPen, fillPatternBits } from "./attrs.ts";
export { withContainers } from "./model.ts";
export { isNarrowFont } from "./fonts.ts";
export { PLAN_VIEW } from "./layerView.ts";
export { markerPaths, type MarkerPath } from "./markers.ts";
export { shadowOffset } from "./shadow.ts";
export { companionUnits, LENGTH_UNITS } from "./settings.ts";
export { fieldKind, MAX_FIELD_NAME, newFieldsProblem } from "./params.ts";
export { setTurnSteps } from "./model3d.ts";

export function openVwx(bytes: Uint8Array, fileName = "untitled.vwx"): EditSession {
  return new Session(new Model(bytes, fileName));
}

/** openVwx for a drawing read a slice at a time (readContainerStream), however large its file. */
export async function openVwxStream(src: ByteSource, fileName = "untitled.vwx", options?: StreamOptions): Promise<EditSession> {
  return new Session(new Model(await readContainerStream(src, options), fileName));
}
