// Text > Format Text…: the selected texts' font, size, style and alignment in one dialog, as
// Vectorworks has it. Where the texts differ a field shows Mixed (a checkbox half-ticked) and
// leaves them as they are unless it is changed; only what changes is set, in one undo step. Sizes
// are typed in points, of any value; each text's layer scale turns them into the drawing's size.
// Text > Size > Set Size… types the size alone.

import type { ObjectInfo, TextStyle } from "../core/index.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { fontChoices, fontOf, H_ALIGN, mmPerPt, restyle, selectedTexts, V_ALIGN } from "./textMenu.ts";

/** The largest size typed, in points. */
const MAX_POINTS = 10000;
/** the select value for "the texts differ" */
const MIXED = "";

/** A text's size in points, to two decimals. */
const points = (o: ObjectInfo): number | undefined => (o.shape?.textSize ? Math.round((o.shape.textSize / mmPerPt(o.layerId)) * 100) / 100 : undefined);

/** A size typed in points ("12" or "12 pt"), or an error to show. */
function typedPoints(typed: string): number | string {
  const pt = Number(typed.trim().replace(/\s*pt$/i, ""));
  return typed.trim() !== "" && Number.isFinite(pt) && pt > 0 && pt <= MAX_POINTS ? pt : `Size: enter a number of points above 0, up to ${MAX_POINTS}.`;
}

/** The one value every text has, or undefined when they differ. */
function common<T>(texts: readonly ObjectInfo[], value: (o: ObjectInfo) => T): T | undefined {
  const first = value(texts[0]);
  return texts.every((o) => value(o) === first) ? first : undefined;
}

export async function formatTextDialog(): Promise<void> {
  const texts = selectedTexts();
  if (texts.length === 0) return;

  const select = (label: string, options: readonly { value: string; label: string }[], value: string | undefined): HTMLSelectElement => {
    const el = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } },
      ...(value === undefined ? [h("option", { value: MIXED, text: "Mixed" })] : []),
      ...options.map((o) => h("option", { value: o.value, text: o.label })),
    );
    el.value = value ?? MIXED;
    return el;
  };

  const fontNow = common(texts, (o) => fontOf(o) ?? "");
  const { own, common: others } = fontChoices();
  const font = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Font" } },
    ...(fontNow === undefined ? [h("option", { value: MIXED, text: "Mixed" })] : []),
    h("optgroup", { attrs: { label: "In this drawing" } }, ...own.map((f) => h("option", { value: f, text: f }))),
    ...(others.length ? [h("optgroup", { attrs: { label: "Common" } }, ...others.map((f) => h("option", { value: f, text: f })))] : []),
  );
  font.value = fontNow ?? MIXED;

  const sizeNow = common(texts, points);
  const size = h("input", {
    cls: "menu-dialog-input",
    value: sizeNow === undefined ? "" : String(sizeNow),
    placeholder: sizeNow === undefined ? "Mixed" : "",
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Size in points" },
  });

  type Flag = "bold" | "italic" | "underline";
  const flags = (["bold", "italic", "underline"] as const).map((flag) => {
    const now = common(texts, (o) => !!o.shape?.[flag]);
    const box = h("input", { attrs: { type: "checkbox" } });
    box.checked = now === true;
    box.indeterminate = now === undefined;
    let touched = false;
    box.addEventListener("change", () => (touched = true));
    return { flag, box, changed: (): boolean => touched && box.checked !== now };
  });
  const hAlign = select("Justification", H_ALIGN, common(texts, (o) => String(o.shape?.hAlign ?? 1)));
  const vAlign = select("Vertical alignment", V_ALIGN, common(texts, (o) => String(o.shape?.vAlign ?? 1)));

  const field = (label: string, input: HTMLElement, unit?: string): HTMLElement =>
    h(
      "label",
      { cls: "menu-dialog-field" },
      h("span", { cls: "menu-dialog-label", text: label }),
      input,
      unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null,
    );
  const label = (flag: Flag): string => flag[0].toUpperCase() + flag.slice(1);

  const result = await showDialog<{ style: TextStyle; pt?: number }>({
    title: texts.length === 1 ? "Format Text" : `Format ${texts.length} Texts`,
    okLabel: "Format",
    body: [
      field("Font", font),
      field("Size", size, "pt"),
      h("div", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Style" }), ...flags.map((f) => h("label", { cls: "menu-dialog-check" }, f.box, label(f.flag)))),
      field("Justification", hAlign),
      field("Vertical", vAlign),
    ],
    check: () => {
      const style: TextStyle = {};
      if (font.value !== MIXED && font.value !== fontNow) style.font = font.value;
      for (const f of flags) if (f.changed()) style[f.flag] = f.box.checked;
      if (hAlign.value !== MIXED && hAlign.value !== common(texts, (o) => String(o.shape?.hAlign ?? 1))) style.hAlign = Number(hAlign.value);
      if (vAlign.value !== MIXED && vAlign.value !== common(texts, (o) => String(o.shape?.vAlign ?? 1))) style.vAlign = Number(vAlign.value);
      let pt: number | undefined;
      if (size.value.trim() !== "") {
        const typed = typedPoints(size.value);
        if (typeof typed === "string") return { error: typed, focus: size };
        pt = typed === sizeNow ? undefined : typed;
      }
      return { value: { style, pt } };
    },
  });
  if (!result) return;
  const { style, pt } = result;
  if (Object.keys(style).length === 0 && pt === undefined) return;
  restyle(texts.length === 1 ? "Format text" : "Format texts", (group) => (pt === undefined ? style : { ...style, size: pt * mmPerPt(group[0].layerId) }));
}

/** Text > Size > Set Size…: the selected texts' size typed in points (any value), one undo step. */
export async function setSizeDialog(): Promise<void> {
  const texts = selectedTexts();
  if (texts.length === 0) return;
  const now = common(texts, points);
  const size = h("input", {
    cls: "menu-dialog-input",
    value: String(now ?? ""),
    placeholder: now === undefined ? "Mixed" : "",
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Size in points" },
  });
  const pt = await showDialog<number>({
    title: "Set Size",
    okLabel: "OK",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Size" }), size, h("span", { cls: "menu-dialog-unit", text: "pt" }))],
    check: () => {
      const typed = typedPoints(size.value);
      return typeof typed === "string" ? { error: typed, focus: size } : { value: typed };
    },
  });
  if (pt === null || pt === now) return;
  restyle("Text size", (group) => ({ size: pt * mmPerPt(group[0].layerId) }));
}
