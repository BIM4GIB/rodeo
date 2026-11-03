// Stage > Lighting Paperwork > Inventory and Equipment List…, as Spotlight has it (inventory.ts holds the
// sums). Symbols and Parts lists the equipment in the drawing by category, each item's In Use count, its
// Source (an inventory) and what that source and every inventory in use hold of it and have left, red
// where there isn't enough; categories are made, renamed and removed (when empty) and items moved between
// them; Create Equipment List Worksheet… and Create Equipment List Report… put the list shown in a
// worksheet. Manage Inventories lists this machine's inventories, each ticked to Use in the drawing:
// New Inventory from File (the drawing's equipment, each item's count as its stock), Update Inventory
// File, Delete Selected Inventory, Edit Inventory Settings…, and Import… and Export… as .xml, with the
// highlighted inventory's items and their Stock to edit. OK keeps the inventories on this machine and the
// drawing's choices in the drawing, in one undo step; Cancel drops both.

import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { downloadBlob } from "../../../app/fileio.ts";
import { confirmDialog, showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { NewSheetCell } from "../../../core/index.ts";
import { fixtures } from "../instrument.ts";
import { readShow, writeShowIn } from "../show.ts";
import { usedEquipment } from "./equipmentKey.ts";
import {
  categoryList,
  drawingInventoryOf,
  equipmentRows,
  freeName,
  inventoriesOf,
  inventoryFrom,
  inventoryXml,
  LIGHTING_DEVICE,
  NO_DRAWING_INVENTORY,
  readInventoryXml,
  SYMBOL,
  type DrawingInventory,
  type EquipmentRow,
  type InUse,
  type Inventory,
} from "./inventory.ts";
import "../connectcad/connectcad.css";
import "./inventory.css";

/** where this machine keeps its inventories */
const LIBRARY_KEY = "openvwx.inventories";
const DRAWING_KEY = "inventory";
const ALL = "";

type Tab = "Symbols and Parts" | "Manage Inventories";

function loadLibrary(): Inventory[] {
  try {
    return inventoriesOf(JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function saveLibrary(list: readonly Inventory[]): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** The equipment in the drawing: lighting devices by type, plug-in objects and symbols by name. */
export function equipmentInUse(): InUse[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const devices = new Map<string, number>();
  for (const f of fixtures()) if (f.label) devices.set(f.label, (devices.get(f.label) ?? 0) + 1);
  const { plugins, symbols } = usedEquipment(doc);
  return [
    ...[...devices].map(([name, count]) => ({ name, partType: LIGHTING_DEVICE, count })),
    ...[...plugins].map(([name, count]) => ({ name, partType: name, count })),
    ...[...symbols].map(([name, count]) => ({ name, partType: SYMBOL, count })),
  ];
}

const button = (label: string, run: () => void, disabled = false): HTMLButtonElement => {
  const b = h("button", { cls: "menu-dialog-button", text: label, attrs: { type: "button" } }) as HTMLButtonElement;
  b.disabled = disabled;
  b.addEventListener("click", run);
  return b;
};

const cell = (n: number | null, short = false): HTMLElement => h("td", { cls: `ccad-centre${short && n !== null && n < 0 ? " ccad-missing" : ""}`, text: n === null ? "-" : String(n) });

/** A one-line name dialog; null when cancelled. */
async function askName(title: string, label: string, value: string, taken: readonly string[]): Promise<string | null> {
  const input = h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label } }) as HTMLInputElement;
  return showDialog<string>({
    title,
    okLabel: "OK",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input)],
    check: () => {
      const v = input.value.trim();
      if (!v) return { error: `Enter the ${label.toLowerCase()}.`, focus: input };
      if (taken.includes(v)) return { error: `There is one named ${v} already.`, focus: input };
      return { value: v };
    },
  });
}

