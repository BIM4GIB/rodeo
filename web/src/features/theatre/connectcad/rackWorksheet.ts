// ConnectCAD Layout's Make Rack Equipment Worksheet: a click opens Rack Equipment Columns, for the
// rack (the one clicked over, or the first) and the worksheet's columns, used or not and dragged
// into order; then a worksheet lists what's in that rack at each position from the top (reports.ts
// makes it, or shows it in a dialog in a drawing that can't hold one). The columns chosen are kept
// for next time.

import "./connectcad.css";
import type { Pt } from "../../../core/index.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { RACK_COLUMNS, RACK_COLUMNS_SHOWN, rackRows, type RackColumn } from "./ccadReports.ts";
import { rackContents } from "./equipmentItem.ts";
import { rackPlace, racksIn, rackUnder } from "./equipmentRack.ts";
import { report } from "./reports.ts";

/** the columns in their order, and which are used: what the dialog last OKed */
let columns: { readonly name: RackColumn; use: boolean }[] = RACK_COLUMNS.map((name) => ({ name, use: RACK_COLUMNS_SHOWN.includes(name) }));

/** The Rack Equipment Columns dialog: the rack (by object) and the columns to use, in order. */
function chooseColumns(racks: readonly { readonly id: string; readonly label: string }[], first: string): Promise<{ rack: string; columns: RackColumn[] } | null> {
  const select = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Select Rack" } }, ...racks.map((r) => h("option", { value: r.id, text: r.label }))) as HTMLSelectElement;
  select.value = first;
  const order = columns.map((c) => ({ ...c }));
  const tbody = h("tbody", {});
  let dragged = -1;
  const draw = (): void => {
    let n = 0;
    tbody.replaceChildren(
      ...order.map((c, k) => {
        const use = h("input", { attrs: { type: "checkbox", "aria-label": `Use ${c.name}` } }) as HTMLInputElement;
        use.checked = c.use;
        use.addEventListener("change", () => {
          c.use = use.checked;
          draw();
        });
        const row = h("tr", { cls: "ccad-drag", attrs: { draggable: "true", "data-column": c.name } }, h("td", { cls: "ccad-centre", text: c.use ? String(++n) : "" }), h("td", { cls: "ccad-centre" }, use), h("td", { text: c.name }));
        // drag a row by its # to move the column
        row.addEventListener("dragstart", (e) => {
          dragged = k;
          e.dataTransfer?.setData("text/plain", c.name);
        });
        row.addEventListener("dragover", (e) => e.preventDefault());
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          if (dragged < 0 || dragged === k) return;
          const [moved] = order.splice(dragged, 1);
          order.splice(k, 0, moved);
          dragged = -1;
          draw();
        });
        return row;
      }),
    );
  };
  draw();
  const button = (text: string, on: boolean): HTMLButtonElement => {
    const el = h("button", { cls: "btn", text, attrs: { type: "button" } });
    el.addEventListener("click", () => {
      for (const c of order) c.use = on;
      draw();
    });
    return el;
  };
  return showDialog<{ rack: string; columns: RackColumn[] }>({
    title: "Rack Equipment Columns",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Select Rack" }), select),
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, h("th", { text: "#" }), h("th", { text: "Use" }), h("th", { text: "Column" }))), tbody)),
      h("div", { cls: "ccad-actions" }, button("Select All Columns", true), button("Deselect All Columns", false)),
      h("p", { cls: "muted", text: "Drag a row to change the columns' order. The worksheet lists the rack's equipment at each position from the top, its free units, and the equipment below it." }),
    ],
    check: () => {
      const used = order.filter((c) => c.use).map((c) => c.name);
      if (!used.length) return { error: "Choose a column to use." };
      columns = order;
      return { value: { rack: select.value, columns: used } };
    },
  });
}

/** The tool's click at `at`: the dialog, then the worksheet of the rack chosen. */
export async function makeRackWorksheet(at: Pt): Promise<void> {
  const s = store.session;
  if (!s) return;
  const racks = racksIn(s.doc).map((r) => ({ id: r.id, label: rackPlace(s.doc, r.id)?.rackId || "(no Rack ID)" }));
  if (!racks.length) {
    toast("Make Rack Equipment Worksheet: the drawing has no equipment racks.", "info");
    return;
  }
  const chosen = await chooseColumns(racks, rackUnder(s.doc, at) ?? racks[0].id);
  if (!chosen || store.session !== s) return;
  const contents = rackContents(s.doc, chosen.rack);
  if (!contents) return;
  await report(`${contents.rackId || "Rack"} Equipment`, rackRows(contents.units, contents.entries, chosen.columns));
}
