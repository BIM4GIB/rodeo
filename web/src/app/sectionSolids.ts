// Model > Section Solids…, Vectorworks' Select Object dialog for it: of the two objects selected,
// which is the sectioning object (the other is cut), Retain Sectioning Object, and Reverse
// Direction (in Object Info in Vectorworks). A flat 3D polygon cuts away the part on the side its
// normal points to, a solid or mesh the part inside it (edit.ts sectionSolid); what is left is one
// mesh, where Vectorworks makes a solid section that stays editable.

import { canSectionSolids, type SectionPart, sectionSolidSelection, selectedSolidAndCutter } from "./compose.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { typeLabel } from "./reportRows.ts";

export { canSectionSolids };

/** the dialog's last settings, kept for the next time */
const last = { retain: false, reverse: false };

/** The likelier sectioning object of the two: the one that can't be cut (a 3D polygon), else the frontmost, as the newer. */
function likelyCutter([back, front]: [SectionPart, SectionPart]): SectionPart {
  return back.base && front.cutter ? front : back;
}

/** The object's kind, and which of the two it is when both are the same kind. */
function optionText(p: SectionPart, pair: [SectionPart, SectionPart]): string {
  const other = pair[0] === p ? pair[1] : pair[0];
  if (other.typeName !== p.typeName) return typeLabel(p.typeName);
  return `${typeLabel(p.typeName)} (${p === pair[1] ? "front" : "back"})`;
}

/** Model > Section Solids…: which of the two selected objects cuts the other, Retain Sectioning Object and Reverse Direction. */
export async function sectionSolidsDialog(): Promise<void> {
  const pair = selectedSolidAndCutter();
  if (!pair) return;
  const candidates = pair.filter((p) => p.cutter && pair.find((q) => q !== p)!.base);
  const cutter = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Cut with" } },
    ...candidates.map((p) => h("option", { value: p.id, text: optionText(p, pair) })),
  );
  cutter.value = likelyCutter(pair).id;
  const retain = h("input", { attrs: { type: "checkbox", "aria-label": "Retain Sectioning Object" }, checked: last.retain });
  const reverse = h("input", { attrs: { type: "checkbox", "aria-label": "Reverse Direction" }, checked: last.reverse });
  const r = await showDialog<string>({
    title: "Section Solids",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Cut with" }), cutter),
      h("label", { cls: "menu-dialog-check" }, retain, "Retain Sectioning Object"),
      h("label", { cls: "menu-dialog-check" }, reverse, "Reverse Direction"),
      h("p", {
        cls: "muted",
        text:
          "A 3D polygon cuts away the part on the side its normal points to (the right-hand rule round its points) and must be larger than the solid; a solid cuts away the part inside it. " +
          "Reverse Direction cuts the other side, or keeps only the part inside. The cut faces take the sectioning object's attributes.",
      }),
    ],
    check: () => ({ value: cutter.value }),
  });
  if (r === null) return;
  last.retain = retain.checked;
  last.reverse = reverse.checked;
  const base = pair.find((p) => p.id !== r)!;
  sectionSolidSelection(base.id, r, reverse.checked, retain.checked);
}
