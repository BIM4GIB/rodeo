// A story's levels as a dialog edits them (Navigation > Stories' Edit Story, Organization's
// Levels…): one row per level, each a level type, an elevation above the story and the design
// layer at it (one of the story's, or none), with Add Level and a remove button per row. Layers
// are given as keys with their names, so a dialog that renames layers before applying can name
// them its own way. Level types and layers are each one level's at most.

import { h } from "./dom.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";
import "./storyLevels.css";

/** A level as the editor has it: `layer` a key of the layers offered, `from` its place among the story's levels (none for a new one). */
export interface LevelDraft<K> {
  type: string;
  /** above the story's, mm */
  elevation: number;
  layer: K | null;
  from?: number;
}

interface LevelRow {
  readonly el: HTMLElement;
  readonly type: HTMLInputElement;
  readonly elevation: HTMLInputElement;
  /** the elevation as the field first showed it, and its exact value */
  readonly shown: string;
  readonly exact: number;
  readonly layer: HTMLSelectElement;
  readonly from?: number;
}

export interface LevelsEditor<K> {
  /** the head, the rows and Add Level */
  readonly body: HTMLElement[];
  /** the levels as the rows have them, or what is wrong and where */
  read(): { levels: LevelDraft<K>[] } | { error: string; focus: HTMLElement };
}

/** The editor for `start`'s levels, offering `layers` (the design layers on the story) to put at them. */
export function levelsEditor<K>(units: string | undefined, layers: readonly { key: K; name: string }[], start: readonly LevelDraft<K>[]): LevelsEditor<K> {
  const rows: LevelRow[] = [];
  const list = h("div", { cls: "sl-list", attrs: { role: "list" } });
  const showRows = (): void => {
    list.replaceChildren(...(rows.length ? rows.map((r) => r.el) : [h("div", { cls: "sl-empty", text: "No levels" })]));
  };
  const addRow = (level: LevelDraft<K>): LevelRow => {
    const type = h("input", { cls: "sl-type", value: level.type, attrs: { type: "text", "aria-label": "Level type", spellcheck: "false" } });
    const shown = formatLengthValue(level.elevation, units);
    const z = h("input", { cls: "sl-elevation", value: shown, attrs: { type: "text", "aria-label": "Elevation above the story", spellcheck: "false", inputmode: "decimal" } });
    // options by place in `layers`, "" for none
    const layer = h(
      "select",
      { cls: "sl-layer", attrs: { "aria-label": "Design layer at the level" } },
      h("option", { value: "", text: "None" }),
      ...layers.map((l, i) => h("option", { attrs: { translate: "no" }, value: String(i), text: l.name })),
    );
    const at = level.layer === null ? -1 : layers.findIndex((l) => l.key === level.layer);
    layer.value = at < 0 ? "" : String(at);
    const remove = h("button", { cls: "sl-remove", text: "×", attrs: { type: "button", "aria-label": "Remove level", title: "Remove level" } });
    const el = h("div", { cls: "sl-row", attrs: { role: "listitem" } }, type, z, layer, remove);
    const row: LevelRow = { el, type, elevation: z, shown, exact: level.elevation, layer, from: level.from };
    remove.addEventListener("click", () => {
      rows.splice(rows.indexOf(row), 1);
      showRows();
    });
    rows.push(row);
    return row;
  };
  for (const l of start) addRow(l);
  showRows();
  const add = h("button", { cls: "btn sl-add", text: "Add Level", attrs: { type: "button" } });
  add.addEventListener("click", () => {
    const types = new Set(rows.map((r) => r.type.value.trim()));
    let n = rows.length + 1;
    while (types.has(`Level ${n}`)) n++;
    const row = addRow({ type: `Level ${n}`, elevation: 0, layer: null });
    showRows();
    row.type.focus();
    row.type.select();
  });
  const suffix = lengthSuffix(units);
  const head = h(
    "div",
    { cls: "sl-head", attrs: { "aria-hidden": "true" } },
    h("span", { text: "Level type" }),
    h("span", { text: `Elevation${suffix ? ` (${suffix})` : ""}` }),
    h("span", { text: "Design layer" }),
  );

  const read = (): { levels: LevelDraft<K>[] } | { error: string; focus: HTMLElement } => {
    const levels: LevelDraft<K>[] = [];
    const types = new Set<string>();
    const used = new Set<string>();
    for (const r of rows) {
      const type = r.type.value.trim();
      if (!type) return { error: "Each level needs a level type.", focus: r.type };
      if (types.has(type)) return { error: `There are two "${type}" levels.`, focus: r.type };
      types.add(type);
      // left as shown, it keeps its exact value (the field rounds it)
      const z = r.elevation.value === r.shown ? r.exact : parseLength(r.elevation.value, units);
      if (z === null) return { error: `The elevation of "${type}" takes a length.`, focus: r.elevation };
      const layer = r.layer.value === "" ? null : layers[Number(r.layer.value)];
      if (layer && used.has(r.layer.value)) return { error: `"${layer.name}" is at two levels.`, focus: r.layer };
      if (layer) used.add(r.layer.value);
      levels.push({ type, elevation: z, layer: layer ? layer.key : null, ...(r.from !== undefined ? { from: r.from } : {}) });
    }
    return { levels };
  };
  return { body: [head, list, add], read };
}
