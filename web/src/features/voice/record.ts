// Voice commands through Rodeo's server, for browsers with no speech recognition of their own
// (Firefox) or whose service fails (Brave): while the key is held the microphone is recorded in
// this browser; on letting go the recording is made 16 kHz mono WAV and sent to
// POST /api/voice/transcribe, which has an AI model write down what was said. There are no words
// until then. A Recorder has the shape of listen.ts's Listener, so the controller drives either.

import type { VoiceCharge, VoiceTranscribeRequest, VoiceTranscript } from "../../platform/protocol.ts";
import type { Heard, ListenError, ListenHandlers } from "./listen.ts";
import { base64Of, WAV_RATE, wavBytes } from "./wav.ts";

/** What went wrong: listen.ts's kinds, and the server's sign-in and credit refusals. */
export type RecordError = ListenError | "credit" | "signin";
/** What the recorder tells the controller: the listener's callbacks, its errors, and the upload starting. */
export interface RecordHandlers extends Omit<ListenHandlers, "error"> {
  error(kind: RecordError, message: string): void;
  /** the recording is on its way to the server: there are no words until it answers */
  transcribing(): void;
}
/** How one listening runs. `hints` (the drawing's names) go to the server's model; the browser's recogniser ignores them. */
export interface HearOptions {
  readonly lang: string;
  readonly onDevice: boolean;
  readonly meter: boolean;
  readonly hints: readonly string[];
}
/** What the controller drives: the browser's recogniser (listen.ts) or the server's (this file). */
export interface Hearing {
  readonly active: boolean;
  readonly heardSomething: boolean;
  start(opts: HearOptions): void;
  finish(): Promise<Heard>;
  abort(): void;
}

/** A recording shorter than this is a tap, not a command: nothing is sent. */
const MIN_MS = 400;
/** A recording this short that won't decode is taken as one that stopped before any sound was encoded. */
const SHORT_MS = 1500;
/** The loudness (RMS) a recording must reach somewhere to count as speech; quieter is silence, and isn't sent. */
const VOICE_RMS = 0.02;
/** The meter's frame, ms (about 30 a second). */
const LEVEL_MS = 33;
/** The longest recording sent, seconds: the controller sends at 30 s, and this covers the stop. */
const MAX_SECONDS = 30.5;
const NOTHING: Heard = { final: "", interim: "", alternatives: [] };

/** A refusal or failure to show: its kind and its sentence. */
class RecordFailure extends Error {
  readonly kind: RecordError;
  constructor(kind: RecordError, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** The microphone could not open: the kind and the sentence. */
function micError(err: unknown): [RecordError, string] {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return ["denied", "Rodeo can't use the microphone. Allow it in the browser's site settings, then try again."];
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return ["no-mic", "No microphone was found."];
  if (name === "NotReadableError") return ["no-mic", "The microphone is in use by another app, or couldn't be opened."];
  return ["other", `The microphone couldn't start${name ? `: ${name}` : ""}.`];
}

/** A recording in whatever the browser recorded (Ogg or WebM Opus, MP4) as 16 kHz mono WAV, at most 30.5 s. */
export async function toWav16k(recording: Blob): Promise<Uint8Array> {
  const encoded = await recording.arrayBuffer();
  // decodeAudioData resamples to its context's rate, so this decodes straight to 16 kHz
  const decoded = await new OfflineAudioContext(1, 1, WAV_RATE).decodeAudioData(encoded);
  const length = Math.min(decoded.length, Math.round(MAX_SECONDS * WAV_RATE));
  const mono = new Float32Array(length);
  const channels = decoded.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }
  return wavBytes(mono, WAV_RATE);
}

/** Sends a recording to the server; resolves with its words and charge, throws RecordFailure when it can't. */
async function transcribe(req: VoiceTranscribeRequest, signal: AbortSignal): Promise<VoiceTranscript> {
  let res: Response;
  try {
    res = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "X-Requested-With": "openvwx", "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new RecordFailure("network", "Rodeo's server couldn't be reached. Check the connection and try again.");
  }
  let body: { text?: unknown; charged?: unknown; balance?: unknown; error?: unknown; code?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // not JSON: the status alone
  }
  if (res.ok) {
    return {
      text: typeof body.text === "string" ? body.text : "",
      charged: typeof body.charged === "number" ? body.charged : null,
      balance: typeof body.balance === "number" ? body.balance : null,
    };
  }
  const said = typeof body.error === "string" ? body.error : `Rodeo's speech to text failed (${res.status}).`;
  if (res.status === 401) throw new RecordFailure("signin", "Sign in to use voice commands.");
  if (res.status === 402 || body.code === "credit") throw new RecordFailure("credit", said);
  throw new RecordFailure("service", said);
}

/**
 * One listening through Rodeo's server: the microphone recorded and metered from start until
 * finish, then turned into words by the server. abort() drops it at any point, the upload too.
 */
export class Recorder implements Hearing {
  private readonly handlers: RecordHandlers;
  private stream: MediaStream | null = null;
  private media: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audio: AudioContext | null = null;
  private frame = 0;
  private frames = 0;
  private peak = 0;
  private startedAt = 0;
  private opts: HearOptions | null = null;
  /** bumped by each start and abort, so a microphone or an answer that comes late is dropped */
  private run = 0;
  private live = false;
  private stopping = false;
  private upload: AbortController | null = null;
  private lastCharge: VoiceCharge | null = null;

  constructor(handlers: RecordHandlers) {
    this.handlers = handlers;
  }

