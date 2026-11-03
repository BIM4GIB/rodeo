// File > Page Setup…: a sheet layer's page, which its drawing is laid out on and which prints and
// exports to PDF as one sheet of paper. The page is centred on the sheet's origin and drawn as a
// gray outline under it. Sizes are typed in the document's units; a preset fills them in, turned
// to the orientation chosen.

import type { LayerInfo, PageSize } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLength, parseLength } from "./units.ts";

const IN = 25.4;

/** Sheet sizes, landscape, mm. */
const PRESETS: readonly (PageSize & { name: string })[] = [
  { name: "ARCH A (12 × 9 in)", width: 12 * IN, height: 9 * IN },
  { name: "ARCH B (18 × 12 in)", width: 18 * IN, height: 12 * IN },
  { name: "ARCH C (24 × 18 in)", width: 24 * IN, height: 18 * IN },
  { name: "ARCH D (36 × 24 in)", width: 36 * IN, height: 24 * IN },
  { name: "ARCH E1 (42 × 30 in)", width: 42 * IN, height: 30 * IN },
  { name: "ARCH E (48 × 36 in)", width: 48 * IN, height: 36 * IN },
  { name: "ISO A4 (297 × 210 mm)", width: 297, height: 210 },
  { name: "ISO A3 (420 × 297 mm)", width: 420, height: 297 },
  { name: "ISO A2 (594 × 420 mm)", width: 594, height: 420 },
  { name: "ISO A1 (841 × 594 mm)", width: 841, height: 594 },
  { name: "ISO A0 (1189 × 841 mm)", width: 1189, height: 841 },
  { name: "Letter (11 × 8.5 in)", width: 11 * IN, height: 8.5 * IN },
  { name: "Legal (14 × 8.5 in)", width: 14 * IN, height: 8.5 * IN },
  { name: "Tabloid (17 × 11 in)", width: 17 * IN, height: 11 * IN },
];
const CUSTOM = "custom";
const ALL_SHEETS = "all";
/** sizes this close (mm) count as a preset's */
const SAME_MM = 0.05;

function sheets(): LayerInfo[] {
  return store.session?.doc.layers().filter((l) => l.kind === "sheet" && l.page) ?? [];
}

export function canSetUpPage(): boolean {
  return sheets().length > 0;
}

/** The preset a size is, in either orientation, or null. */
function presetOf(page: PageSize): number | null {
  const long = Math.max(page.width, page.height);
  const short = Math.min(page.width, page.height);
  const i = PRESETS.findIndex((p) => Math.abs(p.width - long) < SAME_MM && Math.abs(p.height - short) < SAME_MM);
  return i < 0 ? null : i;
}

export async function pageSetup(): Promise<void> {
  const session = store.session;
  const list = sheets();
  if (!session || list.length === 0) {
    toast("Page Setup sets a sheet layer's page; this drawing has no sheet layers.", "info");
    return;
  }
  const units = session.doc.info.units;
  const start = list.find((l) => l.id === store.activeLayerId) ?? list[0];

  const field = (label: string, input: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const select = (label: string, options: readonly { value: string; label: string }[]): HTMLSelectElement =>
    h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }, ...options.map((o) => h("option", { value: o.value, text: o.label })));
  const length = (label: string): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", attrs: { type: "text", "aria-label": label, spellcheck: "false", inputmode: "decimal" } });

  const target = select("Sheet layer", [
    ...list.map((l) => ({ value: l.id, label: l.title ? `${l.name} ${l.title}` : l.name })),
    ...(list.length > 1 ? [{ value: ALL_SHEETS, label: "All sheet layers" }] : []),
  ]);
  target.value = start.id;
  const size = select("Size", [...PRESETS.map((p, i) => ({ value: String(i), label: p.name })), { value: CUSTOM, label: "Custom" }]);
  const orientation = select("Orientation", [
    { value: "landscape", label: "Landscape" },
    { value: "portrait", label: "Portrait" },
  ]);
  const width = length("Width");
  const height = length("Height");

  const read = (): PageSize | null => {
    const w = parseLength(width.value, units);
    const hh = parseLength(height.value, units);
    return w !== null && hh !== null ? { width: w, height: hh } : null;
  };
  const show = (page: PageSize): void => {
    width.value = formatLength(page.width, units);
    height.value = formatLength(page.height, units);
    const preset = presetOf(page);
    size.value = preset === null ? CUSTOM : String(preset);
    orientation.value = page.height > page.width ? "portrait" : "landscape";
  };
  show(start.page!);

  target.addEventListener("change", () => {
    const l = list.find((x) => x.id === target.value);
    if (l?.page) show(l.page);
  });
  size.addEventListener("change", () => {
    const p = PRESETS[Number(size.value)];
    if (!p) return;
    const portrait = orientation.value === "portrait";
    show({ width: portrait ? p.height : p.width, height: portrait ? p.width : p.height });
  });
  orientation.addEventListener("change", () => {
    const page = read();
    if (!page) return;
    const portrait = orientation.value === "portrait";
    // turned only when the sides disagree with the orientation picked
    if (portrait === page.height > page.width || page.width === page.height) return;
    show({ width: page.height, height: page.width });
  });
  for (const input of [width, height]) {
    input.addEventListener("change", () => {
      const page = read();
      if (!page) return;
      const preset = presetOf(page);
      size.value = preset === null ? CUSTOM : String(preset);
      if (page.width !== page.height) orientation.value = page.height > page.width ? "portrait" : "landscape";
    });
  }

  const value = await showDialog<{ ids: string[]; page: PageSize }>({
    title: "Page Setup",
    okLabel: "OK",
    body: [
      field("Sheet layer", target),
      field("Size", size),
      field("Orientation", orientation),
      field("Width", width),
      field("Height", height),
      h("p", { cls: "muted", text: "The page is centred on the sheet's origin. Prints and PDF exports take it as the sheet of paper." }),
    ],
    check: () => {
      const w = parseLength(width.value, units);
      if (w === null || !(w > 0)) return { error: "Width: enter a length above 0.", focus: width };
      const hh = parseLength(height.value, units);
      if (hh === null || !(hh > 0)) return { error: "Height: enter a length above 0.", focus: height };
      const ids = target.value === ALL_SHEETS ? list.map((l) => l.id) : [target.value];
      return { value: { ids, page: { width: w, height: hh } } };
    },
  });
  if (!value) return;
  attempt("Page Setup", (s) => s.batch(() => value.ids.forEach((id) => s.setSheetPage(id, value.page))));
}
