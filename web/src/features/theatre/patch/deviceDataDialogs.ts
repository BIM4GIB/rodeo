// File > Export > Export Lighting Device Data… and File > Import > Import Lighting Device Data…, as Vectorworks
// Spotlight has them for Lightwright and spreadsheets (the sums are in deviceData.ts). Export ticks the fields
// to write, with All, User (the last set exported) and None, named sets kept in this browser, and the field
// names as the first record; UID always goes first. Import reads a tab-delimited file (or CSV, or an Excel
// workbook's first sheet), takes a Unique ID Field to match on, links each column to a field (AutoLink by
// name, or by hand), keeps named sets of links, and sets the matched instruments in one undo step. Rows that
// match none are placed as new Rodeo Instruments in a row below the bottom left of the drawing, as Vectorworks
// places orphans outside the page.

import { attempt, setSelection } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { layerScaleOf } from "../../../app/spaces.ts";
import { store } from "../../../app/state.ts";
import { loadTable } from "../../../app/surveyInput.ts";
import { toast } from "../../../app/toast.ts";
import { formatLengthValue, parseLength } from "../../../app/units.ts";
import { parseDelimited } from "../../../import/worksheet.ts";
import { DEFAULT_TYPE, fixtureType, type Fixture } from "../fixture.ts";
import { fixtures, placeInstrument, writeFixtures } from "../instrument.ts";
import { downloadText } from "../ui.ts";
import { autoLink, DEVICE_FIELDS, deviceDataText, deviceTable, likelyKey, patchTwice, planImport, UID, type LengthText } from "./deviceData.ts";
import { counted } from "./patch.ts";
import "./deviceData.css";

const EXPORT_KEY = "rodeo.lightingDeviceData.export";
const LINKS_KEY = "rodeo.lightingDeviceData.links";
/** the fields ticked the first time: what Lightwright needs to know an instrument by and patch it */
const FIRST_SET = ["type", "position", "unit", "channel", "universeAddress", "dimmer", "circuit", "color", "gobo", "purpose", "accessory", "watts"];
/** orphans: the gap below the drawing and between them, in mm on paper */
const ORPHAN_PAPER_MM = 25;

interface ExportSaved {
  user: string[];
  headings: boolean;
  sets: Record<string, string[]>;
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // a private window keeps nothing: the sets last this visit only
  }
}

const lengths = (): LengthText => {
  const units = store.session?.doc.info.units;
  return { format: (mm) => formatLengthValue(mm, units), parse: (t) => (t.trim() ? parseLength(t, units) : null) };
};

function baseName(): string {
  return store.fileName.replace(/\.(vwx|sta)$/i, "").trim() || "Untitled";
}

const button = (text: string, run: () => void): HTMLButtonElement => {
  const b = h("button", { cls: "btn small", text, attrs: { type: "button" } });
  b.addEventListener("click", run);
  return b;
};
const heading = (text: string): HTMLElement => h("p", { cls: "menu-dialog-heading", text });

/** A row of named sets kept in this browser: pick one to load it, or name the current one and save it. */
function setsRow(names: () => string[], load: (name: string) => void, save: (name: string) => void): HTMLElement {
  const pick = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Saved sets" } });
  const name = h("input", { cls: "menu-dialog-input", attrs: { "aria-label": "Name of the set to save", placeholder: "Name" } });
  const fill = (): void => {
    pick.replaceChildren(h("option", { text: names().length ? "Load a saved set…" : "No saved sets", attrs: { value: "" } }), ...names().map((n) => h("option", { text: n, attrs: { value: n } })));
    pick.disabled = !names().length;
  };
  pick.addEventListener("change", () => {
    if (pick.value) load(pick.value);
    pick.value = "";
  });
  const saveBtn = button("Save", () => {
    const n = name.value.trim();
    if (!n) {
      name.focus();
      return;
    }
    save(n);
    name.value = "";
    fill();
    toast(`Saved "${n}" in this browser.`, "info");
  });
  fill();
  return h("div", { cls: "ldd-row" }, h("span", { cls: "ldd-label", text: "Settings" }), pick, name, saveBtn);
}

