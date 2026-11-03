// Turns the frames of a timelapse into a file: WebM or MP4 by MediaRecorder (where the browser
// records that type), or GIF by gifenc. Video frames are captured one at a time with
// track.requestFrame() at a fixed rate, so the file plays at the chosen duration as long as the
// frames draw in time; a frame that draws late is captured late, and the file runs longer.

import { GIFEncoder, applyPalette, quantize } from "gifenc";

export type Format = "webm" | "mp4" | "gif";

const VIDEO_TYPES: Record<"webm" | "mp4", string[]> = {
  webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
  mp4: ["video/mp4;codecs=avc1.42E01E", "video/mp4"],
};

/** The MediaRecorder type for a video format, or null when the browser cannot record it. */
export function videoMime(format: "webm" | "mp4"): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  return VIDEO_TYPES[format].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** The formats this browser can write: GIF always, the video formats where recorded. */
export function formatsAvailable(): Format[] {
  const out: Format[] = [];
  if (videoMime("webm")) out.push("webm");
  if (videoMime("mp4")) out.push("mp4");
  out.push("gif");
  return out;
}

export function extensionOf(format: Format): string {
  return format;
}

/** A sink takes each frame, and gives the file when all are in. */
export interface FrameSink {
  /** the frame is in `canvas` now */
  add(canvas: HTMLCanvasElement, index: number): Promise<void>;
  finish(): Promise<Blob>;
  abort(): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export class VideoSink implements FrameSink {
  private readonly stream: MediaStream;
  private readonly track: CanvasCaptureMediaStreamTrack | null;
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly t0 = performance.now();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly fps: number,
    private readonly mime: string,
    width: number,
    height: number,
  ) {
    // captureStream(0): frames are only captured when asked for (requestFrame)
    this.stream = canvas.captureStream(0);
    this.track = (this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined) ?? null;
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime, videoBitsPerSecond: Math.round(width * height * fps * 0.15) });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }

  async add(_canvas: HTMLCanvasElement, index: number): Promise<void> {
    // frame i is due at i / fps: wait for it, then capture what the canvas shows
    await sleep(this.t0 + (index * 1000) / this.fps - performance.now());
    this.track?.requestFrame?.();
  }

  finish(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      this.recorder.onstop = () => {
        this.stopTracks();
        resolve(new Blob(this.chunks, { type: this.mime.split(";")[0] }));
      };
      this.recorder.onerror = () => {
        this.stopTracks();
        reject(new Error("the browser could not record the video"));
      };
      this.recorder.stop();
    });
  }

  abort(): void {
    try {
      if (this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      // already stopped
    }
    this.stopTracks();
  }

  private stopTracks(): void {
    for (const t of this.stream.getTracks()) t.stop();
  }
}

export class GifSink implements FrameSink {
  private readonly gif = GIFEncoder();

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly fps: number,
  ) {}

  async add(canvas: HTMLCanvasElement): Promise<void> {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("openvwx: 2D canvas is not available");
    const rgba = ctx.getImageData(0, 0, this.width, this.height).data;
    const palette = quantize(rgba, 256, { format: "rgb565" });
    const index = applyPalette(rgba, palette, "rgb565");
    this.gif.writeFrame(index, this.width, this.height, { palette, delay: 1000 / this.fps });
  }

  async finish(): Promise<Blob> {
    this.gif.finish();
    return new Blob([this.gif.bytes() as BlobPart], { type: "image/gif" });
  }

  abort(): void {
    // nothing to release: the GIF is simply not finished
  }
}
