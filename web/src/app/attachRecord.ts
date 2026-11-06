// Tools > Records > Attach Record… and Detach Record…, as Vectorworks Fundamentals has them: a
// record of one of the drawing's data record formats, holding its default values, attached to
// each selected object that has none of that format yet (EditSession.attachRecord), or the
// records of a format the selected objects have taken off them, each in one undo step. Object
// Info's Data tab shows and edits the values, and attaches and detaches for one object at a time.

import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** the format chosen last, while the page is open */
let lastFormat: number | null = null;

export function canAttachRecord(): boolean {
  const doc = store.session?.doc;
  return !!doc && store.selection.size > 0 && doc.recordFormats().length > 0;
}

/** How many of `ids` have no record of `format`. */
function without(ids: readonly string[], format: number): number {
  const doc = store.session?.doc;
  if (!doc) return 0;
  return ids.filter((id) => !doc.records(id).some((r) => r.format === format)).length;
}

export async function attachRecordDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const ids = [...store.selection];
  const formats = doc.recordFormats();
  if (!ids.length || !formats.length) {
    toast(formats.length ? "Select the objects to attach a record to first." : "This drawing has no record formats: make one with Tools > Records > New Record Format….", "info");
    return;
  }
  const select = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Record format" } },
    ...formats.map((f) => h("option", { attrs: { translate: "no" }, text: f.name, value: String(f.format) })),
  );
  if (lastFormat !== null && formats.some((f) => f.format === lastFormat)) select.value = String(lastFormat);
  const note = h("p", { cls: "muted" });
  const sync = (): void => {
    const n = without(ids, Number(select.value));
    const all = ids.length;
    note.textContent =
      n === 0
        ? `Each of the ${all} selected object${all === 1 ? "" : "s"} has this record already.`
        : `Attaches a record holding the format's default values to ${n === all ? (all === 1 ? "the selected object" : `the ${all} selected objects`) : `${n} of the ${all} selected objects (the other${all - n === 1 ? " has" : "s have"} one)`}.`;
  };
  select.addEventListener("change", sync);
  sync();
  const format = await showDialog<number>({
    title: "Attach Record",
    okLabel: "Attach",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Record format" }), select), note],
    check: () => {
      const f = Number(select.value);
      if (without(ids, f) === 0) return { error: "The selected objects all have this record: choose another format.", focus: select };
      return { value: f };
    },
  });
  if (format === null || format === undefined) return;
  lastFormat = format;
  const n = without(ids, format);
  const name = formats.find((f) => f.format === format)?.name ?? "the record";
  if (attempt("Attach Record", (s) => s.attachRecord(ids, format))) toast(`Attached ${name} to ${n} object${n === 1 ? "" : "s"}.`, "info");
}

/** The data record formats some selected object has a record of, by name. */
function attachedFormats(): { format: number; name: string }[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const ids = [...store.selection];
  return doc.recordFormats().filter((f) => ids.some((id) => doc.records(id).some((r) => r.format === f.format)));
}

export function canDetachRecord(): boolean {
  return store.selection.size > 0 && attachedFormats().length > 0;
}

export async function detachRecordDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const ids = [...store.selection];
  const formats = attachedFormats();
  if (!formats.length) {
    toast("None of the selected objects has a data record.", "info");
    return;
  }
  const select = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Record format" } },
    ...formats.map((f) => h("option", { attrs: { translate: "no" }, text: f.name, value: String(f.format) })),
  );
  const note = h("p", { cls: "muted" });
  const sync = (): void => {
    const n = ids.length - without(ids, Number(select.value));
    note.textContent = `Takes the record, and the values it holds, off ${n === ids.length ? (n === 1 ? "the selected object" : `the ${n} selected objects`) : `${n} of the ${ids.length} selected objects (the other${ids.length - n === 1 ? " has" : "s have"} none)`}.`;
  };
  select.addEventListener("change", sync);
  sync();
  const format = await showDialog<number>({
    title: "Detach Record",
    okLabel: "Detach",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Record format" }), select), note],
    check: () => ({ value: Number(select.value) }),
  });
  if (format === null || format === undefined) return;
  const holders = ids.filter((id) => doc.records(id).some((r) => r.format === format));
  const name = formats.find((f) => f.format === format)?.name ?? "the record";
  const n = holders.length;
  if (attempt("Detach Record", (s) => s.detachRecord(holders, format))) toast(`Detached ${name} from ${n} object${n === 1 ? "" : "s"}.`, "info");
}
