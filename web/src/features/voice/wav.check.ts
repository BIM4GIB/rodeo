// Checks the WAV encoder (wav.ts) in node: cd web && npx tsx src/features/voice/wav.check.ts
// The header is read back field by field with a DataView, the way the server reads it, so a wrong
// offset or byte order shows here rather than as the server's refusal.

import { base64Of, wavBytes, wavSeconds } from "./wav.ts";

let failures = 0;

/** Prints one line for a check and counts it when it fails. */
function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

/** The four bytes at `at` as text, for the RIFF, WAVE, fmt and data tags. */
function tagAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

/** Runs every WAV case; returns the failure count. */
export function checkWav(): number {
  failures = 0;

  // one second of silence: the whole canonical header, field by field
  const second = wavBytes(new Float32Array(16000));
  const v = new DataView(second.buffer, second.byteOffset, second.byteLength);
  expect("one second: 32,044 bytes", second.length === 32044, String(second.length));
  expect("one second: wavSeconds is 1", wavSeconds(second) === 1, String(wavSeconds(second)));
  const fields: readonly [string, unknown, unknown][] = [
    ["RIFF tag", tagAt(second, 0), "RIFF"],
    ["RIFF size", v.getUint32(4, true), 32036],
    ["WAVE tag", tagAt(second, 8), "WAVE"],
    ["fmt tag", tagAt(second, 12), "fmt "],
    ["fmt size", v.getUint32(16, true), 16],
    ["PCM format", v.getUint16(20, true), 1],
    ["mono", v.getUint16(22, true), 1],
    ["sample rate", v.getUint32(24, true), 16000],
    ["byte rate", v.getUint32(28, true), 32000],
    ["block align", v.getUint16(32, true), 2],
    ["bits per sample", v.getUint16(34, true), 16],
    ["data tag", tagAt(second, 36), "data"],
    ["data size", v.getUint32(40, true), 32000],
  ];
  for (const [label, got, want] of fields) {
    expect(`header ${label}`, got === want, got === want ? String(got) : `want ${want}, got ${got}`);
  }

  // samples are clamped to -1..1 and scaled to 16-bit, the negative side to -32768
  const clip = wavBytes(new Float32Array([1, -1, 0.5, -0.5, 2, -2, 0]));
  const cv = new DataView(clip.buffer, clip.byteOffset, clip.byteLength);
  const samples = Array.from({ length: 7 }, (_, i) => cv.getInt16(44 + i * 2, true));
  const wantSamples = [32767, -32768, 16383, -16384, 32767, -32768, 0];
  expect("samples to int16", samples.join(" ") === wantSamples.join(" "), samples.join(" "));

  // the server's 30 s cap is measured on these numbers
  const half = wavBytes(new Float32Array(480000));
  expect("30 s: 960,044 bytes", half.length === 960044, String(half.length));
  expect("30 s: base64 1,280,060 characters", base64Of(half).length === 1280060, String(base64Of(half).length));
  expect("30 s: wavSeconds is 30", wavSeconds(half) === 30, String(wavSeconds(half)));

  // anything that isn't a canonical 16 kHz mono 16-bit WAV is refused as not one
  const stereo = wavBytes(new Float32Array(16000));
  new DataView(stereo.buffer).setUint16(22, 2, true);
  expect("2 channels: null", wavSeconds(stereo) === null);
  const odd = wavBytes(new Float32Array(16000)).slice(0, 32043);
  expect("odd length: null", wavSeconds(odd) === null);
  const low = wavBytes(new Float32Array(8000), 8000);
  expect("8,000 Hz file read as 16 kHz: null", wavSeconds(low) === null);
  expect("8,000 Hz file read at 8,000 Hz: 1 s", wavSeconds(low, 8000) === 1, String(wavSeconds(low, 8000)));
  expect("43 bytes: null", wavSeconds(new Uint8Array(43)) === null);

  // base64 for the request body, and a long one that goes in slices
  const small = base64Of(new Uint8Array([0, 1, 2, 253, 254, 255]));
  expect("base64 of 00 01 02 fd fe ff", small === "AAEC/f7/", small);
  const big = new Uint8Array(100000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 7919) % 256;
  const back = Buffer.from(base64Of(big), "base64");
  expect("100,000 bytes round-trip", back.length === big.length && big.every((b, i) => back[i] === b), `${back.length} bytes`);

  return failures;
}

if (process.argv[1]?.endsWith("wav.check.ts")) {
  const count = checkWav();
  console.log(count === 0 ? "\nall checks passed" : `\n${count} check(s) failed`);
  process.exit(count > 0 ? 1 : 0);
}
