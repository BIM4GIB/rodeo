// Three of Vectorworks' commands on the drawing's right-click menu, for the object under the pointer
// (selected or not; an object inside a group stands for its group, as a click picks it):
// Activate Class makes its class the active one, and Create Class Using Object Attributes makes a
// class from it. That asks for the new class's name, and Edit properties after creation opens the
// class's attributes to change first; the class takes the object's fill, pen colour, line style,
// line weight and opacities (a line, which has no fill, leaves the new class's fill as it comes),
// and the object goes into it with those attributes set by class. Update Class Attributes from
// Object gives a class already there the attributes ticked of those the object has, and can put
// the object into it with them set by class. One undo step each. Rodeo's classes have no Use at
// Creation setting to turn on.

import type { Attributes, ByClassGroup, ObjectInfo } from "../core/index.ts";
import { h } from "./dom.ts";
import { attempt, setActiveClass } from "./commands.ts";
import { showDialog } from "./menubar.ts";
import { freeName } from "./panels/common.ts";
import { classAttributeControls } from "./panels/objectInfo.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

const LINE = 2;

const GROUP_LABEL: Record<ByClassGroup, string> = {
  fill: "Fill",
  penColor: "Pen colour",
  lineStyle: "Line style",
  lineWeight: "Line weight",
  opacity: "Opacity",
};

function objectOf(id: string | null): ObjectInfo | null {
  return id === null ? null : (store.session?.doc.object(id) ?? null);
}

/** Whether the object's class is one to activate: not the active class already. */
export function canActivateClassOf(id: string | null): boolean {
  const o = objectOf(id);
  return o !== null && o.classIndex !== store.activeClassIndex;
}

/** Activate Class: the object's class becomes the active class. */
export function activateClassOf(id: string | null): void {
  const o = objectOf(id);
  if (!o) return;
  setActiveClass(o.classIndex);
  toast(`"${o.className}" is the active class.`, "info");
}

export function canCreateClassFrom(id: string | null): boolean {
  return objectOf(id) !== null;
}

/** The attribute groups the object has to give a class: none for an object without attributes, no fill for a line. */
function groupsOf(o: ObjectInfo): ByClassGroup[] {
  if (!o.attrs) return [];
  return o.type === LINE ? ["lineStyle", "penColor", "lineWeight", "opacity"] : ["fill", "lineStyle", "penColor", "lineWeight", "opacity"];
}

/** The fields of `a` in the groups given. */
function fieldsOf(a: Attributes, groups: readonly ByClassGroup[]): Partial<Attributes> {
  const out: Partial<Attributes> = {};
  if (groups.includes("fill")) Object.assign(out, { fillPattern: a.fillPattern, fillFore: a.fillFore, fillBack: a.fillBack });
  if (groups.includes("penColor")) Object.assign(out, { penFore: a.penFore, penBack: a.penBack });
  if (groups.includes("lineStyle")) out.lineStyle = a.lineStyle;
  if (groups.includes("lineWeight")) out.lineWeight = a.lineWeight;
  if (groups.includes("opacity")) Object.assign(out, { fillOpacity: a.fillOpacity, penOpacity: a.penOpacity });
  return out;
}

