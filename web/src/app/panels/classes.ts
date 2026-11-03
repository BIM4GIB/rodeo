// Navigation > Classes: filterable class list with visibility cycling, inline
// rename, the active-class radio (used for new objects), a context menu, create
// and delete.

import type { ClassInfo } from "../../core/index.ts";
import { attempt, setActiveClass } from "../commands.ts";
import { editInline, h } from "../dom.ts";
import { openContextMenu, type Row } from "../menu.ts";
import { confirmDialog } from "../menubar.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { NEXT_VISIBILITY, freeName, visibilityButton, visibilityRows } from "./common.ts";
import { displayOptionsRow } from "./layers.ts";

const NONE_CLASS = "None";

export function mountClasses(root: HTMLElement): void {
  let filter = "";
  let selected: number | null = null;

  const search = h("input", {
    cls: "search",
    attrs: { type: "search", placeholder: "Filter classes", "aria-label": "Filter classes" },
  });
  const btnNew = h("button", { cls: "btn", text: "+ Class", title: "New class" });
  const btnDelete = h("button", { cls: "btn danger", text: "Delete", title: "Delete class" });
  const list = h("div", { cls: "list" });
  root.replaceChildren(displayOptionsRow("classMode", "class"), h("div", { cls: "toolbar" }, search, btnNew, btnDelete), list);

  const selectedClass = (): ClassInfo | undefined =>
    store.session?.doc.classes().find((c) => c.index === selected);

  const classRow = (c: ClassInfo): HTMLElement => {
    const radio = h("input", {
      checked: c.index === store.activeClassIndex,
      attrs: { type: "radio", name: "active-class", title: "Use for new objects", "aria-label": `Use ${c.name} for new objects` },
    });
    radio.addEventListener("click", (e) => e.stopPropagation());
    radio.addEventListener("change", () => setActiveClass(c.index));

    const names = h("div", { cls: "names", title: "Double-click to rename" }, h("div", { cls: "name", text: c.name }));
    const vis = visibilityButton(c.visibility, () =>
      attempt("Change visibility", (s) => s.setClassVisibility(c.index, NEXT_VISIBILITY[c.visibility])),
    );
    const count = h("span", { cls: "count", text: String(c.objectCount), title: "Objects in this class" });
    const classes = ["row", "class-row"];
    if (c.index === selected) classes.push("selected");
    if (c.index === store.activeClassIndex) classes.push("active");
    const row = h("div", { cls: classes.join(" "), attrs: { "data-index": String(c.index) } }, radio, vis, names, count);

    row.addEventListener("click", () => {
      selected = c.index;
      render();
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(classMenu(c), e.clientX, e.clientY);
    });
    names.addEventListener("dblclick", () => {
      editInline(names, [c.name], (vals) => {
        if (vals) {
          const name = vals[0] ?? "";
          if (!name) toast("A class needs a name.", "info");
          else attempt("Rename class", (s) => s.renameClass(c.index, name));
        }
        render();
      });
    });
    return row;
  };

  /** Starts renaming a class in its row, as a double-click on its name does. */
  const rename = (index: number): void => {
    const host = list.querySelector<HTMLElement>(`[data-index="${index}"] .names`);
    host?.scrollIntoView({ block: "nearest" });
    host?.dispatchEvent(new MouseEvent("dblclick"));
  };

  const newClass = (): void => {
    const r = attempt("Create class", (s) => s.createClass(freeName("Class")));
    if (!r) return;
    selected = r.value;
    filter = "";
    search.value = "";
    setActiveClass(r.value);
    render();
    rename(r.value);
  };

  /** A class with all of `c`'s settings, made active, with its name to edit as a new class's is. */
  const duplicateClass = (c: ClassInfo): void => {
    const r = attempt("Duplicate class", (s) => s.duplicateClass(c.index, freeName(c.name)));
    if (!r) return;
    selected = r.value;
    filter = "";
    search.value = "";
    setActiveClass(r.value);
    render();
    rename(r.value);
  };

  const deleteClass = async (c: ClassInfo): Promise<void> => {
    if (c.name === NONE_CLASS) {
      toast('The "None" class cannot be deleted.', "info");
      return;
    }
    const message = `Delete class "${c.name}"? Its objects move to "${NONE_CLASS}".`;
    if (!(await confirmDialog("Delete class", message, "Delete"))) return;
    if (attempt("Delete class", (s) => s.deleteClass(c.index)) && selected === c.index) selected = null;
    render();
  };

  /** A right-click on a class's row. */
  const classMenu = (c: ClassInfo): Row[] => [
    { label: "Make Active", checked: () => store.activeClassIndex === c.index, run: () => setActiveClass(c.index) },
    "-",
    ...visibilityRows(c.visibility, (v) => attempt("Change visibility", (s) => s.setClassVisibility(c.index, v))),
    "-",
    { label: "Rename", run: () => rename(c.index) },
    { label: "New Class", enabled: () => store.session !== null, run: newClass },
    { label: "Duplicate", run: () => duplicateClass(c) },
    { label: "Delete", enabled: () => c.name !== NONE_CLASS, run: () => void deleteClass(c) },
  ];

  function render(): void {
    const s = store.session;
    const all = s ? s.doc.classes() : [];
    const shown = all.filter((c) => filter === "" || c.name.toLowerCase().includes(filter));
    list.replaceChildren(...shown.map((c) => classRow(c)));
    if (shown.length === 0) {
      list.append(h("div", { cls: "empty", text: all.length > 0 ? "No matching classes" : "No classes" }));
    }
    btnNew.disabled = !s;
    const sel = selectedClass();
    btnDelete.disabled = !sel || sel.name === NONE_CLASS;
  }

  search.addEventListener("input", () => {
    filter = search.value.trim().toLowerCase();
    render();
  });

  // new classes get a free default name and open straight into rename
  btnNew.addEventListener("click", newClass);
  btnDelete.addEventListener("click", () => {
    const c = selectedClass();
    if (c) void deleteClass(c);
  });

  store.on(["session", "class"], render);
  render();
}
