// Stage > Lighting > Label Legend Manager… and Assign Legend to Lighting Devices…. The manager lists the
// drawing's label legends: which is active (new devices take it), and Add, Duplicate, Edit Fields and
// Remove (not the active one). Edit Fields picks each label's field, order, spot, container,
// right-reading and size, the legend's name and whether it's Non-Rotating. OK writes the legends and
// draws the devices that use a changed one again, as one undo step; devices whose legend is removed take
// the active one, and renaming one renames it on its devices. Assign gives the selected devices a legend.
// Create Label Legend from Lighting Device makes a legend from one device's labels and gives it to it.
// Vectorworks lighting devices keep their saved drawing, so they don't take one.

import type { EditSession } from "../../../core/index.ts";
import { attempt, setSelection } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { pluginDriver } from "../../../app/ext.ts";
import { LABEL_BOXES, LABEL_SPOTS, type LabelBox, type LabelSpot } from "../../../app/labelLegend.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { FIELD, INSTRUMENT } from "../fixture.ts";
import { fixtures, redrawInstruments } from "../instrument.ts";
import { writeShowIn } from "../show.ts";
import { freeLegendName, labelSummary, LEGEND_FIELDS, LEGEND_KEY, STARTER_LABELS, type Legend, type LegendBook, type LegendField, type LegendLabel } from "./legendBook.ts";
import { readLegends, whileWriting } from "./legendData.ts";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const DEFAULT_LABEL = "Rodeo default";

const button = (label: string, run: () => void, disabled = false): HTMLButtonElement => {
  const b = h("button", { cls: "menu-dialog-button", text: label, attrs: { type: "button" } }) as HTMLButtonElement;
  b.disabled = disabled;
  b.addEventListener("click", run);
  return b;
};
const select = <T extends string>(options: readonly { readonly id: T; readonly label: string }[], value: T, label: string, set: (v: T) => void): HTMLSelectElement => {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }, ...options.map((o) => h("option", { value: o.id, text: o.label }))) as HTMLSelectElement;
  el.value = value;
  el.addEventListener("change", () => set(el.value as T));
  return el;
};
const check = (on: boolean, label: string, set: (v: boolean) => void): HTMLInputElement => {
  const el = h("input", { checked: on, attrs: { type: "checkbox", "aria-label": label } }) as HTMLInputElement;
  el.addEventListener("change", () => set(el.checked));
  return el;
};

/** A row of the Edit Fields table: a field, used or not, with its settings. */
interface Row {
  field: LegendField;
  use: boolean;
  order: string;
  spot: LabelSpot;
  box: LabelBox;
  rightReading: boolean;
  size: string;
}

