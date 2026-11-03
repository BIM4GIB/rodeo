// Tools > Utilities > Change Symbol Attrs…, as the Vectorworks command does: the objects in the
// symbol definitions of a folder (with its subfolders), of no folder, or of all of them, put in one
// class and set to take the class's attributes chosen (fill, pen colour, line style, line weight,
// opacity); the attributes not chosen keep the objects' own or take the Attributes palette's for
// new objects. One undo step, after a confirmation naming how many definitions change; every
// instance draws its definition, so every instance follows.

import { BY_CLASS_KEYS, type Attributes, type ByClassGroup, type ResourceInfo } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { confirmDialog, showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** The class attributes the command can apply, in the dialog's order. */
const GROUPS: readonly { readonly group: ByClassGroup; readonly label: string }[] = [
  { group: "fill", label: "Fill" },
  { group: "penColor", label: "Pen colour" },
  { group: "lineStyle", label: "Line style" },
  { group: "lineWeight", label: "Line weight" },
  { group: "opacity", label: "Opacity" },
];

/** a mesh's face, listed among a definition's objects */
const MESH_FACE = 41;

/** the Symbol Folder choices that aren't folders */
const ALL = "\u0000all";
const NO_FOLDER = "\u0000none";

interface Choice {
  readonly scope: string;
  readonly classIndex: number;
  readonly groups: readonly ByClassGroup[];
  /** the attributes not chosen take the Attributes palette's for new objects (else they stay) */
  readonly defaults: boolean;
}

/** The definitions a Symbol Folder choice covers: a folder takes in its subfolders. */
function inScope(defs: readonly ResourceInfo[], scope: string): ResourceInfo[] {
  if (scope === ALL) return [...defs];
  if (scope === NO_FOLDER) return defs.filter((d) => d.folder === "");
  return defs.filter((d) => d.folder === scope || d.folder.startsWith(`${scope}/`));
}

/** Opens Change Symbol Attributes and makes the change. */
export async function changeSymbolAttrsDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const defs = doc.resources().filter((r) => r.kind === "symbol");
  if (defs.length === 0) {
    toast("This drawing has no symbol definitions.", "info");
    return;
  }
  // every folder holding definitions, and the folders around those
  const folders = new Set<string>();
  for (const d of defs) {
    const parts = d.folder.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  const select = (label: string): HTMLSelectElement => h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } });
  const scope = select("Symbol folder");
  scope.append(
    h("option", { value: ALL, text: `All (${defs.length})` }),
    h("option", { value: NO_FOLDER, text: `None: not in a folder (${inScope(defs, NO_FOLDER).length})` }),
    ...[...folders].sort().map((f) => h("option", { value: f, text: `${f.split("/").join(" › ")} (${inScope(defs, f).length})` })),
  );
  const cls = select("Class");
  const classes = doc.classes();
  cls.append(...classes.map((c) => h("option", { value: String(c.index), text: c.name })));
  cls.value = String(store.activeClassIndex);
  const boxes = GROUPS.map(({ group, label }) => {
    const box = h("input", { checked: true, attrs: { type: "checkbox" } });
    return { group, box, row: h("label", { cls: "menu-dialog-check" }, box, label) };
  });
  const radio = (label: string, on: boolean): [HTMLInputElement, HTMLElement] => {
    const input = h("input", { checked: on, attrs: { type: "radio", name: "symbol-attrs-rest" } });
    return [input, h("label", { cls: "menu-dialog-check" }, input, label)];
  };
  const [keep, keepRow] = radio("Keep the objects' own", true);
  const [, defaultsRow] = radio("Use the Attributes palette's for new objects", false);
  const field = (label: string, input: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const heading = (text: string): HTMLElement => h("p", { cls: "muted", text });

  const choice = await showDialog<Choice>({
    title: "Change Symbol Attributes",
    okLabel: "OK",
    body: [
      field("Symbol folder", scope),
      field("Class", cls),
      heading("The objects in these symbol definitions go in the class and take its:"),
      ...boxes.map((b) => b.row),
      heading("The attributes not taken from the class:"),
      keepRow,
      defaultsRow,
    ],
    check: () => {
      if (inScope(defs, scope.value).length === 0) return { error: "No symbol definition is outside a folder.", focus: scope };
      return {
        value: {
          scope: scope.value,
          classIndex: Number(cls.value),
          groups: boxes.filter((b) => b.box.checked).map((b) => b.group),
          defaults: !keep.checked,
        },
      };
    },
  });
  if (!choice) return;
  const chosen = inScope(defs, choice.scope);
  const className = classes.find((c) => c.index === choice.classIndex)?.name ?? "the class";
  const n = `${chosen.length} symbol definition${chosen.length === 1 ? "" : "s"}`;
  if (!(await confirmDialog("Change Symbol Attributes", `Put the objects of ${n} in the class "${className}"? Every instance changes with its definition.`, "Change"))) return;

  // what the attributes not taken from the class become, when they take the palette's
  const rest: Partial<Attributes> = {};
  if (choice.defaults) {
    for (const { group } of GROUPS) {
      if (choice.groups.includes(group)) continue;
      for (const key of BY_CLASS_KEYS[group]) if (store.drawAttrs[key] !== undefined) Object.assign(rest, { [key]: store.drawAttrs[key] });
    }
  }
  const r = attempt("Change symbol attributes", (s) =>
    s.batch(() => {
      let objects = 0;
      try {
        for (const def of chosen) {
          const id = s.doc.openSymbol(def.index);
          if (!id) continue;
          // a mesh's faces share one id and go with their mesh
          const ids = s.doc
            .objects(id)
            .filter((o) => o.type !== MESH_FACE && !isDerivedId(o.id))
            .map((o) => o.id);
          if (ids.length === 0) continue;
          objects += ids.length;
          s.setObjectClass(ids, choice.classIndex);
          for (const group of choice.groups) s.setAttributesByClass(ids, group, true);
          if (Object.keys(rest).length) s.setAttributes(ids, rest);
        }
      } finally {
        // the definition being edited, if any, stays the one open
        s.doc.openSymbol(store.symbolEdit?.index ?? null);
      }
      return objects;
    }),
  );
  if (r) toast(`${n} changed: ${r.value} object${r.value === 1 ? "" : "s"} in the class "${className}".`, "info");
}
