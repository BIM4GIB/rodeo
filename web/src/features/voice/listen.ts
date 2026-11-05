// Speech recognition in the browser, for voice commands. The Web Speech API stops by itself after
// a pause or a few seconds, so this keeps the recogniser going while the user holds the key: it
// restarts it, keeps the words heard so far, and turns the browser's error codes into sentences
// the user can act on. It also runs the level meter that makes the bubble's ring swell with the
// voice. No audio is recorded or kept here: the meter reads a stream that stays in this page and
// is stopped when listening ends.

/** What has been heard so far: final words, the words still being guessed, and the whole utterance's alternatives, best first. */
export interface Heard { readonly final: string; readonly interim: string; readonly alternatives: readonly string[] }
/** What went wrong with listening: the kind the voice UI words its card by. */
export type ListenError = "denied" | "no-mic" | "network" | "service" | "language" | "unsupported" | "other";
/** What the listener tells the voice controller as it happens. */
export interface ListenHandlers {
  /** the microphone is live */
  audio(): void;
  heard(h: Heard): void;
  /** the voice's loudness, 0 to 1, about 30 times a second while the meter runs */
  level(v: number): void;
  /** recognition ended by itself and could not go on (not after finish or abort) */
  ended(): void;
  error(kind: ListenError, message: string): void;
}
/** Chrome's on-device speech for one language: ready, needing a download, downloading, not offered, or the browser can't say. */
export type OnDevice = "available" | "downloadable" | "downloading" | "unavailable" | "unsupported";

/** The part of the browser's SpeechRecognition this file uses. lib.dom has its events but not the class. */
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
}

/** The recogniser's constructor, with the static checks Chrome 139 and later offer for on-device speech. */
type RecognitionClass = (new () => Recognition) & {
  available?(o: { langs: string[]; processLocally: boolean }): Promise<string>;
  install?(o: { langs: string[]; processLocally: boolean }): Promise<boolean>;
};

/** Restarts allowed in one listening, and the time after which the browser's own stop is final. */
const MAX_RESTARTS = 5;
const MAX_SPAN_MS = 30_000;
/** How long finish() waits for the browser's last result. */
const FINISH_MS = 1500;
/** The level meter's refresh: about 30 times a second. */
const LEVEL_MS = 33;
const NOTHING: Heard = { final: "", interim: "", alternatives: [] };

/** The on-device status last seen per language. Start reads it, so the answer is not waited for. */
const onDeviceSeen = new Map<string, OnDevice>();

/** The browser's recogniser class (unprefixed, or Chromium's webkit one), or null. */
function recogniserClass(): RecognitionClass | null {
  const w = window as unknown as Record<string, RecognitionClass | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Safari, not Chrome or Edge (they say Safari in their user agents too). */
function isSafari(): boolean {
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|CriOS/.test(ua);
}

/** True when this browser has speech recognition (SpeechRecognition or webkitSpeechRecognition). */
export function recognitionAvailable(): boolean {
  return recogniserClass() !== null;
}

/** Maps the browser's status word to ours; a word we don't know is "unavailable". */
function toStatus(s: string): OnDevice {
  return s === "available" || s === "downloadable" || s === "downloading" || s === "unavailable" ? s : "unavailable";
}

/** Whether `lang` can be recognised on this device (Chrome's on-device speech); "unsupported" where the browser can't say. */
export async function onDeviceStatus(lang: string): Promise<OnDevice> {
  const cls = recogniserClass();
  let status: OnDevice = "unsupported";
  if (cls?.available) {
    try {
      status = toStatus(await cls.available({ langs: [lang], processLocally: true }));
    } catch {
      status = "unsupported";
    }
  }
  onDeviceSeen.set(lang, status);
  return status;
}

/** Downloads on-device speech for `lang` (call from a click); true when it is ready. */
export async function installOnDevice(lang: string): Promise<boolean> {
  const cls = recogniserClass();
  let ready = false;
  if (cls?.install) {
    try {
      ready = await cls.install({ langs: [lang], processLocally: true });
    } catch {
      ready = false;
    }
  }
  // the settings show the new status, so the next listening can use it
  await onDeviceStatus(lang);
  return ready;
}

/** Asks for the microphone now (from a click) and lets it go at once; true when allowed. */
export async function warmMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    return true;
  } catch {
    return false;
  }
}

/** The finals of one recogniser run (each result's alternatives, best first) and the words still being guessed. */
function readResults(e: SpeechRecognitionEvent): { finals: string[][]; interim: string } {
  const finals: string[][] = [];
  let interim = "";
  for (let i = 0; i < e.results.length; i++) {
    const result = e.results[i];
    if (result.isFinal) finals.push(Array.from({ length: result.length }, (_, k) => result[k].transcript.trim()));
    else interim += ` ${result[0]?.transcript ?? ""}`;
  }
  return { finals, interim: interim.trim() };
}

