// The converter page (rodeo.build/convert and its pairs): drop CAD and 3D files, see what each holds,
// and convert it to another format in this browser. A worker reads and writes the files (worker.ts),
// so the page stays live. Nothing is uploaded: the one request beyond the page's own files is an
// anonymous visit count, the same one the editor sends. Each file is a row with its status, its
// downloads and its problems; the file picked also shows a preview and its facts.

import { h } from "../../app/dom.ts";
import { MAX_PNG_SIDE, svgToPng } from "../../export/png.ts";
import { zipFiles } from "../../export/zip.ts";
import { summaryLine } from "../describe.ts";
import { formatById, formatOfName } from "../formats.ts";
import type { DrawingSummary, Unit } from "../types.ts";
import { handOff } from "./handoff.ts";
import type { PreviewMesh } from "./preview3d.ts";
import type { FromWorker, ToWorker } from "./worker.ts";

/** The localStorage key of the format picked last. */
const CHOICE_KEY = "openvwx.convert.to";
/** The format the page starts on when the path, the query and the last pick name none. */
const FALLBACK_TO = "pdf";
/** The Convert to menu, in its groups: a format's id, or "png", which the page draws from the plan. */
const MENU: readonly (readonly [string, readonly string[]])[] = [
  ["Drawing", ["vwx"]],
  ["2D", ["pdf", "svg", "dxf", "eps", "emf", "png"]],
  ["3D", ["ifc", "skp", "3dm", "glb", "obj", "fbx", "dae", "stl", "ply", "3ds", "usdz", "step", "iges"]],
];
const CHOICES = new Set(MENU.flatMap(([, ids]) => ids));
/** A PNG is this many pixels wide, or as tall as MAX_PNG_SIDE allows for a drawing taller than it is wide. */
const PNG_WIDTH = 3000;
/** A file this large may run the browser out of memory: the page says so, and still reads it. */
const LARGE_FILE = 1024 ** 3;
/** Formats whose files don't say their units or which way is up: the page asks, and reads them again when asked. */
const ASKS = new Set(["obj", "stl", "ply", "3ds"]);
const UNITS: readonly Unit[] = ["mm", "cm", "m", "in", "ft"];
/** The layers and object types the facts list by name before "and N more". */
const LAYERS_SHOWN = 5;
const TYPES_SHOWN = 5;
/** What the page says when the worker stopped on a file, most likely for want of memory. */
const OUT_OF_MEMORY = "Your browser ran out of memory reading this file. The command line has more room:";

/** A converted file the page keeps: its bytes, what the writer left out, and a link to download it. */
interface Result {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly notes: readonly string[];
  readonly url: string;
}

/** Keeps a converted file, with its download link made once. */
function makeResult(name: string, mime: string, bytes: Uint8Array, notes: readonly string[]): Result {
  return { name, bytes, notes: [...notes], url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) };
}

/** A request the worker never answered: it stopped first, or while it ran. The page reads the file again. */
class Lost extends Error {
  constructor() {
    super("The converter restarted: try again");
  }
}

/** A request waiting for the worker: whose it is, what it asks, and where its answer goes. */
interface Job {
  readonly owner: Row;
  readonly message: ToWorker;
  readonly transfer: Transferable[];
  readonly progress: ((step: string) => void) | null;
  readonly resolve: (reply: FromWorker) => void;
  readonly reject: (err: Error) => void;
}

/**
 * The converter's one worker, with its requests run one at a time, in order. The worker runs one
 * request at a time anyway, so waiting here costs nothing, and an answer always belongs to the request
 * in flight. When the worker stops (a browser out of memory), its drawings are gone: the request in
 * flight goes to `crashed` with its owner, and every other request is cancelled with Lost.
 */
class Client {
  private worker: Worker | null = null;
  private queue: Job[] = [];
  private inFlight: Job | null = null;

  private readonly crashed: (owner: Row | null) => void;

  constructor(crashed: (owner: Row | null) => void) {
    this.crashed = crashed;
  }

