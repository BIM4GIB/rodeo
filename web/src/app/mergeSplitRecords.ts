// Tools > Records > Merge Record Formats… and Split Record Format…, as Vectorworks has them. Merge
// takes one data record format's fields into another's (a name the other has already taking "_"
// in front), every object and symbol definition with a record of the first keeping its values in
// a record of the second, and deletes the first. Split moves the fields ticked from a format to a
// new one, named in the dialog, every holder of the format gaining a record of the new one with
// its values. Each is one undo step (EditSession.mergeRecordFormats and splitRecordFormat).

import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import "./mergeSplitRecords.css";

/** The drawing's data record formats whose fields can be read, by name. */
function formats(): { format: number; name: string }[] {
  const doc = store.session?.doc;
  return doc ? doc.recordFormats().filter((f) => doc.recordFormatFields(f.format) !== null) : [];
}

export function canMergeRecordFormats(): boolean {
  return formats().length >= 2;
}

export function canSplitRecordFormat(): boolean {
  const doc = store.session?.doc;
  return !!doc && formats().some((f) => (doc.recordFormatFields(f.format)?.length ?? 0) >= 2);
}

function field(label: string, el: HTMLElement): HTMLElement {
  return h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
}

function formatSelect(label: string, list: readonly { format: number; name: string }[]): HTMLSelectElement {
  return h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } },
    ...list.map((f) => h("option", { value: String(f.format), text: f.name })),
  );
}

/** Tools > Records > Merge Record Formats…: the format merged (and deleted), and the one that takes its fields. */
export async function mergeRecordFormatsDialog(): Promise<void> {
  const list = formats();
  if (list.length < 2) {
    toast("Merging takes two record formats; this drawing has fewer.", "info");
    return;
  }
  const from = formatSelect("Merge Record Format", list);
  const into = formatSelect("Into", list);
  into.selectedIndex = 1;
  const r = await showDialog<{ from: number; into: number }>({
    title: "Merge Record Formats",
    okLabel: "Merge",
    body: [
      field("Merge Record Format", from),
      field("Into", into),
      h("p", {
        cls: "muted",
        text: "The first format's fields go to the end of the second's (a name it has already gets \"_\" in front). Objects with the first format's record have the second's, with their values, and the first format is deleted.",
      }),
    ],
    check: () =>
      from.value === into.value
        ? { error: "Choose two different record formats.", focus: into }
        : { value: { from: Number(from.value), into: Number(into.value) } },
  });
  if (!r) return;
  const name = (f: number): string => list.find((x) => x.format === f)?.name ?? "";
  if (attempt("Merge Record Formats", (s) => s.mergeRecordFormats(r.from, r.into))) toast(`"${name(r.from)}" merged into "${name(r.into)}".`, "info");
}

/** Tools > Records > Split Record Format…: the format, the fields ticked to move, and the new format's name. */
export async function splitRecordFormatDialog(): Promise<void> {
  const doc = store.session?.doc;
  const list = formats().filter((f) => (doc?.recordFormatFields(f.format)?.length ?? 0) >= 2);
  if (!doc || !list.length) {
    toast("Splitting takes a record format with two fields or more.", "info");
    return;
  }
  const source = formatSelect("Source Record Format", list);
  const fields = h("div", { cls: "split-fields", attrs: { role: "group", "aria-label": "Fields to split" } });
  let boxes: { name: string; box: HTMLInputElement }[] = [];
  const showFields = (): void => {
    boxes = (doc.recordFormatFields(Number(source.value)) ?? []).map((f) => ({ name: f.name, box: h("input", { attrs: { type: "checkbox", "aria-label": f.name } }) }));
    fields.replaceChildren(...boxes.map((b) => h("label", { cls: "menu-dialog-check" }, b.box, b.name)));
  };
  source.addEventListener("change", showFields);
  showFields();
  const name = h("input", { cls: "menu-dialog-input", attrs: { type: "text", "aria-label": "New Record Format name", spellcheck: "false" } });
  const r = await showDialog<{ format: number; fields: string[]; name: string }>({
    title: "Split Record Format",
    okLabel: "Split",
    cls: "split-record-dialog",
    body: [
      field("Source Record Format", source),
      h("div", { cls: "menu-dialog-label split-fields-label", text: "Fields to split" }),
      fields,
      field("New Record Format name", name),
      h("p", { cls: "muted", text: "The fields ticked move, with their values, to the new format, which every object with the source format's record has too." }),
    ],
    check: () => {
      const ticked = boxes.filter((b) => b.box.checked).map((b) => b.name);
      if (!ticked.length) return { error: "Tick the fields to split off.", focus: boxes[0]?.box };
      if (ticked.length === boxes.length) return { error: "Leave at least one field in the source format.", focus: boxes[0]?.box };
      if (!name.value.trim()) return { error: "Name the new record format.", focus: name };
      return { value: { format: Number(source.value), fields: ticked, name: name.value.trim() } };
    },
  });
  if (!r) return;
  const n = r.fields.length;
  if (attempt("Split Record Format", (s) => s.splitRecordFormat(r.format, r.fields, r.name))) toast(`${n} field${n === 1 ? "" : "s"} split off into "${r.name}".`, "info");
}
