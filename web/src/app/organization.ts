// Tools > Organization… (⇧⌘O): the drawing's classes, design layers, sheet
// layers and viewports in one dialog, as Vectorworks' Organization dialog has
// them. Each tab is a dense table: visibility (visible, grayed, hidden; a column
// head sets every listed row), the name, a design layer's scale or a sheet's
// title, and how many objects it holds. New, Delete and, for design layers, Up
// and Down change the list; on the Classes tab Edit… (or a double-click) sets a
// class's attributes, which objects using the class style draw with, its
// RenderWorks texture, which objects textured "by class" show in 3D, and its
// text style, which texts set to Class Text Style follow. Design
// layers also have their elevation and story, and the Stories tab names,
// suffixes and raises the stories (their layers move with them), adds and
// deletes them, and Levels… sets a story's levels (each a level type, an
// elevation above the story and the design layer at it, which takes that
// elevation). The Viewports tab lists every viewport by sheet, with
// its scale to edit. Nothing changes until OK, which applies it all as one undo
// step; Cancel leaves the drawing as it was. Viewports are renamed there too.
// The Saved Views tab adds (the current view), renames, deletes and reorders the
// saved views, which this browser keeps beside the file, so OK saves them
// outside the undo step.

import type { Attributes, ViewportInfo, Visibility } from "../core/index.ts";
import { h } from "./dom.ts";
import { visibilityIcon } from "./icons.ts";
import { showDialog } from "./menubar.ts";
import { visibilityLabel } from "./panels/common.ts";
import { classAttributeControls } from "./panels/objectInfo.ts";
import { savedViews } from "./panels/views.ts";
import { store } from "./state.ts";
import { levelsEditor, type LevelDraft } from "./storyLevels.ts";
import { errorMessage } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** the tabs that list rows to add, delete and rename */
type ListTab = "classes" | "design" | "sheet";
type TabId = ListTab | "stories" | "viewports" | "views";

const TABS: readonly { readonly id: TabId; readonly label: string; readonly noun: string }[] = [
  { id: "classes", label: "Classes", noun: "class" },
  { id: "design", label: "Design Layers", noun: "design layer" },
  { id: "stories", label: "Stories", noun: "story" },
  { id: "sheet", label: "Sheet Layers", noun: "sheet layer" },
  { id: "viewports", label: "Viewports", noun: "viewport" },
  { id: "views", label: "Saved Views", noun: "saved view" },
];
/** the range of drawing scales a viewport takes (1:n) */
const VIEWPORT_SCALE = { min: 0.001, max: 1e6 } as const;
const STATES: readonly Visibility[] = ["visible", "grayed", "hidden"];
/** the class that cannot be renamed or deleted */
const NONE_CLASS = "None";
/** how near an elevation is to another to be the same (mm): a field shows them rounded */
const SAME_ELEVATION = 1e-6;
/** the floor height a new story is put above the top one at, when the stories don't show one (mm) */
const FLOOR_HEIGHT = 3000;

interface Row {
  /** class index or layer id; null for one added here */
  readonly key: number | string | null;
  name: string;
  /** a sheet layer's title */
  title: string;
  /** a design layer's scale (1:n) */
  scale: number;
  visibility: Visibility;
  readonly objects: number;
  /** the "None" class: kept and named as it is */
  readonly fixed: boolean;
  /** for one added here by Duplicate: the class or layer it copies, with what that holds */
  readonly copyOf: number | string | null;
  deleted: boolean;
  /** a class's attributes; null for layers, and for a class whose record has none */
  attrs: Attributes | null;
  /** a class's RenderWorks texture (name index, 0 none) */
  texture: number;
  /** the text style a class's "Class Text Style" texts follow (name index, 0 none) */
  textStyle: number;
  /** a design layer's story */
  story: StoryRow | null;
  /** a design layer's elevation above its story's (as the dialog has the story now), or above 0 on none; mm */
  rel: number;
  /** a design layer's elevation field holds no length */
  badElevation: boolean;
  readonly orig: {
    readonly name: string;
    readonly title: string;
    readonly scale: number;
    readonly visibility: Visibility;
    readonly attrs: Attributes | null;
    readonly texture: number;
    readonly textStyle: number;
    readonly elevation: number;
    readonly story: StoryRow | null;
  } | null;
}

/** A story on the Stories tab. */
interface StoryRow {
  /** its name index; null for one added here */
  readonly key: number | null;
  name: string;
  suffix: string;
  /** mm */
  elevation: number;
  /** its elevation field holds no length */
  bad: boolean;
  deleted: boolean;
  /** its levels, each at one of the design layers on it as the dialog has them */
  levels: LevelDraft<Row>[];
  readonly orig: { readonly name: string; readonly suffix: string; readonly elevation: number; levels: readonly LevelDraft<Row>[] } | null;
}

/** A viewport on the Viewports tab: its name and scale are edited here. */
interface ViewportRow {
  readonly id: string;
  /** its name ("" for none) */
  name: string;
  readonly origName: string;
  /** what the list calls it: its name, or "Viewport n" by its place on the sheet */
  readonly label: string;
  /** the sheet layer it is on */
  readonly sheetId: string;
  readonly plan: boolean;
  scale: number;
  readonly origScale: number;
}

/** A saved view on the Saved Views tab. */
interface ViewRow {
  /** its place in the list as the dialog opened; -1 for one added here, the view as it is now */
  readonly index: number;
  name: string;
  /** the "Visibility" box: the view also restores layer and class visibility */
  restoreVisibility: boolean;
  readonly modes: string;
  deleted: boolean;
  readonly orig: { readonly name: string; readonly restoreVisibility: boolean };
}

/** the tab shown last, so the dialog reopens on it */
let lastTab: TabId = "classes";