  /** Sends a request and resolves with its answer; `progress` hears each step of a read. */
  run(owner: Row, message: ToWorker, progress: ((step: string) => void) | null = null, transfer: Transferable[] = []): Promise<FromWorker> {
    return new Promise((resolve, reject) => {
      this.queue.push({ owner, message, transfer, progress, resolve, reject });
      this.pump();
    });
  }

  /** Tells the worker to forget a drawing. No answer comes back. */
  drop(id: number): void {
    this.worker?.postMessage({ type: "drop", id } satisfies ToWorker);
  }

  /** Sends the next request, when none is in flight. */
  private pump(): void {
    if (this.inFlight || this.queue.length === 0) return;
    const job = this.queue.shift() as Job;
    this.inFlight = job;
    this.worker ??= this.start();
    this.worker.postMessage(job.message, job.transfer);
  }

  /** Starts a worker. Only the current one's messages and failures are heard; a stopped one's are not. */
  private start(): Worker {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      if (worker === this.worker) this.receive(e.data);
    };
    worker.onerror = () => {
      if (worker === this.worker) this.stopped();
    };
    worker.onmessageerror = () => {
      if (worker === this.worker) this.stopped();
    };
    return worker;
  }

  /** Hands an answer to the request in flight, then sends the next. */
  private receive(reply: FromWorker): void {
    const job = this.inFlight;
    if (!job) return;
    if (reply.type === "progress") {
      job.progress?.(reply.step);
      return;
    }
    this.inFlight = null;
    if (reply.type === "error") job.reject(new Error(reply.message));
    else job.resolve(reply);
    this.pump();
  }

  /** The worker stopped: it is replaced, and the request in flight is its owner's to answer for. */
  private stopped(): void {
    const job = this.inFlight;
    const waiting = this.queue.splice(0);
    this.inFlight = null;
    this.worker?.terminate();
    this.worker = null;
    if (job) job.reject(new Lost());
    for (const j of waiting) j.reject(new Lost());
    this.crashed(job?.owner ?? null);
  }
}

const client = new Client(onCrash);

/** A file on the page: its read, what the read says (a summary, a plan and a 3D model), and what it converts to, by format. */
class Row {
  readonly file: File;
  readonly name: string;
  readonly el: HTMLLIElement;
  /** the units and up axis the file is read with */
  units: Unit;
  yUp: boolean;
  /** the drawing the worker holds for this file, 0 when it holds none */
  readId = 0;
  /** counts the reads and resets: an answer to an earlier one is thrown away */
  gen = 0;
  /** true while a read waits its turn, so the file isn't queued twice */
  queued = false;
  removed = false;
  state: "reading" | "ready" | "failed" = "reading";
  step = "Reading the file";
  summary: DrawingSummary | null = null;
  svg: string | null = null;
  mesh: PreviewMesh | null = null;
  /** the preview tab the file opens on */
  tab: "3d" | "plan" = "3d";
  /** why the file can't be read, or null */
  readError: string | null = null;
  /** true when the browser ran out of memory on the file, so the page offers the command line */
  outOfMemory = false;
  /** why the file didn't open in the editor, or null */
  openError: string | null = null;
  /** why each format couldn't be made, by format */
  readonly errors = new Map<string, string>();
  /** the formats being made now */
  readonly pending = new Set<string>();
  /** the files made, by format */
  readonly results = new Map<string, Result>();

  private readonly statusEl: HTMLElement;
  private readonly notesEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly actionsEl: HTMLElement;

  constructor(file: File) {
    this.file = file;
    this.name = file.name;
    const id = formatOfName(file.name);
    // the defaults an STL or an OBJ is read with, as the readers take them when the file doesn't say
    this.units = id === "stl" ? "mm" : "m";
    this.yUp = id === "obj";
    this.statusEl = h("div", { cls: "cv-file-status" });
    this.notesEl = h("p", { cls: "cv-file-notes", hidden: true });
    this.errorEl = h("p", { cls: "cv-file-error", hidden: true, attrs: { role: "alert" } });
    this.actionsEl = h("div", { cls: "cv-file-actions" });
    const children: Node[] = [
      h("div", { cls: "cv-file-head" }, h("span", { cls: "cv-file-name", text: file.name }), h("span", { cls: "cv-file-size", text: sizeText(file.size) })),
      this.statusEl,
      this.notesEl,
    ];
    if (id && ASKS.has(id)) children.push(this.optionsBar());
    if (file.size >= LARGE_FILE) children.push(h("p", { cls: "cv-note", text: "Large file: your browser may run out of memory. The command line has more room." }));
    children.push(this.errorEl, this.actionsEl);
    this.el = h("li", { cls: "cv-file" }, ...children);
    this.el.addEventListener("click", (e) => {
      // a control in the row does its own thing; a click on the rest of the row picks the file for the preview
      if (e.target instanceof Element && e.target.closest("button, a, select, input, label")) return;
      selectFile(this);
      // on a narrow screen the preview sits under the list, so bring it into view
      if (matchMedia("(max-width: 899px)").matches) previewEl.scrollIntoView({ block: "start" });
    });
    this.render();
  }