/** The error kind and the sentence the user reads for a recogniser error code. */
function describe(code: string, lang: string): [ListenError, string] {
  switch (code) {
    case "not-allowed":
      return ["denied", "Rodeo can't use the microphone. Allow it in the browser's site settings, then try again."];
    case "service-not-allowed":
      return [
        "service",
        isSafari()
          ? "Turn on Dictation in System Settings › Keyboard so Safari can recognise speech."
          : "This browser's speech service is turned off.",
      ];
    case "audio-capture":
      return ["no-mic", "No microphone was found."];
    case "network":
      return [
        "network",
        "Speech recognition couldn't reach its service. Check the connection. Brave and some other Chromium browsers don't include it: try Chrome, Edge or Safari.",
      ];
    case "language-not-supported":
      return ["language", `Speech recognition doesn't know ${lang}. Pick another language in Tools › Voice Commands….`];
    default:
      return ["other", `Speech recognition stopped: ${code}.`];
  }
}

/**
 * Runs the microphone's level meter; the returned function stops it. Where the browser can't run
 * a second capture alongside the recogniser (Safari), there is no meter and the ring pulses by CSS.
 */
function levelMeter(onLevel: (v: number) => void): () => void {
  // no microphone API (an insecure page) means no meter, and no throw out of start()
  if (isSafari() || !navigator.mediaDevices?.getUserMedia) return () => {};
  let stopped = false;
  let frame = 0;
  let stream: MediaStream | null = null;
  let audio: AudioContext | null = null;
  const stop = (): void => {
    stopped = true;
    cancelAnimationFrame(frame);
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
    void audio?.close().catch(() => {});
    audio = null;
  };
  navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    .then((s) => {
      // stopped while the microphone was being opened: let it go at once
      if (stopped) {
        for (const t of s.getTracks()) t.stop();
        return;
      }
      stream = s;
      const ctx = new AudioContext();
      audio = ctx;
      void ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let level = 0;
      let last = 0;
      const tick = (now: number): void => {
        frame = requestAnimationFrame(tick);
        if (now - last < LEVEL_MS) return;
        last = now;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const x of samples) sum += x * x;
        const v = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        // smoothed, so the ring swells and settles instead of flickering
        level = level * 0.6 + v * 0.4;
        onLevel(level);
      };
      frame = requestAnimationFrame(tick);
    })
    .catch(() => {
      // refused or no microphone: no meter, and no error (the recogniser reports those)
    });
  return stop;
}

/**
 * One listening: the recogniser, restarted while it is wanted, and the level meter. Words come in
 * through the handlers; finish() ends it with the last words, abort() drops them.
 */
export class Listener {
  private readonly handlers: ListenHandlers;
  private rec: Recognition | null = null;
  private cls: RecognitionClass | null = null;
  private lang = "";
  /** on-device recognition for this listening, decided at start */
  private local = false;
  private startedAt = 0;
  private restarts = 0;
  /** the finals of the recogniser runs before this one, in this listening */
  private prior: string[][] = [];
  /** the finals of the current run */
  private finals: string[][] = [];
  private interim = "";
  private heardAny = false;
  /** finish() was called: the run is stopping and its last result is awaited */
  private stopping = false;
  /** a fatal error was reported: the run is not restarted */
  private failed = false;
  private finishing: Promise<Heard> | null = null;
  private settle: ((h: Heard) => void) | null = null;
  private timer = 0;
  private stopLevel: (() => void) | null = null;

  constructor(handlers: ListenHandlers) {
    this.handlers = handlers;
  }

  /** Listening now (not counting one that is finishing). */
  get active(): boolean {
    return this.rec !== null && !this.stopping;
  }

  /** Some words, final or still being guessed, have come in since start. */
  get heardSomething(): boolean {
    return this.heardAny;
  }

  /** Starts listening: `onDevice` keeps audio on the device where the browser can; `meter` runs the level meter. */
  start(opts: { readonly lang: string; readonly onDevice: boolean; readonly meter: boolean }): void {
    this.abort();
    const cls = recogniserClass();
    if (!cls) {
      this.handlers.error("unsupported", "Voice commands need Chrome, Edge or Safari: this browser has no speech recognition.");
      return;
    }
    this.cls = cls;
    this.lang = opts.lang;
    this.prior = [];
    this.finals = [];
    this.interim = "";
    this.heardAny = false;
    this.restarts = 0;
    this.stopping = false;
    this.failed = false;
    this.finishing = null;
    this.startedAt = Date.now();
    // the first listening in a language only asks; the next one uses the answer
    if (!onDeviceSeen.has(opts.lang)) void onDeviceStatus(opts.lang);
    this.local = opts.onDevice && onDeviceSeen.get(opts.lang) === "available";
    if (opts.meter) this.stopLevel = levelMeter((v) => this.handlers.level(v));
    this.begin();
  }

