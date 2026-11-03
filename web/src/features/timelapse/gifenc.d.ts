// gifenc ships without type declarations: the parts the timelapse uses.
declare module "gifenc" {
  export interface GifFrameOptions {
    palette?: number[][];
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** milliseconds the frame shows */
    delay?: number;
    repeat?: number;
    dispose?: number;
  }

  export interface GifStream {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GifStream;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: string }): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
}
