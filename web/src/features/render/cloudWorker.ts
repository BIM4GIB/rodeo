// The cloud render worker's page (render-worker.html): headless Chrome on a GPU server
// (cloudrender/worker.py) opens it and calls rodeoRender. It reads the job the editor packed
// (pack.ts), builds the scene as the editor would and makes each picture with the same engines,
// reporting progress through rodeoReport, which answers with "finish" or "cancel" when the user
// asks for that. Each picture is PUT back to the page's server as it is made.

import { buildScene, type RenderScene } from "./sceneBuilder.ts";
import { prepareLibrary } from "./library.ts";
import { unpackJob } from "./pack.ts";
import { renderStill, type Job, type Tiling } from "./still.ts";

/** What worker.py asks for. */
interface WorkerJob {
  /** where the gzipped pack is */
  readonly pack: string;
  /** where the pictures go: PUT {results}/{n} */
  readonly results: string;
  /** seconds the whole job may take from now, 0 for no limit */
  readonly limitSeconds: number;
}

/** What the page tells worker.py while it works. */
interface Report {
  readonly label: string;
  readonly fraction: number | null;
  /** the picture so far, small, as a JPEG data URL (now and then) */
  readonly preview?: string;
}

/** One picture made, as rodeoRender resolves with it. */
interface Made {
  readonly name: string;
  readonly mime: string;
  readonly samples: number | null;
  readonly seconds: number;
}

declare global {
  interface Window {
    rodeoRender(job: WorkerJob): Promise<Made[]>;
    /** worker.py's (Playwright's exposeFunction): resolves with what the user asked for, if anything */
    rodeoReport?(report: Report): Promise<"finish" | "cancel" | null>;
  }
}

/** time kept back at the end for encoding and sending the last picture */
const RESERVE_MS = 20_000;
const REPORT_MS = 1000;
const PREVIEW_MS = 8000;
const PREVIEW_WIDTH = 480;
/**
 * Whole pictures a sample: the server's GPU drives no display, so nothing resets it on a long draw,
 * and tiles only cost time there (a 4K picture of 1024 samples took 122 s on an L40S in the
 * editor's tiles, 54 s whole). A tile still splits past 2 s, well inside Chrome's GPU watchdog.
 */
const CLOUD_TILING: Tiling = { ms: 2000, pixels: Infinity };

window.rodeoRender = async (spec: WorkerJob): Promise<Made[]> => {
  const started = performance.now();
  const deadline = spec.limitSeconds > 0 ? started + spec.limitSeconds * 1000 - RESERVE_MS : Infinity;
  const job: Job = { cancelled: false, finishNow: false };
  let lastReport = -Infinity;
  let lastPreview = -Infinity;
  let label = "Preparing…";
  let fraction: number | null = null;
  let preview: string | undefined;

  const report = async (force = false): Promise<void> => {
    const now = performance.now();
    if (!force && now - lastReport < REPORT_MS) return;
    lastReport = now;
    const asked = await window.rodeoReport?.({ label, fraction, preview });
    preview = undefined;
    if (asked === "cancel") job.cancelled = true;
    else if (asked === "finish") job.finishNow = true;
  };
  const box = {
    label(text: string) {
      label = text;
      void report();
    },
    bar(f: number | null) {
      fraction = f;
    },
    picture(canvas: HTMLCanvasElement) {
      const now = performance.now();
      if (now - lastPreview < PREVIEW_MS) return;
      // the first is black when no sample is in yet: the next is tried
      const small = thumbnail(canvas);
      if (!small) return;
      lastPreview = now;
      preview = small;
    },
  };

  label = "Reading the model…";
  await report(true);
  const res = await fetch(spec.pack);
  if (!res.ok || !res.body) throw new Error(`the job could not be read (${res.status})`);
  const bytes = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const unpacked = await unpackJob(bytes);
  const { plan, viz, shots, source } = unpacked;
  // the server's headless Chrome traces with WebGL (its WebGPU isn't set up for the GPU)
  const settings = { ...unpacked.settings, quality: { ...unpacked.settings.quality, engine: "webgl" as const } };
  await prepareLibrary(settings);

  label = "Building the scene…";
  await report(true);
  const scene: RenderScene = buildScene(source, settings, viz);
  const made: Made[] = [];
  try {
    for (const [i, { label: name, shot }] of shots.entries()) {
      if (job.cancelled || (made.length > 0 && job.finishNow)) break;
      const left = shots.length - i;
      // a time limit is shared out among the pictures still to make
      const minutesLeft = deadline === Infinity ? 0 : Math.max(0.05, (deadline - performance.now()) / 60_000 / left);
      const minutes = plan.minutes > 0 && minutesLeft > 0 ? Math.min(plan.minutes, minutesLeft) : plan.minutes || minutesLeft;
      const prefix = shots.length > 1 ? `Shot ${i + 1} of ${shots.length} · ` : "";
      const still = await renderStill(scene, shot, { ...plan, minutes }, settings, job, box, { prefix, laterShots: left - 1 }, CLOUD_TILING);
      if (!still) break;
      label = `${prefix}Sending the picture…`;
      fraction = null;
      await report(true);
      const put = await fetch(`${spec.results}/${made.length}`, { method: "PUT", body: still.blob });
      if (!put.ok) throw new Error(`the picture could not be sent back (${put.status})`);
      made.push({ name, mime: still.blob.type, samples: still.samples, seconds: still.seconds });
    }
  } finally {
    scene.dispose();
  }
  return job.cancelled ? [] : made;
};

/** The picture so far, PREVIEW_WIDTH wide, as a JPEG data URL; null while it is all black. */
function thumbnail(source: HTMLCanvasElement): string | null {
  const scale = Math.min(1, PREVIEW_WIDTH / source.width);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(source.width * scale));
  c.height = Math.max(1, Math.round(source.height * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let drawn = false;
  for (let i = 0; i < px.length && !drawn; i += 4) drawn = px[i] > 0 || px[i + 1] > 0 || px[i + 2] > 0;
  return drawn ? c.toDataURL("image/jpeg", 0.8) : null;
}