/** Edit Fields: `legend` changed, or null when cancelled; `others` are the names it can't take. */
async function editLegend(title: string, legend: Legend, others: readonly string[]): Promise<Legend | null> {
  const rows: Row[] = LEGEND_FIELDS.map((f) => {
    const i = legend.labels.findIndex((l) => l.field === f.id);
    const l = legend.labels[i];
    return l ? { field: f.id, use: true, order: String(i + 1), spot: l.spot, box: l.box, rightReading: l.rightReading, size: String(l.size) } : { field: f.id, use: false, order: "", spot: "right", box: "none", rightReading: true, size: "100" };
  });
  const name = h("input", { cls: "menu-dialog-input", value: legend.name, attrs: { type: "text", "aria-label": "Legend Name" } }) as HTMLInputElement;
  const nonRotating = check(legend.nonRotating, "Non-Rotating", () => {});
  const text = (value: string, label: string, set: (v: string) => void): HTMLInputElement => {
    const el = h("input", { cls: "menu-dialog-input ccad-num", value, attrs: { type: "text", "aria-label": label } }) as HTMLInputElement;
    el.addEventListener("input", () => set(el.value));
    return el;
  };
  const body = rows.map((r) => {
    const label = LEGEND_FIELDS.find((f) => f.id === r.field)!.label;
    return h(
      "tr",
      {},
      h("td", { cls: "ccad-centre" }, check(r.use, `Use ${label}`, (v) => (r.use = v))),
      h("td", {}, text(r.order, `Order of ${label}`, (v) => (r.order = v))),
      h("td", { text: label }),
      h("td", {}, select(LABEL_SPOTS, r.spot, `Position of ${label}`, (v) => (r.spot = v))),
      h("td", {}, select(LABEL_BOXES, r.box, `Container of ${label}`, (v) => (r.box = v))),
      h("td", { cls: "ccad-centre" }, check(r.rightReading, `Right-Reading ${label}`, (v) => (r.rightReading = v))),
      h("td", {}, text(r.size, `Size of ${label}`, (v) => (r.size = v))),
    );
  });
  return showDialog<Legend>({
    title,
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Legend Name" }), name),
      h("label", { cls: "menu-dialog-check" }, nonRotating, "Non-Rotating: the labels stay where they are as the device turns"),
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...["Use", "#", "Attribute", "Position", "Container", "Right-Reading", "Size %"].map((t) => h("th", { text: t })))), h("tbody", {}, ...body))),
      h("p", {
        cls: "muted",
        text: "Labels at the same position stack outward from the device in # order. Positions are as a device aimed down the page shows them, and turn with the device unless the legend is Non-Rotating. A right-reading label stays level; one that isn't turns with the device (never upside down). Size is against each device's Label Size.",
      }),
    ],
    check: () => {
      const n = name.value.trim();
      if (!n) return { error: "Enter a legend name.", focus: name };
      if (n === DEFAULT_LABEL || others.includes(n)) return { error: `There's already a legend called ${n}.`, focus: name };
      const used = rows.filter((r) => r.use);
      for (const r of used) {
        const size = Number(r.size);
        if (!Number.isFinite(size) || size <= 0) return { error: `The size of ${LEGEND_FIELDS.find((f) => f.id === r.field)!.label} isn't a percentage above 0.` };
      }
      // in # order, those without one after, as listed
      const key = (r: Row): number => (r.order.trim() && Number.isFinite(Number(r.order)) ? Number(r.order) : Infinity);
      const labels: LegendLabel[] = used
        .map((r, i) => ({ r, i }))
        .sort((a, b) => key(a.r) - key(b.r) || a.i - b.i)
        .map(({ r }) => ({ field: r.field, spot: r.spot, box: r.box, rightReading: r.rightReading, size: Number(r.size) }));
      return { value: { name: n, nonRotating: nonRotating.checked, labels } };
    },
  });
}

/** A legend in the manager, with the name it had when the manager opened (null for a new one). */
interface Entry {
  legend: Legend;
  readonly was: string | null;
}

/** Writes `book`, renaming or resetting devices' legends as `entries` say, and draws again the devices whose legend changed. */
function writeBook(s: EditSession, before: LegendBook, entries: readonly Entry[], book: LegendBook): number {
  const renamed = new Map(entries.filter((e) => e.was !== null).map((e) => [e.was!, e.legend.name]));
  const same = new Set(entries.filter((e) => e.was !== null && JSON.stringify(e.legend) === JSON.stringify(before.legends.find((l) => l.name === e.was))).map((e) => e.was!));
  let drawn = 0;
  whileWriting(book, () => {
    writeShowIn(s, LEGEND_KEY, book);
    for (const f of fixtures().filter((x) => x.native)) {
      const rec = s.doc.records(f.id).find((r) => r.parametric && r.name === INSTRUMENT);
      // a device from before legends has no field for one, so uses none
      const was = String(rec?.fields.find((x) => x.name === FIELD.legend)?.value ?? "");
      if (!rec || !was || same.has(was)) continue;
      // a renamed legend's new name; a removed one's devices take the active one
      const now = renamed.get(was) ?? book.active;
      if (now !== was) s.setRecordField(f.id, rec.format, FIELD.legend, now);
      redrawInstruments(s, [f.id]);
      drawn++;
    }
  });
  return drawn;
}