  /** True from start until the words come back, or abort. */
  get active(): boolean {
    return this.live;
  }

  /** The microphone has heard something louder than silence. */
  get heardSomething(): boolean {
    return this.peak >= VOICE_RMS;
  }

  /** What the last recording was charged and the balance left (null before one, or when the server didn't say). */
  get charge(): VoiceCharge | null {
    return this.lastCharge;
  }

  start(opts: HearOptions): void {
    this.abort();
    const my = ++this.run;
    this.opts = opts;
    this.live = true;
    this.lastCharge = null;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      this.live = false;
      this.handlers.error("unsupported", "This browser can't record from the microphone here.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
      .then((stream) => {
        // stopped, or started again, while the microphone was opening: let it go at once
        if (my !== this.run || this.stopping) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        this.stream = stream;
        const media = new MediaRecorder(stream);
        this.media = media;
        media.ondataavailable = (e) => {
          if (e.data.size > 0) this.chunks.push(e.data);
        };
        for (const t of stream.getAudioTracks()) {
          t.onended = () => {
            if (my === this.run && !this.stopping) this.fail("no-mic", "The microphone stopped.");
          };
        }
        this.startedAt = performance.now();
        media.start();
        this.meter(stream, my);
        this.handlers.audio();
      })
      .catch((err: unknown) => {
        if (my !== this.run) return;
        const [kind, message] = micError(err);
        this.fail(kind, message);
      });
  }

  async finish(): Promise<Heard> {
    const my = this.run;
    this.stopping = true;
    const media = this.media;
    if (!media || !this.live) {
      this.release();
      this.live = false;
      return NOTHING;
    }
    if (media.state !== "inactive") {
      const stopped = new Promise<void>((resolve) => media.addEventListener("stop", () => resolve(), { once: true }));
      media.stop();
      await stopped;
    }
    const took = performance.now() - this.startedAt;
    const recording = new Blob(this.chunks, { type: media.mimeType });
    // no meter frames (a hidden tab) can't say it was silent, so it counts as speech
    const voiced = this.peak >= VOICE_RMS || this.frames < 3;
    // the meter heard sound for certain (not just "can't tell")
    const heardSound = this.peak >= VOICE_RMS && this.frames >= 3;
    // the microphone goes off before the upload: its light shouldn't stay on while the server works
    this.release();
    if (my !== this.run) return NOTHING;
    if (took < MIN_MS || !voiced || recording.size === 0) {
      this.live = false;
      return NOTHING;
    }
    this.handlers.transcribing();
    const upload = new AbortController();
    this.upload = upload;
    try {
      let wav: Uint8Array;
      try {
        wav = await toWav16k(recording);
      } catch (err) {
        // a short hold can stop before the browser encodes any sound: a container header and no
        // audio, which can't be decoded. That isn't a broken recording: if the meter heard the
        // person, they began speaking before the recorder was going, so they're asked to hold longer
        if (took >= SHORT_MS) throw err;
        if (heardSound && my === this.run) this.handlers.error("other", "Rodeo didn't catch that. Keep holding the key a moment longer as you speak.");
        return NOTHING;
      }
      if (my !== this.run) return NOTHING;
      const got = await transcribe({ audio: base64Of(wav), lang: this.opts?.lang ?? "", hints: this.opts?.hints ?? [] }, upload.signal);
      if (my !== this.run) return NOTHING;
      this.lastCharge = { charged: got.charged, balance: got.balance };
      const text = got.text.trim();
      return { final: text, interim: "", alternatives: text ? [text] : [] };
    } catch (err) {
      if (my !== this.run || upload.signal.aborted) return NOTHING;
      if (err instanceof RecordFailure) this.handlers.error(err.kind, err.message);
      else this.handlers.error("service", "The recording couldn't be read. Try again.");
      return NOTHING;
    } finally {
      if (this.upload === upload) this.upload = null;
      if (my === this.run) this.live = false;
    }
  }

  abort(): void {
    this.run++;
    this.upload?.abort();
    this.upload = null;
    this.release();
    this.live = false;
    this.stopping = false;
    this.chunks = [];
    this.peak = 0;
    this.frames = 0;
  }

  /** Stops and reports a failure of the microphone. */
  private fail(kind: RecordError, message: string): void {
    this.abort();
    this.handlers.error(kind, message);
  }

  /** The level meter on the recorded stream: the ring's halo, and the loudest moment, for "was anything said". */
  private meter(stream: MediaStream, my: number): void {
    try {
      const ctx = new AudioContext();
      this.audio = ctx;
      void ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let level = 0;
      let last = 0;
      const tick = (now: number): void => {
        if (my !== this.run || this.stopping) return;
        this.frame = requestAnimationFrame(tick);
        if (now - last < LEVEL_MS) return;
        last = now;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const x of samples) sum += x * x;
        const rms = Math.sqrt(sum / samples.length);
        this.frames++;
        if (rms > this.peak) this.peak = rms;
        // smoothed, so the ring swells and settles instead of flickering
        level = level * 0.6 + Math.min(1, rms * 4) * 0.4;
        this.handlers.level(level);
      };
      this.frame = requestAnimationFrame(tick);
    } catch {
      // no meter: the recording counts as speech
      this.peak = VOICE_RMS;
    }
  }

  /** Lets go of the microphone, the recorder and the meter. */
  private release(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.media && this.media.state !== "inactive") {
      try {
        this.media.stop();
      } catch {
        // already stopped
      }
    }
    this.media = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.audio?.close().catch(() => {});
    this.audio = null;
  }
}
