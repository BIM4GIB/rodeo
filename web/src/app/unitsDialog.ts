// File > Document Settings > Units…: the document's length unit, which every length is shown and
// typed in, with the area and volume units that go with it. Lengths are kept in millimetres
// whatever the unit, so changing it moves nothing; it is one undoable step.

import { companionUnits, LENGTH_UNITS } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { formatArea, formatLength } from "./units.ts";

/** a metre, and a square metre, as the preview shows them in the unit picked */
const SAMPLE_MM = 1000;
const SAMPLE_MM2 = 1e6;

export async function unitsDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const current = session.doc.info.units;

  const unit = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Length unit" } },
    ...LENGTH_UNITS.map((name) => h("option", { value: name, text: name })),
  );
  if (LENGTH_UNITS.includes(current)) unit.value = current;
  const shows = h("p", { cls: "muted" });
  const preview = (): void => {
    const c = companionUnits(unit.value);
    const area = c ? ` Areas in ${c.area}, volumes in ${c.volume}.` : "";
    shows.textContent = `A metre reads ${formatLength(SAMPLE_MM, unit.value)}, a square metre ${formatArea(SAMPLE_MM2, unit.value)}.${area}`;
  };
  unit.addEventListener("change", preview);
  preview();

  const value = await showDialog<string>({
    title: "Units",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Length unit" }), unit),
      shows,
      h("p", { cls: "muted", text: "Nothing in the drawing moves: lengths are shown and typed in the new unit." }),
    ],
    check: () => ({ value: unit.value }),
  });
  if (value === null || value === current) return;
  attempt("Units", (s) => s.setUnits(value));
}