/** Opens the Organization dialog for the open drawing. */
export async function organizationDialog(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const existing = (
    key: number | string,
    name: string,
    title: string,
    scale: number,
    visibility: Visibility,
    objects: number,
    fixed = false,
    attrs: Attributes | null = null,
    elevation = 0,
    story: StoryRow | null = null,
    texture = 0,
    textStyle = 0,
  ): Row => ({
    key,
    name,
    title,
    scale,
    visibility,
    objects,
    fixed,
    copyOf: null,
    deleted: false,
    attrs: attrs && { ...attrs },
    texture,
    textStyle,
    story,
    rel: elevation - (story?.elevation ?? 0),
    badElevation: false,
    orig: { name, title, scale, visibility, attrs, texture, textStyle, elevation, story },
  });
  const units = s.doc.info.units;
  const storyInfo = s.doc.stories();
  const stories: StoryRow[] = storyInfo.map((st) => ({
    key: st.index,
    name: st.name,
    suffix: st.suffix,
    elevation: st.elevation,
    bad: false,
    deleted: false,
    levels: [],
    orig: { name: st.name, suffix: st.suffix, elevation: st.elevation, levels: [] },
  }));
  const storyOf = new Map(stories.map((r) => [r.key, r]));
  const classInfo = s.doc.classes();
  const lists: Record<ListTab, Row[]> = {
    classes: classInfo.map((c) => existing(c.index, c.name, "", 1, c.visibility, c.objectCount, c.name === NONE_CLASS, c.attrs, 0, null, c.texture, c.textStyle)),
    design: s.doc
      .layers()
      .filter((l) => l.kind === "design")
      .map((l) => existing(l.id, l.name, "", l.scale, l.visibility, l.objectCount, false, null, l.elevation ?? 0, storyOf.get(l.story ?? 0) ?? null)),
    sheet: s.doc.layers().filter((l) => l.kind === "sheet").map((l) => existing(l.id, l.name, l.title, l.scale, l.visibility, l.objectCount)),
  };
  // each story's levels, at the design layers' rows (found by the names the levels hold)
  for (const r of stories) {
    const levels = (storyInfo.find((st) => st.index === r.key)?.levels ?? []).map(
      (l, i): LevelDraft<Row> => ({ type: l.type, elevation: l.elevation, layer: lists.design.find((d) => d.name === l.layer && d.story === r) ?? null, from: i }),
    );
    r.levels = levels;
    r.orig!.levels = levels.map((l) => ({ ...l }));
  }
  /** a design layer's elevation as the dialog has it now, mm */
  const elevationOf = (r: Row): number => r.rel + (r.story?.elevation ?? 0);
  const liveStories = (): StoryRow[] => stories.filter((r) => !r.deleted);
  const viewports: ViewportRow[] = lists.sheet.flatMap((sheet) =>
    s.doc
      .viewportIds(sheet.key as string)
      .map((id) => s.doc.viewport(id))
      .filter((v): v is ViewportInfo => v !== null)
      .map((v, i) => ({ id: v.id, name: v.name, origName: v.name, label: v.name || `Viewport ${i + 1}`, sheetId: sheet.key as string, plan: v.plan, scale: v.scale, origScale: v.scale })),
  );
  const views: ViewRow[] = (savedViews()?.entries() ?? []).map((v, index) => ({
    index,
    name: v.name,
    restoreVisibility: v.restoreVisibility,
    modes: v.modes,
    deleted: false,
    orig: { name: v.name, restoreVisibility: v.restoreVisibility },
  }));
  let tab: TabId = lastTab;
  const selected: Record<ListTab, Row | null> = { classes: null, design: null, sheet: null };
  let selectedView: ViewRow | null = null;
  let selectedStory: StoryRow | null = null;
  const storyFields = new Map<StoryRow, { name: HTMLInputElement; elevation: HTMLInputElement }>();
  const elevationFields = new Map<Row, HTMLInputElement>();
  const viewFields = new Map<ViewRow, HTMLInputElement>();
  /** the name field of each shown row, to focus one a check finds fault with */
  const nameFields = new Map<Row, HTMLInputElement>();
  /** the scale and name fields of each shown viewport */
  const scaleFields = new Map<ViewportRow, HTMLInputElement>();
  const viewportNames = new Map<ViewportRow, HTMLInputElement>();
  /** the tab's list of rows, or null on the Stories, Viewports and Saved Views tabs */
  const listTab = (): ListTab | null => (tab === "stories" || tab === "viewports" || tab === "views" ? null : tab);
  /** the sheets OK keeps, by id, as the dialog names them now */
  const liveSheets = (): Map<string, Row> =>
    new Map(lists.sheet.filter((r) => !r.deleted && typeof r.key === "string").map((r) => [r.key as string, r]));

  const tabButtons = TABS.map((t) => {
    const btn = h("button", { cls: "seg-btn", text: t.label, attrs: { type: "button", role: "tab" } });
    btn.addEventListener("click", () => {
      tab = t.id;
      search.value = "";
      render();
    });
    return btn;
  });
  const search = h("input", {
    cls: "menu-dialog-input org-search",
    placeholder: "Search",
    attrs: { type: "search", "aria-label": "Search the list", autocomplete: "off", spellcheck: "false" },
  });
  search.addEventListener("input", () => render());
  const btn = (text: string, run: () => void): HTMLButtonElement => {
    const b = h("button", { cls: "btn small", text, attrs: { type: "button" } });
    b.addEventListener("click", run);
    return b;
  };
  const btnNew = btn("New", () => addRow());
  const btnDuplicate = btn("Duplicate", () => duplicateRow());
  const btnEdit = btn("Edit…", () => void editClass());
  const btnLevels = btn("Levels…", () => void editLevels());
  const btnDelete = btn("Delete", () => deleteRow());
  const btnUp = btn("Move Up", () => moveRow(-1));
  const btnDown = btn("Move Down", () => moveRow(1));
  const table = h("div", { cls: "org-table", attrs: { role: "table" } });
  const note = h("p", { cls: "muted org-note" });

  /** Every name in use once OK applies, but `except`'s. */
  const takenNames = (except: Row | StoryRow | null): Set<string> => {
    const names = new Set<string>();
    for (const list of [...Object.values(lists), stories]) for (const r of list) if (r !== except && !r.deleted) names.add(r.name.trim());
    return names;
  };
  const freeName = (base: string): string => {
    const taken = takenNames(null);
    for (let i = 1; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  };

  function addRow(): void {
    if (tab === "stories") {
      const [top, next] = [...liveStories()].sort((a, b) => b.elevation - a.elevation);
      const height = top && next && top.elevation > next.elevation ? top.elevation - next.elevation : FLOOR_HEIGHT;
      const taken = takenNames(null);
      let n = liveStories().length + 1;
      while (taken.has(`Story ${n}`)) n++;
      const row: StoryRow = { key: null, name: `Story ${n}`, suffix: String(n), elevation: top ? top.elevation + height : 0, bad: false, deleted: false, levels: [], orig: null };
      stories.push(row);
      selectedStory = row;
      search.value = "";
      render();
      const field = storyFields.get(row)?.name;
      field?.focus();
      field?.select();
      return;
    }
    if (listTab() === null) {
      if (tab !== "views") return;
      const taken = new Set(views.filter((v) => !v.deleted).map((v) => v.name));
      let n = 1;
      while (taken.has(`View ${n}`)) n++;
      const row: ViewRow = { index: -1, name: `View ${n}`, restoreVisibility: false, modes: "The view as it is now", deleted: false, orig: { name: "", restoreVisibility: false } };
      views.push(row);
      selectedView = row;
      search.value = "";
      render();
      const field = viewFields.get(row);
      field?.focus();
      field?.select();
      return;
    }
    const which = listTab();
    if (!which) return;
    const list = lists[which];
    const like = selected[which] ?? list.find((r) => !r.deleted);
    const row: Row = {
      key: null,
      name: freeName(which === "classes" ? "Class" : which === "design" ? "Design Layer" : "Sheet"),
      title: "",
      scale: which === "design" ? (like?.scale ?? 50) : 1,
      visibility: "visible",
      objects: 0,
      fixed: false,
      copyOf: null,
      deleted: false,
      // a new class starts as a copy of the last one that is not None, as createClass makes it
      attrs: which === "classes" ? copyAttrs(classInfo.filter((c) => c.name !== NONE_CLASS).at(-1)?.attrs ?? null) : null,
      texture: which === "classes" ? (classInfo.filter((c) => c.name !== NONE_CLASS).at(-1)?.texture ?? 0) : 0,
      textStyle: which === "classes" ? (classInfo.filter((c) => c.name !== NONE_CLASS).at(-1)?.textStyle ?? 0) : 0,
      story: null,
      rel: 0,
      badElevation: false,
      orig: null,
    };
    list.push(row);
    selected[which] = row;
    search.value = "";
    render();
    const field = nameFields.get(row);
    field?.focus();
    field?.select();
  }

  /** A copy of the selected class or layer just after it, with its settings as the dialog has them; on OK a layer's copy gets a copy of everything on it. */
  function duplicateRow(): void {
    const which = listTab();
    const src = which && selected[which];
    if (!which || !src) return;
    const list = lists[which];
    const row: Row = {
      ...src,
      key: null,
      name: freeName(src.name.trim() || "Copy"),
      // a layer's copy holds what it does; a class's has no objects in it
      objects: which === "classes" ? 0 : src.objects,
      fixed: false,
      copyOf: src.key ?? src.copyOf,
      deleted: false,
      attrs: copyAttrs(src.attrs),
      // the copy is on no story, at the elevation the one copied is at
      story: null,
      rel: elevationOf(src),
      badElevation: false,
      orig: null,
    };
    list.splice(list.indexOf(src) + 1, 0, row);
    selected[which] = row;
    search.value = "";
    render();
    const field = nameFields.get(row);
    field?.focus();
    field?.select();
  }

  function deleteRow(): void {
    if (tab === "stories") {
      const st = selectedStory;
      if (!st) return;
      // its layers stay where they are, on no story
      for (const r of lists.design) {
        if (r.story !== st) continue;
        r.rel = elevationOf(r);
        r.story = null;
      }
      if (st.key === null) stories.splice(stories.indexOf(st), 1);
      else st.deleted = true;
      selectedStory = null;
      render();
      return;
    }
    if (tab === "views") {
      // one added here just goes; an existing one is deleted on OK
      if (selectedView?.index === -1) views.splice(views.indexOf(selectedView), 1);
      else if (selectedView) selectedView.deleted = true;
      selectedView = null;
      render();
      return;
    }
    const t = listTab();
    const row = t && selected[t];
    if (!t || !row || row.fixed) return;
    const list = lists[t];
    if (row.key === null) list.splice(list.indexOf(row), 1);
    else row.deleted = true;
    selected[t] = null;
    render();
  }

  /** Edit…: the selected class's attributes, in a dialog over this one; they apply with the rest on OK. */
  async function editClass(): Promise<void> {
    const row = selected.classes;
    const doc = store.session?.doc;
    if (tab !== "classes" || !row?.attrs || !doc) return;
    const values = { ...row.attrs };
    // the drawing's textures by name, and the class's own should it not be among them
    const textures = doc.resources().filter((r) => r.kind === "texture").sort((a, b) => a.name.localeCompare(b.name));
    const texture = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select org-texture", attrs: { "aria-label": "Texture" } },
      h("option", { value: "0", text: "None" }),
      ...textures.map((t) => h("option", { value: String(t.index), text: t.name })),
      ...(row.texture && !textures.some((t) => t.index === row.texture) ? [h("option", { value: String(row.texture), text: `Texture #${row.texture}` })] : []),
    );
    texture.value = String(row.texture);
    // the same for its text style
    const styles = doc.resources().filter((r) => r.kind === "text-style").sort((a, b) => a.name.localeCompare(b.name));
    const textStyle = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select org-texture", attrs: { "aria-label": "Text style" } },
      h("option", { value: "0", text: "None" }),
      ...styles.map((t) => h("option", { value: String(t.index), text: t.name })),
      ...(row.textStyle && !styles.some((t) => t.index === row.textStyle) ? [h("option", { value: String(row.textStyle), text: `Text style #${row.textStyle}` })] : []),
    );
    textStyle.value = String(row.textStyle);
    const next = await showDialog<{ attrs: Attributes; texture: number; textStyle: number }>({
      title: `Edit Class: ${row.name.trim() || "New class"}`,
      okLabel: "OK",
      cls: "org-class-dialog",
      body: [
        h("p", { cls: "muted", text: "Objects set to use the class style (Object Info's Attributes) draw with these." }),
        classAttributeControls(doc, values),
        h(
          "label",
          { cls: "menu-dialog-field" },
          h("span", { cls: "menu-dialog-label", text: "Texture" }),
          texture,
        ),
        h("p", { cls: "muted", text: textures.length ? "Objects whose texture is set to the class's show it in 3D." : "This drawing has no textures yet." }),
        h(
          "label",
          { cls: "menu-dialog-field" },
          h("span", { cls: "menu-dialog-label", text: "Text style" }),
          textStyle,
        ),
        h("p", { cls: "muted", text: styles.length ? "Texts set to Class Text Style (the Text menu or Object Info) follow it." : "This drawing has no text styles yet." }),
      ],
      check: () => ({ value: { attrs: values, texture: Number(texture.value), textStyle: Number(textStyle.value) } }),
    });
    if (!next) return;
    row.attrs = next.attrs;
    row.texture = next.texture;
    row.textStyle = next.textStyle;
    render();
  }

  /** Levels…: the selected story's levels, in a dialog over this one; they apply with the rest on OK. */
  async function editLevels(): Promise<void> {
    const st = selectedStory;
    if (tab !== "stories" || !st) return;
    const onStory = lists.design.filter((d) => !d.deleted && d.story === st);
    // a level at a layer no longer on the story is at none
    const editor = levelsEditor(
      units,
      onStory.map((d) => ({ key: d, name: d.name.trim() })),
      st.levels.map((l) => ({ ...l, layer: l.layer && onStory.includes(l.layer) ? l.layer : null })),
    );
    const next = await showDialog<LevelDraft<Row>[]>({
      title: `Levels: ${st.name.trim() || "New story"}`,
      okLabel: "OK",
      cls: "story-levels-dialog",
      body: [...editor.body, h("p", { cls: "muted", text: "A design layer at a level takes the story's elevation plus the level's." })],
      check: () => {
        const read = editor.read();
        return "error" in read ? read : { value: read.levels };
      },
    });
    if (!next) return;
    st.levels = next;
    for (const l of next) if (l.layer) l.layer.rel = l.elevation;
    render();
  }

  function moveRow(by: -1 | 1): void {
    const t = listTab();
    if (tab === "views" ? shift(views, selectedView, by) : t && shift(lists[t], selected[t], by)) render();
  }

  function render(): void {
    lastTab = tab;
    const def = TABS.find((t) => t.id === tab)!;
    tabButtons.forEach((b, i) => {
      const on = TABS[i].id === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    const q = search.value.trim().toLowerCase();
    table.dataset.tab = tab;
    btnNew.hidden = tab === "viewports";
    btnDuplicate.hidden = listTab() === null;
    btnDelete.hidden = tab === "viewports";
    btnEdit.hidden = tab !== "classes";
    btnLevels.hidden = tab !== "stories";
    if (tab === "stories") {
      renderStories(q);
      btnUp.hidden = btnDown.hidden = true;
      refreshButtons();
      refreshNote();
      return;
    }
    if (tab === "views") {
      renderViews(q);
      btnUp.hidden = btnDown.hidden = false;
      refreshButtons();
      refreshNote();
      return;
    }
    if (tab === "viewports") {
      renderViewports(q);
      btnUp.hidden = btnDown.hidden = true;
      refreshNote();
      return;
    }
    const list = lists[tab];
    const shown = list.filter((r) => !r.deleted && (q === "" || r.name.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)));
    const extra = tab === "design" ? ["Scale", `Elevation${lengthSuffix(units) ? ` (${lengthSuffix(units)})` : ""}`, ...(liveStories().length ? ["Story"] : [])] : tab === "sheet" ? ["Title"] : [];
    table.dataset.stories = String(tab === "design" && liveStories().length > 0);

    const heads = STATES.map((v) => {
      const b = h("button", {
        cls: `vl-col vl-head vis-${v}`,
        html: visibilityIcon(v),
        title: `${visibilityLabel(v)}: set every listed ${def.noun}`,
        attrs: { type: "button", "aria-label": `Make every listed ${def.noun} ${visibilityLabel(v).toLowerCase()}` },
      });
      b.addEventListener("click", () => {
        for (const r of shown) r.visibility = v;
        render();
      });
      return b;
    });
    nameFields.clear();
    elevationFields.clear();
    table.replaceChildren(
      h(
        "div",
        { cls: "org-row org-head", attrs: { role: "row" } },
        ...heads,
        h("span", { text: tab === "sheet" ? "Number" : "Name" }),
        ...extra.map((text) => h("span", { text })),
        h("span", { cls: "org-num", text: "Objects" }),
      ),
      ...shown.map((r) => rowEl(r)),
      ...(shown.length === 0 ? [h("p", { cls: "vl-empty", text: q ? "None match." : `No ${def.noun}s.` })] : []),
    );

    btnUp.hidden = btnDown.hidden = tab !== "design";
    refreshButtons();
    refreshNote();
  }

  /** The Stories tab: each story's name, suffix and elevation, the top one first, and how many design layers are on it. */
  function renderStories(q: string): void {
    const shown = liveStories()
      .filter((r) => q === "" || r.name.toLowerCase().includes(q))
      .sort((a, b) => b.elevation - a.elevation);
    storyFields.clear();
    const suffix = lengthSuffix(units);
    table.dataset.stories = "false";
    table.replaceChildren(
      h(
        "div",
        { cls: "org-row org-head", attrs: { role: "row" } },
        h("span", { text: "Name" }),
        h("span", { text: "Suffix" }),
        h("span", { text: `Elevation${suffix ? ` (${suffix})` : ""}` }),
        h("span", { cls: "org-num", text: "Layers" }),
      ),
      ...shown.map((r) => {
        const input = (value: string, label: string): HTMLInputElement =>
          h("input", { cls: "org-input", value, attrs: { type: "text", "aria-label": `${label} of ${r.name}`, spellcheck: "false" } });
        const name = input(r.name, "Name");
        name.addEventListener("input", () => {
          r.name = name.value;
          refreshNote();
        });
        const sfx = input(r.suffix, "Suffix");
        sfx.addEventListener("input", () => {
          r.suffix = sfx.value;
          refreshNote();
        });
        const start = r.elevation;
        const shownElevation = formatLengthValue(start, units);
        const elevation = input(shownElevation, "Elevation");
        elevation.addEventListener("input", () => {
          // left as shown, it keeps its exact value (the field rounds it)
          const v = elevation.value === shownElevation ? start : parseLength(elevation.value, units);
          r.bad = v === null;
          if (v !== null) r.elevation = v;
          refreshNote();
        });
        storyFields.set(r, { name, elevation });
        const layers = lists.design.filter((d) => !d.deleted && d.story === r).length;
        const el = h(
          "div",
          { cls: `org-row${selectedStory === r ? " sel" : ""}${r.key === null ? " new" : ""}`, attrs: { role: "row" } },
          name,
          sfx,
          elevation,
          h("span", { cls: "org-num", text: r.key === null && layers === 0 ? "new" : String(layers) }),
        );
        el.addEventListener("pointerdown", () => {
          if (selectedStory === r) return;
          selectedStory = r;
          for (const other of table.querySelectorAll(".org-row.sel")) other.classList.remove("sel");
          el.classList.add("sel");
          refreshButtons();
        });
        return el;
      }),
      ...(shown.length === 0 ? [h("p", { cls: "vl-empty", text: q ? "None match." : "No stories." })] : []),
    );
  }

  /** The Viewports tab: each viewport under its sheet, with its scale to edit. */
  function renderViewports(q: string): void {
    const sheets = liveSheets();
    // a viewport on a sheet deleted here goes with it
    const shown = viewports.filter((v) => {
      const sheet = sheets.get(v.sheetId);
      return sheet && (q === "" || v.label.toLowerCase().includes(q) || sheet.name.toLowerCase().includes(q));
    });
    scaleFields.clear();
    viewportNames.clear();
    table.replaceChildren(
      h(
        "div",
        { cls: "org-row org-head", attrs: { role: "row" } },
        h("span", { text: "Name" }),
        h("span", { text: "Sheet" }),
        h("span", { text: "View" }),
        h("span", { text: "Scale" }),
      ),
      ...shown.map((v) => {
        const sheet = sheets.get(v.sheetId)!;
        const scale = h("input", {
          cls: "org-input org-scale",
          value: String(v.scale),
          attrs: { type: "number", min: String(VIEWPORT_SCALE.min), max: String(VIEWPORT_SCALE.max), step: "any", "aria-label": `Scale of ${v.label} (1:n)` },
        });
        scale.addEventListener("input", () => {
          v.scale = Number(scale.value);
          refreshNote();
        });
        scaleFields.set(v, scale);
        const name = h("input", {
          cls: "org-input",
          value: v.name,
          placeholder: v.label,
          attrs: { type: "text", "aria-label": `Name of ${v.label}`, spellcheck: "false" },
        });
        name.addEventListener("input", () => {
          v.name = name.value;
          refreshNote();
        });
        viewportNames.set(v, name);
        const sheetLabel = sheet.title.trim() ? `${sheet.name} ${sheet.title}` : sheet.name;
        return h(
          "div",
          { cls: "org-row", attrs: { role: "row" } },
          name,
          h("span", { cls: "org-text", text: sheetLabel, title: sheetLabel }),
          h("span", { cls: "org-text muted", text: v.plan ? "Plan" : "Section or 3D" }),
          h("span", { cls: "org-scale-field" }, h("span", { cls: "muted", text: "1:" }), scale),
        );
      }),
      ...(shown.length === 0 ? [h("p", { cls: "vl-empty", text: q ? "None match." : "No viewports." })] : []),
    );
  }

  /** The Saved Views tab: each view's name, its Visibility box and the display options it restores. */
  function renderViews(q: string): void {
    const shown = views.filter((v) => !v.deleted && (q === "" || v.name.toLowerCase().includes(q)));
    viewFields.clear();
    table.replaceChildren(
      h(
        "div",
        { cls: "org-row org-head", attrs: { role: "row" } },
        h("span", { text: "Name" }),
        h("span", { text: "Visibility", title: "The view also restores layer and class visibility" }),
        h("span", { text: "Display" }),
      ),
      ...shown.map((v) => {
        const name = h("input", { cls: "org-input", value: v.name, attrs: { type: "text", "aria-label": "Name", spellcheck: "false" } });
        name.addEventListener("input", () => {
          v.name = name.value;
          refreshNote();
        });
        viewFields.set(v, name);
        const box = h("input", { checked: v.restoreVisibility, attrs: { type: "checkbox", "aria-label": `${v.name} restores visibility` } });
        box.addEventListener("change", () => {
          v.restoreVisibility = box.checked;
          refreshNote();
        });
        const el = h(
          "div",
          { cls: `org-row${selectedView === v ? " sel" : ""}`, attrs: { role: "row" } },
          name,
          h("label", { cls: "org-check" }, box),
          h("span", { cls: "org-text muted", text: v.modes, title: v.modes }),
        );
        el.addEventListener("pointerdown", () => {
          if (selectedView === v) return;
          selectedView = v;
          for (const other of table.querySelectorAll(".org-row.sel")) other.classList.remove("sel");
          el.classList.add("sel");
          refreshButtons();
        });
        return el;
      }),
      ...(shown.length === 0 ? [h("p", { cls: "vl-empty", text: q ? "None match." : "No saved views." })] : []),
    );
  }

  function rowEl(r: Row): HTMLElement {
    const tab = listTab()!;
    const cells = STATES.map((v) => {
      const on = r.visibility === v;
      const cell = h("button", {
        cls: `vl-col vis-${v}${on ? " on" : ""}`,
        html: on ? visibilityIcon(v) : "",
        title: visibilityLabel(v),
        attrs: { type: "button", "aria-label": `${r.name}: ${visibilityLabel(v)}`, "aria-pressed": String(on) },
      });
      cell.addEventListener("click", () => {
        r.visibility = v;
        selected[tab] = r;
        render();
      });
      return cell;
    });
    const name = h("input", {
      cls: "org-input",
      value: r.name,
      attrs: { type: "text", "aria-label": tab === "sheet" ? "Sheet number" : "Name", spellcheck: "false" },
    });
    name.disabled = r.fixed;
    name.addEventListener("input", () => {
      r.name = name.value;
      refreshNote();
    });
    nameFields.set(r, name);
    const extra: HTMLElement[] = [];
    if (tab === "design") {
      const scale = h("input", {
        cls: "org-input org-scale",
        value: String(r.scale),
        attrs: { type: "number", min: "0.001", step: "any", "aria-label": `Scale of ${r.name} (1:n)` },
      });
      scale.addEventListener("input", () => {
        r.scale = Number(scale.value);
        refreshNote();
      });
      extra.push(h("span", { cls: "org-scale-field" }, h("span", { cls: "muted", text: "1:" }), scale));
      const shownElevation = formatLengthValue(elevationOf(r), units);
      const elevation = h("input", {
        cls: "org-input",
        value: shownElevation,
        attrs: { type: "text", "aria-label": `Elevation of ${r.name}`, spellcheck: "false" },
      });
      const rel = r.rel;
      elevation.addEventListener("input", () => {
        // left as shown, it keeps its exact value (the field rounds it)
        const v = elevation.value === shownElevation ? null : parseLength(elevation.value, units);
        r.badElevation = elevation.value !== shownElevation && v === null;
        r.rel = v === null ? rel : v - (r.story?.elevation ?? 0);
        refreshNote();
      });
      elevationFields.set(r, elevation);
      extra.push(elevation);
      const live = liveStories().sort((a, b) => b.elevation - a.elevation);
      if (live.length) {
        const story = h(
          "select",
          { cls: "org-input org-select", attrs: { "aria-label": `Story of ${r.name}` } },
          h("option", { value: "", text: "None" }),
          ...live.map((st) => h("option", { value: String(stories.indexOf(st)), text: st.name.trim() || "New story" })),
        );
        story.value = r.story ? String(stories.indexOf(r.story)) : "";
        story.addEventListener("change", () => {
          // it stays where it is, now above the new story
          const z = elevationOf(r);
          r.story = story.value === "" ? null : stories[Number(story.value)];
          r.rel = z - (r.story?.elevation ?? 0);
          refreshNote();
        });
        extra.push(story);
      }
    } else if (tab === "sheet") {
      const title = h("input", {
        cls: "org-input",
        value: r.title,
        attrs: { type: "text", "aria-label": `Title of ${r.name}`, spellcheck: "false" },
      });
      title.addEventListener("input", () => {
        r.title = title.value;
        refreshNote();
      });
      extra.push(title);
    }
    const el = h(
      "div",
      { cls: `org-row${selected[tab] === r ? " sel" : ""}${r.key === null ? " new" : ""}`, attrs: { role: "row" } },
      ...cells,
      name,
      ...extra,
      // a layer's copy shows what it will hold
      h("span", { cls: "org-num", text: r.key === null && r.objects === 0 ? "new" : String(r.objects) }),
    );
    // a press anywhere in the row selects it; the fields keep their own focus
    el.addEventListener("pointerdown", () => {
      if (selected[tab] === r) return;
      selected[tab] = r;
      for (const other of table.querySelectorAll(".org-row.sel")) other.classList.remove("sel");
      el.classList.add("sel");
      refreshButtons();
    });
    // a double-click off the name field edits a class, as Vectorworks' list does
    if (tab === "classes") {
      el.addEventListener("dblclick", (e) => {
        if (!(e.target instanceof HTMLInputElement)) void editClass();
      });
    }
    return el;
  }

  /** The buttons and the note, without rebuilding the rows (so a field being typed in keeps focus). */
  function refreshButtons(): void {
    if (tab === "stories") {
      btnDelete.disabled = btnLevels.disabled = !selectedStory;
      return;
    }
    if (tab === "views") {
      const live = views.filter((v) => !v.deleted);
      btnDelete.disabled = !selectedView;
      btnUp.disabled = !selectedView || live[0] === selectedView;
      btnDown.disabled = !selectedView || live.at(-1) === selectedView;
      return;
    }
    const t = listTab();
    if (!t) return;
    const sel = selected[t];
    const live = lists[t].filter((r) => !r.deleted);
    btnDelete.disabled = !sel || sel.fixed || (t === "design" && live.length <= 1);
    btnDuplicate.disabled = !sel;
    btnEdit.disabled = t !== "classes" || !sel?.attrs;
    btnUp.disabled = !sel || live[0] === sel;
    btnDown.disabled = !sel || live.at(-1) === sel;
  }
  function refreshNote(): void {
    const changed =
      Object.values(lists).flat().filter((r) => r.key === null || r.deleted || changedRow(r) || layerMoved(r)).length +
      stories.filter((r) => r.key === null || r.deleted || storyChanged(r)).length +
      (orderChanged() ? 1 : 0) +
      viewportChanges().length +
      viewChanges();
    note.textContent = changed ? `${changed} change${changed === 1 ? "" : "s"} to apply.` : "Changes apply when you click OK.";
  }

  /** True when an existing design layer's elevation or story is to change. */
  function layerMoved(r: Row): boolean {
    return !!r.orig && !r.deleted && (r.story !== r.orig.story || Math.abs(elevationOf(r) - r.orig.elevation) > SAME_ELEVATION);
  }

  function storyChanged(r: StoryRow): boolean {
    const o = r.orig;
    return !!o && !r.deleted && (r.name !== o.name || r.suffix !== o.suffix || Math.abs(r.elevation - o.elevation) > SAME_ELEVATION || levelsChanged(r));
  }

  /** True when the story's levels are to change (a new story's when it has any). */
  function levelsChanged(r: StoryRow): boolean {
    const before = r.orig?.levels ?? [];
    return (
      r.levels.length !== before.length ||
      r.levels.some((l, i) => {
        const b = before[i];
        return l.type !== b.type || Math.abs(l.elevation - b.elevation) > SAME_ELEVATION || l.layer !== b.layer || l.from !== b.from;
      })
    );
  }

  /** Viewports whose scale or name is to change, leaving out those on a sheet deleted here. */
  function viewportChanges(): ViewportRow[] {
    const sheets = liveSheets();
    return viewports.filter((v) => (v.scale !== v.origScale || v.name.trim() !== v.origName) && sheets.has(v.sheetId));
  }

  /** How many saved views are deleted or changed, counting a new order as one. */
  function viewChanges(): number {
    const live = views.filter((v) => !v.deleted);
    const edited = views.filter((v) => v.deleted || v.name !== v.orig.name || v.restoreVisibility !== v.orig.restoreVisibility).length;
    const kept = live.filter((v) => v.index >= 0);
    return edited + (kept.some((v, i) => i > 0 && v.index < kept[i - 1].index) ? 1 : 0);
  }

  /** Shows `row` on its tab, selected, so a check can point at its field. */
  const reveal = (t: ListTab, row: Row): HTMLInputElement | undefined => {
    tab = t;
    selected[t] = row;
    search.value = "";
    render();
    return nameFields.get(row);
  };

  render();
  await showDialog<true>({
    title: "Organization",
    okLabel: "OK",
    cls: "org-dialog",
    body: [
      h("div", { cls: "org-top" }, h("div", { cls: "seg org-tabs", attrs: { role: "tablist" } }, ...tabButtons), search),
      table,
      h("div", { cls: "org-actions" }, btnNew, btnDuplicate, btnEdit, btnLevels, btnDelete, btnUp, btnDown, note),
    ],
    check: () => {
      // names: none empty, none taken by another layer or class
      for (const t of TABS) {
        if (t.id === "stories" || t.id === "viewports" || t.id === "views") continue;
        for (const r of lists[t.id]) {
          if (r.deleted) continue;
          const name = r.name.trim();
          if (name === "") return { error: `A ${t.noun} needs a name.`, focus: reveal(t.id, r) };
          if ((r.key === null || r.name !== r.orig?.name) && takenNames(r).has(name)) {
            return { error: `“${name}” is already the name of a layer, class or story.`, focus: reveal(t.id, r) };
          }
          if (t.id === "design" && !(Number.isFinite(r.scale) && r.scale > 0)) {
            return { error: `The scale of ${name} must be a number above 0.`, focus: reveal(t.id, r) };
          }
        }
      }
      for (const r of lists.design) {
        if (r.deleted || !r.badElevation) continue;
        reveal("design", r);
        return { error: `The elevation of ${r.name.trim()} takes a length.`, focus: elevationFields.get(r) };
      }
      const storyTab = (r: StoryRow): void => {
        tab = "stories";
        selectedStory = r;
        search.value = "";
        render();
      };
      for (const r of liveStories()) {
        const name = r.name.trim();
        if (name === "") {
          storyTab(r);
          return { error: "A story needs a name.", focus: storyFields.get(r)?.name };
        }
        if ((r.key === null || r.name !== r.orig?.name) && takenNames(r).has(name)) {
          storyTab(r);
          return { error: `“${name}” is already used in this drawing.`, focus: storyFields.get(r)?.name };
        }
        if (r.bad) {
          storyTab(r);
          return { error: `The elevation of ${name} takes a length.`, focus: storyFields.get(r)?.elevation };
        }
      }
      for (const v of viewportChanges()) {
        if (!(Number.isFinite(v.scale) && v.scale >= VIEWPORT_SCALE.min && v.scale <= VIEWPORT_SCALE.max)) {
          tab = "viewports";
          search.value = "";
          render();
          return { error: `The scale of ${v.label} must be a number from ${VIEWPORT_SCALE.min} to ${VIEWPORT_SCALE.max}.`, focus: scaleFields.get(v) };
        }
        const name = v.name.trim();
        const clash = name !== "" && viewports.find((o) => o !== v && (o.name.trim() || o.origName) === name);
        if (clash) {
          tab = "viewports";
          search.value = "";
          render();
          return { error: `“${name}” is already the name of another viewport.`, focus: viewportNames.get(v) };
        }
      }
      for (const v of views) {
        if (!v.deleted && v.name.trim() === "") {
          tab = "views";
          selectedView = v;
          search.value = "";
          render();
          return { error: "A saved view needs a name.", focus: viewFields.get(v) };
        }
      }
      try {
        apply();
      } catch (err) {
        return { error: errorMessage(err) };
      }
      // saved views live in this browser, not the drawing: written once the drawing's changes have gone in
      if (viewChanges() > 0) {
        savedViews()?.rewrite(
          views
            .filter((v) => !v.deleted)
            .map((v) => ({ index: v.index, name: v.name === v.orig.name ? v.name : v.name.trim(), restoreVisibility: v.restoreVisibility })),
        );
      }
      return { value: true };
    },
  });

  /** Makes the changes, as one undo step; on failure nothing changes. */
  function apply(): void {
    const session = store.session;
    if (!session) throw new Error("No drawing is open.");
    const scaled = viewportChanges();
    if (
      !Object.values(lists).flat().some((r) => r.key === null || r.deleted || changedRow(r) || layerMoved(r)) &&
      !stories.some((r) => r.key === null || r.deleted || storyChanged(r)) &&
      !orderChanged() &&
      scaled.length === 0
    )
      return;
    session.batch(() => {
      // viewports before any sheet changes: one on a deleted sheet is already left out
      for (const v of scaled) {
        if (v.scale !== v.origScale) session.setViewportScale(v.id, v.scale);
        if (v.name.trim() !== v.origName) session.setObjectName(v.id, v.name.trim());
      }
      // new ones first, so deleting the last old design layer leaves the new one
      const ids = new Map<Row, string>();
      const storyIndex = new Map<StoryRow, number>();
      for (const r of stories) {
        if (r.key === null && !r.deleted) storyIndex.set(r, session.createStory(r.name.trim(), r.suffix.trim(), r.elevation));
        else if (r.key !== null) storyIndex.set(r, r.key);
      }
      for (const r of lists.classes) {
        if (r.key !== null || r.deleted) continue;
        const index = typeof r.copyOf === "number" ? session.duplicateClass(r.copyOf, r.name.trim()) : session.createClass(r.name.trim());
        if (r.visibility !== (session.doc.classes().find((c) => c.index === index)?.visibility ?? "visible")) session.setClassVisibility(index, r.visibility);
        if (r.attrs) session.setClassAttributes(index, r.attrs);
        session.setClassTexture(index, r.texture);
        // a class copied from one whose record has no text style field has none to set
        if (r.textStyle !== (session.doc.classes().find((c) => c.index === index)?.textStyle ?? 0)) session.setClassTextStyle(index, r.textStyle);
      }
      for (const kind of ["design", "sheet"] as const) {
        for (const r of lists[kind]) {
          if (r.key !== null || r.deleted) continue;
          const id =
            typeof r.copyOf === "string"
              ? session.duplicateLayer(r.copyOf, r.name.trim())
              : session.createLayer(r.name.trim(), kind, kind === "design" ? r.scale : undefined);
          ids.set(r, id);
          const made = session.doc.layers().find((l) => l.id === id);
          if (kind === "sheet" && r.title.trim() !== (made?.title ?? "")) session.renameLayer(id, r.name.trim(), r.title.trim());
          if (r.visibility !== (made?.visibility ?? "visible")) session.setLayerVisibility(id, r.visibility);
          if (kind === "design" && made && r.scale !== made.scale) session.setLayerScale(id, r.scale);
        }
      }
      for (const r of lists.classes) if (r.deleted && typeof r.key === "number") session.deleteClass(r.key);
      for (const r of [...lists.design, ...lists.sheet]) if (r.deleted && typeof r.key === "string") session.deleteLayer(r.key);
      for (const r of stories) if (r.deleted && r.key !== null) session.deleteStory(r.key);
      // a story's new elevation moves its layers before any is set apart
      for (const r of stories) {
        if (r.key === null || !storyChanged(r) || !r.orig) continue;
        if (r.name !== r.orig.name) session.renameStory(r.key, r.name.trim());
        session.editStory(r.key, {
          ...(r.suffix !== r.orig.suffix ? { suffix: r.suffix.trim() } : {}),
          ...(Math.abs(r.elevation - r.orig.elevation) > SAME_ELEVATION ? { elevation: r.elevation } : {}),
        });
      }
      for (const r of lists.classes) {
        if (r.deleted || typeof r.key !== "number" || !r.orig) continue;
        if (!r.fixed && r.name !== r.orig.name) session.renameClass(r.key, r.name.trim());
        if (r.visibility !== r.orig.visibility) session.setClassVisibility(r.key, r.visibility);
        const attrs = attrChanges(r);
        if (attrs) session.setClassAttributes(r.key, attrs);
        if (r.texture !== r.orig.texture) session.setClassTexture(r.key, r.texture);
        if (r.textStyle !== r.orig.textStyle) session.setClassTextStyle(r.key, r.textStyle);
      }
      for (const kind of ["design", "sheet"] as const) {
        for (const r of lists[kind]) {
          if (r.deleted || typeof r.key !== "string" || !r.orig) continue;
          // a name or title is tidied only when it was edited: one stored with spaces stays as it is
          const name = r.name === r.orig.name ? r.name : r.name.trim();
          const title = r.title === r.orig.title ? r.title : r.title.trim();
          if (r.name !== r.orig.name || r.title !== r.orig.title) session.renameLayer(r.key, name, kind === "sheet" ? title : undefined);
          if (r.visibility !== r.orig.visibility) session.setLayerVisibility(r.key, r.visibility);
          if (kind === "design" && r.scale !== r.orig.scale) session.setLayerScale(r.key, r.scale);
        }
      }
      // each design layer on its story, at its elevation
      for (const r of lists.design) {
        const id = typeof r.key === "string" ? r.key : ids.get(r);
        const now = id && !r.deleted ? session.doc.layers().find((l) => l.id === id) : undefined;
        if (!id || !now) continue;
        const story = r.story ? (storyIndex.get(r.story) ?? 0) : 0;
        if ((now.story ?? 0) !== story) session.setLayerStory(id, story);
        const z = elevationOf(r);
        if (Math.abs((now.elevation ?? 0) - z) > SAME_ELEVATION) session.setLayerElevation(id, z);
      }
      // the stories' levels last, once the layers they name have their names and are on them
      for (const r of stories) {
        const index = storyIndex.get(r);
        if (r.deleted || index === undefined || !levelsChanged(r)) continue;
        const nameOf = (row: Row | null): string => {
          const id = row && !row.deleted && row.story === r ? (typeof row.key === "string" ? row.key : ids.get(row)) : undefined;
          return (id && session.doc.layers().find((l) => l.id === id)?.name) || "";
        };
        session.editStory(index, { levels: r.levels.map((l) => ({ type: l.type, elevation: l.elevation, layer: nameOf(l.layer), ...(l.from !== undefined ? { from: l.from } : {}) })) });
      }
      // the design layers' stacking order: each design layer's place takes the next in the dialog's order
      const designIds = lists.design.filter((r) => !r.deleted).map((r) => (typeof r.key === "string" ? r.key : ids.get(r)!));
      const isDesign = new Set(designIds);
      const now = session.doc.layers().map((l) => l.id);
      let next = 0;
      const order = now.map((id) => (isDesign.has(id) ? designIds[next++] : id));
      if (order.some((id, i) => id !== now[i])) session.reorderLayers(order);
    });
  }

  function orderChanged(): boolean {
    const now = lists.design.filter((r) => !r.deleted && r.key !== null).map((r) => r.key);
    const before = (store.session?.doc.layers() ?? []).filter((l) => l.kind === "design").map((l) => l.id).filter((id) => now.includes(id));
    return now.some((id, i) => id !== before[i]);
  }
}