/** File > Export > Export Lighting Device Data…: the instruments' fields as a tab-delimited text file. */
export async function exportDeviceDataDialog(): Promise<void> {
  const list = fixtures();
  if (!list.length) {
    toast("There are no lighting instruments in this drawing to export.", "info");
    return;
  }
  const saved = readStore<ExportSaved>(EXPORT_KEY, { user: FIRST_SET, headings: true, sets: {} });
  const boxes = DEVICE_FIELDS.map((f) => {
    const box = h("input", { attrs: { type: "checkbox" } });
    box.checked = saved.user.includes(f.key);
    return { key: f.key, box, el: h("label", { cls: "menu-dialog-check" }, box, f.label) };
  });
  const tick = (keys: readonly string[]): void => {
    for (const b of boxes) b.box.checked = keys.includes(b.key);
  };
  const ticked = (): string[] => boxes.filter((b) => b.box.checked).map((b) => b.key);
  const headings = h("input", { attrs: { type: "checkbox" } });
  headings.checked = saved.headings;
  const keys = await showDialog<string[]>({
    title: "Export Lighting Device Data",
    okLabel: "Export",
    cls: "ldd-dialog",
    body: [
      heading("Lighting Device Fields"),
      h("div", { cls: "ldd-fields" }, ...boxes.map((b) => b.el)),
      h(
        "div",
        { cls: "ldd-row" },
        h("span", { cls: "ldd-label", text: "Select" }),
        button("All", () => tick(DEVICE_FIELDS.map((f) => f.key))),
        button("User", () => tick(readStore<ExportSaved>(EXPORT_KEY, saved).user)),
        button("None", () => tick([])),
      ),
      setsRow(
        () => Object.keys(readStore<ExportSaved>(EXPORT_KEY, saved).sets).sort(),
        (n) => tick(readStore<ExportSaved>(EXPORT_KEY, saved).sets[n] ?? []),
        (n) => {
          const now = readStore<ExportSaved>(EXPORT_KEY, saved);
          writeStore(EXPORT_KEY, { ...now, user: ticked(), sets: { ...now.sets, [n]: ticked() } });
        },
      ),
      h("label", { cls: "menu-dialog-check" }, headings, "Export field names as first record"),
      h("p", { cls: "muted", text: `${counted(list.length, "instrument")}. The Unique ID (UID) is always exported first: it's what Import Lighting Device Data matches a file's rows by.` }),
    ],
    check: () => ({ value: ticked() }),
  });
  if (!keys) return;
  const now = readStore<ExportSaved>(EXPORT_KEY, saved);
  writeStore(EXPORT_KEY, { ...now, user: keys, headings: headings.checked });
  const doc = store.session?.doc;
  const layers = new Map((doc?.layers() ?? []).map((l) => [l.id, l.name]));
  const classes = new Map((doc?.classes() ?? []).map((c) => [c.index, c.name]));
  const placement = (f: Fixture) => ({ layer: layers.get(f.layerId) ?? "", cls: classes.get(f.classIndex) ?? "None" });
  const name = `${baseName()} lighting devices.txt`;
  downloadText(name, deviceDataText(list, keys, headings.checked, placement, lengths()), "text/tab-separated-values");
  toast(`Exported ${counted(list.length, "instrument")} with ${counted(keys.length + 1, "field")} to ${name}.`, "info");
}

function chooseDataFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const el = h("input", { attrs: { type: "file", accept: ".txt,.tsv,.tab,.csv,.xlsx,.xlsm", "aria-label": "Lighting device data file" }, hidden: true });
    document.body.append(el);
    el.addEventListener("change", () => {
      const file = el.files?.[0] ?? null;
      el.remove();
      resolve(file);
    });
    el.addEventListener("cancel", () => {
      el.remove();
      resolve(null);
    });
    el.click();
  });
}

/** Where orphans go: a row from the bottom left of what the layer shows, a little below it. */
function orphanSpots(layerId: string, n: number): { x: number; y: number }[] {
  const box = appContext()?.scene.drawnBounds(layerId) ?? null;
  const gap = ORPHAN_PAPER_MM * layerScaleOf(layerId);
  const x0 = box ? box.x0 : 0;
  const y = (box ? box.y0 : 0) - 2 * gap;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * gap, y }));
}

