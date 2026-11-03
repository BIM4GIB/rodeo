// File > Export PDF… and File > Print…: the dialog that picks the layers and page options, and
// printing a PDF from a hidden frame. File > Publish… lists the layers the same way. The dialog itself is the shell from menubar.ts.

import type { LayerInfo, VwxDocument } from "../core/types.ts";
import { PAPER_SIZES, paperScale, type PdfOptions } from "../export/pdf.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { toast } from "./toast.ts";
import "./exportDialog.css";

/** How long the print frame and the PDF's blob URL live after printing starts: the print dialog may still read them. */
const RELEASE_MS = 60_000;
/** How long the frame may take to load the PDF before it opens in a tab instead. */
const LOAD_MS = 15_000;

export interface PdfDialogSpec {
  /** dialog title: "Export PDF" or "Print" */
  readonly title: string;
  /** OK button: "Export" or "Print" */
  readonly okLabel: string;
  /** the layer that is checked when the dialog opens */
  readonly activeLayerId: string | null;
}

/** Sheet layers first, then design layers, each in document order. */
export function listOrder(layers: readonly LayerInfo[]): LayerInfo[] {
  return [...layers.filter((l) => l.kind === "sheet"), ...layers.filter((l) => l.kind === "design")];
}

/** "A-101 · Ground floor" for a sheet with a title, otherwise the layer name. */
export function layerLabel(layer: LayerInfo): string {
  const name = layer.name || "(unnamed)";
  return layer.title ? `${name} · ${layer.title}` : name;
}

/** Kind, scale and object count, and the visibility when it is not plain visible. */
export function layerMeta(layer: LayerInfo): string {
  const objects = layer.objectCount === 1 ? "1 object" : `${layer.objectCount} objects`;
  const parts = [layer.kind === "sheet" ? "Sheet" : "Design", `1:${paperScale(layer)}`, objects];
  if (layer.visibility !== "visible") parts.push(layer.visibility);
  return parts.join(" · ");
}

/**
 * Asks which layers go on the PDF and how each page is laid out. Resolves with the options for
 * exportPdf, or null when cancelled.
 */
export function askPdfOptions(doc: VwxDocument, spec: PdfDialogSpec): Promise<PdfOptions | null> {
  const layers = listOrder(doc.layers());
  const boxes = new Map<string, HTMLInputElement>();
  const count = h("span", { cls: "export-count" });
  const updateCount = (): void => {
    const picked = layers.filter((l) => boxes.get(l.id)?.checked).length;
    count.textContent = `${picked} of ${layers.length} selected`;
  };
  /** Checks exactly the layers in `picked`. */
  const select = (picked: readonly LayerInfo[]): void => {
    const ids = new Set(picked.map((l) => l.id));
    for (const [id, box] of boxes) box.checked = ids.has(id);
    updateCount();
  };
  const quick = (label: string, picked: LayerInfo[]): HTMLButtonElement => {
    const btn = h("button", { cls: "btn small", text: label, attrs: { type: "button" } });
    btn.disabled = picked.length === 0;
    btn.addEventListener("click", () => select(picked));
    return btn;
  };

  const rows = layers.map((layer) => {
    const box = h("input", { attrs: { type: "checkbox" }, checked: layer.id === spec.activeLayerId });
    boxes.set(layer.id, box);
    box.addEventListener("change", updateCount);
    return h(
      "label",
      { cls: "export-layer" },
      box,
      h("span", { cls: "export-layer-name", text: layerLabel(layer) }),
      h("span", { cls: "export-layer-meta", text: layerMeta(layer) }),
    );
  });
  updateCount();

  const classes = h("input", { attrs: { type: "checkbox" }, checked: true });
  const paper = h(
    "select",
    { cls: "export-select", attrs: { "aria-label": "Fit to page" } },
    h("option", { text: "Layer size (sheets: their page)", value: "" }),
    ...PAPER_SIZES.map((p) => h("option", { text: p.name, value: p.name })),
  );
  const hint = h("p", {
    cls: "export-hint",
    text: "Fits each page inside a 10 mm margin",
    hidden: true,
  });
  paper.addEventListener("change", () => {
    hint.hidden = paper.value === "";
  });

  const active = layers.filter((l) => l.id === spec.activeLayerId);
  const sheets = layers.filter((l) => l.kind === "sheet");
  const visibleDesign = layers.filter((l) => l.kind === "design" && l.visibility !== "hidden");
  const body: Node[] = [
    h("div", { cls: "export-head" }, h("span", { cls: "export-heading", text: "Layers" }), count),
    h(
      "div",
      { cls: "export-quick" },
      quick("Active layer", active),
      quick("All sheets", sheets),
      quick("Visible design layers", visibleDesign),
    ),
    layers.length > 0
      ? h("div", { cls: "export-layers", attrs: { role: "group", "aria-label": "Layers" } }, ...rows)
      : h("p", { cls: "export-hint", text: "This drawing has no layers." }),
    h(
      "div",
      { cls: "export-options" },
      h("label", { cls: "export-check" }, classes, h("span", { text: "Use visible classes only" })),
      h("label", { cls: "export-field" }, h("span", { cls: "export-label", text: "Fit to page" }), paper),
      hint,
    ),
  ];

  return showDialog<PdfOptions>({
    title: spec.title,
    okLabel: spec.okLabel,
    cls: "export-dialog",
    body,
    check: () => {
      const layerIds = layers.filter((l) => boxes.get(l.id)?.checked).map((l) => l.id);
      if (layerIds.length === 0) return { error: "Choose at least one layer." };
      const size = PAPER_SIZES.find((p) => p.name === paper.value);
      return {
        value: {
          layerIds,
          includeHiddenClasses: !classes.checked,
          pageSize: size ? { width: size.width, height: size.height } : undefined,
        },
      };
    },
  });
}

/**
 * Prints a PDF from a hidden frame: once the frame has loaded the PDF, the frame's window prints
 * it. When that fails, or the PDF does not load in time, the PDF opens in a new tab to print there.
 */
export function printPdf(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  const frame = h("iframe", { cls: "print-frame", attrs: { src: url, title: "PDF to print" } });
  const release = (): void => {
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, RELEASE_MS);
  };
  const openInTab = (): void => {
    frame.remove();
    if (window.open(url, "_blank") === null) toast("Pop-ups are blocked, so the PDF could not open for printing.");
    release();
  };
  // set once either route has started, so the load event and the timeout never both print
  let handled = false;
  frame.addEventListener(
    "load",
    () => {
      if (handled) return;
      handled = true;
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error("the print frame has no window");
        win.focus();
        win.print();
        release();
      } catch {
        openInTab();
      }
    },
    { once: true },
  );
  window.setTimeout(() => {
    if (handled) return;
    handled = true;
    openInTab();
  }, LOAD_MS);
  document.body.append(frame);
}
