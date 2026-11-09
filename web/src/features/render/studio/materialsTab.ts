// The Render palette's Materials tab: the model's materials as a list (the Realistic and Path Traced views
// list them), and each one's page, where its finish (the preset, then roughness, metalness, transmission
// and emissive), its tint and its library material are set, and Reset puts its preset back. Pick names the
// material under a click on the model; Match library gives the unmatched ones the library's material of
// their finish. The settings are the render settings' (settings.ts), the list the live view's (bridge.ts).
// No three.js here: the library picker loads when first used.

import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { reportFailure } from "../../../app/reports.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import type { FacePick, View3D } from "../../../app/view3d.ts";
import { materialList, onMaterials, type MaterialItem } from "../bridge.ts";
import { LIBRARY, type LibraryEntry } from "../library.data.ts";
import { materialKey, onRender, PRESET_LABELS, renderSettings, setMaterial, setRender, type MaterialOverride, type MaterialPresetId, type RenderSettings } from "../settings.ts";
import { faceUnder } from "./materialPick.ts";
import "./materialsTab.css";
import { button, colour, empty, group, icon, note, pct, select, slider, toPct, type SliderRow } from "./ui.ts";

/** "1 face group", "3 face groups" */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The search box shows above this many materials. */
const SEARCH_ABOVE = 8;
/** The finishes Match library gives a material whose guessed finish is one of these. */
const MATCHED_FINISHES: ReadonlySet<string> = new Set(["wood", "brick", "stone", "concrete", "plaster", "tile", "metal", "brushed-metal", "fabric"]);
const PRESET_IDS = Object.keys(PRESET_LABELS) as MaterialPresetId[];

/** One row of the list: the material, its row, and the picture and muted line the settings change. */
interface Row {
  readonly item: MaterialItem;
  readonly el: HTMLButtonElement;
  readonly art: HTMLElement;
  readonly meta: HTMLElement;
}

/** A finish's slider in display units: `unit` per setting unit, and what the preset gives when the override leaves it out. */
interface FinishSpec {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: number;
  readonly fallback: number;
  readonly format: (display: number) => string;
}

/** The library entry with this id, or null (none given, or not in the library). */
function entryOf(id: string | null | undefined): LibraryEntry | null {
  return id ? (LIBRARY.find((e) => e.id === id) ?? null) : null;
}

/** A library material's thumb: the file libraryUrl gives in library.ts, without loading its textures. */
function thumbUrl(id: string): string {
  const map = "thumb";
  return `${import.meta.env.BASE_URL}materials/${id}/${map}.webp`;
}

/** A finish's name as the Finish drop-down and the list say it: "Auto (Brick)" for auto, else the preset's. */
function finishName(guess: MaterialItem["guess"], preset: MaterialPresetId): string {
  return preset === "auto" ? `Auto (${PRESET_LABELS[guess]})` : PRESET_LABELS[preset];
}

/** A row's muted line: its finish, and its library material when it has one. */
function metaOf(item: MaterialItem, m: MaterialOverride | undefined): string {
  const lib = entryOf(m?.library);
  return [finishName(item.guess, m?.preset ?? "auto"), lib ? `Library: ${lib.label}` : null].filter(Boolean).join(" · ");
}

/** Changes some of a material's finish, keeping the rest of its override (or "auto" when it has none). */
function editMaterial(key: string, change: Partial<MaterialOverride>): void {
  const current: MaterialOverride = renderSettings().materials[key] ?? { preset: "auto" };
  setMaterial(key, { ...current, ...change });
}

/** A texture's preview as a blob URL (revoked when the list is rebuilt). */
function previewUrl(preview: NonNullable<MaterialItem["preview"]>): string {
  return URL.createObjectURL(new Blob([new Uint8Array(preview.bytes)], { type: preview.mime }));
}

