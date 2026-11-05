// 16 kHz mono 16-bit PCM WAV for the voice commands Rodeo's server turns into text (record.ts),
// and base64 for the request. DOM-free, so wav.check.ts runs it in node.

/** The sample rate the server takes. */
export const WAV_RATE = 16_000;
/** A canonical WAV header: the RIFF, fmt and data chunks' heads. */
export const WAV_HEADER = 44;

/** `samples` (-1 to 1) as a 16-bit mono WAV file at `rate`. */
export function wavBytes(samples: Float32Array, rate = WAV_RATE): Uint8Array {
  const out = new Uint8Array(WAV_HEADER + samples.length * 2);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(WAV_HEADER + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** The seconds a canonical 16-bit mono WAV at `rate` holds; null when `bytes` isn't one. */
export function wavSeconds(bytes: Uint8Array, rate = WAV_RATE): number | null {
  if (bytes.length < WAV_HEADER || (bytes.length - WAV_HEADER) % 2 !== 0) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const ok =
    tag(0) === "RIFF" &&
    v.getUint32(4, true) === bytes.length - 8 &&
    tag(8) === "WAVE" &&
    tag(12) === "fmt " &&
    v.getUint16(20, true) === 1 &&
    v.getUint16(22, true) === 1 &&
    v.getUint32(24, true) === rate &&
    v.getUint16(34, true) === 16 &&
    tag(36) === "data" &&
    v.getUint32(40, true) === bytes.length - WAV_HEADER;
  return ok ? (bytes.length - WAV_HEADER) / (rate * 2) : null;
}

/** `bytes` as base64, in slices so a long recording doesn't overflow the call stack. */
export function base64Of(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