  /** The units and up axis of a file that doesn't say its own: changing either reads the file again. */
  private optionsBar(): HTMLElement {
    const units = h("select", { cls: "cv-select", attrs: { "aria-label": "Units" } }, ...UNITS.map((u) => h("option", { text: u, value: u })));
    units.value = this.units;
    const up = h("input", { checked: this.yUp, attrs: { type: "checkbox" } });
    units.addEventListener("change", () => this.setOptions(units.value as Unit, up.checked));
    up.addEventListener("change", () => this.setOptions(units.value as Unit, up.checked));
    return h(
      "div",
      { cls: "cv-file-opts" },
      h("label", { cls: "cv-field" }, h("span", { text: "Units" }), units),
      h("label", { cls: "cv-check" }, up, h("span", { text: "Y is up" })),
    );
  }

  /** Sets the units and up axis, then reads the file again with them: its drawing and conversions go. */
  private setOptions(units: Unit, yUp: boolean): void {
    if (units === this.units && yUp === this.yUp) return;
    this.units = units;
    this.yUp = yUp;
    this.dropDrawing();
    this.clearConversions();
    this.summary = null;
    this.svg = null;
    this.mesh = null;
    this.readError = null;
    this.outOfMemory = false;
    this.state = "reading";
    this.step = "Reading the file";
    this.render();
    if (selected === this) renderPreview();
    refreshBar();
    queueRead(this);
  }