/** Shows a material's picture in `holder`: its library thumb, else its texture's preview, else its colour (with its tint). Repaints only on a change. */
function paintArt(holder: HTMLElement, item: MaterialItem, m: MaterialOverride | undefined, preview: string | null): void {
  const entry = entryOf(m?.library);
  const src = entry ? thumbUrl(entry.id) : preview;
  const colourOf = m?.tint ?? item.color;
  const sig = src !== null ? `pic:${src}` : `col:${colourOf}`;
  if (holder.dataset.art === sig) return;
  holder.dataset.art = sig;
  if (src !== null) {
    holder.replaceChildren(h("img", { attrs: { src, alt: "", loading: "lazy" } }));
  } else {
    const dot = h("span", { attrs: { "aria-hidden": "true" } });
    dot.style.background = colourOf;
    holder.replaceChildren(dot);
  }
}

/** A finish's slider: its readout reads "Preset" while the override leaves the value to the preset; a double-click on its label gives the value back to the preset. */
function finishSlider(label: string, spec: FinishSpec, write: (value: number | undefined) => void): { readonly row: SliderRow; set(value: number | undefined): void } {
  let fromPreset = true;
  const sl = slider(label, {
    min: spec.min,
    max: spec.max,
    step: spec.step,
    format: (v) => (fromPreset ? "Preset" : spec.format(v)),
    onInput: (v) => write(v / spec.unit),
    hint: "Double-click the label for the preset's value",
  });
  sl.el.querySelector(".rs-label")?.addEventListener("dblclick", () => write(undefined));
  return {
    row: sl,
    set(value) {
      fromPreset = value === undefined;
      sl.set((value ?? spec.fallback) * spec.unit);
    },
  };
}

function report(err: unknown, step: string): void {
  toast(`Render: ${errorMessage(err)}`);
  reportFailure("render", err, { step });
}

