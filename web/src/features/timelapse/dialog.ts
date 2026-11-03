// File > Export Timelapse…: the source (this session, the saved history, or a cloud drawing's
// version history), what to show, the framing, resolution, length, format, paper and captions. A
// preview shows the drawing at any frame; Export renders the file, with progress and Stop.

import "./timelapse.css";
import { appContext, documentSource } from "../../app/ext.ts";
import { h } from "../../app/dom.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { files } from "../../platform/api.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { extensionOf, formatsAvailable, type Format } from "./encode.ts";
import { ExportCancelled, GIF_MAX_SECONDS, frameCount, renderTimelapse } from "./export.ts";
import { FrameRenderer, type LayerChoice, type Look, type Plan, type ViewState } from "./frames.ts";
import { hasSavedState, savedRecording, sessionRecording } from "./record.ts";
import { timelineFor, type Source, type Timeline } from "./timeline.ts";

const MB = 1024 * 1024;
/** drawings over this take noticeably longer per frame */
const LARGE_BYTES = 100 * MB;
/** the preview is drawn at most this wide; the file is drawn at the chosen resolution */
const PREVIEW_MAX_WIDTH = 960;

const RESOLUTIONS = [
  { label: "1280 × 720", width: 1280, height: 720 },
  { label: "1920 × 1080", width: 1920, height: 1080 },
  { label: "1080 × 1080", width: 1080, height: 1080 },
];
const DURATIONS = [10, 20, 30, 60];
const FORMAT_LABEL: Record<Format, string> = { webm: "WebM video", mp4: "MP4 video", gif: "GIF animation" };

type SourceKind = "session" | "saved" | "versions";
const SOURCES: readonly SourceKind[] = ["session", "saved", "versions"];
const SOURCE_LABEL: Record<SourceKind, string> = { session: "This session", saved: "Saved history", versions: "Version history" };