  /** Sends the file's bytes to the worker and takes the drawing it makes. Reads run in turn (see queueRead). */
  async read(): Promise<void> {
    this.queued = false;
    if (this.removed) return;
    const gen = ++this.gen;
    this.state = "reading";
    this.step = "Reading the file";
    this.readError = null;
    this.outOfMemory = false;
    this.render();

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await this.file.arrayBuffer());
    } catch (err) {
      if (gen === this.gen && !this.removed) this.fail(`Could not read ${this.name}: ${messageOf(err)}`);
      return;
    }
    if (gen !== this.gen || this.removed) return;

    try {
      const reply = await client.run(
        this,
        { type: "read", id: ++readSeq, name: this.name, bytes, options: { units: this.units, yUp: this.yUp } },
        (step) => {
          if (gen !== this.gen) return;
          this.step = step;
          this.renderStatus();
        },
        [bytes.buffer],
      );
      if (reply.type !== "read") throw new Error("the converter answered out of turn");
      if (gen !== this.gen || this.removed) {
        client.drop(reply.id);
        return;
      }
      this.readId = reply.id;
      this.summary = reply.summary;
      this.svg = reply.svg;
      this.mesh = reply.mesh;
      this.tab = reply.mesh ? "3d" : "plan";
      this.state = "ready";
      this.render();
      if (selected === this) renderPreview();
      refreshBar();
      void this.convert(chosen);
    } catch (err) {
      if (err instanceof Lost || gen !== this.gen || this.removed) return;
      this.fail(messageOf(err));
    }
  }

  /** Marks the file as failed, with the reason; `outOfMemory` makes the page offer the command line. */
  fail(message: string, outOfMemory = false): void {
    this.dropDrawing();
    this.clearConversions();
    this.state = "failed";
    this.readError = message;
    this.outOfMemory = outOfMemory;
    this.render();
    if (selected === this) renderPreview();
    refreshBar();
  }

  /** The worker stopped and took its drawings with it: a file that isn't failed goes back to reading. */
  forgetDrawing(): void {
    if (this.removed || this.readError !== null) return;
    this.readId = 0;
    this.pending.clear();
    this.summary = null;
    this.svg = null;
    this.mesh = null;
    this.state = "reading";
    this.step = "Reading the file";
    this.render();
  }

  /** Whether the file is still on the page and not failed, so a read after a restart is worth asking for. */
  canRead(): boolean {
    return !this.removed && this.readError === null;
  }

  /** Takes the file off the page: its drawing and conversions go. */
  dispose(): void {
    this.removed = true;
    this.dropDrawing();
    this.clearConversions();
    this.el.remove();
  }

  /** Tells the worker to forget this file's drawing. */
  dropDrawing(): void {
    if (this.readId) client.drop(this.readId);
    this.readId = 0;
  }

  /** Forgets the conversions: their links are released, and one still running is thrown away when it answers. */
  clearConversions(): void {
    for (const made of this.results.values()) URL.revokeObjectURL(made.url);
    this.results.clear();
    this.errors.clear();
    this.pending.clear();
    this.gen++;
  }

  /** Makes the file in `format`, unless it has been made or is being made. A result stays until the file is read again or its units change. */
  async convert(format: string): Promise<void> {
    if (this.state !== "ready" || this.results.has(format) || this.pending.has(format)) return;
    const gen = this.gen;
    this.pending.add(format);
    this.errors.delete(format);
    this.render();
    refreshBar();
    try {
      const made = format === "png" ? await this.png() : await this.makeIn(format);
      if (gen !== this.gen) {
        URL.revokeObjectURL(made.url);
        return;
      }
      this.results.set(format, made);
    } catch (err) {
      if (gen === this.gen && !(err instanceof Lost)) this.errors.set(format, messageOf(err));
    } finally {
      if (gen === this.gen) this.pending.delete(format);
      this.render();
      refreshBar();
    }
  }

  /** Shows the file as it is now: its status, the writer's notes, its problem and its actions. */
  render(): void {
    this.renderStatus();
    const made = this.results.get(chosen);
    this.notesEl.hidden = !made || made.notes.length === 0;
    this.notesEl.textContent = made ? made.notes.map((note) => `${note}.`).join(" ") : "";
    const problem = this.readError ?? this.openError ?? this.errors.get(chosen) ?? null;
    this.errorEl.hidden = problem === null;
    this.errorEl.replaceChildren();
    if (problem !== null) {
      if (this.outOfMemory) {
        const command = this.command();
        this.errorEl.append(`${problem} `, h("code", { cls: "cv-cli", text: command }), copyButton(command));
      } else {
        this.errorEl.textContent = problem;
      }
    }
    this.actionsEl.replaceChildren(...this.actions());
    this.el.classList.toggle("is-failed", this.state === "failed");
  }

  /** Shows what the file is doing: its step while it is read, or what it holds once it is. */
  private renderStatus(): void {
    const text = this.state === "reading" ? `${this.step}…` : this.state === "ready" && this.summary ? summaryLine(this.summary) : "";
    this.statusEl.textContent = text;
    this.statusEl.hidden = text === "";
  }

  /** The buttons and links under the file: its download, the conversion in progress, Open in Rodeo and Remove. */
  private actions(): Node[] {
    const out: Node[] = [];
    if (this.state === "ready") {
      const made = this.results.get(chosen);
      if (made) {
        out.push(h("a", { cls: "cv-btn cv-btn-primary", text: `Download ${made.name} (${sizeText(made.bytes.byteLength)})`, attrs: { href: made.url, download: made.name } }));
      } else if (this.pending.has(chosen)) {
        out.push(h("span", { cls: "cv-busy", text: `Converting to ${formatLabel(chosen)}…` }));
      }
      out.push(button("Open in Rodeo", () => void this.openInRodeo()));
    }
    out.push(button("Remove", () => removeRow(this), "cv-btn cv-btn-quiet"));
    return out;
  }

  /** The command that makes the chosen file on the command line, for a file the browser can't hold. */
  private command(): string {
    const id = chosen === "png" ? "pdf" : chosen;
    const ext = formatById(id)?.writeExtensions[0] ?? id;
    return `npx @rodeo.build/cli convert "${this.name}" "${baseOf(this.name)}.${ext}"`;
  }

  /** Converts the file to a .vwx and takes it into the editor, which opens in a new tab. */
  private async openInRodeo(): Promise<void> {
    this.openError = null;
    // the tab opens now, inside the click, because a browser lets a new tab through only then
    const tab = window.open("", "_blank");
    try {
      const vwx = await this.written("vwx");
      const id = await handOff(vwx.name, this.name, vwx.bytes);
      if (!tab) throw new Error("your browser blocked the new tab: allow pop-ups for this site, then try again");
      tab.location.href = `/?convert=${id}`;
    } catch (err) {
      tab?.close();
      this.openError = `Could not open ${this.name} in Rodeo: ${messageOf(err)}`;
    }
    this.render();
  }

  /** The file the worker makes from this read, in `format`. */
  private async written(format: string): Promise<Extract<FromWorker, { type: "written" }>> {
    if (!this.readId) throw new Error("the file isn't read yet");
    const reply = await client.run(this, { type: "write", id: this.readId, format });
    if (reply.type !== "written") throw new Error("the converter answered out of turn");
    return reply;
  }

  /** The file in `format` as a result the page keeps. */
  private async makeIn(format: string): Promise<Result> {
    const written = await this.written(format);
    return makeResult(written.name, written.mime, written.bytes, written.notes);
  }

  /** The plan drawn as a PNG, its shape kept. The plan text the read made is drawn, or the worker's when that was too large to keep. */
  private async png(): Promise<Result> {
    try {
      if (!this.summary?.bounds2d) throw new Error("there is no plan to draw");
      const plan = this.svg ?? new TextDecoder().decode((await this.written("svg")).bytes);
      const { width, height } = pngSize(plan);
      const blob = await svgToPng(plan, width, height);
      return makeResult(`${baseOf(this.name)}.png`, "image/png", new Uint8Array(await blob.arrayBuffer()), []);
    } catch (err) {
      throw new Error(`Could not convert to PNG: ${messageOf(err)}`);
    }
  }
}

