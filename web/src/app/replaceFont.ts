// Tools > Utilities > Replace Font…: one font for another throughout the drawing,
// as the Vectorworks command does: every text object on the drawing's layers set
// in it, and every text style that names it (texts that follow a style keep
// following it), in one undo step. Text inside symbol definitions is left alone,
// as Find-Replace Text leaves it: it is shared by every instance.

import type { ResourceInfo, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { fontChoices } from "./textMenu.ts";
import { textStylePreviews } from "./textStyleEditor.ts";
import { toast } from "./toast.ts";

/** A font the drawing uses, with the text objects and text styles set in it. */
interface Use {
  readonly font: string;
  readonly texts: string[];
  readonly styles: ResourceInfo[];
}

/** Each font the drawing's texts and text styles are set in, by name. */
function fontUses(doc: VwxDocument): Use[] {
  const fonts = doc.fonts();
  const byFont = new Map<string, Use>();
  const use = (font: string): Use => {
    let u = byFont.get(font);
    if (!u) byFont.set(font, (u = { font, texts: [], styles: [] }));
    return u;
  };
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      const font = o.shape?.kind === "text" && !isDerivedId(o.id) ? fonts[o.shape.fontIndex ?? -1] : undefined;
      if (font) use(font).texts.push(o.id);
    }
  }
  for (const r of doc.resources()) {
    const font = r.kind === "text-style" && r.textStyle ? fonts[r.textStyle.fontIndex] : undefined;
    if (font) use(font).styles.push(r);
  }
  return [...byFont.values()].sort((a, b) => a.font.localeCompare(b.font));
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** What a font is used by, as the Replace list shows it. */
function usedBy(u: Use): string {
  return [u.texts.length && plural(u.texts.length, "text"), u.styles.length && plural(u.styles.length, "text style")].filter(Boolean).join(", ");
}

/** Opens Replace Font and makes the change. */
export async function replaceFontDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const uses = fontUses(doc);
  if (uses.length === 0) {
    toast("No text or text style in this drawing names a font.", "info");
    return;
  }
  const select = (label: string): HTMLSelectElement => h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } });
  const from = select("Replace");
  from.append(...uses.map((u) => h("option", { value: u.font, text: `${u.font} (${usedBy(u)})` })));
  const to = select("With");
  const { own, common } = fontChoices();
  to.append(
    h("optgroup", { attrs: { label: "In this drawing" } }, ...own.map((f) => h("option", { value: f, text: f }))),
    ...(common.length ? [h("optgroup", { attrs: { label: "Common" } }, ...common.map((f) => h("option", { value: f, text: f })))] : []),
  );
  // a selected text's font is the likely one to replace
  const selected = [...store.selection].map((id) => doc.object(id)).find((o) => o?.shape?.kind === "text");
  const selectedFont = selected ? doc.fonts()[selected.shape?.fontIndex ?? -1] : undefined;
  if (selectedFont && uses.some((u) => u.font === selectedFont)) from.value = selectedFont;
  const pickOther = (): void => {
    if (to.value === from.value) to.value = [...own, ...common].find((f) => f !== from.value) ?? to.value;
  };
  pickOther();
  from.addEventListener("change", pickOther);
  const field = (label: string, input: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);

  const choice = await showDialog<{ from: Use; to: string }>({
    title: "Replace Font",
    okLabel: "Replace",
    body: [
      field("Replace", from),
      field("With", to),
      h("p", { cls: "muted", text: "Texts inside symbol definitions keep their font." }),
    ],
    check: () => {
      if (to.value === from.value) return { error: "Choose a different font to replace it with.", focus: to };
      return { value: { from: uses.find((u) => u.font === from.value)!, to: to.value } };
    },
  });
  if (!choice) return;
  const { from: use, to: font } = choice;
  const r = attempt("Replace font", (s) =>
    s.batch(() => {
      if (use.texts.length) s.setTextStyle(use.texts, { font });
      for (const style of use.styles) {
        const def = style.textStyle!;
        s.editTextStyle(style.index, { font, points: def.points, hAlign: def.hAlign, vAlign: def.vAlign }, textStylePreviews(doc, font, style));
      }
    }),
  );
  if (r) toast(`${use.font} replaced with ${font} in ${usedBy(use)}.`, "info");
}
