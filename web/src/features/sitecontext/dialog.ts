// File > Import Site Context…: a large dialog with a Leaflet map to choose the area on (a place
// search, or a rectangle dragged out, at most 2 km × 2 km), a checklist of the kinds of context, and
// where the area's centre goes. Import shows its steps and can be cancelled; the drawing gets the
// result as one undo step (commands.ts's attempt), on a new design layer, which is then made active.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./context.css";
import { appContext } from "../../app/ext.ts";
import { attempt, setActiveLayer } from "../../app/commands.ts";
import { h } from "../../app/dom.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import {
  boxCentre,
  boxFromCorners,
  boxSizeM,
  boxTooLarge,
  MAX_SIDE_M,
  projectionAt,
  toMetres,
  type GeoBox,
} from "./geo.ts";
import { runImport, type ImportResult } from "./importer.ts";
import type { SiteCategory } from "./model.ts";
import { searchPlaces, type Place } from "./services.ts";
import { siteOverlay } from "./overlay3d.ts";
import { writeSiteContext, type WriteReport } from "./writer.ts";
import type { Pt } from "../../core/index.ts";

/** The kinds of context, in the order the checklist lists them. */
const KINDS: readonly { cat: SiteCategory; label: string }[] = [
  { cat: "terrain", label: "Terrain" },
  { cat: "buildings", label: "Buildings" },
  { cat: "roads", label: "Roads" },
  { cat: "paths", label: "Paths and cycleways" },
  { cat: "rail", label: "Railways" },
  { cat: "water", label: "Water" },
  { cat: "green", label: "Green spaces" },
  { cat: "trees", label: "Trees" },
  { cat: "facilities", label: "Public facilities" },
];

const CONTOUR_INTERVALS = [1, 2, 5, 10];
const MIN_AREA_M = 5;
const SEARCH_DEBOUNCE_MS = 600;
const SEARCH_MIN_CHARS = 2;

interface Settings {
  area: GeoBox | null;
  kinds: Set<SiteCategory>;
  contourInterval: number;
  labelHeights: boolean;
  centreLines: boolean;
  placement: "origin" | "view";
}

/** Opens the dialog; resolves when it closes. */
export function openSiteContextDialog(): Promise<void> {
  return new Promise((resolve) => {
    const dialog = new SiteContextDialog(() => resolve());
    dialog.open();
  });
}

class SiteContextDialog {
  private readonly done: () => void;
  private readonly settings: Settings = {
    area: null,
    kinds: new Set(KINDS.map((k) => k.cat)),
    contourInterval: 5,
    labelHeights: false,
    centreLines: false,
    placement: "origin",
  };
  private mapEl: HTMLElement | null = null;
  private readonly returnFocus: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private backdrop: HTMLElement | null = null;
  private map: L.Map | null = null;
  private rect: L.Rectangle | null = null;
  private drawing = false;
  private anchor: L.LatLng | null = null;
  private drawButton: HTMLButtonElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private resultList: HTMLElement | null = null;
  private searchStatus: HTMLElement | null = null;
  private searchTimer = 0;
  private searchAbort: AbortController | null = null;
  private areaText: HTMLElement | null = null;
  private warning: HTMLElement | null = null;
  private error: HTMLElement | null = null;
  private steps: HTMLElement | null = null;
  private importButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private intervalSelect: HTMLSelectElement | null = null;
  private labelBox: HTMLInputElement | null = null;
  private centreBox: HTMLInputElement | null = null;
  /** the import in progress: its controller and the steps shown so far */
  private run: AbortController | null = null;
  private stepLabels: string[] = [];

  constructor(done: () => void) {
    this.done = done;
  }

  open(): void {
    const backdrop = h("div", { cls: "menu-dialog-backdrop sc-backdrop" });
    this.backdrop = backdrop;
    const panel = h(
      "div",
      { cls: "menu-dialog sc-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Import Site Context" } },
      h("h2", { cls: "sc-title", text: "Import Site Context" }),
      h("div", { cls: "sc-body" }, this.sidebar(), this.mapPane()),
      this.footer(),
    );
    backdrop.append(panel);
    document.body.append(backdrop);

