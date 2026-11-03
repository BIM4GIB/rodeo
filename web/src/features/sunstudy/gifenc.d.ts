// gifenc (1.0.3) ships without type declarations. These are the parts Sun Study uses; the
// signatures follow the package's README.
declare module "gifenc" {
  export type Palette = number[][];
  export type PixelFormat = "rgb565" | "rgb444" | "rgba4444";

  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: PixelFormat }): Palette;

  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: PixelFormat): Uint8Array;

  export interface FrameOptions {
    palette?: Palette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** frame time in milliseconds */
    delay?: number;
    /** -1 plays once, 0 forever, a positive number repeats that many times */
    repeat?: number;
  }

  export interface GIFEncoderStream {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GIFEncoderStream;
}
