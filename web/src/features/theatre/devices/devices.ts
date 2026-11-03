// Stage > Lighting > Convert To Lighting Device and Replace Lighting Devices…. Convert turns the selected
// symbol instances into lighting devices (Rodeo Instruments) that show the symbol, where it was and
// aimed as it was turned, with the figures of the generic type its name suggests; Object Info edits it. Replace gives the selected
// lighting devices, or all of them on the visible design layers, another generic type (and its typical
// figures) or another of the drawing's symbols, keeping their data; Object Info's Replace Lighting Device…
// opens it on the one device. Each is one undo step, and the devices are selected after. The sums are
// in deviceShapes.ts.

import type { ObjectInfo } from "../../../core/index.ts";
import { attempt, setSelection } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { pluginDriver } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { groupByFolder, symbolDefsOf } from "../../../app/panels/resources.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { FIELD, FIXTURE_TYPES, INSTRUMENT } from "../fixture.ts";
import { fixtures, placeInstrument, replaceDevices } from "../instrument.ts";
import { aimOfTurn, typeForName } from "./deviceShapes.ts";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The selected symbol instances on the drawing's design layers (those the layers hold directly). */
function selectedSymbols(): ObjectInfo[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return [...store.selection].flatMap((id) => {
    const o = doc.object(id);
    return o && o.kind === "symbol" && o.parentId === null && o.symbol !== undefined && o.insertion ? [o] : [];
  });
}

/** Stage > Lighting > Convert To Lighting Device: the selected symbols become lighting devices showing them. */
export function convertToLightingDevice(): void {
  const s = store.session;
  if (!s) return;
  const symbols = selectedSymbols();
  if (!symbols.length) {
    toast("Convert To Lighting Device: select symbols to convert. To convert other objects, make a symbol of them first with Modify > Create Symbol.", "info");
    return;
  }
  const r = attempt("Convert To Lighting Device", (session) =>
    session.batch(() => {
      const made: string[] = [];
      const converted: string[] = [];
      for (const o of symbols) {
        const def = session.doc.symbolDefs().find((d) => d.index === o.symbol);
        if (!def) continue;
        made.push(placeInstrument(session, o.layerId, o.insertion!, typeForName(def.name), { symbol: def.name, aimDeg: aimOfTurn(o.turned ?? 0) }, o.classIndex));
        converted.push(o.id);
      }
      if (converted.length) session.deleteObjects(converted);
      return made;
    }),
  );
  if (!r) return;
  setSelection(r.value);
  toast(`Converted ${plural(r.value.length, "symbol", "symbols")} to lighting devices. Their type, focus and data are set in Object Info.`, "info");
}

/** Rodeo's lighting devices on the visible design layers. */
function visibleDevices(): string[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const shown = new Set(doc.layers().filter((l) => l.kind === "design" && l.visibility !== "hidden").map((l) => l.id));
  return fixtures().filter((f) => f.native && shown.has(f.layerId)).map((f) => f.id);
}

/** What replaces: a generic type, or a symbol of the drawing's. */
type Replacement = { readonly type: string } | { readonly symbol: string };

/** what the dialog had last, while the page is open */
const last = { value: "type:profile26" };

/**
 * Replace Lighting Devices: the dialog, then the devices replaced as one undo step. `only` gives the
 * devices Object Info's button opens it on; otherwise it offers the selected ones or all of them.
 */
export async function replaceLightingDevices(only?: readonly string[]): Promise<void> {
  const s = store.session;
  if (!s) return;
  const native = new Set(fixtures().filter((f) => f.native).map((f) => f.id));
  const chosen = (only ?? [...store.selection]).filter((id) => native.has(id));
  const all = visibleDevices();
  const foreign = fixtures().filter((f) => !f.native && (only ?? [...store.selection]).includes(f.id)).length;
  if (!chosen.length && !all.length) {
    toast(foreign ? "Replace Lighting Devices: Vectorworks' own lighting devices keep their drawing in Rodeo, so they can't be replaced here." : "Replace Lighting Devices: the drawing has no lighting devices.", "info");
    return;
  }
  const scopeSelected = h("input", { checked: chosen.length > 0, disabled: !chosen.length, attrs: { type: "radio", name: "replace-scope", "aria-label": "Replace selected lighting devices" } });
  const scopeAll = h("input", { checked: chosen.length === 0, disabled: !!only, attrs: { type: "radio", name: "replace-scope", "aria-label": "Replace All" } });
  const defs = symbolDefsOf(s.doc);
  const pick = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select replace-device-pick", attrs: { "aria-label": "Replacement" } },
    h("optgroup", { attrs: { label: "Generic types" } }, ...FIXTURE_TYPES.map((t) => h("option", { value: `type:${t.key}`, text: t.label }))),
    ...[...groupByFolder(defs)].map(([folder, list]) => h("optgroup", { attrs: { label: folder ? `Symbols: ${folder}` : "Symbols in this drawing" } }, ...list.map((d) => h("option", { value: `symbol:${d.name}`, text: d.name })))),
  );
  if ([...pick.options].some((o) => o.value === last.value)) pick.value = last.value;
  const v = await showDialog<{ ids: readonly string[]; with: Replacement }>({
    title: "Replace Lighting Devices",
    okLabel: "Replace",
    cls: "replace-device-dialog",
    body: [
      h("label", { cls: "menu-dialog-check" }, scopeSelected, `Replace selected lighting devices (${chosen.length})`),
      h("label", { cls: "menu-dialog-check" }, scopeAll, `Replace All: every lighting device on the visible design layers (${all.length})`),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Replace with" }), pick),
      h("p", { cls: "muted", text: `A generic type brings its typical wattage, weight, beam and lumens; a symbol is drawn in place of the outline, its front toward the bottom of the symbol, and keeps the device's type.${foreign ? ` ${plural(foreign, "Vectorworks lighting device", "Vectorworks lighting devices")} selected keep their drawing and aren't replaced.` : ""}` }),
    ],
    check: () => {
      const ids = scopeAll.checked ? all : chosen;
      if (!ids.length) return { error: "There are no lighting devices to replace." };
      const [kind, ...rest] = pick.value.split(":");
      const name = rest.join(":");
      return { value: { ids, with: kind === "type" ? { type: name } : { symbol: name } } };
    },
  });
  last.value = pick.value;
  if (!v || store.session !== s) return;
  const driver = pluginDriver(INSTRUMENT);
  if (!driver) return;
  const values: Record<string, string> = "type" in v.with ? { [FIELD.type]: v.with.type, [FIELD.symbol]: "" } : { [FIELD.symbol]: v.with.symbol };
  const r = attempt("Replace Lighting Devices", (session) => session.batch(() => v.ids.forEach((id) => driver.edit(id, values))));
  if (!r) return;
  setSelection(v.ids);
  const what = "type" in v.with ? (FIXTURE_TYPES.find((t) => t.key === (v.with as { type: string }).type)?.label ?? "") : (v.with as { symbol: string }).symbol;
  toast(`Replaced ${plural(v.ids.length, "lighting device", "lighting devices")} with ${what}.`, "info");
}

replaceDevices.open = (ids) => void replaceLightingDevices(ids);
