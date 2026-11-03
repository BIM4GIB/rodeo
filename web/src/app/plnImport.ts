// An Archicad project (.pln, a .pla archive or a .tpl template) dropped on the window or chosen
// with File > Open: it opens as a new drawing of its model, made in a worker
// (archicadImport.worker.ts) that reads the file by ranges, so the page stays live however big the
// project is. The summary says what came in, what was approximated and what was left out.

import type { ArchicadDrawing, ArchicadReply, ArchicadRequest } from "./archicadImport.ts";

/** True for a file named as an Archicad project, archive or template. */
export function isArchicadName(name: string): boolean {
  return /\.(pln|pla|tpl)$/i.test(name);
}

/** The drawing of the Archicad project `file`, named `name`, made in a worker; `progress` hears each step, and `signal` stops it. */
export function archicadModelDrawing(file: Blob, name: string, progress?: (step: string) => void, signal?: AbortSignal): Promise<ArchicadDrawing> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./archicadImport.worker.ts", import.meta.url), { type: "module" });
    signal?.addEventListener("abort", () => {
      worker.terminate();
      reject(new Error("stopped"));
    });
    worker.onmessage = (e: MessageEvent<ArchicadReply>) => {
      const m = e.data;
      if (m.type === "progress") return progress?.(m.step);
      worker.terminate();
      if (m.type === "done") resolve(m.drawing);
      else reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "the Archicad reader stopped"));
    };
    worker.postMessage({ file, name } satisfies ArchicadRequest);
  });
}

/** What an Archicad import brought in, what it approximated and what it left out, in a few sentences. */
export function archicadSummary(d: ArchicadDrawing): string {
  const w = d.written;
  const n = (count: number, one: string, many = `${one}s`): string => `${count.toLocaleString()} ${count === 1 ? one : many}`;
  const brought = [n(w.layers.length, "story", "stories"), n(w.walls, "wall"), n(w.slabs, "slab"), n(w.openings, "door or window", "doors and windows"), n(w.objects, "other element"), n(w.drawing, "2D object")];
  const left = Object.entries(d.skipped).map(([kind, count]) => `${kind} (${count.toLocaleString()})`);
  const failed = Object.entries(w.failed).map(([kind, count]) => `${kind} (${count.toLocaleString()})`);
  return [
    `Opened ${d.name} from Archicad: ${list(brought)}.`,
    ...d.notes.map((note) => `${note.charAt(0).toUpperCase()}${note.slice(1)}.`),
    left.length ? `Left out: ${list(left)}.` : "",
    failed.length ? `Couldn't make some: ${list(failed)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function list(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