/** Rows in the order they were dropped. */
const rows: Row[] = [];
/** The file the preview shows, or null. */
let selected: Row | null = null;
/** The format the page converts to: the Convert to menu's value. */
let chosen = FALLBACK_TO;
/** The reads, one at a time, so only one file's bytes are being copied to the worker. */
let readChain: Promise<void> = Promise.resolve();
/** The id of the latest read, which is also the id of its drawing in the worker. */
let readSeq = 0;
/** The 3D preview and the plan's object URL on screen. Each redraw takes the last ones down first. */
let view3d: { dispose(): void } | null = null;
let planUrl: string | null = null;
let previewGen = 0;
/** How many dragged things are over the window, so the drop zone lights up until they all leave. */
let dragDepth = 0;

const fileInput = h("input", { hidden: true, attrs: { type: "file", multiple: "" } });
const chooseBtn = button("Choose files", () => fileInput.click(), "cv-btn cv-btn-primary");
const dropEl = h(
  "div",
  { cls: "cv-drop" },
  chooseBtn,
  h("p", { cls: "cv-or", text: "or drop them here" }),
  h("p", { cls: "cv-privacy", text: "Files stay on this computer: nothing is uploaded." }),
  fileInput,
);
const toEl = h(
  "select",
  { cls: "cv-select", attrs: { id: "cv-to" } },
  ...MENU.map(([label, ids]) => h("optgroup", { attrs: { label } }, ...ids.map((id) => h("option", { text: optionText(id), value: id })))),
);
const allBtn = button("Download all (.zip)", downloadAll);
allBtn.hidden = true;
const barEl = h("div", { cls: "cv-bar" }, h("label", { cls: "cv-label", text: "Convert to", attrs: { for: "cv-to" } }), toEl, allBtn);
const listEl = h("ul", { cls: "cv-files" });
const previewEl = h("section", { cls: "cv-preview", hidden: true, attrs: { "aria-label": "Preview" } });
const resultsEl = h("div", { cls: "cv-results", hidden: true }, listEl, previewEl);

