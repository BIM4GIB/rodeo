// Error reports: the editor tells the server on its own when something breaks or crawls, so a
// failure can be looked into without asking what happened (POST /api/reports; admins read them in
// Help > Error Reports…). Sent are errors nothing caught (heard from the moment this module is
// imported, which main.ts does first), failures the user was shown (reportFailure) and work that
// took far too long (reportSlow). Each carries the build,
// browser, GPU, memory and view, and a trail of what happened just before: toasts, console
// warnings and errors, long freezes, lost WebGL contexts, parts of the editor that would not
// load, and steps marked with note(). Never the drawing: names in quotes are blanked out. The same
// error goes at most 3 times a page and 30 reports in all; with no server, nothing is sent.

import { serverConfig } from "../platform/api.ts";
import type { ErrorReportKind, NewErrorReport, ReportValue } from "../platform/protocol.ts";
import { documentSource } from "./ext.ts";
import { store } from "./state.ts";
import { onToast } from "./toast.ts";

export type ReportDetails = Readonly<Record<string, ReportValue | undefined>>;

const TRAIL_LINES = 50;
const SAME_ERROR_MAX = 3;
const REPORTS_MAX = 30;
/** a task this long on the main thread goes in the trail */
const FREEZE_MS = 1000;

const trail: string[] = [];
const sentCount = new Map<string, number>();
let sentTotal = 0;
let installed = false;

/** "Saved as “Kitchen.vwx”" → "Saved as “…”": names are the drawing's, not the error's. */
function scrub(text: string): string {
  return text.replace(/“[^”]*”/g, "“…”");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function since(): string {
  return `+${(performance.now() / 1000).toFixed(1)}s`;
}

/** Adds a line to the trail a report carries ("render: 2 of 4 tiles", "cloud save: 120 MB"). */
export function note(text: string): void {
  trail.push(`${since()} ${clip(scrub(text), 300)}`);
  if (trail.length > TRAIL_LINES) trail.splice(0, trail.length - TRAIL_LINES);
}

/**
 * Reports a failure the user was told of (a toast, a dialog). `area` names the part of the
 * editor ("render", "cloud-save"); `details` what bears on it (sizes, settings, timings).
 */
export function reportFailure(area: string, err: unknown, details: ReportDetails = {}): void {
  const e = err instanceof Error ? err : null;
  send("failure", area, e ? e.message || e.name : String(err), e?.stack, details);
}

/** Where the editor runs and what happened just before, for a bug report the user sends (features/feedback). */
export function diagnosticsNow(): { readonly env: Record<string, ReportValue>; readonly trail: readonly string[] } {
  return { env: environment(), trail: [...trail] };
}

/** Reports work that took far too long, with what it took the time on. */
export function reportSlow(area: string, message: string, details: ReportDetails = {}): void {
  send("slow", area, message, undefined, details);
}

/** Starts listening for errors nothing caught, and for what goes in the trail. */
function install(): void {
  if (installed) return;
  installed = true;

  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      // a script or stylesheet that would not load (capture: these errors don't bubble)
      if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
        const url = target instanceof HTMLScriptElement ? target.src : target.href;
        note(`could not load ${pathOf(url)}`);
        return;
      }
      if (!(event instanceof ErrorEvent)) return;
      if (ignored(event.message, event.error)) return;
      const err = event.error instanceof Error ? event.error : null;
      const where = event.filename ? `${pathOf(event.filename)}:${event.lineno}:${event.colno}` : undefined;
      send("crash", "window", err?.message || event.message || "Unknown error", err?.stack ?? where, {});
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    const err = reason instanceof Error ? reason : null;
    const message = err ? err.message || err.name : typeof reason === "string" ? reason : safeString(reason);
    if (ignored(message, reason)) return;
    send("crash", "promise", message, err?.stack, {});
  });
  // Vite's own event when a part of the editor that loads on demand can't be fetched
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    note(`could not load a part of the editor: ${payload instanceof Error ? payload.message : safeString(payload)}`);
  });
  // lost GPU contexts (the event doesn't bubble, but a capturing listener hears it)
  document.addEventListener("webglcontextlost", (event) => note(`WebGL context lost (${describeCanvas(event.target)})`), true);
  document.addEventListener("webglcontextrestored", (event) => note(`WebGL context restored (${describeCanvas(event.target)})`), true);
  document.addEventListener("visibilitychange", () => note(`page ${document.visibilityState}`));
  window.addEventListener("offline", () => note("browser went offline"));
  window.addEventListener("online", () => note("browser back online"));

  onToast((message, kind) => note(`toast${kind === "error" ? "" : ` (${kind})`}: ${message}`));
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      note(`console.${level}: ${args.map(safeString).join(" ")}`);
    };
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= FREEZE_MS) note(`the page froze for ${(entry.duration / 1000).toFixed(1)} s`);
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // no long-task timing in this browser
  }
}

