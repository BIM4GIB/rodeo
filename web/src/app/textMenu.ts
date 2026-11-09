// Text menu: the font, size, style (bold, italic, underline), justification,
// vertical alignment and text style of the selected text objects, as Object
// Info's Text section sets them for one (Format Text… sets them together),
// Find-Replace Text, Check Spelling
// (loaded on first use, with its dictionaries) and Convert Text to Polylines. The fonts offered are the
// document's own, then common ones, which are added to its font list when
// chosen. A text style gives text its font, size and alignment, and the text
// keeps naming it; Class Text Style follows the one the text's class names.

import { canPickUpRedline, canRestoreRedline, hasRedlineClass, pickUpRedlines, redlineStatusWorksheet, restoreRedlines, toggleRedlines } from "./redlines.ts";
import { TEXT_STYLE_BY_CLASS, type ObjectInfo, type ResourceInfo, type TextStyle } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { pathOf } from "./cutting.ts";
import { findReplaceDialog } from "./findReplace.ts";
import type { Row } from "./menu.ts";
import { STEP, need, whyIn, whyNot } from "./menuReasons.ts";
import { isDerivedId } from "./scene.ts";
import { layerInfo, store } from "./state.ts";

/** Millimetres per point: text sizes are stored in world units, shown in points. */
export const MM_PER_PT = 25.4 / 72;

export const H_ALIGN = [
  { value: "1", label: "Left" },
  { value: "2", label: "Centre" },
  { value: "3", label: "Right" },
];

export const V_ALIGN = [
  { value: "1", label: "Top" },
  { value: "2", label: "Top baseline" },
  { value: "3", label: "Centre" },
  { value: "4", label: "Bottom baseline" },
  { value: "5", label: "Bottom" },
];

/** The sizes Text > Size offers, in points. */
const SIZES = [6, 8, 9, 10, 12, 14, 18, 24, 36, 48, 72];

/** Fonts offered beside the document's own. */
const COMMON_FONTS = ["Arial", "Arial Narrow", "Helvetica", "Times New Roman", "Courier New", "Georgia", "Verdana"];

/** The document's fonts, then the common ones it does not list. */
export function fontChoices(): { own: string[]; common: string[] } {
  const own = store.session?.doc.fonts().filter((f) => f !== "") ?? [];
  return { own, common: COMMON_FONTS.filter((f) => !own.includes(f)) };
}

/** A text's font name, if the document lists it. */
export function fontOf(o: ObjectInfo): string | undefined {
  const i = o.shape?.fontIndex;
  return i === undefined ? undefined : store.session?.doc.fonts()[i];
}

/** The document's text styles that can be applied, by name. */
export function textStyles(): ResourceInfo[] {
  return (store.session?.doc.resources() ?? []).filter((r) => r.kind === "text-style" && r.textStyle).sort((a, b) => a.name.localeCompare(b.name));
}

/** What following `style` (a text style resource; null for none) sets on a text on `layerId`. */
export function followStyle(style: ResourceInfo | null, layerId: string): TextStyle {
  const def = style?.textStyle;
  if (!style || !def) return { textStyle: 0 };
  const font = store.session?.doc.fonts()[def.fontIndex];
  return { textStyle: style.index, ...(font ? { font } : {}), size: def.points * mmPerPt(layerId), hAlign: def.hAlign, vAlign: def.vAlign };
}

type StyleFlag = "bold" | "italic" | "underline";
const STYLE_FLAGS: readonly { flag: StyleFlag; label: string }[] = [
  { flag: "bold", label: "Bold" },
  { flag: "italic", label: "Italic" },
  { flag: "underline", label: "Underline" },
];

/** Selected text objects that can be restyled (text inside a symbol's definition cannot). */
/** Whether the selection is a text and a path, as Text Along Path takes. */
function textAndPath(): boolean {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 2) return false;
  const shapes = [...store.selection].map((id) => doc.object(id)?.shape);
  return shapes.some((s) => s?.kind === "text") && shapes.some((s) => s && s.kind !== "text" && pathOf(s) !== null);
}