/** Create Class Using Object Attributes: a new class with the object's attributes, the object in it, taking them from it. */
export async function createClassFrom(id: string | null): Promise<void> {
  const o = objectOf(id);
  const doc = store.session?.doc;
  if (!o || !doc) return;
  const taken = new Set([...doc.classes().map((c) => c.name), ...doc.layers().map((l) => l.name)]);
  const name = h("input", { cls: "menu-dialog-input", value: freeName("Class"), attrs: { type: "text", "aria-label": "Name" } });
  const edit = h("input", { attrs: { type: "checkbox", "aria-label": "Edit properties after creation" } });
  const first = await showDialog<{ name: string; edit: boolean }>({
    title: "New Class",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), name),
      h("label", { cls: "menu-dialog-check" }, edit, "Edit properties after creation"),
      h("p", { cls: "muted", text: `The class takes the ${o.typeName.toLowerCase()}'s attributes, and the ${o.typeName.toLowerCase()} goes into it with them set by class.` }),
    ],
    check: () => {
      const n = name.value.trim();
      if (!n) return { error: "Name the class.", focus: name };
      if (taken.has(n)) return { error: `"${n}" is taken by a class or layer.`, focus: name };
      return { value: { name: n, edit: edit.checked } };
    },
  });
  if (!first) return;
  const groups = groupsOf(o);
  let attrs: Partial<Attributes> = o.attrs ? fieldsOf(o.attrs, groups) : {};
  if (first.edit) {
    // the class as it would come, with the object's attributes on it
    const template = doc.classes().find((c) => c.attrs)?.attrs;
    const values: Attributes | null = template ? { ...template, ...attrs } : o.attrs && { ...o.attrs };
    if (values) {
      const edited = await showDialog<Attributes>({
        title: `Edit Class: ${first.name}`,
        okLabel: "OK",
        cls: "org-class-dialog",
        body: [h("p", { cls: "muted", text: "Objects set to use the class style draw with these." }), classAttributeControls(doc, values)],
        check: () => ({ value: values }),
      });
      if (!edited) return;
      attrs = edited;
    }
  }
  const r = attempt("Create Class Using Object Attributes", (s) =>
    s.batch(() => {
      const index = s.createClass(first.name);
      if (Object.keys(attrs).length) s.setClassAttributes(index, attrs);
      s.setObjectClass([o.id], index);
      for (const g of groups) s.setAttributesByClass([o.id], g, true);
      return index;
    }),
  );
  if (!r) return;
  store.emit("class");
  toast(`Class "${first.name}" made from the ${o.typeName.toLowerCase()}'s attributes.`, "info");
}

/** Whether the object has attributes to give a class (a group has none of its own). */
export function canUpdateClassFrom(id: string | null): boolean {
  return objectOf(id)?.attrs != null;
}

/** Update Class Attributes from Object: a class takes the ticked attributes of the object, which may go into it with them set by class. */
export async function updateClassFrom(id: string | null): Promise<void> {
  const o = objectOf(id);
  const doc = store.session?.doc;
  if (!o?.attrs || !doc) return;
  const from = o.attrs;
  const classes = doc.classes().filter((c) => c.attrs !== null);
  if (!classes.length) {
    toast("The drawing has no class to update.", "info");
    return;
  }
  const list = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Class" } }, ...classes.map((c) => h("option", { value: String(c.index), text: c.name })));
  list.value = String(classes.some((c) => c.index === o.classIndex) ? o.classIndex : classes[0].index);
  const ticks = groupsOf(o).map((g) => ({ g, box: h("input", { attrs: { type: "checkbox", "aria-label": GROUP_LABEL[g] } }) }));
  for (const t of ticks) t.box.checked = true;
  const assign = h("input", { attrs: { type: "checkbox", "aria-label": "Assign the object to the class" } });
  const kind = o.typeName.toLowerCase();
  const r = await showDialog<{ index: number; groups: ByClassGroup[]; assign: boolean }>({
    title: "Update Class",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Class" }), list),
      h("p", { cls: "muted", text: `Attributes to take from the ${kind}:` }),
      ...ticks.map((t) => h("label", { cls: "menu-dialog-check" }, t.box, GROUP_LABEL[t.g])),
      h("label", { cls: "menu-dialog-check" }, assign, `Assign the ${kind} to the class`),
    ],
    check: () => {
      const groups = ticks.filter((t) => t.box.checked).map((t) => t.g);
      if (!groups.length) return { error: "Tick an attribute to take.", focus: ticks[0]?.box };
      return { value: { index: Number(list.value), groups, assign: assign.checked } };
    },
  });
  if (!r) return;
  const name = classes.find((c) => c.index === r.index)?.name ?? "";
  const done = attempt("Update Class Attributes from Object", (s) =>
    s.batch(() => {
      s.setClassAttributes(r.index, fieldsOf(from, r.groups));
      if (!r.assign) return;
      if (o.classIndex !== r.index) s.setObjectClass([o.id], r.index);
      for (const g of r.groups) s.setAttributesByClass([o.id], g, true);
    }),
  );
  if (!done) return;
  store.emit("class");
  toast(`Class "${name}" updated from the ${kind}'s attributes${r.assign ? ", and the " + kind + " put in it" : ""}.`, "info");
}