/** The contents of a source; throws, with the reason, when it has none. */
async function loadSource(kind: SourceKind): Promise<Source> {
  if (kind === "session") {
    const r = sessionRecording();
    if (!r) throw new Error("This drawing is not recorded.");
    return { kind: "history", label: SOURCE_LABEL.session, start: r.start, ops: r.ops, created: r.created };
  }
  if (kind === "saved") {
    const r = await savedRecording();
    if (!r) throw new Error("This drawing has no saved history yet. Save it first.");
    return { kind: "history", label: SOURCE_LABEL.saved, start: r.start, ops: r.ops, created: r.created };
  }
  const file = documentSource();
  if (!isCloudSource(file)) throw new Error("Only cloud drawings have a version history.");
  const versions = (await files.versions(file.id))
    .map((v) => ({ id: v.id, createdAt: Date.parse(v.createdAt) }))
    .sort((a, b) => a.createdAt - b.createdAt);
  if (versions.length === 0) throw new Error("This drawing has no saved versions.");
  return {
    kind: "versions",
    label: SOURCE_LABEL.versions,
    versions,
    fetch: async (id: string) => (await files.content(file.id, id)).bytes,
  };
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h("label", { cls: "menu-dialog-field tl-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
}

function select(label: string, options: readonly { value: string; label: string; disabled?: boolean }[], value: string): HTMLSelectElement {
  const el = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select tl-select", attrs: { "aria-label": label } },
    ...options.map((o) => h("option", { value: o.value, text: o.label, disabled: o.disabled ?? false })),
  );
  el.value = value;
  return el;
}

function checkbox(label: string, on: boolean): { box: HTMLInputElement; row: HTMLElement } {
  const box = h("input", { attrs: { type: "checkbox" } });
  box.checked = on;
  return { box, row: h("label", { cls: "menu-dialog-check" }, box, label) };
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

class TimelapseDialog {
  private readonly preview = new FrameRenderer();
  private readonly layers = store.session?.doc.layers() ?? [];
  /** the editor's view when the dialog opened: what "Current view" shows */
  private readonly view: ViewState | null = (() => {
    const v = appContext()?.view;
    return v ? { cx: v.cx, cy: v.cy, scale: v.scale, cssWidth: v.width } : null;
  })();
  private source: Source | null = null;
  private sourceKind: SourceKind | null = null;
  private timeline: Timeline | null = null;
  /** where the preview is, as a fraction of the timelapse, so changing the length keeps the place */
  private fraction = 1;
  private loadToken = 0;
  private previewToken = 0;
  private previewQueued = 0;
  private fitCache: { key: string; box: Plan["fitBox"] } | null = null;
  private stop: AbortController | null = null;
  private closed = false;

  private readonly sourceSel = select("Source", [], "session");
  private readonly layerSel = select(
    "Show",
    [
      { value: "visible", label: "Visible design layers" },
      ...this.layers.map((l) => ({
        value: l.id,
        label: l.kind === "sheet" ? `Sheet ${l.name}${l.title ? ` · ${l.title}` : ""}` : l.name,
      })),
    ],
    "visible",
  );
  private readonly framingSel = select(
    "Framing",
    [
      { value: "fit", label: "Fit the finished drawing" },
      { value: "current", label: "Current view", disabled: this.view === null },
    ],
    "fit",
  );
  private readonly resSel = select(
    "Resolution",
    RESOLUTIONS.map((r, i) => ({ value: String(i), label: r.label })),
    "1",
  );
  private readonly durSel = select(
    "Length",
    DURATIONS.map((d) => ({ value: String(d), label: `${d} s` })),
    "20",
  );
  private readonly fmtSel = select(
    "Format",
    formatsAvailable().map((f) => ({ value: f, label: FORMAT_LABEL[f] })),
    formatsAvailable()[0],
  );
  private readonly paperSel = select(
    "Paper",
    [
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
    "light",
  );
  private readonly date = checkbox("Date and time", true);
  private readonly watermark = checkbox("Made with Rodeo", true);

  private readonly canvas = h("canvas", { cls: "tl-canvas", attrs: { "aria-label": "Preview" } });
  private readonly scrub = h("input", { cls: "tl-scrub", attrs: { type: "range", min: "0", step: "1", "aria-label": "Frame" } });
  private readonly readout = h("p", { cls: "tl-readout" });
  private readonly note = h("p", { cls: "tl-note", attrs: { role: "status" } });
  private readonly bar = h("div", { cls: "tl-bar-fill" });
  private readonly status = h("p", { cls: "tl-status" });
  private readonly progress = h("div", { cls: "tl-progress", hidden: true }, h("div", { cls: "tl-bar" }, this.bar), this.status);
  private readonly exportBtn = h("button", { cls: "btn primary", text: "Export", attrs: { type: "submit" } });
  private readonly closeBtn = h("button", { cls: "btn", text: "Close", attrs: { type: "button" } });
  private readonly backdrop = h("div", { cls: "menu-dialog-backdrop tl-backdrop" });
  private readonly form = h("form", {
    cls: "menu-dialog tl-dialog",
    attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Export Timelapse" },
  });

  /** the frames the length gives, in the chosen format */
  private frames(): number {
    return frameCount(this.seconds(), this.format());
  }

  private seconds(): number {
    return Number(this.durSel.value);
  }

  private format(): Format {
    return this.fmtSel.value as Format;
  }

  private resolution(): { width: number; height: number } {
    return RESOLUTIONS[Number(this.resSel.value)] ?? RESOLUTIONS[1];
  }

  /** the preview frame the scrubber is at, for the current length */
  private frameIndex(): number {
    return Math.round(this.fraction * (this.frames() - 1));
  }

  async open(): Promise<void> {
    this.form.append(
      h("h2", { cls: "menu-dialog-title", text: "Export Timelapse" }),
      h(
        "div",
        { cls: "tl-body" },
        h("div", { cls: "tl-preview" }, h("div", { cls: "tl-stage" }, this.canvas), this.scrub, this.readout),
        h(
          "div",
          { cls: "tl-controls" },
          field("Source", this.sourceSel),
          field("Show", this.layerSel),
          field("Framing", this.framingSel),
          field("Resolution", this.resSel),
          field("Length", this.durSel),
          field("Format", this.fmtSel),
          field("Paper", this.paperSel),
          this.date.row,
          this.watermark.row,
        ),
      ),
      this.note,
      this.progress,
      h("div", { cls: "menu-dialog-actions" }, this.closeBtn, this.exportBtn),
    );
    this.backdrop.append(this.form);
    document.body.append(this.backdrop);

    this.closeBtn.addEventListener("click", () => this.close());
    this.backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === this.backdrop && !this.stop) this.close();
    });
    this.backdrop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" && !this.stop) {
        e.preventDefault();
        this.close();
      }
    });
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (this.stop) this.stop.abort();
      else void this.export();
    });
    this.sourceSel.addEventListener("change", () => void this.chooseSource(this.sourceSel.value as SourceKind));
    this.durSel.addEventListener("change", () => this.lengthChanged());
    this.fmtSel.addEventListener("change", () => this.queueRedraw());
    for (const el of [this.layerSel, this.framingSel, this.resSel, this.paperSel]) el.addEventListener("change", () => this.queueRedraw());
    for (const c of [this.date.box, this.watermark.box]) c.addEventListener("change", () => this.queueRedraw());
    this.scrub.addEventListener("input", () => {
      this.fraction = Number(this.scrub.value) / Math.max(1, this.frames() - 1);
      this.queueRedraw();
    });

    await this.offerSources();
    this.lengthChanged();
    this.sourceSel.focus();
  }

  /** Lists the sources, and shows the first one that has contents. */
  private async offerSources(): Promise<void> {
    const sessionOk = sessionRecording() !== null;
    // storage can be blocked: then there is no saved history, and the rest still works
    const savedOk = sessionOk && (await hasSavedState().catch(() => false));
    const cloudOk = isCloudSource(documentSource());
    const ok: Record<SourceKind, boolean> = { session: sessionOk, saved: savedOk, versions: cloudOk };
    const why: Record<SourceKind, string> = {
      session: " (not recorded: over 100 MB)",
      saved: " (save the drawing first)",
      versions: " (cloud drawings only)",
    };
    this.sourceSel.replaceChildren(
      ...SOURCES.map((k) => h("option", { value: k, text: SOURCE_LABEL[k] + (ok[k] ? "" : why[k]), disabled: !ok[k] })),
    );
    const first = SOURCES.find((k) => ok[k]);
    if (!first) {
      this.note.textContent = "Nothing to show: this drawing has no recorded history and is not a cloud drawing.";
      this.exportBtn.disabled = true;
      this.sourceSel.disabled = true;
      return;
    }
    this.sourceSel.value = first;
    await this.chooseSource(first);
  }

  private async chooseSource(kind: SourceKind): Promise<void> {
    const token = ++this.loadToken;
    this.sourceKind = kind;
    this.exportBtn.disabled = true;
    this.note.textContent = "Loading…";
    try {
      const source = await loadSource(kind);
      if (token !== this.loadToken || this.closed) return;
      this.source = source;
      this.timeline = timelineFor(source);
      this.fitCache = null;
      this.fraction = 1;
      this.exportBtn.disabled = false;
      this.note.textContent = this.noteText();
      await this.redrawNow();
    } catch (err) {
      if (token !== this.loadToken || this.closed) return;
      this.source = null;
      this.timeline = null;
      this.exportBtn.disabled = true;
      this.note.textContent = errorMessage(err);
      this.readout.textContent = "";
    }
  }

  private noteText(): string {
    const notes: string[] = [];
    if (this.source?.kind === "history" && this.source.ops.length === 0) {
      notes.push("No changes are recorded: the timelapse shows the drawing as it was opened.");
    }
    if (store.fileSize > LARGE_BYTES) {
      notes.push("This drawing is over 100 MB, so each frame takes longer. Showing one layer makes it faster.");
    }
    return notes.join(" ");
  }

  /** GIF is written only up to GIF_MAX_SECONDS: a longer length switches a GIF to the first video format. */
  private lengthChanged(): void {
    const gif = this.fmtSel.querySelector<HTMLOptionElement>('option[value="gif"]');
    const tooLong = this.seconds() > GIF_MAX_SECONDS;
    if (gif) gif.disabled = tooLong;
    if (tooLong && this.format() === "gif") {
      const video = [...this.fmtSel.options].find((o) => !o.disabled);
      if (video) this.fmtSel.value = video.value;
    }
    this.queueRedraw();
  }

  /** The plan's fitted extent, found once per source and layer choice. */
  private async plan(): Promise<Plan> {
    const layer: LayerChoice = this.layerSel.value;
    const fit = this.framingSel.value === "fit" || this.view === null;
    let fitBox: Plan["fitBox"] = null;
    if (fit && this.timeline) {
      const key = `${this.sourceKind}:${layer}`;
      if (this.fitCache?.key !== key) {
        const last = await this.timeline.last();
        this.fitCache = { key, box: this.preview.extent(last, layer) };
      }
      fitBox = this.fitCache.box;
    }
    return { layer, fitBox, current: fit ? null : this.view };
  }

  private look(preview: boolean): Look {
    const r = this.resolution();
    const scale = preview ? Math.min(1, PREVIEW_MAX_WIDTH / r.width) : 1;
    return {
      width: Math.round(r.width * scale),
      height: Math.round(r.height * scale),
      dark: this.paperSel.value === "dark",
      date: this.date.box.checked,
      watermark: this.watermark.box.checked,
    };
  }

  private queueRedraw(): void {
    if (this.previewQueued) return;
    this.previewQueued = requestAnimationFrame(() => {
      this.previewQueued = 0;
      void this.redrawNow();
    });
  }

  /** Draws the preview at the scrubber's frame. */
  private async redrawNow(): Promise<void> {
    const timeline = this.timeline;
    const frames = this.frames();
    const frame = this.frameIndex();
    this.scrub.max = String(Math.max(0, frames - 1));
    this.scrub.value = String(frame);
    if (!timeline) return;
    const token = ++this.previewToken;
    try {
      const plan = await this.plan();
      const shown = await timeline.at(frame, frames);
      if (token !== this.previewToken || this.closed) return;
      await this.preview.show(shown, plan, this.look(true), this.canvas);
      if (token !== this.previewToken) return;
      const step =
        this.source?.kind === "history"
          ? shown.key === 0
            ? "the opening"
            : `change ${shown.key} of ${timeline.steps}`
          : `version ${shown.key + 1} of ${timeline.steps}`;
      const when = shown.time !== null ? ` · ${formatWhen(shown.time)}` : "";
      this.readout.textContent = `Frame ${frame + 1} of ${frames}: ${step}${when}`;
    } catch (err) {
      if (token === this.previewToken) this.readout.textContent = `Preview failed: ${errorMessage(err)}`;
    }
  }

  private async export(): Promise<void> {
    const source = this.source;
    if (!source) return;
    const layer: LayerChoice = this.layerSel.value;
    if (layer === "visible" && !this.layers.some((l) => l.kind === "design" && l.visibility !== "hidden")) {
      this.note.textContent = "There is no visible design layer to show.";
      return;
    }
    if (store.fileSize > LARGE_BYTES && layer === "visible") {
      const ok = await confirmDialog(
        "Large drawing",
        "This drawing is over 100 MB, so every frame takes longer. Showing one layer makes it faster. Export all visible design layers anyway?",
        "Export",
      );
      if (!ok) return;
    }
    const format = this.format();
    const r = this.resolution();
    const controller = new AbortController();
    this.setRunning(controller);
    try {
      const blob = await renderTimelapse({
        timeline: timelineFor(source),
        layer,
        fit: this.framingSel.value === "fit" || this.view === null,
        view: this.view,
        width: r.width,
        height: r.height,
        dark: this.paperSel.value === "dark",
        date: this.date.box.checked,
        watermark: this.watermark.box.checked,
        seconds: this.seconds(),
        format,
        signal: controller.signal,
        onProgress: (done, total) => {
          this.bar.style.width = `${Math.round((done / total) * 100)}%`;
          this.status.textContent = `Frame ${done} of ${total}. Keep this tab open until the file is ready.`;
        },
      });
      const base = store.fileName.replace(/\.vwx$/i, "") || "drawing";
      downloadBlob(`${base}-timelapse.${extensionOf(format)}`, blob);
      toast(`Timelapse exported (${(blob.size / MB).toFixed(1)} MB).`, "info");
      this.close();
    } catch (err) {
      if (err instanceof ExportCancelled || controller.signal.aborted) toast("Timelapse export stopped.", "info");
      else toast(`Timelapse export failed: ${errorMessage(err)}`);
    } finally {
      this.setRunning(null);
    }
  }

  /** Locks the controls while a file is rendered; Export becomes Stop. */
  private setRunning(controller: AbortController | null): void {
    this.stop = controller;
    this.progress.hidden = controller === null;
    this.bar.style.width = "0%";
    this.status.textContent = controller ? "Starting…" : "";
    for (const el of [this.sourceSel, this.layerSel, this.framingSel, this.resSel, this.durSel, this.fmtSel, this.paperSel, this.date.box, this.watermark.box]) {
      el.disabled = controller !== null;
    }
    this.exportBtn.textContent = controller ? "Stop" : "Export";
    this.closeBtn.disabled = controller !== null;
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.backdrop.remove();
  }
}

/** File > Export Timelapse…: opens the dialog for the open drawing. */
export async function openTimelapseDialog(): Promise<void> {
  if (!store.session) return;
  await new TimelapseDialog().open();
}