    // every key stays inside the dialog: the window's shortcuts do not run under it
    backdrop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (this.drawing) this.setDrawing(false);
      else if (this.run) this.cancelRun();
      else this.close();
    });
    // a click outside the box closes it, unless an import is running
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop && !this.run) this.close();
    });

    this.initMap();
    this.refresh();
    this.searchInput?.focus();
  }

  // ---- layout -----------------------------------------------------------------

  private sidebar(): HTMLElement {
    this.searchInput = h("input", {
      cls: "menu-dialog-input sc-search",
      attrs: { type: "search", "aria-label": "Find a place", placeholder: "Find a place…", spellcheck: "false", autocomplete: "off" },
    });
    this.searchInput.addEventListener("input", () => this.onSearchInput());
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        window.clearTimeout(this.searchTimer);
        this.runSearch(this.searchInput?.value.trim() ?? "");
      }
    });
    this.resultList = h("ul", { cls: "sc-results", attrs: { role: "listbox", "aria-label": "Places" }, hidden: true });
    this.searchStatus = h("p", { cls: "sc-hint muted" });

    this.drawButton = h("button", {
      cls: "btn sc-draw",
      text: "Draw Area",
      attrs: { type: "button", "aria-pressed": "false" },
    });
    this.drawButton.addEventListener("click", () => this.setDrawing(!this.drawing));
    this.areaText = h("p", { cls: "sc-area" });
    this.warning = h("p", { cls: "sc-warning", attrs: { role: "status" }, hidden: true });

    const kindRows = KINDS.map(({ cat, label }) => this.kindRow(cat, label));
    const placeRadio = (value: "origin" | "view", label: string): HTMLElement => {
      const box = h("input", { attrs: { type: "radio", name: "sc-place", value } });
      box.checked = this.settings.placement === value;
      box.addEventListener("change", () => {
        if (box.checked) this.settings.placement = value;
      });
      return h("label", { cls: "menu-dialog-check" }, box, label);
    };

    return h(
      "aside",
      { cls: "sc-side" },
      h("h3", { cls: "sc-heading", text: "Find a place" }),
      this.searchInput,
      this.resultList,
      this.searchStatus,
      h("h3", { cls: "sc-heading", text: "Area" }),
      this.drawButton,
      this.areaText,
      this.warning,
      h("h3", { cls: "sc-heading", text: "Include" }),
      ...kindRows,
      h("h3", { cls: "sc-heading", text: "Place the area's centre" }),
      placeRadio("origin", "Drawing origin (0, 0)"),
      placeRadio("view", "Current view centre"),
      h(
        "p",
        { cls: "sc-credit muted" },
        "Data: © OpenStreetMap contributors (ODbL) through Overpass, and AWS terrain tiles. Heights are in metres, drawn at true scale.",
      ),
    );
  }

  private kindRow(cat: SiteCategory, label: string): HTMLElement {
    const box = h("input", { attrs: { type: "checkbox" } });
    box.checked = this.settings.kinds.has(cat);
    box.addEventListener("change", () => {
      if (box.checked) this.settings.kinds.add(cat);
      else this.settings.kinds.delete(cat);
      this.refresh();
    });
    const extra: HTMLElement[] = [];
    if (cat === "terrain") {
      const select = h(
        "select",
        { cls: "menu-dialog-input menu-dialog-select sc-option", attrs: { "aria-label": "Contour interval" } },
        ...CONTOUR_INTERVALS.map((m) => h("option", { value: String(m), text: `${m} m` })),
      );
      select.value = String(this.settings.contourInterval);
      select.addEventListener("change", () => {
        this.settings.contourInterval = Number(select.value);
      });
      this.intervalSelect = select;
      extra.push(h("span", { cls: "sc-sub muted", text: "contours every" }), select);
    }
    if (cat === "buildings") {
      this.labelBox = h("input", { attrs: { type: "checkbox" } });
      this.labelBox.checked = this.settings.labelHeights;
      this.labelBox.addEventListener("change", () => {
        this.settings.labelHeights = this.labelBox?.checked ?? false;
      });
      extra.push(h("label", { cls: "menu-dialog-check sc-sub" }, this.labelBox, "Label heights"));
    }
    if (cat === "roads") {
      this.centreBox = h("input", { attrs: { type: "checkbox" } });
      this.centreBox.checked = this.settings.centreLines;
      this.centreBox.addEventListener("change", () => {
        this.settings.centreLines = this.centreBox?.checked ?? false;
      });
      extra.push(h("label", { cls: "menu-dialog-check sc-sub" }, this.centreBox, "Centre lines"));
    }
    return h(
      "div",
      { cls: "sc-kind" },
      h("label", { cls: "menu-dialog-check" }, box, label),
      extra.length > 0 ? h("div", { cls: "sc-kind-options" }, ...extra) : null,
    );
  }

  private mapPane(): HTMLElement {
    const el = h("div", { cls: "sc-map", attrs: { "aria-label": "Map" } });
    this.mapEl = el;
    return el;
  }

  private footer(): HTMLElement {
    this.steps = h("ol", { cls: "sc-steps", hidden: true });
    this.error = h("p", { cls: "menu-dialog-error", attrs: { role: "alert" }, hidden: true });
    this.cancelButton = h("button", { cls: "btn", text: "Cancel", attrs: { type: "button" } });
    this.cancelButton.addEventListener("click", () => {
      if (this.run) this.cancelRun();
      else this.close();
    });
    this.importButton = h("button", { cls: "btn primary", text: "Import", attrs: { type: "button" } });
    this.importButton.addEventListener("click", () => void this.importNow());
    return h(
      "div",
      { cls: "sc-foot" },
      this.steps,
      this.error,
      h("div", { cls: "menu-dialog-actions" }, this.cancelButton, this.importButton),
    );
  }

  // ---- map ----------------------------------------------------------------------

  private initMap(): void {
    if (!this.mapEl) return;
    const map = L.map(this.mapEl, { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    this.map = map;
    // a drag makes the rectangle while Draw Area is on: pointer events on the map's container
    const container = map.getContainer();
    container.addEventListener("pointerdown", (e) => {
      if (!this.drawing || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      container.setPointerCapture(e.pointerId);
      this.anchor = map.mouseEventToLatLng(e);
      this.previewArea(this.anchor, this.anchor);
    });
    container.addEventListener("pointermove", (e) => {
      if (!this.anchor) return;
      this.previewArea(this.anchor, map.mouseEventToLatLng(e));
    });
    container.addEventListener("pointerup", (e) => {
      if (!this.anchor) return;
      const end = map.mouseEventToLatLng(e);
      const start = this.anchor;
      this.anchor = null;
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
      const box = boxFromCorners({ lat: start.lat, lon: start.lng }, { lat: end.lat, lon: end.lng });
      const { width, height } = boxSizeM(box);
      // a click without a drag keeps the area chosen before
      if (width >= MIN_AREA_M && height >= MIN_AREA_M) this.settings.area = box;
      this.setDrawing(false);
    });
  }

  private setDrawing(on: boolean): void {
    this.drawing = on;
    this.drawButton?.setAttribute("aria-pressed", String(on));
    if (this.drawButton) this.drawButton.textContent = on ? "Drag on the map…" : this.settings.area ? "Redraw Area" : "Draw Area";
    this.mapEl?.classList.toggle("sc-drawing", on);
    if (this.map) {
      if (on) {
        this.map.dragging.disable();
        this.map.doubleClickZoom.disable();
      } else {
        this.map.dragging.enable();
        this.map.doubleClickZoom.enable();
      }
    }
    if (!on) this.anchor = null;
    this.refresh();
  }

  /** Shows the rectangle between two corners while it is being dragged out (not yet kept). */
  private previewArea(a: L.LatLng, b: L.LatLng): void {
    const box = boxFromCorners({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
    this.showRect(box);
    const { width, height } = boxSizeM(box);
    this.updateAreaText(width, height);
    this.setWarning(warningFor(box));
  }

  /** Takes the rectangle off the map (no area is chosen). */
  private hideRect(): void {
    this.rect?.remove();
    this.rect = null;
  }

  private showRect(box: GeoBox): void {
    if (!this.map) return;
    const bounds = L.latLngBounds([box.south, box.west], [box.north, box.east]);
    const tooLarge = boxTooLarge(box);
    const style = { color: tooLarge ? "#d33" : "#2b78e4", weight: 2, fillOpacity: 0.08 };
    if (!this.rect) this.rect = L.rectangle(bounds, style).addTo(this.map);
    else {
      this.rect.setBounds(bounds);
      this.rect.setStyle(style);
    }
  }

  // ---- search -------------------------------------------------------------------

  private onSearchInput(): void {
    window.clearTimeout(this.searchTimer);
    const q = this.searchInput?.value.trim() ?? "";
    if (q.length < SEARCH_MIN_CHARS) {
      this.searchAbort?.abort();
      this.showResults([], "");
      return;
    }
    this.searchStatus?.replaceChildren();
    this.searchTimer = window.setTimeout(() => this.runSearch(q), SEARCH_DEBOUNCE_MS);
  }

  private runSearch(q: string): void {
    if (q.length < SEARCH_MIN_CHARS) return;
    this.searchAbort?.abort();
    const ctl = new AbortController();
    this.searchAbort = ctl;
    this.showResults([], "Searching…");
    searchPlaces(q, ctl.signal).then(
      (places) => {
        if (ctl.signal.aborted) return;
        this.showResults(places, places.length === 0 ? "No places found." : "");
      },
      (err: unknown) => {
        if (ctl.signal.aborted) return;
        this.showResults([], err instanceof Error ? err.message : "The place search failed.");
      },
    );
  }

  private showResults(places: readonly Place[], status: string): void {
    if (!this.resultList || !this.searchStatus) return;
    this.resultList.replaceChildren(
      ...places.map((p) => {
        const item = h("button", { cls: "sc-result", text: p.name, attrs: { type: "button", role: "option" } });
        item.addEventListener("click", () => this.goTo(p));
        return h("li", {}, item);
      }),
    );
    this.resultList.hidden = places.length === 0;
    this.searchStatus.textContent = status;
  }

  private goTo(p: Place): void {
    if (!this.map) return;
    if (p.box) this.map.fitBounds([[p.box.south, p.box.west], [p.box.north, p.box.east]]);
    else this.map.setView([p.lat, p.lon], 15);
  }

  // ---- state shown ----------------------------------------------------------------

  private updateAreaText(width: number, height: number): void {
    if (!this.areaText) return;
    this.areaText.textContent = `Area: ${Math.round(width)} m × ${Math.round(height)} m`;
  }

  /** Brings the area readout, the warning, the Draw button and the Import button into line with the settings. */
  private refresh(): void {
    const area = this.settings.area;
    if (!this.drawing) {
      if (area) {
        const { width, height } = boxSizeM(area);
        this.updateAreaText(width, height);
        this.showRect(area);
      } else {
        this.hideRect();
        if (this.areaText) this.areaText.textContent = "No area yet. Find a place, then drag Draw Area over the map.";
      }
      if (this.drawButton) this.drawButton.textContent = area ? "Redraw Area" : "Draw Area";
    }
    this.setWarning(this.settings.kinds.size === 0 ? "Choose at least one kind of context." : area ? warningFor(area) : "");
    if (this.intervalSelect) this.intervalSelect.disabled = !this.settings.kinds.has("terrain");
    if (this.labelBox) this.labelBox.disabled = !this.settings.kinds.has("buildings");
    if (this.centreBox) this.centreBox.disabled = !this.settings.kinds.has("roads");
    if (this.importButton) this.importButton.disabled = !this.canImport() || this.run !== null;
  }

  private setWarning(message: string): void {
    if (!this.warning) return;
    this.warning.textContent = message;
    this.warning.hidden = message === "";
  }

  private canImport(): boolean {
    const area = this.settings.area;
    return area !== null && !boxTooLarge(area) && this.settings.kinds.size > 0 && !this.drawing;
  }

  // ---- importing ----------------------------------------------------------------

  private async importNow(): Promise<void> {
    const area = this.settings.area;
    const session = store.session;
    if (!area || !session || !this.canImport()) return;
    const run = new AbortController();
    this.run = run;
    this.stepLabels = [];
    this.renderSteps();
    this.setError("");
    this.refresh();

    try {
      const offset = this.origin();
      const result = await runImport(
        {
          box: area,
          kinds: this.settings.kinds,
          contourInterval: this.settings.contourInterval,
          labelHeights: this.settings.labelHeights,
          centreLines: this.settings.centreLines,
          offset,
        },
        run.signal,
        (label, sameStep) => this.step(label, sameStep === true),
      );
      if (run.signal.aborted) throw new Error("cancelled");
      if (result.features.length === 0) {
        this.setError("Nothing to import: this area has none of the chosen kinds in OpenStreetMap or a flat terrain. Try a larger area or more kinds.");
        this.finishRun();
        return;
      }
      this.step("Writing to the drawing");
      const written = this.write(area, offset, result);
      if (!written) {
        this.finishRun();
        return;
      }
      siteOverlay.add({ name: written.layerName, layer: written.layerId, ...result.context });
      setActiveLayer(written.layerId);
      appContext()?.fit();
      this.close();
      toast(summary(written), "info");
    } catch (err) {
      if (run.signal.aborted) {
        this.setError("");
        this.step("Cancelled");
      } else {
        this.setError(err instanceof Error ? err.message : "The import failed.");
      }
      this.finishRun();
    }
  }

  /** Where the area's centre goes: the drawing's origin, or the centre of the view. */
  private origin(): Pt {
    if (this.settings.placement === "view") {
      const view = appContext()?.view;
      if (view) return { x: view.cx, y: view.cy };
    }
    return { x: 0, y: 0 };
  }

  /** Writes the import in one undo step; the report says what was placed. */
  private write(area: GeoBox, offset: Pt, result: ImportResult): WriteReport | null {
    const proj = projectionAt(boxCentre(area));
    const sw = toMetres(proj, { lat: area.south, lon: area.west });
    const corner = { x: offset.x + sw.x * 1000, y: offset.y + sw.y * 1000 };
    const fallbackClass = store.activeClassIndex;
    const r = attempt("Import Site Context", (s) =>
      s.batch(() => writeSiteContext(s, result.features, { layerName: "Site Context", corner, fallbackClass })),
    );
    if (r) return r.value;
    this.setError("The drawing could not take the context. Nothing was imported.");
    return null;
  }

  private step(label: string, sameStep = false): void {
    if (sameStep && this.stepLabels.length > 0) this.stepLabels[this.stepLabels.length - 1] = label;
    else this.stepLabels.push(label);
    this.renderSteps();
  }

  private renderSteps(): void {
    if (!this.steps) return;
    const running = this.run !== null;
    this.steps.hidden = this.stepLabels.length === 0;
    this.steps.replaceChildren(
      ...this.stepLabels.map((label, i) => {
        const current = running && i === this.stepLabels.length - 1 && label !== "Cancelled";
        return h("li", { cls: current ? "sc-step current" : "sc-step done", text: label });
      }),
    );
  }

  private setError(message: string): void {
    if (!this.error) return;
    this.error.textContent = message;
    this.error.hidden = message === "";
  }

  private cancelRun(): void {
    this.run?.abort();
  }

  private finishRun(): void {
    this.run = null;
    this.refresh();
    this.renderSteps();
  }

  private close(): void {
    this.searchAbort?.abort();
    window.clearTimeout(this.searchTimer);
    this.run?.abort();
    this.map?.remove();
    this.map = null;
    this.backdrop?.remove();
    this.backdrop = null;
    this.returnFocus?.focus();
    this.done();
  }
}

/** What is wrong with an area, or "" when it can be imported. */
function warningFor(box: GeoBox): string {
  return boxTooLarge(box) ? `The area is larger than ${MAX_SIDE_M / 1000} km × ${MAX_SIDE_M / 1000} km. Draw a smaller one.` : "";
}

/** The toast after an import: what went in, and what had to be simplified. */
function summary(r: WriteReport): string {
  const placed = Object.values(r.placed).reduce((n, v) => n + (v ?? 0), 0);
  const parts = [`Imported ${placed} ${placed === 1 ? "object" : "objects"} onto "${r.layerName}".`];
  if (r.circlesAsPolygons > 0) parts.push(`${r.circlesAsPolygons} tree circles drawn as polygons (no circle in this file).`);
  if (r.outlinesSimplified > 0) parts.push("Some outlines drawn as lines (no polygon in this file).");
  if (r.skipped > 0) parts.push(`${r.skipped} skipped.`);
  return parts.join(" ");
}

