// A Revit file dropped on the window or chosen with File > Open. A project (.rvt) opens as a new
// drawing of its model, made in a worker (revitImport.worker.ts) so the page stays live. A family
// or template (.rfa, .rte, .rft), whose geometry rvt-rs doesn't read, shows what it says about
// itself instead (the release that saved it, Project Information or a family's category and types,
// linked files) and its thumbnail, in a window; the thumbnail can be placed in the open drawing.

import { readRevit, type RevitFile, type RevitParam } from "../import/rvt.ts";
import type { RevitDrawing, RevitReply, RevitRequest } from "./revitImport.ts";
import { h } from "./dom.ts";
import { placePng } from "./images.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";
import "./revitFile.css";

/**
 * The drawing of the Revit model in `bytes`, from the file `name`, made in a worker; `progress` hears
 * each step, and `signal` stops it. Once it resolves, the worker reads on for the elements only a
 * slower pass draws in full: `detail` hears the drawing made again with them, when there are any.
 */
export function revitModelDrawing(
  bytes: Uint8Array,
  name: string,
  progress?: (step: string) => void,
  signal?: AbortSignal,
  detail?: (drawing: RevitDrawing, count: number) => void,
): Promise<RevitDrawing> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./revitImport.worker.ts", import.meta.url), { type: "module" });
    signal?.addEventListener("abort", () => {
      worker.terminate();
      reject(new Error("stopped"));
    });
    worker.onmessage = (e: MessageEvent<RevitReply>) => {
      const m = e.data;
      if (m.type === "progress") return progress?.(m.step);
      if (m.type === "done") {
        resolve(m.drawing);
        if (detail) return;
      } else if (m.type === "detail") {
        if (m.drawing) detail?.(m.drawing, m.count);
      } else reject(new Error(m.message));
      worker.terminate();
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "the Revit reader stopped"));
    };
    // a copy goes, so the caller keeps its bytes
    worker.postMessage({ bytes, name } satisfies RevitRequest);
  });
}

/** What a Revit import brought in, and what it drew as boxes or left out, in a sentence or two. */
export function revitSummary(d: RevitDrawing): string {
  const w = d.written;
  const n = (count: number, one: string, many = `${one}s`): string => `${count.toLocaleString()} ${count === 1 ? one : many}`;
  const brought = [
    n(w.layers.length, "level"),
    n(w.walls, "wall"),
    n(w.slabs, "floor"),
    n(w.openings, "door or window", "doors and windows"),
    n(w.objects, "other element"),
  ];
  const left = Object.entries(d.skipped).map(([kind, count]) => `${kind} (${count.toLocaleString()})`);
  const failed = Object.entries(w.failed).map(([kind, count]) => `${kind} (${count.toLocaleString()})`);
  return [
    `Opened ${d.name} from Revit: ${list(brought)}.`,
    w.symbols ? `${n(w.symbols, "family type")} placed more than once ${w.symbols === 1 ? "is a symbol" : "are symbols"}.` : "",
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

/** Shows what the Revit file `name`, read as `bytes`, says about itself. */
export async function showRevitFile(bytes: Uint8Array, name: string, view: View): Promise<void> {
  let f: RevitFile;
  try {
    f = readRevit(bytes, name);
  } catch (err) {
    toast(`Could not read ${name}: ${errorMessage(err)}`);
    return;
  }
  const isFamily = f.kind === "family" || f.kind === "family template";
  const url = f.preview ? URL.createObjectURL(new Blob([f.preview.png as BlobPart], { type: "image/png" })) : null;
  const facts = [
    `Revit ${f.release ?? "(release not said)"} ${f.kind}${f.category ? ` · ${f.category}` : ""}`,
    f.build ? `Build ${f.build}` : "",
    f.saved ? `Saved ${savedDate(f.saved)}` : "",
    f.worksharing ? (f.worksharing === "Not enabled" ? "Not workshared" : `Workshared: ${f.worksharing}`) : "",
  ].filter(Boolean);
  const links = f.links.filter((l) => /link/i.test(l.type));

  const body: Node[] = [
    h(
      "div",
      { cls: "rvt-head" },
      url
        ? h("img", { cls: "rvt-thumb", attrs: { src: url, alt: `${name}'s thumbnail`, width: String(f.preview?.width), height: String(f.preview?.height) } })
        : h("div", { cls: "rvt-thumb rvt-no-thumb", text: "No thumbnail saved" }),
      h("div", { cls: "rvt-facts" }, ...(f.title ? [h("strong", { text: f.title })] : []), ...facts.map((t) => h("span", { text: t }))),
    ),
  ];
  if (f.info.length) body.push(h("h3", { cls: "rvt-section", text: isFamily ? "Family parameters" : "Project Information" }), paramList(f.info));
  if (f.types.length) body.push(h("h3", { cls: "rvt-section", text: `Types (${f.types.length})` }), typeTable(f));
  if (links.length) {
    body.push(
      h("h3", { cls: "rvt-section", text: "Linked files" }),
      h("ul", { cls: "rvt-links" }, ...links.map((l) => h("li", {}, h("span", { text: l.name }), h("span", { cls: "muted", text: [l.type, l.state].filter(Boolean).join(" · ") })))),
    );
  }
  body.push(
    h("p", {
      cls: "muted rvt-note",
      text: isFamily
        ? "Rodeo reads a Revit family's details, types and thumbnail, not its own geometry. Placed in a Revit project, it comes in with the project: drop the .rvt here."
        : "Rodeo reads a template's details and thumbnail. A project made from it opens with its model: drop the .rvt here.",
    }),
  );

  // the thumbnail can go into the open drawing when it takes pictures (blank ones don't yet)
  const canPlace = !!f.preview && store.activeLayerId !== null && !!store.session?.canAdd("image");
  const shown = showDialog<true>({
    title: name,
    okLabel: canPlace ? "Place Thumbnail" : "Close",
    cls: "rvt-dialog",
    body,
    check: () => ({ value: true }),
  });
  // with no field to take it, the focus goes to OK, so Esc and Return answer the window
  body[0].parentElement?.querySelector<HTMLButtonElement>("button.primary")?.focus();
  const placed = await shown;
  if (url) URL.revokeObjectURL(url);
  if (placed && canPlace && f.preview) placePng(f.preview.png, f.preview.width, f.preview.height, view, "Place Revit thumbnail");
}

/** "27 March 2023, 11:57", in this browser's language and time zone; the text as written when it isn't a date. */
function savedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}

/** Parameters as name and value rows, each group's name above its own. */
function paramList(params: readonly RevitParam[]): HTMLElement {
  const rows: Node[] = [];
  let group: string | null = null;
  for (const p of params) {
    if (p.group !== group) {
      group = p.group;
      if (group) rows.push(h("dt", { cls: "rvt-group", text: group }));
    }
    rows.push(h("dt", { text: p.name }), h("dd", { text: p.value }));
  }
  return h("dl", { cls: "rvt-params" }, ...rows);
}

/** A family's types as a table: a row each, a column for each parameter any of them has. */
function typeTable(f: RevitFile): HTMLElement {
  const names: string[] = [];
  for (const t of f.types) for (const p of t.params) if (!names.includes(p.name)) names.push(p.name);
  return h(
    "div",
    { cls: "rvt-types" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, h("th", { text: "Type" }), ...names.map((n) => h("th", { text: n })))),
      h(
        "tbody",
        {},
        ...f.types.map((t) => h("tr", {}, h("td", { text: t.name }), ...names.map((n) => h("td", { text: t.params.find((p) => p.name === n)?.value ?? "" })))),
      ),
    ),
  );
}
