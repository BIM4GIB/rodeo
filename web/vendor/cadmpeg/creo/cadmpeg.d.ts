/* tslint:disable */
/* eslint-disable */

/**
 * A converted document: the STEP bytes and what the conversion reported.
 */
export class Converted {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * cadmpeg's id of the format that was read, such as `sldprt`.
     */
    readonly format: string;
    /**
     * The headline read level of the format in cadmpeg's support ladder (`L<level>`), or 0.
     */
    readonly level: number;
    /**
     * The STEP file, as written.
     */
    readonly step: Uint8Array;
    /**
     * A JSON array of strings: decode losses (`decode: ...`), check findings of warning
     * severity or more (`check: ...`), error findings carried into the output, and export
     * losses (`export: ...`).
     */
    readonly warnings: string;
}

/**
 * Converts a CAD file to STEP in memory, as `cadmpeg convert <file> -f step --allow-errors`
 * does: the format is detected from the bytes, the decode runs at the depth STEP needs, the
 * check runs, and the file is written whatever the check finds. `file_name` appears only in
 * error messages, since detection reads the bytes and never the name.
 */
export function to_step(bytes: Uint8Array, file_name: string): Converted;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_converted_free: (a: number, b: number) => void;
    readonly converted_format: (a: number, b: number) => void;
    readonly converted_level: (a: number) => number;
    readonly converted_step: (a: number, b: number) => void;
    readonly converted_warnings: (a: number, b: number) => void;
    readonly to_step: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
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
