/* tslint:disable */
/* eslint-disable */

/**
 * The report of the previous `xt_mesh` call, as JSON:
 * `{"faces", "tessellated", "refused", "triangles", "reasons"}`. `reasons` holds one
 * `"face <id>: <reason>"` string per refused face, up to 200, then `"... N more"`.
 */
export function xt_last_report(): string;

/**
 * Tessellates every face of one bare Parasolid stream (`PS` signature first).
 *
 * `chord_rel` is the largest chordal deviation as a fraction of the model's bounding-box
 * diagonal; `angle_deg` is the largest normal angle, in degrees, between neighbouring
 * vertices of one triangle. `max_triangles` caps the work: a face stops refining at
 * `max(64, max_triangles / (2 * faces in its body))` vertices, and the call fails as soon as
 * the running total passes `max_triangles`. Returns the corners of every triangle as flat x,
 * y, z numbers, nine per triangle, in millimetres. Faces the tessellator refuses are skipped
 * and listed in `xt_last_report`. Fails when the stream does not decode, no face tessellates,
 * or the total passes `max_triangles`.
 */
export function xt_mesh(bytes: Uint8Array, chord_rel: number, angle_deg: number, max_triangles: number): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly xt_last_report: (a: number) => void;
    readonly xt_mesh: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
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
