// Renders a timelapse: one frame per step of the frame count, each the drawing at its place in the
// timeline, encoded to a file. Progress is reported per frame and a cancelled export stops at the
// next frame.

import { FrameRenderer, type LayerChoice, type Look, type Plan, type ViewState } from "./frames.ts";
import { GifSink, VideoSink, videoMime, type Format } from "./encode.ts";
import type { Timeline } from "./timeline.ts";

/** frames per second of a video, and of a GIF (which is kept small) */
export const VIDEO_FPS = 30;
export const GIF_FPS = 15;
/** the longest timelapse a GIF is written for */
export const GIF_MAX_SECONDS = 15;

export class ExportCancelled extends Error {
  constructor() {
    super("the export was cancelled");
  }
}

export interface ExportRequest {
  /** a timeline of its own: the export replays from the start */
  readonly timeline: Timeline;
  readonly layer: LayerChoice;
  readonly fit: boolean;
  /** the editor's view, for "Current view" */
  readonly view: ViewState | null;
  readonly width: number;
  readonly height: number;
  readonly dark: boolean;
  readonly date: boolean;
  readonly watermark: boolean;
  readonly seconds: number;
  readonly format: Format;
  readonly signal: AbortSignal;
  readonly onProgress: (done: number, total: number) => void;
}

/** The frame count of a timelapse of `seconds` in `format`. */
export function frameCount(seconds: number, format: Format): number {
  return Math.round(seconds * (format === "gif" ? GIF_FPS : VIDEO_FPS));
}

/** Renders the timelapse and resolves with the file. Rejects with ExportCancelled when stopped. */
export async function renderTimelapse(req: ExportRequest): Promise<Blob> {
  const fps = req.format === "gif" ? GIF_FPS : VIDEO_FPS;
  const frames = frameCount(req.seconds, req.format);
  const mime = req.format === "gif" ? null : videoMime(req.format);
  if (req.format !== "gif" && !mime) throw new Error(`this browser cannot record ${req.format.toUpperCase()}`);

  const out = document.createElement("canvas");
  out.width = req.width;
  out.height = req.height;
  const renderer = new FrameRenderer();
  const look: Look = { width: req.width, height: req.height, dark: req.dark, date: req.date, watermark: req.watermark };

  // a fitted frame keeps the drawing's final extent, so it does not move as the drawing grows
  const fit = req.fit || req.view === null;
  const fitBox = fit ? renderer.extent(await req.timeline.last(), req.layer) : null;
  const plan: Plan = { layer: req.layer, fitBox, current: fit ? null : req.view };

  const sink = mime ? new VideoSink(out, fps, mime, req.width, req.height) : new GifSink(req.width, req.height, fps);
  try {
    for (let i = 0; i < frames; i++) {
      if (req.signal.aborted) throw new ExportCancelled();
      const shown = await req.timeline.at(i, frames);
      await renderer.show(shown, plan, look, out);
      if (req.signal.aborted) throw new ExportCancelled();
      await sink.add(out, i);
      req.onProgress(i + 1, frames);
    }
    return await sink.finish();
  } catch (err) {
    sink.abort();
    throw err;
  }
}