/** The Inventory Information dialog; null when cancelled. */
async function inventoryInfo(title: string, start: Pick<Inventory, "name" | "vendor" | "contact" | "notes">, taken: readonly string[]): Promise<Pick<Inventory, "name" | "vendor" | "contact" | "notes"> | null> {
  const input = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label } }) as HTMLInputElement;
  const name = input("Inventory Name", start.name);
  const vendor = input("Vendor", start.vendor);
  const contact = input("Contact", start.contact);
  const notes = h("textarea", { cls: "menu-dialog-input", attrs: { rows: "3", "aria-label": "Notes" } }) as HTMLTextAreaElement;
  notes.value = start.notes;
  const field = (label: string, control: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
  return showDialog<Pick<Inventory, "name" | "vendor" | "contact" | "notes">>({
    title,
    okLabel: "OK",
    body: [field("Inventory Name", name), field("Vendor", vendor), field("Contact", contact), field("Notes", notes)],
    check: () => {
      const n = name.value.trim();
      if (!n) return { error: "Enter the inventory's name.", focus: name };
      if (taken.includes(n)) return { error: `There is an inventory named ${n} already.`, focus: name };
      return { value: { name: n, vendor: vendor.value.trim(), contact: contact.value.trim(), notes: notes.value.trim() } };
    },
  });
}

/** Puts `rows` in a new worksheet named `name`, or, in a drawing with no worksheet to copy one from, a .csv file. */
function toWorksheet(name: string, widths: number[], rows: NewSheetCell[][]): void {
  const s = store.session;
  if (!s) return;
  if (s.doc.resources().some((r) => r.kind === "worksheet")) {
    const made = attempt(`Create ${name}`, (session) => session.createWorksheet({ name: freeName(name, s.doc.resources().map((r) => r.name)), widths, rowHeight: 14, rows }));
    if (made) toast(`${name}: a worksheet of ${rows.length - 1} rows, in the Resource Manager.`, "info");
    return;
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c.value).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadBlob(`${name}.csv`, new Blob([csv + "\n"], { type: "text/csv" }));
  toast(`${name}: this drawing has no worksheet to copy one from, so it's saved as a .csv file.`, "info");
}

