// AEC > Space Planning > Import Adjacency Matrix…: a tab- or comma-delimited spreadsheet of spaces, their areas
// and relationships becomes spaces with links between them (a bubble diagram), an adjacency matrix and a
// stacking diagram, on the active layer.

import { ADJACENCY_MATRIX, addDiagram, addLink, adjacencySettings, matrixWidth, STACKING_DIAGRAM } from "./adjacency.ts";
import "./adjacency.css";
import { bubbleGrid, parseAdjacency, splitRows, type AdjacencyOptions, type AdjacencyTable } from "./adjacencyShapes.ts";
import { attempt, setSelection, zoomToSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { showDialog } from "./menubar.ts";
import { addSpaces, areaUnit, layerScaleOf, type SpacePath } from "./spaces.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** the area a space gets when the file gives it none, in the unit areas read in */
const NO_AREA = 100;
const PREVIEW_ROWS = 8;
/** a stacking diagram's bars are this many of its text's heights across */
const STACK_TEXTS_ACROSS = 60;
const MAX_TEXT_MM = 12;

function numberField(label: string, value: number, min: number): { row: HTMLElement; input: HTMLInputElement } {
  const input = h("input", { cls: "menu-dialog-input", attrs: { type: "number", min: String(min), step: "1", "aria-label": label } });
  input.value = String(value);
  return { row: h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input), input };
}

function selectField(label: string, options: readonly (readonly [string, string])[]): { row: HTMLElement; select: HTMLSelectElement } {
  const select = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } });
  for (const [value, text] of options) select.append(h("option", { text, attrs: { value } }));
  return { row: h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), select), select };
}