/** Errors that say nothing or come from outside the editor (extensions, a resize loop warning). */
function ignored(message: string, err: unknown): boolean {
  if (/ResizeObserver loop/i.test(message)) return true;
  if (message === "Script error." && !(err instanceof Error)) return true;
  const stack = err instanceof Error ? (err.stack ?? "") : "";
  return /(?:chrome|moz|safari(?:-web)?)-extension:\/\//.test(stack);
}

/** A console argument as a short line; an object only by its keys, since logging must stay cheap. */
function safeString(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "string") return clip(v, 300);
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (v && typeof v === "object") return `{${Object.keys(v).slice(0, 8).join(", ")}}`;
  return String(v);
}

function pathOf(url: string): string {
  try {
    return new URL(url, location.href).pathname;
  } catch {
    return url;
  }
}

function describeCanvas(target: EventTarget | null): string {
  if (!(target instanceof HTMLCanvasElement)) return "a canvas";
  return `${target.width}×${target.height}${target.id ? ` #${target.id}` : target.className ? ` .${String(target.className).split(" ")[0]}` : ""}`;
}

function send(kind: ErrorReportKind, area: string, message: string, stack: string | undefined, details: ReportDetails): void {
  const text = clip(scrub(message), 1000);
  const key = `${kind}|${area}|${text.replace(/\d+/g, "#")}`;
  const count = sentCount.get(key) ?? 0;
  if (count >= SAME_ERROR_MAX || sentTotal >= REPORTS_MAX) return;
  sentCount.set(key, count + 1);
  sentTotal++;
  const clean: Record<string, ReportValue> = {};
  for (const [k, v] of Object.entries(details)) if (v !== undefined) clean[k] = typeof v === "string" ? clip(scrub(v), 500) : v;
  const report: NewErrorReport = {
    kind,
    area,
    message: text,
    ...(stack ? { stack: clip(stack, 8000) } : {}),
    details: clean,
    env: environment(),
    trail: [...trail],
  };
  void post(report);
}

async function post(report: NewErrorReport): Promise<void> {
  try {
    const cfg = await serverConfig();
    if (!cfg) return;
    const env = { ...report.env, version: cfg.version };
    const body = JSON.stringify({ ...report, env });
    await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" },
      body,
      credentials: "include",
      // goes even if the page is closing
      keepalive: body.length < 60_000,
    });
  } catch {
    // a report that can't go is dropped: never a second error about the first
  }
}

// ---- where it happened -----------------------------------------------------------

let gpuName: string | null | undefined;

/** The graphics card as WebGL names it, read once from a throwaway context. */
function gpu(): string | null {
  if (gpuName !== undefined) return gpuName;
  gpuName = null;
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      gpuName = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // no WebGL: the name stays unknown
  }
  return gpuName;
}

/** The editor's build: the hashed name of the script index.html loads. */
function build(): string {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script ? (pathOf(script.src).split("/").pop() ?? "") : "";
}

/** The build the service worker holds, which can differ from the page's after a deploy. */
function workerBuild(): string | null {
  const url = navigator.serviceWorker?.controller?.scriptURL;
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("v");
  } catch {
    return null;
  }
}

function environment(): Record<string, ReportValue> {
  const ua = navigator.userAgent;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const source = documentSource();
  const out: Record<string, ReportValue> = {
    build: build(),
    browser: browserName(ua),
    platform: platformName(ua),
    gpu: gpu(),
    cores: navigator.hardwareConcurrency || null,
    memoryGb: nav.deviceMemory ?? null,
    heapMb: heap ? Math.round(heap.usedJSHeapSize / 1048576) : null,
    heapLimitMb: heap ? Math.round(heap.jsHeapSizeLimit / 1048576) : null,
    window: `${window.innerWidth}×${window.innerHeight}@${window.devicePixelRatio}`,
    online: navigator.onLine,
    upMinutes: Math.round(performance.now() / 6000) / 10,
    view: store.view3d ? "3D" : "2D",
    drawing: store.session ? (source?.kind ?? "file") : "none",
  };
  const worker = workerBuild();
  if (worker && worker !== out.build) out.workerBuild = worker;
  return out;
}

export function browserName(ua: string): string {
  const known: readonly [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
    [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
    [/Version\/(\d+(?:\.\d+)?).*Safari/, "Safari"],
  ];
  for (const [re, name] of known) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}`;
  }
  return ua.slice(0, 120);
}

export function platformName(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? "iPadOS" : "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

install();