/** Stage > Lighting > Label Legend Manager…. */
export async function labelLegendManager(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const before = readLegends();
  const entries: Entry[] = before.legends.map((l) => ({ legend: l, was: l.name }));
  let active = before.active;
  const list = h("div", { cls: "ccad-scroll" });
  const names = (but?: Entry): string[] => entries.filter((e) => e !== but).map((e) => e.legend.name);
  const render = (): void => {
    const radio = (value: string, label: string): HTMLInputElement => {
      const el = h("input", { checked: active === value, attrs: { type: "radio", name: "legend-active", "aria-label": `Active: ${label}` } }) as HTMLInputElement;
      el.addEventListener("change", () => {
        if (el.checked) active = value;
        render();
      });
      return el;
    };
    const rows = entries.map((e) =>
      h(
        "tr",
        {},
        h("td", { cls: "ccad-centre" }, radio(e.legend.name, e.legend.name)),
        h("td", { text: e.legend.name }),
        h("td", { text: `${labelSummary(e.legend)}${e.legend.nonRotating ? " (Non-Rotating)" : ""}` }),
        h(
          "td",
          {},
          button("Edit Fields…", async () => {
            const was = e.legend.name;
            const next = await editLegend("Edit Label Legend", e.legend, names(e));
            if (!next) return;
            e.legend = next;
            if (active === was) active = next.name;
            render();
          }),
        ),
        h(
          "td",
          {},
          button("Duplicate", async () => {
            const copy = await editLegend("Edit Label Legend", { ...e.legend, name: freeLegendName(e.legend.name, names()) }, names());
            if (!copy) return;
            entries.splice(entries.indexOf(e) + 1, 0, { legend: copy, was: null });
            render();
          }),
        ),
        h(
          "td",
          {},
          button(
            "Remove",
            () => {
              entries.splice(entries.indexOf(e), 1);
              render();
            },
            active === e.legend.name,
          ),
        ),
      ),
    );
    list.replaceChildren(
      h(
        "table",
        { cls: "ccad-table" },
        h("thead", {}, h("tr", {}, ...["Active", "Legend Name", "Labels", "", "", ""].map((t) => h("th", { text: t })))),
        h("tbody", {}, h("tr", {}, h("td", { cls: "ccad-centre" }, radio("", DEFAULT_LABEL)), h("td", { text: DEFAULT_LABEL }), h("td", { text: "Channel, Unit Number, Color, Purpose, as each device's Show boxes say" })), ...rows),
      ),
    );
  };
  render();
  const add = button("Add…", async () => {
    const legend = await editLegend("Add New Legend", { name: freeLegendName("Legend", names()), nonRotating: false, labels: STARTER_LABELS }, names());
    if (!legend) return;
    entries.push({ legend, was: null });
    render();
  });
  const book = await showDialog<LegendBook>({
    title: "Label Legend Manager",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      list,
      h("div", { cls: "ccad-actions" }, add),
      h("p", {
        cls: "muted",
        text: "The active legend goes on lighting devices as they're placed; Object Info's Use Legend, or Assign Legend to Lighting Devices, changes a device's. The active legend can't be removed; devices using a removed legend take the active one.",
      }),
    ],
    check: () => ({ value: { active, legends: entries.map((e) => e.legend) } }),
  });
  if (!book || store.session !== s) return;
  const r = attempt("Label Legend Manager", (session) => session.batch(() => writeBook(session, before, entries, book)));
  if (!r) return;
  toast(`Label Legend Manager: ${plural(book.legends.length, "legend", "legends")}, ${book.active || DEFAULT_LABEL} active${r.value ? `; ${plural(r.value, "lighting device", "lighting devices")} drawn again` : ""}.`, "info");
}