/** The Materials tab: built once; the list rebuilt when the live view publishes its materials, and the values kept in step with the settings. */
export function materialsTab(): HTMLElement {
  /** the list as the live view last published it, the texture previews' blob URLs, and the rows */
  let items: readonly MaterialItem[] = [];
  let previews = new Map<string, string>();
  let rows: Row[] = [];
  let query = "";
  /** the material whose page is open, and that page's refresh */
  let openKey: string | null = null;
  let pageSync: ((s: RenderSettings, item: MaterialItem) => void) | null = null;
  /** the 3D view a Pick is waiting on, and the handler it has */
  let picking: { readonly view: View3D; readonly handler: FacePick } | null = null;

  // the list: a search box above SEARCH_ABOVE materials, Pick and Match library materials
  const search = h("input", {
    cls: "search rs-materials-search",
    attrs: { type: "search", placeholder: "Search materials", "aria-label": "Search materials", autocomplete: "off", spellcheck: "false" },
  });
  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    filter();
  });
  // typing here is not a shortcut for the editor
  search.addEventListener("keydown", (e) => e.stopPropagation());
  const pickBtn = button("Pick", () => togglePick(), { small: true, icon: "eyedropper", title: "Pick a material by clicking the model" });
  pickBtn.classList.add("rs-materials-pick");
  pickBtn.setAttribute("aria-pressed", "false");
  const matchBtn = button("Match library materials", () => matchLibrary(), {
    small: true,
    title: "Give each material whose finish the library has a material of that finish, unless it has a texture or a library material",
  });
  const bar = h("div", { cls: "rs-materials-bar" }, search, pickBtn, matchBtn);
  const list = h("div", { cls: "rs-materials-list" });
  const noMatch = note("No materials match.");
  noMatch.hidden = true;
  const none = empty(
    "materials",
    "No materials yet",
    "Materials appear once the 3D view draws in Realistic or Path Traced.",
    button("Show Realistic", () => showRealistic(), { primary: true, small: true }),
  );
  const listPane = h("div", { cls: "rs-materials-pane" }, bar, list, noMatch, none);
  // a material's page takes the place of the list
  const pageHost = h("div", { cls: "rs-materials-pane" });
  pageHost.hidden = true;
  const root = h("div", { cls: "rs-materials" }, listPane, pageHost);

  const makeRow = (item: MaterialItem): Row => {
    const art = h("span", { cls: "rs-material-art" });
    const meta = h("span", { cls: "rs-material-meta" });
    const chevron = icon("chevron", 14);
    chevron.classList.add("rs-material-chevron");
    const el = h(
      "button",
      { cls: "rs-material-row", title: `${item.label}: ${plural(item.count, "face group")}`, attrs: { type: "button" } },
      art,
      h("span", { cls: "rs-material-text" }, h("span", { cls: "rs-material-name", text: item.label }), meta),
      chevron,
    );
    el.addEventListener("click", () => openPage(item.key));
    return { item, el, art, meta };
  };

  /** Shows the rows that match the search box. */
  const filter = (): void => {
    let shown = 0;
    for (const r of rows) {
      const on = query === "" || r.item.label.toLowerCase().includes(query);
      r.el.hidden = !on;
      if (on) shown++;
    }
    noMatch.hidden = items.length === 0 || shown > 0;
  };

  const paintRow = (r: Row, s: RenderSettings): void => {
    const m = s.materials[r.item.key];
    paintArt(r.art, r.item, m, previews.get(r.item.key) ?? null);
    r.meta.textContent = metaOf(r.item, m);
  };

  /** Brings the rows and the open page in step with the settings. */
  const sync = (): void => {
    const s = renderSettings();
    for (const r of rows) paintRow(r, s);
    if (openKey === null) return;
    const item = items.find((i) => i.key === openKey);
    if (item) pageSync?.(s, item);
    else closePage(false);
  };

  /** Rebuilds the list from the live view's materials (the texture previews' URLs are made again). */
  const build = (): void => {
    for (const url of previews.values()) URL.revokeObjectURL(url);
    previews = new Map();
    items = materialList();
    for (const item of items) if (item.preview) previews.set(item.key, previewUrl(item.preview));
    rows = items.map(makeRow);
    list.replaceChildren(...rows.map((r) => r.el));
    search.hidden = items.length <= SEARCH_ABOVE;
    if (items.length <= SEARCH_ABOVE) {
      search.value = "";
      query = "";
    }
    bar.hidden = items.length === 0;
    none.hidden = items.length > 0;
    filter();
    sync();
  };

  /** One material's page: its picture and name, the finish, the tint, the library material, and Reset. */
  const buildPage = (item: MaterialItem): HTMLElement => {
    const key = item.key;
    const back = h("button", { cls: "rs-materials-back", attrs: { type: "button" } }, icon("chevron", 14), h("span", { text: "All materials" }));
    back.addEventListener("click", () => closePage(true));
    const heroArt = h("span", { cls: "rs-material-art" });
    const heroName = h("p", { cls: "rs-materials-hero-name" });
    const heroMeta = h("p", { cls: "rs-materials-hero-meta" });
    const hero = h("div", { cls: "rs-materials-hero" }, heroArt, h("div", { cls: "rs-materials-hero-text" }, heroName, heroMeta));

    const finish = select<MaterialPresetId>(
      "Finish",
      PRESET_IDS.map((id): [MaterialPresetId, string] => [id, finishName(item.guess, id)]),
      (preset) => editMaterial(key, { preset }),
    );
    finish.select.addEventListener("keydown", (e) => e.stopPropagation());
    const roughness = finishSlider("Roughness", { min: 0, max: 100, step: 1, unit: 100, fallback: 0.5, format: pct }, (value) => editMaterial(key, { roughness: value }));
    const metalness = finishSlider("Metalness", { min: 0, max: 100, step: 1, unit: 100, fallback: 0, format: pct }, (value) => editMaterial(key, { metalness: value }));
    const transmission = finishSlider("Transmission", { min: 0, max: 100, step: 1, unit: 100, fallback: 0, format: pct }, (value) => editMaterial(key, { transmission: value }));
    const emissive = finishSlider("Emissive", { min: 0, max: 10, step: 0.1, unit: 1, fallback: 0, format: (v) => v.toFixed(1) }, (value) => editMaterial(key, { emissive: value }));
    const tint = colour("Tint", (css) => editMaterial(key, { tint: css }));
    const clearTint = button("Clear", () => editMaterial(key, { tint: undefined }), { small: true, title: "Take the tint away" });
    tint.el.querySelector(".rs-control")?.append(clearTint);
    const finishGroup = group("Finish", { key: "materials-finish" }, finish.el, roughness.row.el, metalness.row.el, transmission.row.el, emissive.row.el, tint.el);

    // the library material: its thumb and name, Choose… and Remove; its scale and bump once one is set
    const libArt = h("span", { cls: "rs-material-art rs-materials-lib-art" });
    const libName = h("span", { cls: "rs-materials-lib-name" });
    const choose = button("Choose…", () => chooseLibrary(), { small: true, title: "Pick a material from the library" });
    const remove = button("Remove", () => editMaterial(key, { library: undefined, scale: undefined, bump: undefined }), { small: true, title: "Take the library material away" });
    const libRow = h("div", { cls: "rs-materials-lib" }, libArt, libName, choose, remove);
    const scale = slider("Scale", { min: 0.25, max: 4, step: 0.05, format: (v) => `×${v.toFixed(2)}`, onInput: (n) => editMaterial(key, { scale: n }), reset: 1 });
    const bump = slider("Bump", { min: 0, max: 200, step: 1, format: pct, onInput: (n) => editMaterial(key, { bump: n / 100 }), reset: 100 });
    const libraryGroup = group("Library", { key: "materials-library" }, libRow, scale.el, bump.el);

    const chooseLibrary = (): void => {
      const current = renderSettings().materials[key]?.library ?? null;
      void import("../libraryPicker.ts")
        .then((m) => m.pickLibraryMaterial(choose, current))
        .then((id) => {
          const entry = entryOf(id);
          if (entry) editMaterial(key, { library: entry.id, preset: entry.finish });
        })
        .catch((err: unknown) => report(err, "opening the material library"));
    };

    const reset = button("Reset", () => setMaterial(key, null), { small: true, title: "Back to the preset's finish" });
    const foot = h("div", { cls: "rs-materials-foot" }, reset);

    pageSync = (s, now) => {
      const m = s.materials[key];
      const lib = entryOf(m?.library);
      heroName.textContent = now.label;
      heroMeta.textContent = plural(now.count, "face group");
      paintArt(heroArt, now, m, previews.get(key) ?? null);
      finish.set(m?.preset ?? "auto");
      const auto = finish.select.options.item(0);
      if (auto) auto.textContent = finishName(now.guess, "auto");
      roughness.set(m?.roughness);
      metalness.set(m?.metalness);
      transmission.set(m?.transmission);
      emissive.set(m?.emissive);
      tint.set(m?.tint ?? now.color);
      clearTint.disabled = m?.tint === undefined;
      libName.textContent = lib ? lib.label : m?.library === undefined ? "None" : "Not in the library";
      libName.title = libName.textContent;
      libName.classList.toggle("is-none", m?.library === undefined);
      libArt.hidden = lib === null;
      if (lib) paintArt(libArt, now, m, previews.get(key) ?? null);
      remove.hidden = m?.library === undefined;
      scale.el.hidden = m?.library === undefined;
      bump.el.hidden = m?.library === undefined;
      scale.set(m?.scale ?? 1);
      bump.set(toPct(m?.bump ?? 1));
      reset.disabled = m === undefined;
    };

    return h("div", { cls: "rs-materials-page" }, back, hero, finishGroup.el, libraryGroup.el, foot);
  };

  /** Opens a material's page in place of the list. */
  const openPage = (key: string): void => {
    const item = items.find((i) => i.key === key);
    if (!item) return;
    stopPick();
    openKey = key;
    pageHost.replaceChildren(buildPage(item));
    listPane.hidden = true;
    pageHost.hidden = false;
    pageHost.closest(".rs-body")?.scrollTo({ top: 0 });
    sync();
    pageHost.querySelector<HTMLElement>(".rs-materials-back")?.focus();
  };

  /** Back to the list; `focusRow` puts the keyboard focus on the material's row. */
  const closePage = (focusRow: boolean): void => {
    const key = openKey;
    openKey = null;
    pageSync = null;
    pageHost.replaceChildren();
    pageHost.hidden = true;
    listPane.hidden = false;
    if (focusRow && key !== null) rows.find((r) => r.item.key === key)?.el.focus();
  };

  /** Gives each listed material that has no library material and no texture of its own, and whose guessed finish the library has a material of, the library's first material of that finish: one settings change, and a toast. */
  const matchLibrary = (): void => {
    if (items.length === 0) {
      toast("No materials are listed yet: draw the 3D view in Realistic or Path Traced first.", "info");
      return;
    }
    const next = { ...renderSettings().materials };
    let matched = 0;
    for (const item of items) {
      if (item.textured || next[item.key]?.library !== undefined || !MATCHED_FINISHES.has(item.guess)) continue;
      const entry = LIBRARY.find((e) => e.finish === item.guess);
      if (!entry) continue;
      const current: MaterialOverride = next[item.key] ?? { preset: "auto" };
      next[item.key] = { ...current, library: entry.id, preset: entry.finish };
      matched++;
    }
    if (matched === 0) {
      toast("No material matched a library material.", "info");
      return;
    }
    setRender({ materials: next });
    toast(`Matched ${matched} ${matched === 1 ? "material" : "materials"} to the library.`, "info");
  };

  /** Pick: the next click on the model names its material and opens its page. A click on nothing, or on a face with no listed material, says so and keeps picking. */
  const startPick = async (): Promise<void> => {
    if (materialList().length === 0) {
      toast("No materials are listed yet: draw the 3D view in Realistic or Path Traced first.", "info");
      return;
    }
    const app = appContext();
    const view = app ? await app.show3d() : null;
    if (!view) return;
    const handler: FacePick = (hit) => {
      const face = hit ? faceUnder(view.modelFaces(), hit.point) : null;
      const key = face ? materialKey(face) : null;
      if (key === null || !items.some((i) => i.key === key)) {
        toast("No material there.", "info");
        return;
      }
      stopPick();
      openPage(key);
    };
    picking = { view, handler };
    view.onFacePick = handler;
    pickBtn.setAttribute("aria-pressed", "true");
    pickBtn.classList.add("is-active");
    window.addEventListener("keydown", onPickKey, true);
  };

  const stopPick = (): void => {
    if (!picking) return;
    if (picking.view.onFacePick === picking.handler) picking.view.onFacePick = null;
    picking = null;
    pickBtn.setAttribute("aria-pressed", "false");
    pickBtn.classList.remove("is-active");
    window.removeEventListener("keydown", onPickKey, true);
  };

  const togglePick = (): void => {
    if (picking) stopPick();
    else void startPick().catch((err: unknown) => report(err, "picking a material"));
  };

  /** Escape ends a Pick before the editor sees it (Render Studio's Escape would leave Studio). */
  const onPickKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    stopPick();
  };

  /** Shows the 3D view in Realistic, as the list's empty state offers. */
  const showRealistic = (): void => {
    const app = appContext();
    if (!app) return;
    void app
      .show3d()
      .then(() => app.setRenderMode("realistic"))
      .catch((err: unknown) => report(err, "showing Realistic"));
  };

  onMaterials(build);
  onRender(() => sync());
  store.on("session", () => stopPick());
  build();
  return root;
}
