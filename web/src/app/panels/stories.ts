// Navigation > Stories: the building's stories, the top one first, each with
// its suffix, elevation and the design layers on it (with the level each is
// at). A click on a layer makes it active; a click on a story selects it for
// Edit… and Delete, and a right-click on either offers the rest: renaming or
// editing a story, and moving a layer to another story. Changing a story's
// elevation moves its layers with it. Edit… also sets the story's levels
// (finish floor, top of slab, ...): each a level type, an elevation above the
// story and the design layer at it, which sits at the story's elevation plus
// the level's.

import type { LayerInfo, StoryInfo, StoryLevelSpec } from "../../core/index.ts";
import { attempt, setActiveLayer } from "../commands.ts";
import { h } from "../dom.ts";
import { openContextMenu, type Row } from "../menu.ts";
import { confirmDialog, showDialog } from "../menubar.ts";
import { store } from "../state.ts";
import { levelsEditor } from "../storyLevels.ts";
import { formatLength, formatLengthValue, lengthSuffix, parseLength } from "../units.ts";

/** the floor height a new story is put above the top one at, when the drawing doesn't show one (mm) */
const FLOOR_HEIGHT = 3000;

export function mountStories(root: HTMLElement): void {
  let selected: number | null = null;
  const btnNew = h("button", { cls: "btn", text: "+ Story", title: "New story, above the top one" });
  const btnEdit = h("button", { cls: "btn", text: "Edit…", title: "Edit the selected story" });
  const btnDelete = h("button", { cls: "btn danger", text: "Delete", title: "Delete the selected story (its layers stay)" });
  const list = h("div", { cls: "list" });
  root.replaceChildren(h("div", { cls: "toolbar" }, btnNew, btnEdit, btnDelete), list);

  const render = (): void => {
    const s = store.session;
    const stories = s?.doc.stories() ?? [];
    const layers = new Map((s?.doc.layers() ?? []).map((l) => [l.id, l]));
    if (!stories.some((st) => st.index === selected)) selected = null;
    list.replaceChildren(
      ...stories.flatMap((st) => [storyRow(st), ...st.layers.map((id) => layers.get(id)).filter((l): l is LayerInfo => !!l).map((l) => layerRow(st, l))]),
    );
    if (stories.length === 0) list.append(h("div", { cls: "empty", text: "No stories" }));
    const off = (s?.doc.layers() ?? []).filter((l) => l.kind === "design" && !l.story).length;
    if (stories.length && off) list.append(h("div", { cls: "empty", text: `${off} design layer${off === 1 ? "" : "s"} on no story` }));
    btnNew.disabled = !s;
    btnEdit.disabled = btnDelete.disabled = selected === null;
  };

  const storyRow = (st: StoryInfo): HTMLElement => {
    const units = store.session?.doc.info.units;
    const sub = [st.suffix && `Suffix ${st.suffix}`, formatLength(st.elevation, units)].filter(Boolean).join(" · ");
    const names = h("div", { cls: "names" }, h("div", { cls: "name", text: st.name, attrs: { translate: "no" } }), h("div", { cls: "sub", text: sub }));
    const count = h("span", { cls: "count", text: String(st.layers.length), title: "Design layers on this story" });
    const row = h("div", { cls: `row story-row${st.index === selected ? " selected" : ""}`, attrs: { "data-story": String(st.index) } }, names, count);
    row.addEventListener("click", () => {
      selected = st.index;
      render();
    });
    names.addEventListener("dblclick", () => void editStory(st));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      selected = st.index;
      render();
      openContextMenu(
        [
          { label: "Edit…", run: () => void editStory(st) },
          { label: "New Story…", run: () => void newStory() },
          "-",
          { label: "Delete…", run: () => void deleteStory(st) },
        ],
        e.clientX,
        e.clientY,
      );
    });
    return row;
  };

  const layerRow = (st: StoryInfo, l: LayerInfo): HTMLElement => {
    const units = store.session?.doc.info.units;
    const level = st.levels.find((v) => v.layer === l.name);
    const above = (l.elevation ?? 0) - st.elevation;
    const sub = [level?.type, `${above >= 0 ? "+" : ""}${formatLength(above, units)}`].filter(Boolean).join(" · ");
    const names = h("div", { cls: "names" }, h("div", { cls: "name", text: l.name, attrs: { translate: "no" } }), h("div", { cls: "sub", text: sub }));
    const count = h("span", { cls: "count", text: String(l.objectCount), title: "Objects on this layer" });
    const row = h("div", { cls: `row story-layer${l.id === store.activeLayerId ? " active" : ""}`, attrs: { "data-id": l.id } }, names, count);
    row.addEventListener("click", () => setActiveLayer(l.id));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(
        [{ label: "Make Active", checked: () => store.activeLayerId === l.id, run: () => setActiveLayer(l.id) }, "-", { label: "Story", items: () => storyRows(l) }],
        e.clientX,
        e.clientY,
      );
    });
    return row;
  };

  btnNew.addEventListener("click", () => void newStory());
  btnEdit.addEventListener("click", () => {
    const st = store.session?.doc.stories().find((x) => x.index === selected);
    if (st) void editStory(st);
  });
  btnDelete.addEventListener("click", () => {
    const st = store.session?.doc.stories().find((x) => x.index === selected);
    if (st) void deleteStory(st);
  });

  store.on(["session", "layer"], render);
  render();
}

