// Radiance HDR (.hdr, RGBE) files, as File > Export > Export HDRI… writes them: the linear picture,
// each pixel as three 8-bit mantissas sharing an 8-bit exponent, in the new run-length encoding
// (each scanline's four channels coded apart, runs of a byte as a count and the byte, the rest as
// literal stretches), top row first. A scanline under 8 or over 32,767 pixels wide is written flat,
// as the format asks.

/** The header Radiance and every reader of .hdr files expect, for a picture of `width` × `height`. */
function header(width: number, height: number): string {
  return `#?RADIANCE\n# Made by Rodeo\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
}

/** One pixel's RGBE bytes into `out` at `at`: the largest channel's exponent shared by all three. */
function rgbe(r: number, g: number, b: number, out: Uint8Array, at: number): void {
  const v = Math.max(r, g, b);
  if (!(v > 1e-32) || !Number.isFinite(v)) {
    out[at] = out[at + 1] = out[at + 2] = out[at + 3] = 0;
    return;
  }
  // v = m · 2^e with m in [0.5, 1)
  let e = Math.ceil(Math.log2(v));
  let scale = 256 / 2 ** e;
  // log2 rounding may leave v·scale at 256: one more step of exponent
  if (v * scale >= 256) {
    e += 1;
    scale /= 2;
  }
  if (e < -127) {
    out[at] = out[at + 1] = out[at + 2] = out[at + 3] = 0;
    return;
  }
  if (e > 127) {
    out[at] = out[at + 1] = out[at + 2] = 255;
    out[at + 3] = 255;
    return;
  }
  out[at] = Math.max(0, Math.floor(r * scale));
  out[at + 1] = Math.max(0, Math.floor(g * scale));
  out[at + 2] = Math.max(0, Math.floor(b * scale));
  out[at + 3] = e + 128;
}

/** The run-length coding of one channel of a scanline, appended to `out`. */
function encodeChannel(bytes: Uint8Array, out: number[]): void {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    // the next run of at least 4 alike, within reach
    let runStart = i;
    let run = 0;
    while (runStart < n) {
      run = 1;
      while (run < 127 && runStart + run < n && bytes[runStart + run] === bytes[runStart]) run++;
      if (run >= 4) break;
      runStart += run;
    }
    if (runStart >= n) {
      runStart = n;
      run = 0;
    }
    // the bytes before it, as literal stretches of up to 128
    while (i < runStart) {
      const count = Math.min(128, runStart - i);
      out.push(count);
      for (let k = 0; k < count; k++) out.push(bytes[i + k]);
      i += count;
    }
    if (run >= 4) {
      out.push(128 + run, bytes[runStart]);
      i = runStart + run;
    }
  }
}

/** Writes a .hdr file a scanline at a time, top row first, so a big picture needn't be in memory at once as floats. */
export class HdrWriter {
  private readonly parts: Uint8Array[];
  private readonly line: Uint8Array;
  private readonly channel: Uint8Array;
  private rows = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) throw new Error("a picture is a whole number of pixels a side");
    this.parts = [new TextEncoder().encode(header(width, height))];
    this.line = new Uint8Array(width * 4);
    this.channel = new Uint8Array(width);
  }

  /** The next scanline: `width` RGBA floats of `pixels` from `offset` (alpha ignored; negative and non-finite values black). */
  row(pixels: Float32Array, offset: number): void {
    if (this.rows >= this.height) throw new Error("the picture has all its rows");
    const { width, line, channel } = this;
    for (let x = 0; x < width; x++) {
      const p = offset + x * 4;
      rgbe(pixels[p], pixels[p + 1], pixels[p + 2], line, x * 4);
    }
    this.rows++;
    if (width < 8 || width > 32767) {
      this.parts.push(line.slice());
      return;
    }
    const out: number[] = [2, 2, width >> 8, width & 255];
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < width; x++) channel[x] = line[x * 4 + c];
      encodeChannel(channel, out);
    }
    this.parts.push(Uint8Array.from(out));
  }

  /** The file, once every row is in. */
  finish(): Blob {
    if (this.rows !== this.height) throw new Error(`the picture has ${this.rows} of its ${this.height} rows`);
    return new Blob(this.parts as BlobPart[], { type: "image/vnd.radiance" });
  }
}

/** A .hdr file of a linear RGBA float picture `pixels` (`width` × `height`, top row first). */
export function encodeHdr(pixels: Float32Array, width: number, height: number): Blob {
  if (pixels.length < width * height * 4) throw new Error("the picture is smaller than its size says");
  const writer = new HdrWriter(width, height);
  for (let y = 0; y < height; y++) writer.row(pixels, y * width * 4);
  return writer.finish();
}