/** Moves `row` one place along `list`, stepping over deleted rows (they keep no place); false when it can't. */
function shift<T extends { deleted: boolean }>(list: T[], row: T | null, by: -1 | 1): boolean {
  if (!row) return false;
  const at = list.indexOf(row);
  let to = at + by;
  while (to >= 0 && to < list.length && list[to].deleted) to += by;
  if (at < 0 || to < 0 || to >= list.length) return false;
  list.splice(at, 1);
  list.splice(to, 0, row);
  return true;
}

function changedRow(r: Row): boolean {
  const o = r.orig;
  if (!o) return false;
  return r.name !== o.name || r.title !== o.title || r.scale !== o.scale || r.visibility !== o.visibility || r.texture !== o.texture || r.textStyle !== o.textStyle || attrChanges(r) !== null;
}

/** The attributes Edit… changed on an existing class, or null for none. */
function attrChanges(r: Row): Partial<Attributes> | null {
  const before = r.orig?.attrs;
  if (!r.attrs || !before) return null;
  const out: Partial<Attributes> = {};
  for (const k of Object.keys(r.attrs) as (keyof Attributes)[]) if (r.attrs[k] !== before[k]) out[k] = r.attrs[k];
  return Object.keys(out).length ? out : null;
}

function copyAttrs(a: Attributes | null): Attributes | null {
  return a && { ...a };
}