/** File > Import > Import Lighting Device Data…: a file's rows set onto the instruments they name. */
export async function importDeviceDataDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const file = await chooseDataFile();
  if (!file || store.session !== session) return;
  const loaded = await loadTable(file, "Import Lighting Device Data");
  if (!loaded) return;
  const raw = loaded.sheetRows ?? parseDelimited(loaded.text, !loaded.text.includes("\t") && /\.csv$/i.test(file.name) ? "," : "\t");
  const list = fixtures();
  const len = lengths();
  const firstIsData = h("input", { attrs: { type: "checkbox" } });
  const keyPick = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Unique ID Field" } });
  const matchBy = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Match to" } }, h("option", { text: "UID", attrs: { value: UID } }), ...DEVICE_FIELDS.filter((f) => f.read).map((f) => h("option", { text: f.label, attrs: { value: f.key } })));
  const linksBox = h("div", { cls: "ldd-links" });
  const summary = h("p", { cls: "muted" });
  let table = deviceTable(raw, false);
  let key = likelyKey(table.headings);
  let links = autoLink(table.headings, key);
  const fieldOptions = (): HTMLElement[] => [h("option", { text: "Not imported", attrs: { value: "" } }), ...DEVICE_FIELDS.filter((f) => f.read).map((f) => h("option", { text: f.label, attrs: { value: f.key } }))];
  const plan = () => planImport(table.rows, key, links, list, len, matchBy.value);
  const refreshSummary = (): void => {
    const p = plan();
    summary.textContent = `${counted(table.rows.length, "row")}: ${counted(p.edits.length, "instrument")} to set${p.orphans.length ? `, ${counted(p.orphans.length, "row")} matching none, placed as new instruments below the drawing` : ""}${p.unread ? `, ${counted(p.unread, "cell")} that can't be read left as they were` : ""}.`;
  };
  const drawLinks = (): void => {
    linksBox.replaceChildren(
      ...table.headings.flatMap((name, i) => {
        if (i === key) return [];
        const sample = table.rows.find((r) => r[i])?.[i] ?? "";
        const pick = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `Field for ${name}` } }, ...fieldOptions());
        pick.value = links.get(i) ?? "";
        pick.addEventListener("change", () => {
          // a field takes one column: one linked already lets go of it
          for (const [col, f] of links) if (f === pick.value && col !== i) links.delete(col);
          if (pick.value) links.set(i, pick.value);
          else links.delete(i);
          drawLinks();
        });
        return [h("div", { cls: "ldd-link" }, h("span", { cls: "ldd-incoming", text: name, attrs: { title: sample ? `e.g. ${sample}` : "" } }), h("span", { cls: "ldd-sample muted", text: sample }), pick)];
      }),
    );
    refreshSummary();
  };
  const drawKeys = (): void => {
    keyPick.replaceChildren(...table.headings.map((name, i) => h("option", { text: name, attrs: { value: String(i) } })));
    keyPick.value = String(key);
  };
  const reread = (): void => {
    table = deviceTable(raw, firstIsData.checked);
    key = Math.min(key, Math.max(0, table.headings.length - 1));
    if (!firstIsData.checked) key = likelyKey(table.headings);
    links = autoLink(table.headings, key);
    drawKeys();
    drawLinks();
  };
  firstIsData.addEventListener("change", reread);
  keyPick.addEventListener("change", () => {
    key = Number(keyPick.value);
    links.delete(key);
    drawLinks();
  });
  matchBy.addEventListener("change", refreshSummary);
  const savedLinks = (): Record<string, Record<string, string>> => readStore<Record<string, Record<string, string>>>(LINKS_KEY, {});
  drawKeys();
  drawLinks();
  const done = await showDialog<ReturnType<typeof plan>>({
    title: "Import Lighting Device Data",
    okLabel: "Import",
    cls: "ldd-dialog",
    body: [
      h("p", { cls: "muted", text: file.name }),
      h("label", { cls: "menu-dialog-check" }, firstIsData, "Import First Record (the first row holds data, not field names)"),
      h("div", { cls: "ldd-row" }, h("span", { cls: "ldd-label", text: "Unique ID Field" }), keyPick, h("span", { cls: "ldd-label", text: "matches" }), matchBy),
      heading("Incoming Data → Record Fields"),
      linksBox,
      h(
        "div",
        { cls: "ldd-row" },
        button("AutoLink", () => {
          links = autoLink(table.headings, key);
          drawLinks();
        }),
        button("Unlink All", () => {
          links = new Map();
          drawLinks();
        }),
      ),
      setsRow(
        () => Object.keys(savedLinks()).sort(),
        (n) => {
          const byName = savedLinks()[n] ?? {};
          links = new Map(table.headings.flatMap((name, i): [number, string][] => (i !== key && byName[name] ? [[i, byName[name]]] : [])));
          drawLinks();
        },
        (n) => writeStore(LINKS_KEY, { ...savedLinks(), [n]: Object.fromEntries([...links].map(([i, f]) => [table.headings[i], f])) }),
      ),
      summary,
    ],
    check: () => {
      if (!table.rows.length) return { error: "The file has no rows to import." };
      const p = plan();
      if (!links.size && !p.orphans.length) return { error: "Link at least one column to a field, or AutoLink them." };
      if (patchTwice(links)) return { error: "Link Universe/Address, or Universe and Address, not both: they set the same patch." };
      return { value: p };
    },
  });
  if (!done || store.session !== session) return;
  const layerId = list[0]?.layerId ?? (session.doc.layers().find((l) => l.id === store.activeLayerId && l.kind === "design") ?? session.doc.layers().find((l) => l.kind === "design"))?.id;
  const spots = layerId ? orphanSpots(layerId, done.orphans.length) : [];
  const r = attempt("Import Lighting Device Data", (s) =>
    s.batch(() => {
      writeFixtures(s, done.edits);
      if (!layerId) return [];
      return done.orphans.map((o, i) => placeInstrument(s, layerId, spots[i], o.edit.type && fixtureType(o.edit.type) ? o.edit.type : DEFAULT_TYPE, o.edit));
    }),
  );
  if (!r) return;
  if (r.value.length) setSelection(r.value);
  appContext()?.requestDraw();
  const orphans = done.orphans.length ? ` ${counted(done.orphans.length, "row")} matched no instrument and ${layerId ? `${done.orphans.length === 1 ? "was placed as a new instrument" : "were placed as new instruments"} below the drawing, selected` : "had no design layer to go on"}.` : "";
  toast(`Set ${counted(done.edits.length, "instrument")} from ${file.name}.${orphans}${done.repeated ? ` ${counted(done.repeated, "row")} named an instrument an earlier row did; the later row won.` : ""}`, "info");
}
