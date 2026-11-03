/* tslint:disable */
/* eslint-disable */

/**
 * Build the scene-graph tree for a model.
 */
export function buildSceneGraph(model: any): any;

/**
 * Build a flat schedule table of every BuildingElement.
 */
export function buildSchedule(model: any): any;

/**
 * Distinct IFC types in the scene — source of truth for the
 * layer-toggle UI.
 */
export function distinctIfcTypes(scene: any): any;

/**
 * Populate the element info panel for a click target.
 */
export function elementInfoPanel(model: any, entity_index: number): any;

/**
 * Document identity — release, worksharing, central model, last saved
 * (time and user), document GUID, save counter, and every
 * `BasicFileInfo` `Key: value` line — as a
 * [`rvt::metadata::FileMetadata`] JS object. Reads only the two
 * identity streams straight from `bytes` (no copy of the file), so it
 * returns instantly on any file size. Errors when `bytes` is not a
 * readable Revit file.
 */
export function fileMetadata(bytes: Uint8Array): any;

/**
 * Render `model` as a glTF 2.0 binary. Returns a `Uint8Array`
 * the frontend feeds into Three.js's `GLTFLoader`.
 */
export function modelToGlb(model: any): Uint8Array;

/**
 * Render `model` as an IFC4 STEP document. Returns the ISO-10303-21
 * text; callers wrap it in a Blob for download.
 */
export function modelToIfcStep(model: any): string;

/**
 * Open an RVT / RFA byte slice with an IFC export quality mode and
 * return `{ model, diagnostics }`.
 *
 * `mode` is one of `scaffold`, `typed-no-geometry`, `geometry`, or
 * `strict`. Stronger modes fail closed when the decoded
 * coverage cannot satisfy the requested bar — the viewer uses this to
 * surface honest confidence rather than over-claiming geometry.
 *
 * Doors and windows are drawn from the meshes Revit saved for them, as
 * `rvt-ifc` does by default, on Revit 2023 to 2027 files.
 */
export function openRvtBytesWithDiagnosticsMode(bytes: Uint8Array, mode: string): any;

/**
 * [`open_rvt_bytes_with_diagnostics_mode`] under the resource limits of
 * `limits`, a JS object
 * `{ largeModel?, maxStreamBytes?, maxInflateBytes?, savedMeshes? }` or
 * `null` for the defaults. A field left out keeps its default; the first
 * three are `rvt-ifc`'s flags of the same names, resolved by
 * [`rvt::cli::open_limits`] (`largeModel` is `--large-model`, and an
 * explicit byte limit wins over it):
 *
 * - `largeModel: true` reads streams up to 2 GiB and lets a stream inflate
 *   up to the 4 GiB a wasm32 address space holds (`rvt-ifc` gives 8 GiB on
 *   a 64-bit host), and lifts the walker's scan cap the same way.
 * - `maxStreamBytes` caps one stream as stored; a larger stream is not read.
 * - `maxInflateBytes` caps one gzip member's inflated size; a stream's
 *   members together may inflate to this or 1 GiB, whichever is larger.
 *   A value past what a 32-bit `usize` holds saturates at 4 GiB minus 1.
 * - `savedMeshes` (default `true`) draws the doors and windows of Revit 2023
 *   to 2027 files from the meshes Revit saved for them, as `rvt-ifc` does
 *   without `--no-saved-meshes`; `false` keeps their bounding boxes and
 *   skips the extra pass over the file's saved graphics.
 *
 * Byte limits are whole numbers of bytes. A stream a limit keeps from being
 * read is listed in `diagnostics` (the `stream_not_read_resource_limit`
 * skipped item and a `Not read whole:` warning per stream, #1075), and the
 * model is missing what it holds. Unknown fields and fractional, negative
 * or non-finite byte limits throw.
 */
export function openRvtBytesWithDiagnosticsModeAndOpenLimits(bytes: Uint8Array, mode: string, limits: any): any;

/**
 * Quick summary — reads only the cheap metadata (BasicFileInfo +
 * PartAtom + stream inventory) and returns instantly even for
 * multi-hundred-megabyte RFAs. Used by the viewer for the
 * progressive-loading splash before the full model parse
 * completes. Returns a [`rvt::reader::Summary`] as a JS object.
 */
export function quickSummary(bytes: Uint8Array): any;

/**
 * Render `model` as a 2D SVG plan view (sheet). Options control
 * dimensions + labels + background; pass `null` for defaults.
 */
export function renderPlanSvg(model: any, options: any): string;

/**
 * Spreadsheet schedule of an exported model as CSV
 * ([`rvt::ifc::schedule_csv`]): `kind` is `"elements"` (every building
 * element) or `"rooms"`; `metric` switches lengths to metres; `excel`
 * prefixes a UTF-8 byte-order mark so Excel on Windows reads non-ASCII
 * names correctly.
 */
export function scheduleCsv(model: any, kind: string, metric: boolean, excel: boolean): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly buildSceneGraph: (a: number, b: number) => void;
    readonly buildSchedule: (a: number, b: number) => void;
    readonly distinctIfcTypes: (a: number, b: number) => void;
    readonly elementInfoPanel: (a: number, b: number, c: number) => void;
    readonly fileMetadata: (a: number, b: number, c: number) => void;
    readonly modelToGlb: (a: number, b: number) => void;
    readonly modelToIfcStep: (a: number, b: number) => void;
    readonly openRvtBytesWithDiagnosticsMode: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly openRvtBytesWithDiagnosticsModeAndOpenLimits: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly quickSummary: (a: number, b: number, c: number) => void;
    readonly renderPlanSvg: (a: number, b: number, c: number) => void;
    readonly scheduleCsv: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
