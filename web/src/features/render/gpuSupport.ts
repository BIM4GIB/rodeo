// Whether this browser can trace on the GPU through WebGPU. The Path Traced view and Render Image
// use gpuEngine.ts where it can, and the WebGL tracer (pathtrace.ts) where it cannot. The answer is
// asked once: webgpuKnown() gives it as soon as it has settled, for a view that must choose at once.

/** The adapter request's answer, once it has settled. */
let known: boolean | null = null;
/** The request itself, shared by every caller. */
let pending: Promise<boolean> | null = null;

/** Whether the browser has a WebGPU adapter. Asked once and never rejects: a browser without WebGPU answers false. */
export function webgpuAvailable(): Promise<boolean> {
  pending ??= (async (): Promise<boolean> => {
    try {
      const adapter = await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter();
      known = adapter !== null && adapter !== undefined;
    } catch {
      known = false;
    }
    return known;
  })();
  return pending;
}

/** The settled answer from webgpuAvailable, or null before it has settled. */
export function webgpuKnown(): boolean | null {
  return known;
}

// asked at load, so webgpuKnown has settled by the time a view asks
void webgpuAvailable();