export function selectedTexts(): ObjectInfo[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return [...store.selection]
    .filter((id) => !isDerivedId(id))
    .map((id) => doc.object(id))
    .filter((o): o is ObjectInfo => o?.shape?.kind === "text");
}

/** How many millimetres a point of text is on a layer: a design layer at 1:n draws it n times larger. */
export function mmPerPt(layerId: string): number {
  const scale = layerInfo(layerId)?.scale || 1;
  return MM_PER_PT * scale;
}

/**
 * Applies a style to every selected text in one undo step, worked out per group of texts that
 * share a layer (its scale sizes them) and, by `by`, anything else the style depends on.
 */
export function restyle(label: string, style: (texts: readonly ObjectInfo[]) => TextStyle, by: (o: ObjectInfo) => string | number = () => ""): void {
  const groups = new Map<string, ObjectInfo[]>();
  for (const o of selectedTexts()) {
    const key = `${o.layerId}\n${by(o)}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  if (groups.size === 0) return;
  attempt(label, (s) =>
    s.batch(() => {
      for (const texts of groups.values()) s.setTextStyle(texts.map((o) => o.id), style(texts));
    }),
  );
}

/** The text style a text's class names, which "Class Text Style" follows; null for none. */
export function classTextStyle(o: ObjectInfo): ResourceInfo | null {
  const index = store.session?.doc.classes().find((c) => c.index === o.classIndex)?.textStyle;
  return (index && textStyles().find((r) => r.index === index)) || null;
}

/** What following its class's text style sets on a text; null when its class names none. */
export function followClassStyle(o: ObjectInfo): TextStyle | null {
  const style = classTextStyle(o);
  return style && { ...followStyle(style, o.layerId), textStyle: TEXT_STYLE_BY_CLASS };
}

/** Text > Capitalization: each selected text's characters changed by `change`, in one undo step. */
function recase(label: string, change: (text: string) => string): void {
  const texts = selectedTexts().filter((o) => o.shape?.text !== undefined && change(o.shape.text) !== o.shape.text);
  if (texts.length === 0) return;
  attempt(label, (s) =>
    s.batch(() => {
      for (const o of texts) s.setText(o.id, change(o.shape!.text!));
    }),
  );
}

/** Each word's first letter capital, its others small. */
function titleCaps(text: string): string {
  return text.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** True when every selected text has `value`, and there is one. */
function allHave(value: (o: ObjectInfo) => number | undefined, want: number): boolean {
  const texts = selectedTexts();
  return texts.length > 0 && texts.every((o) => value(o) === want);
}

export function textMenuRows(): Row[] {
  const hasText = (): boolean => selectedTexts().length > 0;
  const points = (o: ObjectInfo): number | undefined =>
    o.shape?.textSize ? Math.round((o.shape.textSize / mmPerPt(o.layerId)) * 10) / 10 : undefined;
  const all = (test: (o: ObjectInfo) => boolean): boolean => {
    const texts = selectedTexts();
    return texts.length > 0 && texts.every(test);
  };
  const fontRow = (font: string): Row => ({
    label: font,
    checked: () => all((o) => fontOf(o) === font),
    run: () => restyle("Text font", () => ({ font })),
  });
  return [
    { label: "Format Text…", why: need.text, enabled: hasText, run: () => void import("./formatText.ts").then((m) => m.formatTextDialog()) },
    "-",
    {
      label: "Font",
      why: need.text,
      enabled: hasText,
      items: () => {
        const { own, common } = fontChoices();
        return [...own.map(fontRow), ...(own.length > 0 && common.length > 0 ? ["-" as const] : []), ...common.map(fontRow)];
      },
    },
    {
      label: "Size",
      why: need.text,
      enabled: hasText,
      items: [
        ...SIZES.map((pt) => ({
          label: `${pt} pt`,
          checked: () => allHave(points, pt),
          run: () => restyle("Text size", (texts) => ({ size: pt * mmPerPt(texts[0].layerId) })),
        })),
        "-",
        { label: "Set Size…", run: () => void import("./formatText.ts").then((m) => m.setSizeDialog()) },
      ],
    },
    {
      label: "Style",
      why: need.text,
      enabled: hasText,
      items: [
        {
          label: "Plain",
          checked: () => all((o) => !o.shape?.bold && !o.shape?.italic && !o.shape?.underline),
          run: () => restyle("Plain text", () => ({ bold: false, italic: false, underline: false })),
        },
        "-",
        ...STYLE_FLAGS.map(
          ({ flag, label }): Row => ({
            label,
            checked: () => all((o) => !!o.shape?.[flag]),
            // on for all of them unless they all have it already
            run: () => restyle(`${label} text`, () => ({ [flag]: !all((o) => !!o.shape?.[flag]) })),
          }),
        ),
      ],
    },
    {
      label: "Justification",
      why: need.text,
      enabled: hasText,
      items: H_ALIGN.map((a) => ({
        label: a.label,
        checked: () => allHave((o) => o.shape?.hAlign ?? 1, Number(a.value)),
        run: () => restyle("Justify text", () => ({ hAlign: Number(a.value) })),
      })),
    },
    {
      label: "Vertical Alignment",
      why: need.text,
      enabled: hasText,
      items: V_ALIGN.map((a) => ({
        label: a.label,
        checked: () => allHave((o) => o.shape?.vAlign ?? 1, Number(a.value)),
        run: () => restyle("Align text", () => ({ vAlign: Number(a.value) })),
      })),
    },
    {
      label: "Text Style",
      why: whyNot([hasText, STEP.text], [() => textStyles().length > 0, "Make a text style first in the Resources palette"]),
      enabled: () => hasText() && textStyles().length > 0,
      items: () => [
        { label: "Unstyled", checked: () => all((o) => !o.shape?.textStyle), run: () => restyle("Unstyle text", () => ({ textStyle: 0 })) },
        {
          label: "Class Text Style",
          why: whyIn("The text's class has no text style"),
          enabled: () => all((o) => !!classTextStyle(o)),
          checked: () => all((o) => o.shape?.textStyle === TEXT_STYLE_BY_CLASS),
          run: () => restyle("Text style", (texts) => followClassStyle(texts[0]) ?? {}, (o) => o.classIndex),
        },
        "-",
        ...textStyles().map(
          (r): Row => ({
            label: r.name,
            checked: () => all((o) => o.shape?.textStyle === r.index),
            run: () => restyle("Text style", (texts) => followStyle(r, texts[0].layerId)),
          }),
        ),
      ],
    },
    {
      label: "Capitalization",
      why: need.text,
      enabled: hasText,
      items: [
        { label: "UPPER CASE", why: need.text, enabled: hasText, run: () => recase("UPPER CASE", (t) => t.toUpperCase()) },
        { label: "lower case", why: need.text, enabled: hasText, run: () => recase("lower case", (t) => t.toLowerCase()) },
        { label: "Title Caps", why: need.text, enabled: hasText, run: () => recase("Title Caps", titleCaps) },
      ],
    },
    "-",
    { label: "Find-Replace Text…", enabled: () => !!store.session, run: () => void findReplaceDialog() },
    { label: "Check Spelling…", enabled: () => !!store.session, run: () => void import("./spellCheck.ts").then((m) => m.spellCheckDialog()) },
    "-",
    {
      label: "Redlines",
      enabled: () => !!store.session,
      items: [
        { label: "Create Redline Status WS", enabled: () => !!store.session, run: () => void redlineStatusWorksheet() },
        { label: "Pick up Redline", why: whyIn("Select a redline that isn't picked up first"), enabled: canPickUpRedline, run: pickUpRedlines },
        { label: "Restore Redline", why: whyIn("Select a picked-up redline first"), enabled: canRestoreRedline, run: restoreRedlines },
        { label: "Show or Hide Redlines", why: whyIn("The drawing has no redlines"), enabled: hasRedlineClass, run: toggleRedlines },
      ],
    },
    "-",
    { label: "Convert Text to Polylines", why: need.text, enabled: hasText, run: () => void import("./textToPolylines.ts").then((m) => m.convertTextToPolylines()) },
    {
      label: "Text Along Path…",
      why: whyIn("Select one text and one line or curve first"),
      enabled: textAndPath,
      run: () => void import("./textAlongPath.ts").then((m) => m.textAlongPathDialog()),
    },
  ];
}