/** A design layer's "Story" submenu: the stories, top first, and None. */
export function storyRows(layer: LayerInfo): Row[] {
  const stories = store.session?.doc.stories() ?? [];
  const put = (index: number): void => void attempt("Change story", (s) => s.setLayerStory(layer.id, index));
  return [
    ...stories.map((st): Row => ({ label: st.name, checked: () => layer.story === st.index, run: () => put(st.index) })),
    ...(stories.length ? ["-" as const] : []),
    { label: "None", checked: () => !layer.story, run: () => put(0) },
  ];
}

/** New Story…: one above the top story, a floor's height up. */
export async function newStory(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const stories = doc.stories();
  const taken = new Set([...doc.classes().map((c) => c.name), ...doc.layers().map((l) => l.name), ...stories.map((st) => st.name)]);
  let n = stories.length + 1;
  while (taken.has(`Story ${n}`)) n++;
  const [top, next] = stories;
  const height = top && next && top.elevation > next.elevation ? top.elevation - next.elevation : FLOOR_HEIGHT;
  const values = await storyDialog("New Story", { name: `Story ${n}`, suffix: String(n), elevation: top ? top.elevation + height : 0 }, null);
  if (values) attempt("New story", (s) => s.createStory(values.name, values.suffix, values.elevation));
}

/** Edit…: a story's name, suffix, elevation and levels, as one undo step. */
export async function editStory(st: StoryInfo): Promise<void> {
  const values = await storyDialog(`Edit Story: ${st.name}`, st, st.index);
  if (!values) return;
  attempt("Edit story", (s) =>
    s.batch(() => {
      if (values.name !== st.name) s.renameStory(st.index, values.name);
      s.editStory(st.index, { suffix: values.suffix, elevation: values.elevation, levels: values.levels });
    }),
  );
}

async function deleteStory(st: StoryInfo): Promise<void> {
  const n = st.layers.length;
  const what = n ? ` Its ${n} design layer${n === 1 ? " stays" : "s stay"} where ${n === 1 ? "it is" : "they are"}, on no story.` : "";
  if (!(await confirmDialog("Delete story", `Delete story "${st.name}"?${what}`, "Delete"))) return;
  attempt("Delete story", (s) => s.deleteStory(st.index));
}

interface StoryValues {
  name: string;
  suffix: string;
  elevation: number;
  /** an existing story's levels, as editStory takes them */
  levels?: StoryLevelSpec[];
}

/** The name, suffix and elevation of a story, and an existing one's levels; `index` is the story's own, so its name isn't taken. */
function storyDialog(title: string, start: StoryValues & { levels?: readonly { type: string; elevation: number; layer: string }[] }, index: number | null): Promise<StoryValues | null> {
  const doc = store.session?.doc;
  if (!doc) return Promise.resolve(null);
  const units = doc.info.units;
  const field = (label: string, input: HTMLInputElement, after = ""): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input, ...(after ? [h("span", { cls: "muted", text: after })] : []));
  const text = (value: string, label: string): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label, spellcheck: "false" } });
  const name = text(start.name, "Name");
  const suffix = text(start.suffix, "Suffix");
  const shown = formatLengthValue(start.elevation, units);
  const elevation = text(shown, "Elevation");
  const taken = new Set([
    ...doc.classes().map((c) => c.name),
    ...doc.layers().map((l) => l.name),
    ...doc.resources().map((r) => r.name),
    ...doc.stories().filter((st) => st.index !== index).map((st) => st.name),
  ]);
  // an existing story's levels: each a type, an elevation above the story and one of its design layers, or none
  const editing = index !== null && start.levels !== undefined;
  const onStory = editing ? doc.layers().filter((l) => l.kind === "design" && l.story === index) : [];
  const levels = editing
    ? levelsEditor(
        units,
        onStory.map((l) => ({ key: l.name, name: l.name })),
        start.levels!.map((l, i) => ({ type: l.type, elevation: l.elevation, layer: l.layer || null, from: i })),
      )
    : null;

  const promise = showDialog<StoryValues>({
    title,
    okLabel: "OK",
    cls: editing ? "story-dialog story-levels-dialog" : "story-dialog",
    body: [
      field("Name", name),
      field("Suffix", suffix),
      field("Elevation", elevation, lengthSuffix(units)),
      ...(levels?.body ?? []),
      h("p", {
        cls: "muted",
        text: editing
          ? "The design layers on the story move with its elevation; one at a level sits at the story's elevation plus the level's. Their names don't change with the suffix."
          : "The design layers on the story move with its elevation. Their names don't change with the suffix.",
      }),
    ],
    check: () => {
      const n = name.value.trim();
      if (!n) return { error: "Enter a name for the story.", focus: name };
      if (n !== start.name && taken.has(n)) return { error: `"${n}" is already used in this drawing.`, focus: name };
      // left as shown, it keeps its exact value (the field rounds it)
      const z = elevation.value === shown ? start.elevation : parseLength(elevation.value, units);
      if (z === null) return { error: "The elevation takes a length.", focus: elevation };
      if (!levels) return { value: { name: n, suffix: suffix.value.trim(), elevation: z } };
      const read = levels.read();
      if ("error" in read) return read;
      const specs: StoryLevelSpec[] = read.levels.map((l) => ({ type: l.type, elevation: l.elevation, layer: l.layer ?? "", ...(l.from !== undefined ? { from: l.from } : {}) }));
      return { value: { name: n, suffix: suffix.value.trim(), elevation: z, levels: specs } };
    },
  });
  name.focus();
  name.select();
  return promise;
}
