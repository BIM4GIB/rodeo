// A voice note: Record / Stop with a running timer (two minutes at most), then
// a player to check it, or Discard. MediaRecorder writes Opus in WebM where the
// browser can, and MP4 otherwise (Safari).

import { h } from "../../app/dom.ts";
import { toast } from "../../app/toast.ts";
import { clock } from "./util.ts";
import { GLYPH } from "./glyphs.ts";

export const MAX_VOICE_MS = 120_000;
const AUDIO_BITS_PER_SECOND = 32_000;

export interface VoiceNote {
  readonly blob: Blob;
  readonly durationMs: number;
}

export interface VoiceRecorder {
  readonly el: HTMLElement;
  /** The note as recorded (a recording still going is stopped first); null with none. */
  finish(): Promise<VoiceNote | null>;
  /** Throws the note away (and stops a recording). */
  discard(): void;
  /** Stops everything and frees the microphone (the widget is being removed). */
  dispose(): void;
}

function pickType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

/** The record button and its state: idle, recording (with the time), or a finished note to hear. */
export function voiceRecorder(onChange: () => void = () => {}): VoiceRecorder {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let timer = 0;
  let autoStop = 0;
  let stopping: Promise<VoiceNote | null> | null = null;
  let note: VoiceNote | null = null;
  let url = "";

  const body = h("div", { cls: "crit-voice" });
  const clockOf = (ms: number): string => `${clock(ms)} / ${clock(MAX_VOICE_MS)}`;

  function freeMicrophone(): void {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function clearTimers(): void {
    window.clearInterval(timer);
    window.clearTimeout(autoStop);
    timer = 0;
    autoStop = 0;
  }

  function render(): void {
    if (recorder) {
      const stopBtn = h("button", { cls: "crit-voice-btn recording", attrs: { type: "button", "aria-label": "Stop recording" } });
      stopBtn.innerHTML = `${GLYPH.stop}<span>Stop</span>`;
      stopBtn.addEventListener("click", () => void stopRecording());
      const time = h("span", { cls: "crit-voice-time", text: clockOf(0) });
      body.replaceChildren(stopBtn, time);
      return;
    }
    if (note) {
      const player = h("audio", { attrs: { controls: "", preload: "metadata", src: url } });
      const discard = h("button", { cls: "crit-voice-btn", attrs: { type: "button", title: "Discard the voice note", "aria-label": "Discard the voice note" } });
      discard.innerHTML = GLYPH.clear;
      discard.addEventListener("click", () => {
        resetNote();
        onChange();
      });
      body.replaceChildren(player, discard);
      return;
    }
    const rec = h("button", { cls: "crit-voice-btn", attrs: { type: "button" } });
    rec.innerHTML = `${GLYPH.mic}<span>Record voice note</span>`;
    rec.addEventListener("click", () => void startRecording());
    body.replaceChildren(rec);
  }

  function resetNote(): void {
    if (recorder) {
      const r = recorder;
      recorder = null;
      clearTimers();
      try {
        r.onstop = null;
        if (r.state !== "inactive") r.stop();
      } catch {
        // already stopped
      }
      freeMicrophone();
    }
    if (url) URL.revokeObjectURL(url);
    url = "";
    note = null;
    stopping = null;
    render();
  }

  async function startRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("This browser cannot record a voice note.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      toast(`The microphone is not available: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const type = pickType();
    const options: MediaRecorderOptions = { audioBitsPerSecond: AUDIO_BITS_PER_SECOND };
    if (type) options.mimeType = type;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch {
      freeMicrophone();
      toast("This browser cannot record a voice note.");
      return;
    }
    chunks = [];
    note = null;
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });
    startedAt = performance.now();
    recorder.start(1000);
    timer = window.setInterval(() => {
      const time = body.querySelector<HTMLElement>(".crit-voice-time");
      if (time) time.textContent = clockOf(performance.now() - startedAt);
    }, 250);
    autoStop = window.setTimeout(() => void stopRecording(), MAX_VOICE_MS);
    render();
    onChange();
  }

  function stopRecording(): Promise<VoiceNote | null> {
    if (stopping) return stopping;
    const r = recorder;
    if (!r) return Promise.resolve(note);
    clearTimers();
    const elapsed = Math.min(performance.now() - startedAt, MAX_VOICE_MS);
    stopping = new Promise<void>((resolve) => {
      r.addEventListener("stop", () => resolve(), { once: true });
      if (r.state !== "inactive") r.stop();
      else resolve();
    }).then(() => {
      const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
      chunks = [];
      freeMicrophone();
      recorder = null;
      stopping = null;
      if (blob.size === 0) {
        note = null;
        toast("Nothing was recorded.");
      } else {
        url = URL.createObjectURL(blob);
        note = { blob, durationMs: elapsed };
      }
      render();
      onChange();
      return note;
    });
    render();
    onChange();
    return stopping;
  }

  render();

  return {
    el: body,
    finish: () => (recorder ? stopRecording() : Promise.resolve(note)),
    discard: () => resetNote(),
    dispose: () => {
      resetNote();
    },
  };
}
