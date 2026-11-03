// A hyperlink's parameters and following one (tools/hyperlink.ts places them): Cmd-click (Ctrl-click)
// on one with the Selection tool, Open Link on its right-click menu, or Object Info's Open Link. A web
// page opens in a new tab, a saved view or a sheet layer is shown, and a QR code's web address opens.
// A browser can't launch applications or open files and folders on this computer, so those say so.

import type { VwxDocument } from "../core/index.ts";
import { setActiveLayer } from "./commands.ts";
import { savedViews } from "./panels/views.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** the plug-in, and its parameters' format, a hyperlink is */
export const HYPERLINK = "Hyperlink";
/** its parameters, named as Vectorworks' report of hyperlinks shows them where it shows them */
export const FIELD = {
  label: "EditableLabel",
  fn: "EditableFunction",
  target: "EditableTarget",
  saveAs: "EditableSaveAs",
  qrWidth: "QRWidth",
  labelSize: "LabelSize",
} as const;
export const FUNCTIONS = ["Open Webpage", "Launch Application", "Open Document", "Open Folder", "Activate Saved View", "Activate Sheet Layer", "QR Code"] as const;
export type HyperlinkFunction = (typeof FUNCTIONS)[number];
export const SAVE_AS = ["absolute path", "relative path"] as const;
/** the functions that open something on this computer, whose path is saved absolute or relative */
export const PATH_FUNCTIONS: ReadonlySet<HyperlinkFunction> = new Set(["Launch Application", "Open Document", "Open Folder"]);

export interface HyperlinkParams {
  readonly label: string;
  readonly fn: HyperlinkFunction;
  readonly target: string;
  readonly saveAs: string;
  /** mm on paper */
  readonly qrWidth: number;
  readonly labelSize: number;
}

/** an image width and label size on paper, mm, when a hyperlink's record has none */
export const QR_WIDTH_MM = 25;
export const LABEL_MM = 3;

/** Object `id`'s hyperlink parameters, or null when it isn't a hyperlink. */
export function hyperlinkParams(doc: VwxDocument, id: string): HyperlinkParams | null {
  const rec = doc.records(id).find((r) => r.parametric && r.name === HYPERLINK);
  if (!rec) return null;
  const get = (name: string): string | number | boolean | undefined => rec.fields.find((f) => f.name === name)?.value;
  const text = (name: string): string => String(get(name) ?? "");
  const size = (name: string, otherwise: number): number => {
    const v = Number(get(name));
    return v > 0 ? v : otherwise;
  };
  const fn = FUNCTIONS.find((f) => f === text(FIELD.fn)) ?? "Open Webpage";
  return { label: text(FIELD.label), fn, target: text(FIELD.target), saveAs: text(FIELD.saveAs), qrWidth: size(FIELD.qrWidth, QR_WIDTH_MM), labelSize: size(FIELD.labelSize, LABEL_MM) };
}

export function isHyperlink(doc: VwxDocument, id: string): boolean {
  return doc.records(id).some((r) => r.parametric && r.name === HYPERLINK);
}

/** `text` as a web address Rodeo opens (http, https, mailto or tel; a bare domain gets https), or null. */
export function webAddress(text: string): string | null {
  const t = text.trim();
  const full = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : /^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(t) ? `https://${t}` : null;
  if (!full) return null;
  try {
    const u = new URL(full);
    return ["http:", "https:", "mailto:", "tel:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** The sheet layer `target` names: its number or title, in brackets or not. */
function sheetLayer(doc: VwxDocument, target: string): string | null {
  const t = target.replace(/^\[(.*)\]$/, "$1").trim().toLowerCase();
  const sheets = doc.layers().filter((l) => l.kind === "sheet");
  return (sheets.find((l) => l.name.toLowerCase() === t) ?? sheets.find((l) => l.title.toLowerCase() === t))?.id ?? null;
}

/** Follows hyperlink `id`, or says why it can't. */
export function followHyperlink(id: string): void {
  const doc = store.session?.doc;
  const p = doc ? hyperlinkParams(doc, id) : null;
  if (!doc || !p) return;
  const target = p.target.trim();
  if (!target) {
    toast("This hyperlink has no target: set one in Object Info.", "info");
    return;
  }
  const web = (): void => {
    const url = webAddress(target);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast(`Rodeo opens web addresses (http, https, mailto or tel), not “${target}”.`, "info");
  };
  switch (p.fn) {
    case "Open Webpage":
      web();
      return;
    case "QR Code":
      if (webAddress(target)) web();
      else toast(`The QR code holds “${target}”.`, "info");
      return;
    case "Activate Saved View": {
      const views = savedViews();
      const i = views?.names().indexOf(target) ?? -1;
      if (views && i >= 0) views.open(i);
      else toast(`There's no saved view named “${target}”: saved views are kept on the computer that saved them.`, "info");
      return;
    }
    case "Activate Sheet Layer": {
      const layer = sheetLayer(doc, target);
      if (layer) setActiveLayer(layer);
      else toast(`This drawing has no sheet layer “${target}”.`, "info");
      return;
    }
    default: {
      const what = p.fn === "Launch Application" ? "launch applications" : p.fn === "Open Folder" ? "open folders" : "open documents";
      toast(`A browser can't ${what} on this computer, so Rodeo can't follow this link to ${target}.`, "info");
    }
  }
}