export async function importAdjacencyMatrixDialog(): Promise<void> {
  const session = store.session;
  const layerId = store.activeLayerId;
  if (!session || !layerId) return;
  let text = "";
  const named = h("span", { cls: "muted adjacency-file", text: "No file chosen" });
  const file = h("input", { attrs: { type: "file", accept: ".txt,.csv,text/plain,text/csv", hidden: "", "aria-label": "Adjacency matrix file" } });
  const browse = h("button", { cls: "btn small", text: "Browse…", attrs: { type: "button" } });
  browse.addEventListener("click", () => file.click());
  const header = numberField("Header Rows", 2, 0);
  const spacing = selectField("Row Spacing", [
    ["1", "1: names on every other row"],
    ["0", "0: names on every row"],
  ]);
  const delimiter = selectField("Field Delimiter", [
    ["\t", "Tab"],
    [",", "Comma"],
  ]);
  const department = numberField("Department", 0, 0);
  const space = numberField("Space", 1, 1);
  const area = numberField("Area", 2, 1);
  const relationships = numberField("Relationships", 3, 1);
  const preview = h("div", { cls: "adjacency-preview" });
  const options = (): AdjacencyOptions => ({
    headerRows: Math.max(0, Math.floor(Number(header.input.value)) || 0),
    rowSpacing: spacing.select.value === "0" ? 0 : 1,
    columns: {
      department: Math.max(0, Math.floor(Number(department.input.value)) || 0),
      space: Math.max(1, Math.floor(Number(space.input.value)) || 1),
      area: Math.max(1, Math.floor(Number(area.input.value)) || 1),
      relationships: Math.max(1, Math.floor(Number(relationships.input.value)) || 1),
    },
  });
  const read = (): AdjacencyTable | string => (text ? parseAdjacency(splitRows(text, delimiter.select.value), options()) : "Choose the adjacency matrix file.");
  const show = (): void => {
    const table = read();
    if (typeof table === "string") {
      preview.replaceChildren(h("p", { cls: "muted", text: table }));
      return;
    }
    const cells = (kind: "th" | "td", values: readonly string[]): HTMLElement => h("tr", {}, ...values.map((value) => h(kind, { text: value })));
    const shown = table.spaces.slice(0, PREVIEW_ROWS).map((s, i) => cells("td", [s.department, s.name, s.area ? String(s.area) : "", String(table.links.filter((l) => l.a === i || l.b === i).length)]));
    const more = table.spaces.length - shown.length;
    preview.replaceChildren(
      h("table", {}, cells("th", ["Department", "Space", "Area", "Links"]), ...shown),
      h("p", { cls: "muted", text: `${table.spaces.length} ${table.spaces.length === 1 ? "space" : "spaces"} and ${table.links.length} ${table.links.length === 1 ? "link" : "links"}${more > 0 ? `; the first ${shown.length} shown` : ""}.` }),
    );
  };
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (!f) return;
    named.textContent = f.name;
    if (/\.csv$/i.test(f.name)) delimiter.select.value = ",";
    void f.text().then((read) => {
      text = read;
      show();
    });
  });
  for (const input of [header.input, department.input, space.input, area.input, relationships.input]) input.addEventListener("input", show);
  spacing.select.addEventListener("change", show);
  delimiter.select.addEventListener("change", show);
  show();
  const table = await showDialog<AdjacencyTable>({
    title: "Import Adjacency Matrix",
    okLabel: "Import",
    cls: "adjacency-dialog",
    body: [
      h("div", { cls: "adjacency-pick" }, browse, named, file),
      header.row,
      spacing.row,
      delimiter.row,
      h("p", { cls: "muted", text: "Column numbers, from 1; a Department of 0 means the file has none. Relationships is the first column holding them." }),
      department.row,
      space.row,
      area.row,
      relationships.row,
      preview,
    ],
    check: () => {
      const got = read();
      return typeof got === "string" ? { error: got } : { value: got };
    },
  });
  const A = appContext();
  if (!table || !A || store.session !== session) return;
  const unit = areaUnit();
  const origin = A.view.toWorld(A.view.width / 2, A.view.height / 2);
  const scale = layerScaleOf(layerId);
  const r = attempt("Import Adjacency Matrix", (s) =>
    s.batch(() => {
      const grid = bubbleGrid(table.spaces.map((x) => (x.area || NO_AREA) * unit.mm2), origin);
      // the diagrams' text as large as makes the stacking diagram as wide as the bubbles, within reason, and the spaces' labels with it
      const textSize = Math.min(MAX_TEXT_MM, Math.max(adjacencySettings.textSize, grid.width / STACK_TEXTS_ACROSS / scale));
      const paths = grid.rings.map((ring, i): SpacePath => ({ ring, layerId, classIndex: store.activeClassIndex, scale: (scale * textSize) / adjacencySettings.textSize, name: table.spaces[i].name, department: table.spaces[i].department, order: i + 1 }));
      const ids = addSpaces(s, paths);
      for (const l of table.links) addLink(s, ids[l.a], ids[l.b], l.strength);
      const margin = textSize * scale * 8;
      const matrix = addDiagram(s, ADJACENCY_MATRIX, layerId, { x: origin.x - matrixWidth(s, layerId, textSize) - margin, y: origin.y }, 0, textSize);
      const stack = addDiagram(s, STACKING_DIAGRAM, layerId, { x: origin.x, y: origin.y - grid.height - margin }, 0, textSize);
      return [...ids, matrix, stack];
    }),
  );
  if (!r) return;
  setSelection(r.value);
  zoomToSelection(A.scene, A.view);
  A.requestDraw();
  const noArea = table.spaces.filter((x) => !x.area).length;
  const notes = [noArea ? `${noArea} with no area given took ${NO_AREA} ${unit.name}` : "", table.leftOut ? `${table.leftOut} relationships fell on no two spaces and were left out` : ""].filter(Boolean);
  toast(`Imported ${table.spaces.length} spaces and ${table.links.length} links, with an adjacency matrix and a stacking diagram${notes.length ? `; ${notes.join("; ")}` : ""}.`, "info");
}