  /** Stops listening and resolves with what was heard once the last result is in (1.5 s at most). */
  finish(): Promise<Heard> {
    if (this.finishing) return this.finishing;
    const rec = this.rec;
    if (!rec) return Promise.resolve(this.settled());
    this.stopping = true;
    this.stopMeter();
    this.finishing = new Promise<Heard>((resolve) => {
      this.settle = resolve;
      this.timer = window.setTimeout(() => this.done(), FINISH_MS);
    });
    try {
      rec.stop();
    } catch {
      this.done();
    }
    return this.finishing;
  }

  /** Stops at once, dropping what was heard; no handler is called after. */
  abort(): void {
    const rec = this.rec;
    const resolve = this.settle;
    this.release();
    this.settle = null;
    this.finishing = null;
    this.prior = [];
    this.finals = [];
    this.interim = "";
    this.heardAny = false;
    try {
      rec?.abort();
    } catch {
      // already stopped
    }
    resolve?.(NOTHING);
  }

  /** A recogniser run with the listening's options. Its events count only while it is the current run. */
  private begin(): void {
    const cls = this.cls;
    if (!cls) return;
    const rec = new cls();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    if (this.local && "processLocally" in rec) rec.processLocally = true;
    rec.onaudiostart = () => {
      if (this.rec === rec) this.handlers.audio();
    };
    rec.onresult = (e) => {
      if (this.rec !== rec) return;
      // each event carries every result of the run so far, so the run's list replaces the last
      const read = readResults(e);
      this.finals = read.finals;
      this.interim = read.interim;
      const heard = this.heard();
      if (heard.final || heard.interim) this.heardAny = true;
      this.handlers.heard(heard);
    };
    rec.onerror = (e) => {
      // no speech is not an error (the run just ends), and an abort is ours
      if (this.rec !== rec || this.failed || e.error === "no-speech" || e.error === "aborted") return;
      this.failed = true;
      const [kind, message] = describe(e.error, this.lang);
      this.handlers.error(kind, message);
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      if (this.stopping) {
        this.done();
        return;
      }
      if (this.failed) {
        this.release();
        return;
      }
      // the browser stops on a pause or after a while: go on from where it left off
      if (this.restarts < MAX_RESTARTS && Date.now() - this.startedAt < MAX_SPAN_MS) {
        this.restarts++;
        this.prior.push(...this.finals);
        this.finals = [];
        this.interim = "";
        this.begin();
        return;
      }
      this.release();
      this.handlers.ended();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.release();
      this.handlers.error("other", `Speech recognition stopped: ${err instanceof Error ? err.message : String(err)}.`);
    }
  }

  /** What has been heard in this listening, across its restarts: the final words, the guess, and up to three alternatives. */
  private heard(): Heard {
    const all = [...this.prior, ...this.finals];
    const final = all.map((alts) => alts[0] ?? "").join(" ").replace(/\s+/g, " ").trim();
    const alternatives: string[] = [];
    for (let k = 0; k < 3; k++) {
      // a run with fewer alternatives than k keeps its last one
      const words = all.map((alts) => alts[Math.min(k, alts.length - 1)] ?? "").join(" ");
      const text = `${words} ${this.interim}`.replace(/\s+/g, " ").trim();
      if (text && !alternatives.includes(text)) alternatives.push(text);
    }
    return { final, interim: this.interim, alternatives };
  }

  /** What finish() hands back: the final words, or the guess when no final words came. */
  private settled(): Heard {
    const heard = this.heard();
    return heard.final ? heard : { final: heard.interim, interim: "", alternatives: heard.alternatives };
  }

  /** Ends a finish(): resolves it with what was heard and drops the recogniser. */
  private done(): void {
    const rec = this.rec;
    const resolve = this.settle;
    const heard = this.settled();
    this.release();
    this.settle = null;
    try {
      rec?.abort();
    } catch {
      // already stopped
    }
    resolve?.(heard);
  }

  /** Drops the recogniser and the meter. The words heard stay until the next start or abort. */
  private release(): void {
    window.clearTimeout(this.timer);
    this.stopMeter();
    this.rec = null;
  }

  private stopMeter(): void {
    this.stopLevel?.();
    this.stopLevel = null;
  }
}