/** Stage > Lighting > Assign Legend to Lighting Devices…: the selected devices take a legend. */
export async function assignLegend(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const chosen = fixtures().filter((f) => store.selection.has(f.id));
  const ours = chosen.filter((f) => f.native).map((f) => f.id);
  const foreign = chosen.length - ours.length;
  if (!ours.length) {
    toast(foreign ? "Assign Legend to Lighting Devices: Vectorworks lighting devices keep the drawing they were saved with, so they can't take a legend here." : "Assign Legend to Lighting Devices: select the lighting devices first.", "info");
    return;
  }
  const book = readLegends();
  const pick = select([{ id: "", label: DEFAULT_LABEL }, ...book.legends.map((l) => ({ id: l.name, label: l.name }))], book.active, "Use Legend", () => {});
  const v = await showDialog<string>({
    title: "Assign Legend to Lighting Devices",
    okLabel: "Assign",
    cls: "replace-device-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Use Legend" }), pick),
      h("p", {
        cls: "muted",
        text: `For ${plural(ours.length, "selected lighting device", "selected lighting devices")}.${book.legends.length ? "" : " The drawing has no legends yet: make them with the Label Legend Manager."}${foreign ? ` ${plural(foreign, "Vectorworks lighting device keeps", "Vectorworks lighting devices keep")} its saved drawing and isn't changed.` : ""}`,
      }),
    ],
    check: () => ({ value: pick.value }),
  });
  if (v === null || store.session !== s) return;
  const driver = pluginDriver(INSTRUMENT);
  if (!driver) return;
  const r = attempt("Assign Legend to Lighting Devices", (session) => session.batch(() => ours.forEach((id) => driver.edit(id, { [FIELD.legend]: v }))));
  if (!r) return;
  setSelection(ours);
  toast(`${plural(ours.length, "lighting device", "lighting devices")} now ${ours.length === 1 ? "uses" : "use"} ${v || DEFAULT_LABEL}.`, "info");
}

/**
 * Stage > Lighting > Create Label Legend from Lighting Device…: a new legend from the selected
 * device's labels (a copy of its legend, or Rodeo default's as its Show boxes have them), named
 * after its legend with -1 (or the next number free), given to the device.
 */
export async function createLegendFromDevice(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const chosen = fixtures().filter((f) => f.native && store.selection.has(f.id));
  if (chosen.length !== 1) {
    toast(chosen.length ? "Create Label Legend from Lighting Device: select just one lighting device." : "Create Label Legend from Lighting Device: select a lighting device (a Rodeo one: Vectorworks' keep their saved drawing).", "info");
    return;
  }
  const id = chosen[0].id;
  const rec = s.doc.records(id).find((r) => r.parametric && r.name === INSTRUMENT);
  const field = (name: string) => rec?.fields.find((f) => f.name === name)?.value;
  const book = readLegends();
  const from = book.legends.find((l) => l.name === String(field(FIELD.legend) ?? ""));
  // Rodeo default's labels: the channel, unit and colour unless switched off, the purpose when switched on
  const shown: Record<string, boolean> = { channel: field(FIELD.showChannel) !== false, unit: field(FIELD.showUnit) !== false, color: field(FIELD.showColor) !== false, purpose: field(FIELD.showPurpose) === true };
  const labels = from ? from.labels : STARTER_LABELS.filter((l) => shown[l.field]);
  const taken = book.legends.map((l) => l.name);
  const stem = from?.name ?? DEFAULT_LABEL;
  let suggested = `${stem}-1`;
  for (let n = 2; taken.includes(suggested); n++) suggested = `${stem}-${n}`;
  const name = h("input", { cls: "menu-dialog-input", value: suggested, attrs: { type: "text", "aria-label": "Legend Name" } }) as HTMLInputElement;
  const v = await showDialog<string>({
    title: "Create Label Legend from Lighting Device",
    okLabel: "Create",
    cls: "replace-device-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Legend Name" }), name),
      h("p", { cls: "muted", text: `Its labels: ${labels.length ? labelSummary({ name: "", nonRotating: false, labels }) : "none"}, placed as ${from ? from.name : "Rodeo default"} places them. The device takes the new legend; edit it in the Label Legend Manager.` }),
    ],
    check: () => {
      const n = name.value.trim();
      if (!n) return { error: "Enter a legend name.", focus: name };
      if (n === DEFAULT_LABEL || taken.includes(n)) return { error: `There's already a legend called ${n}.`, focus: name };
      return { value: n };
    },
  });
  if (!v || store.session !== s) return;
  const legend: Legend = { name: v, nonRotating: from?.nonRotating ?? false, labels };
  const next: LegendBook = { active: book.active, legends: [...book.legends, legend] };
  const driver = pluginDriver(INSTRUMENT);
  if (!driver) return;
  const r = attempt("Create Label Legend from Lighting Device", (session) =>
    session.batch(() =>
      whileWriting(next, () => {
        writeShowIn(session, LEGEND_KEY, next);
        driver.edit(id, { [FIELD.legend]: v });
      }),
    ),
  );
  if (!r) return;
  toast(`Label legend ${v} made from the lighting device, which now uses it.`, "info");
}