/** Stage > Lighting Paperwork > Inventory and Equipment List…. */
export async function inventoryAndEquipmentList(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const inUse = equipmentInUse();
  let library = loadLibrary();
  const before = readShow<unknown>(DRAWING_KEY, null);
  let d: DrawingInventory = before ? drawingInventoryOf(before) : NO_DRAWING_INVENTORY;
  let tab: Tab = "Symbols and Parts";
  let category = ALL;
  let highlighted = library.findIndex((i) => d.use.includes(i.name));
  if (highlighted < 0) highlighted = library.length ? 0 : -1;
  const problem = h("p", { cls: "menu-dialog-error", attrs: { role: "status" } });
  const tabs = h("div", { cls: "seg org-tabs", attrs: { role: "tablist" } });
  const panel = h("div", {});
  const file = h("input", { attrs: { type: "file", accept: ".xml,text/xml,application/xml", hidden: "", "aria-label": "Inventory file" } }) as HTMLInputElement;
  const rows = (): EquipmentRow[] => equipmentRows(inUse, library, d);
  const say = (text: string): void => {
    problem.textContent = text;
  };

  const equipmentPanel = (): HTMLElement[] => {
    const all = rows();
    const cats = categoryList(all, d);
    if (category !== ALL && !cats.includes(category)) category = ALL;
    const shown = all.filter((r) => category === ALL || r.category === category);
    const catSelect = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Category" } }, h("option", { value: ALL, text: "All Categories" }), ...cats.map((c) => h("option", { value: c, text: c }))) as HTMLSelectElement;
    catSelect.value = category;
    catSelect.addEventListener("change", () => {
      category = catSelect.value;
      render();
    });
    const used = new Set(all.map((r) => r.category));
    const catButtons = h(
      "div",
      { cls: "ccad-actions" },
      catSelect,
      button("New Category…", async () => {
        const name = await askName("New Category", "New Category Name", "", cats);
        if (!name) return;
        d = { ...d, order: [...cats, name] };
        category = name;
        render();
      }),
      button(
        "Edit Category…",
        async () => {
          const name = await askName("Edit Category", "Category Name", category, cats.filter((c) => c !== category));
          if (!name || name === category) return;
          const was = category;
          const moved = Object.fromEntries(all.filter((r) => r.category === was).map((r) => [r.name, name]));
          d = { ...d, order: cats.map((c) => (c === was ? name : c)), categories: { ...d.categories, ...moved } };
          category = name;
          render();
        },
        category === ALL,
      ),
      button(
        "Remove Category",
        () => {
          if (used.has(category)) {
            say(`The category must be empty to remove it: ${category} holds ${all.filter((r) => r.category === category).length} items.`);
            return;
          }
          d = { ...d, order: d.order.filter((c) => c !== category) };
          category = ALL;
          render();
        },
        category === ALL,
      ),
    );
    const sourceOptions = [h("option", { value: "", text: "-" }), ...library.map((i) => h("option", { value: i.name, text: i.name }))];
    const body = shown.map((r) => {
      const cat = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `${r.name} Category` } }, ...cats.map((c) => h("option", { value: c, text: c }))) as HTMLSelectElement;
      cat.value = r.category;
      cat.addEventListener("change", () => {
        d = { ...d, categories: { ...d.categories, [r.name]: cat.value } };
        render();
      });
      const src = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `${r.name} Source` } }, ...sourceOptions.map((o) => o.cloneNode(true))) as HTMLSelectElement;
      src.value = r.source;
      src.addEventListener("change", () => {
        const sources = { ...d.sources };
        if (src.value) sources[r.name] = src.value;
        else delete sources[r.name];
        d = { ...d, sources };
        render();
      });
      return h("tr", {}, h("td", { text: r.name }), cell(r.inUse), h("td", { text: r.partType }), h("td", {}, cat), h("td", {}, src), cell(r.remainingSource, true), cell(r.totalSource), cell(r.remainingAll, true), cell(r.totalAll));
    });
    const heads = ["Symbol/Object", "In Use", "Part Type", "Category", "Source", "Remaining in source inventory", "Total in source inventory", "Remaining via all in use inventories", "Total via all in use inventories"];
    return [
      catButtons,
      h(
        "div",
        { cls: "ccad-scroll" },
        shown.length
          ? h("table", { cls: "ccad-table inventory-table" }, h("thead", {}, h("tr", {}, ...heads.map((t) => h("th", { text: t })))), h("tbody", {}, ...body))
          : h("p", { cls: "muted", text: inUse.length ? "Nothing in this category." : "No equipment in the drawing yet: lighting devices, plug-in objects and symbols placed on design layers are listed here." }),
      ),
      h(
        "div",
        { cls: "ccad-actions" },
        button("Create Equipment List Worksheet…", () => void equipmentWorksheet(shown, library, d), !shown.length),
        button("Create Equipment List Report…", () => void equipmentReport(shown), !shown.length),
      ),
      h("p", { cls: "muted", text: "Remaining is what an inventory holds less what's in use, red where there isn't enough. A source is any of this machine's inventories; the totals via all count those ticked to Use." }),
    ];
  };

  const inventoriesPanel = (): HTMLElement[] => {
    const inv = library[highlighted];
    const list = library.map((i, k) => {
      const pick = h("input", { checked: k === highlighted, attrs: { type: "radio", name: "inventory", "aria-label": `Inventory ${i.name}` } }) as HTMLInputElement;
      pick.addEventListener("change", () => {
        highlighted = k;
        render();
      });
      const use = h("input", { checked: d.use.includes(i.name), attrs: { type: "checkbox", "aria-label": `Use ${i.name}` } }) as HTMLInputElement;
      use.addEventListener("change", () => {
        d = { ...d, use: use.checked ? [...d.use, i.name] : d.use.filter((n) => n !== i.name) };
        render();
      });
      return h("tr", { cls: k === highlighted ? "ccad-focus" : "" }, h("td", { cls: "ccad-centre" }, pick), h("td", { cls: "ccad-centre" }, use), h("td", { text: i.name }), h("td", { text: i.vendor }), h("td", { cls: "ccad-centre", text: String(Object.keys(i.stock).length) }));
    });
    const using = library.filter((i) => d.use.includes(i.name));
    const items = inv
      ? Object.keys(inv.stock)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map((name) => {
            const stock = h("input", { cls: "menu-dialog-input ccad-num", value: String(inv.stock[name]), attrs: { type: "number", min: "0", step: "1", "aria-label": `${name} Stock` } }) as HTMLInputElement;
            stock.addEventListener("change", () => {
              const n = Math.round(Number(stock.value));
              if (!Number.isFinite(n) || n < 0) {
                say("Stock: a whole number, 0 or more.");
                stock.value = String(inv.stock[name]);
                return;
              }
              library = library.map((x, k) => (k === highlighted ? { ...x, stock: { ...x.stock, [name]: n } } : x));
              render();
            });
            const totals = using.reduce((n, x) => n + (x.stock[name] ?? 0), 0);
            return h("tr", {}, h("td", { text: name }), h("td", { text: inv.categories[name] ?? "" }), h("td", {}, stock), h("td", { cls: "ccad-centre", text: String(totals) }));
          })
      : [];
    const none = !inv;
    return [
      h(
        "div",
        { cls: "ccad-scroll" },
        library.length
          ? h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...["", "Use", "Inventory", "Vendor", "Items"].map((t) => h("th", { text: t })))), h("tbody", {}, ...list))
          : h("p", { cls: "muted", text: "No inventories on this machine yet. Place one of each item a vendor or venue has in a drawing, then New Inventory from File; or Import… one saved as .xml." }),
      ),
      h(
        "div",
        { cls: "ccad-actions" },
        button(
          "New Inventory from File…",
          async () => {
            if (!inUse.length) {
              say("This drawing holds no equipment to make an inventory of.");
              return;
            }
            const names = library.map((i) => i.name);
            const info = await inventoryInfo("Inventory Information", { name: freeName(store.fileName.replace(/\.vwx$/i, "") || "Inventory", names), vendor: "", contact: "", notes: "" }, names);
            if (!info) return;
            library = [...library, inventoryFrom(info.name, info, inUse, d, library)];
            highlighted = library.length - 1;
            render();
          },
          false,
        ),
        button(
          "Update Inventory File",
          async () => {
            if (!(await confirmDialog("Update Inventory File", `Make inventory ${inv.name} again from this drawing's equipment? Its stock is replaced.`, "Update"))) return;
            library = library.map((x, k) => (k === highlighted ? inventoryFrom(x.name, x, inUse, d, library) : x));
            render();
          },
          none || !inUse.length,
        ),
        button(
          "Delete Selected Inventory",
          async () => {
            if (!(await confirmDialog("Delete Selected Inventory", `Delete inventory ${inv.name} from this machine?`, "Delete"))) return;
            const gone = inv.name;
            library = library.filter((_, k) => k !== highlighted);
            const sources = Object.fromEntries(Object.entries(d.sources).filter(([, v]) => v !== gone));
            d = { ...d, use: d.use.filter((n) => n !== gone), sources };
            highlighted = Math.min(highlighted, library.length - 1);
            render();
          },
          none,
        ),
        button(
          "Edit Inventory Settings…",
          async () => {
            const info = await inventoryInfo("Inventory Information", inv, library.filter((x) => x !== inv).map((x) => x.name));
            if (!info) return;
            const was = inv.name;
            library = library.map((x, k) => (k === highlighted ? { ...x, ...info } : x));
            if (info.name !== was) {
              const sources = Object.fromEntries(Object.entries(d.sources).map(([item, v]) => [item, v === was ? info.name : v]));
              d = { ...d, use: d.use.map((n) => (n === was ? info.name : n)), sources };
            }
            render();
          },
          none,
        ),
        button("Import…", () => file.click()),
        button(
          "Export…",
          () => {
            downloadBlob(`${inv.name}.xml`, new Blob([inventoryXml(inv)], { type: "application/xml" }));
          },
          none,
        ),
      ),
      ...(inv
        ? [
            h("p", { cls: "menu-dialog-heading", text: `${inv.name}${inv.vendor ? ` (${inv.vendor})` : ""}` }),
            h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...["Symbol/Object", "Category", "Stock in highlighted inventory", "Totals"].map((t) => h("th", { text: t })))), h("tbody", {}, ...items))),
          ]
        : []),
    ];
  };

  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    const inv = readInventoryXml(await f.text());
    if (typeof inv === "string") {
      say(`${f.name} can't be imported: ${inv}.`);
      return;
    }
    library = [...library, { ...inv, name: freeName(inv.name, library.map((i) => i.name)) }];
    highlighted = library.length - 1;
    render();
  });

  function render(): void {
    say("");
    tabs.replaceChildren(
      ...(["Symbols and Parts", "Manage Inventories"] as const).map((t) => {
        const b = h("button", { cls: `seg-btn${t === tab ? " active" : ""}`, text: t, attrs: { type: "button", role: "tab", "aria-selected": String(t === tab) } });
        b.addEventListener("click", () => {
          tab = t;
          render();
        });
        return b;
      }),
    );
    panel.replaceChildren(...(tab === "Symbols and Parts" ? equipmentPanel() : inventoriesPanel()));
  }
  render();

  const ok = await showDialog<true>({ title: "Inventory and Equipment List", okLabel: "OK", cls: "ccad-dialog", body: [tabs, panel, problem, file], check: () => ({ value: true }) });
  if (!ok || store.session !== s) return;
  const kept = saveLibrary(library);
  const changed = JSON.stringify(d) !== JSON.stringify(before ? drawingInventoryOf(before) : NO_DRAWING_INVENTORY);
  if (changed) attempt("Inventory and Equipment List", (session) => session.batch(() => writeShowIn(session, DRAWING_KEY, d)));
  if (!kept) toast("The inventories couldn't be kept on this machine: the browser's storage is full or turned off.");
}