fileInput.addEventListener("change", () => {
  addFiles(Array.from(fileInput.files ?? []));
  fileInput.value = "";
});
toEl.addEventListener("change", () => chooseFormat(toEl.value));

// Files dragged over the window light up the drop zone; a drop anywhere adds them.
const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropEl.classList.add("is-over");
});
window.addEventListener("dragleave", (e) => {
  if (!carriesFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropEl.classList.remove("is-over");
});
window.addEventListener("dragover", (e) => {
  if (carriesFiles(e)) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropEl.classList.remove("is-over");
  addFiles(Array.from(e.dataTransfer?.files ?? []));
});

const app = document.getElementById("cv-app");
if (!app) throw new Error("the converter page has no #cv-app");
chosen = startFormat();
toEl.value = chosen;
app.replaceChildren(dropEl, barEl, resultsEl);
pingVisit();

/** Adds the files dropped or chosen: each is a row, read in turn, and the first one picked shows its preview. */
function addFiles(files: readonly File[]): void {
  for (const file of files) {
    const row = new Row(file);
    rows.push(row);
    listEl.append(row.el);
    if (!selected) selectFile(row);
    queueRead(row);
  }
  refreshBar();
}

/** Queues a read of a file. Reads run one at a time, so a large file's bytes are copied to the worker only when its turn comes. */
function queueRead(row: Row): void {
  if (row.queued) return;
  row.queued = true;
  readChain = readChain.then(() => row.read()).catch((err: unknown) => console.error(err));
}

/** Picks the file the preview shows (null for none) and marks its row. */
function selectFile(row: Row | null): void {
  selected = row;
  for (const r of rows) r.el.classList.toggle("is-selected", r === row);
  renderPreview();
}

/** Takes a file off the page: its drawing and conversions go, and the preview moves to the first file left. */
function removeRow(row: Row): void {
  row.dispose();
  const at = rows.indexOf(row);
  if (at >= 0) rows.splice(at, 1);
  if (selected === row) selectFile(rows[0] ?? null);
  refreshBar();
}

/** Converts every file to the format picked, and remembers the pick for next time. */
function chooseFormat(format: string): void {
  chosen = format;
  try {
    localStorage.setItem(CHOICE_KEY, format);
  } catch {
    // storage can be refused (private windows): the next visit then starts on the default
  }
  for (const row of rows) {
    row.openError = null;
    row.render();
    void row.convert(format);
  }
  refreshBar();
}

/** The worker stopped, most likely out of memory. The file it was on fails; every other file is read again. */
function onCrash(owner: Row | null): void {
  for (const row of rows) row.forgetDrawing();
  owner?.fail(OUT_OF_MEMORY, true);
  for (const row of rows) {
    if (row.canRead()) queueRead(row);
  }
  if (selected) renderPreview();
  refreshBar();
}

/** Draws the preview of the picked file: its 3D model or its plan, with its facts. A file not yet read shows none. */
function renderPreview(): void {
  const gen = ++previewGen;
  view3d?.dispose();
  view3d = null;
  if (planUrl) URL.revokeObjectURL(planUrl);
  planUrl = null;
  const row = selected;
  if (!row || row.state !== "ready" || !row.summary) {
    previewEl.hidden = true;
    previewEl.replaceChildren();
    return;
  }
  const summary = row.summary;
  const mesh = row.mesh;
  const svg = row.svg;
  // the tab the file opens on, or the one it has when the other has nothing to show
  const use3d = mesh !== null && (row.tab === "3d" || svg === null);
  const tabs: HTMLButtonElement[] = [];
  if (mesh) tabs.push(tabButton(row, "3d", "3D", use3d));
  if (svg) tabs.push(tabButton(row, "plan", "Plan", !use3d));

  const stage = h("div", { cls: "cv-stage" });
  let body: Node[];
  if (use3d && mesh) {
    body = [stage];
    if (mesh.capped) body.push(h("p", { cls: "cv-note", text: "Preview shows part of the model." }));
    void show3d(stage, mesh, gen);
  } else if (svg) {
    planUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    stage.append(h("img", { attrs: { src: planUrl, alt: `Plan of ${row.name}` } }));
    body = [stage];
  } else {
    body = [h("p", { cls: "cv-note", text: "No preview for this file." })];
  }

  previewEl.hidden = false;
  previewEl.replaceChildren(
    h("h2", { cls: "cv-preview-name", text: row.name }),
    h("div", { cls: "cv-tabs", hidden: tabs.length === 0 }, ...tabs),
    ...body,
    h("dl", { cls: "cv-facts" }, ...factNodes(summary)),
  );
}

/** Draws the 3D model in the stage once the preview's code has loaded. A browser without WebGL gets a line saying so. */
async function show3d(stage: HTMLElement, mesh: PreviewMesh, gen: number): Promise<void> {
  try {
    const { showPreview3d } = await import("./preview3d.ts");
    if (gen !== previewGen) return;
    view3d = showPreview3d(stage, mesh);
  } catch {
    if (gen === previewGen) {
      stage.replaceChildren(h("p", { cls: "cv-note", text: "The 3D preview needs WebGL, which this browser doesn't have. The plan and the facts still work." }));
    }
  }
}

/** A tab over the preview, 3D or Plan, marked when it is the one showing. */
function tabButton(row: Row, tab: "3d" | "plan", label: string, on: boolean): HTMLButtonElement {
  const b = button(
    label,
    () => {
      row.tab = tab;
      renderPreview();
    },
    on ? "cv-tab is-on" : "cv-tab",
  );
  b.setAttribute("aria-pressed", String(on));
  return b;
}

/** Shows Download all when two or more files have their file in the format picked, and the results when there are files. */
function refreshBar(): void {
  allBtn.hidden = rows.filter((r) => r.results.has(chosen)).length < 2;
  resultsEl.hidden = rows.length === 0;
}

/** Downloads the files in the format picked, zipped as rodeo-converted.zip. */
function downloadAll(): void {
  const taken = new Set<string>();
  const files: [string, Uint8Array][] = [];
  for (const row of rows) {
    const made = row.results.get(chosen);
    if (made) files.push([uniqueName(made.name, taken), made.bytes]);
  }
  const url = URL.createObjectURL(new Blob([zipFiles(files) as BlobPart], { type: "application/zip" }));
  download(url, "rodeo-converted.zip");
}

/** Saves a URL's file as `name`, through a link clicked and removed; the URL is released a minute later. */
function download(url: string, name: string): void {
  const link = h("a", { attrs: { href: url, download: name } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The format the page starts on: the "to" of /convert/<from>-to-<to>, else ?to=, else the one picked last time, else PDF. */
function startFormat(): string {
  const fromPath = /^\/convert\/[a-z0-9]+-to-([a-z0-9]+)\/?$/.exec(location.pathname)?.[1];
  const fromQuery = new URLSearchParams(location.search).get("to");
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(CHOICE_KEY);
  } catch {
    // storage can be refused (private windows): the page then starts on its default
  }
  for (const id of [fromPath, fromQuery, saved]) {
    if (id && CHOICES.has(id)) return id;
  }
  return FALLBACK_TO;
}

/** The text of a Convert to option: "Vectorworks (.vwx)", "PNG (.png)". */
function optionText(id: string): string {
  if (id === "png") return "PNG (.png)";
  const info = formatById(id);
  return `${info?.name ?? id} (.${info?.writeExtensions[0] ?? id})`;
}

/** A format's name on the page: "IFC", "PNG". */
function formatLabel(id: string): string {
  return id === "png" ? "PNG" : (formatById(id)?.name ?? id);
}

/** The PNG's pixel size for a plan: PNG_WIDTH wide, or as tall as MAX_PNG_SIDE allows at the plan's shape. */
function pngSize(svg: string): { width: number; height: number } {
  const box = /viewBox="\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)\s*"/.exec(svg);
  const vw = box ? Number(box[3]) : 1;
  const vh = box ? Number(box[4]) : 1;
  const aspect = vw > 0 && vh > 0 && Number.isFinite(vh / vw) ? vh / vw : 1;
  let width = PNG_WIDTH;
  let height = Math.round(PNG_WIDTH * aspect);
  if (height > MAX_PNG_SIDE) {
    height = MAX_PNG_SIDE;
    width = Math.round(MAX_PNG_SIDE / aspect);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/** The facts under the preview: units, layers, the commonest objects, the size, what was left out and the notes. */
function factNodes(s: DrawingSummary): Node[] {
  const layerNames = s.layers.map((l) => l.name);
  const types = Object.entries(s.objects);
  const top = types.slice(0, TYPES_SHOWN).map(([name, n]) => `${capitalised(name)} ${fmt(n)}`);
  const other = types.slice(TYPES_SHOWN).reduce((sum, [, n]) => sum + n, 0);
  if (other > 0) top.push(`${fmt(other)} other`);
  const left = Object.entries(s.skipped)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${kind} ${fmt(n)}`);
  const more = layerNames.length > LAYERS_SHOWN ? `, and ${fmt(layerNames.length - LAYERS_SHOWN)} more` : "";
  const facts: [string, string | string[]][] = [
    ["Units", s.units],
    ["Layers", layerNames.length ? `${fmt(layerNames.length)}: ${layerNames.slice(0, LAYERS_SHOWN).join(", ")}${more}` : "None"],
    ["Objects", s.totalObjects ? `${fmt(s.totalObjects)}: ${top.join(" · ")}` : "None"],
    ["Size", extentOf(s)],
  ];
  if (left.length) facts.push(["Left out", left.join(" · ")]);
  if (s.notes.length) facts.push(["Notes", s.notes.map((note) => `${note}.`)]);
  return facts.flatMap(([label, value]) => {
    const lines = typeof value === "string" ? [value] : value;
    return [h("dt", { text: label }), h("dd", {}, ...lines.map((line) => h("div", { text: line })))];
  });
}

/** The size as summaryLine gives it: its fourth part after the format, layers and objects ("48.2 × 32.0 × 41.5 m"), or "None" when there is no extent. */
function extentOf(s: DrawingSummary): string {
  const parts = summaryLine(s).split(" · ");
  return parts.length > 3 ? parts.slice(3).join(" · ") : "None";
}

/** A button with a label and a click handler. */
function button(label: string, onClick: () => void, cls = "cv-btn"): HTMLButtonElement {
  const b = h("button", { cls, text: label, attrs: { type: "button" } });
  b.addEventListener("click", onClick);
  return b;
}

/** A button that copies `text` to the clipboard, and says whether it did. */
function copyButton(text: string): HTMLButtonElement {
  const b = button("Copy command", () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        b.textContent = "Copied";
      },
      () => {
        b.textContent = "Copy failed";
      },
    );
  });
  return b;
}

/** A file's size as the page shows it, in the decimal units file managers use: "512 B", "210 KB", "12.4 MB". */
function sizeText(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** A file name without its extension: "tower" for "tower.rvt". */
function baseOf(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

/** A name not yet in `taken`, numbered before its extension when it is ("a (2).ifc"); records the name it returns. */
function uniqueName(name: string, taken: Set<string>): string {
  const base = baseOf(name);
  const ext = name.slice(base.length);
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${base} (${n})${ext}`;
  taken.add(out);
  return out;
}

/** A thousands-separated count, in English. */
function fmt(n: number): string {
  return n.toLocaleString("en");
}

/** A type name with its first letter capitalised, as the facts show it: "Wall". */
function capitalised(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The text of an error, whatever was thrown. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Counts this visit for the admin page, as the editor does. Test browsers send nothing. */
function pingVisit(): void {
  if (navigator.webdriver) return;
  const params = new URLSearchParams(location.search);
  void fetch("/api/visits", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" },
    body: JSON.stringify({
      event: "visit",
      entry: "convert",
      device: deviceOf(),
      referrer: referrerHost(),
      campaign: params.get("utm_source") ?? params.get("ref"),
    }),
  }).catch(() => {});
}

/** The kind of device this is: a phone or a tablet when the pointer is a finger, else a desktop. */
function deviceOf(): "phone" | "tablet" | "desktop" {
  if (!matchMedia("(pointer: coarse)").matches) return "desktop";
  return Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet";
}

/** The host of the page that linked here, or null when it is this site or none. */
function referrerHost(): string | null {
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    return host && host !== location.hostname ? host : null;
  } catch {
    return null;
  }
}