/** Create Equipment List Worksheet…: its name and options, then the list shown, by category. */
async function equipmentWorksheet(shown: readonly EquipmentRow[], library: readonly Inventory[], d: DrawingInventory): Promise<void> {
  const name = h("input", { cls: "menu-dialog-input", value: "Equipment List", attrs: { type: "text", "aria-label": "Worksheet Name" } }) as HTMLInputElement;
  const sourcesFrom = new Set(shown.map((r) => r.source).filter(Boolean));
  const single = sourcesFrom.size === 1 ? library.find((i) => i.name === [...sourcesFrom][0] && d.use.includes(i.name)) : undefined;
  const vendor = h("input", { attrs: { type: "checkbox", "aria-label": "Show vendor information" } }) as HTMLInputElement;
  vendor.disabled = !single?.vendor;
  const sources = h("input", { attrs: { type: "checkbox", "aria-label": "Include assigned sources column" } }) as HTMLInputElement;
  const v = await showDialog<{ name: string; vendor: boolean; sources: boolean }>({
    title: "Create Equipment List Worksheet",
    okLabel: "Create",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Worksheet Name" }), name),
      h("label", { cls: "menu-dialog-check" }, vendor, "Show vendor information"),
      h("label", { cls: "menu-dialog-check" }, sources, "Include assigned sources column"),
      h("p", { cls: "muted", text: vendor.disabled ? "Vendor information shows when everything listed comes from one inventory in use that names its vendor." : `Vendor: ${single?.vendor}` }),
    ],
    check: () => (name.value.trim() ? { value: { name: name.value.trim(), vendor: vendor.checked, sources: sources.checked } } : { error: "Enter the worksheet's name.", focus: name }),
  });
  if (!v) return;
  const rows: NewSheetCell[][] = [];
  if (v.vendor && single) rows.push([{ value: `Vendor: ${single.vendor}${single.contact ? `, ${single.contact}` : ""}`, bold: true }]);
  rows.push([{ value: "Symbol/Object", bold: true }, { value: "Quantity", bold: true, align: "center" }, ...(v.sources ? [{ value: "Source", bold: true }] : [])]);
  let last = "";
  for (const r of shown) {
    if (r.category !== last) rows.push([{ value: r.category, bold: true }]);
    last = r.category;
    rows.push([{ value: r.name }, { value: r.inUse, align: "right" }, ...(v.sources ? [{ value: r.source || "-" }] : [])]);
  }
  rows.push([{ value: "Total", bold: true }, { value: shown.reduce((n, r) => n + r.inUse, 0), align: "right", bold: true }]);
  toWorksheet(v.name, v.sources ? [160, 64, 120] : [160, 64], rows);
}

/** Create Equipment List Report…: the list shown, a row each, as the dialog shows it. */
async function equipmentReport(shown: readonly EquipmentRow[]): Promise<void> {
  const name = await askName("Create Equipment Report", "Report Name", "Equipment Report", []);
  if (!name) return;
  const n = (x: number | null): NewSheetCell => ({ value: x === null ? "-" : x, align: "right" });
  const head = ["Symbol/Object", "In Use", "Part Type", "Category", "Source", "Remaining in Source", "Total in Source", "Remaining via All", "Total via All"].map((value): NewSheetCell => ({ value, bold: true }));
  const body = shown.map((r): NewSheetCell[] => [{ value: r.name }, n(r.inUse), { value: r.partType }, { value: r.category }, { value: r.source || "-" }, n(r.remainingSource), n(r.totalSource), n(r.remainingAll), n(r.totalAll)]);
  toWorksheet(name, [140, 50, 90, 90, 90, 70, 70, 70, 70], [head, ...body]);
}
