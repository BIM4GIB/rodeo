// ConnectCAD Settings (Stage > ConnectCAD): a drawing's defaults for the schematic tools, kept in the
// drawing as show data (show.ts) so they travel with the file and undo. Its panes: General (Number
// Format, automatic hopover), Panel Settings (prefixes and panel sizes), Numbering (the system Number
// Cables starts on), Signals, Connectors, Cables and Cable Lengths. settingsShapes.ts reads them back;
// ccadShapes.ts's FileSettings carries what they change in the tools, and the tools' prefixes and
// Number Cables follow them when a drawing opens.

import type { EditSession } from "../../../core/index.ts";
import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { millimetresPerUnit } from "../../../app/units.ts";
import { readShow, writeShowIn } from "../show.ts";
import { tabs } from "../ui.ts";
import { NO_FILE_SETTINGS, NUMBERING_SYSTEMS, readSettingsFrom, SIGNALS, type FileSettings, type NumberingSystem } from "./ccadShapes.ts";
import { numbering } from "./dialogs.ts";
import { ccadSettings, circuitsIn, hopAllCircuits } from "./schematic.ts";
import {
  connectorList,
  defaultSettings,
  fileSettingsOf,
  IMPERIAL_LENGTHS,
  METRIC_LENGTHS,
  NUMBER_FORMATS,
  PANEL_CATEGORIES,
  settingsFrom,
  SIGNAL_CATEGORIES,
  signalProblems,
  type CcadSettings,
} from "./settingsShapes.ts";
import "./connectcad.css";

const KEY = "connectcad.settings";

/** whether a drawing measures in metric units: its unit isn't a whole number of inches */
const metricIn = (s: EditSession): boolean => {
  const inches = millimetresPerUnit(s.doc.info.units) / 25.4;
  return Math.abs(inches - Math.round(inches)) > 1e-9;
};

/** The open drawing's settings, read once per change of it. */
let memo: { session: EditSession; settings: CcadSettings; file: FileSettings } | null = null;
const watched = new WeakSet<EditSession>();

function current(): { settings: CcadSettings; file: FileSettings } | null {
  const s = store.session;
  if (!s) return null;
  if (memo?.session === s) return memo;
  if (!watched.has(s)) {
    watched.add(s);
    s.onChange(() => {
      if (memo?.session === s) memo = null;
    });
  }
  const settings = settingsFrom(readShow<unknown>(KEY, null), metricIn(s));
  memo = { session: s, settings, file: fileSettingsOf(settings) };
  return memo;
}

export const settingsOf = (): CcadSettings => current()?.settings ?? defaultSettings(true);
readSettingsFrom(() => current()?.file ?? NO_FILE_SETTINGS);

/** The tools' panel prefixes and Number Cables' system, as the settings say. */
function applyToTools(c: CcadSettings): void {
  const p = ccadSettings.panelPrefix;
  p.jack = c.prefixes.jack;
  p.linked = c.prefixes.jack;
  p.term = c.prefixes.term;
  p.connector = c.prefixes.connector;
  numbering.system = c.numbering;
}
let applied: EditSession | null = null;
store.on("session", () => {
  const s = store.session;
  if (!s || s === applied) return;
  applied = s;
  applyToTools(settingsOf());
});

/** The dialog's copy of the settings, which its panes edit. */
interface Draft {
  autoHop: boolean;
  digits: number;
  prefixes: { jack: string; term: string; connector: string };
  sizes: { jack: Record<string, number>; term: Record<string, number>; din: number; custom: number };
  numbering: NumberingSystem;
  signals: { name: string; category: string; letter: string; connectors: string[] }[];
  connectors: { name: string; description: string }[];
  cables: { name: string; description: string }[];
  lengths: string[];
}

const field = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
const note = (text: string): HTMLElement => h("p", { cls: "muted", text });
const button = (label: string, run: () => void): HTMLElement => {
  const b = h("button", { cls: "menu-dialog-button", text: label, attrs: { type: "button" } });
  b.addEventListener("click", run);
  return b;
};
const input = (value: string, label: string, set: (v: string) => void, wide = true): HTMLInputElement => {
  const el = h("input", { cls: `menu-dialog-input${wide ? "" : " ccad-num"}`, value, attrs: { type: "text", "aria-label": label } }) as HTMLInputElement;
  el.addEventListener("input", () => set(el.value));
  return el;
};
const count = (value: number, label: string, set: (v: number) => void): HTMLInputElement =>
  input(String(value), label, (v) => {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 1) set(Math.min(999, n));
  }, false);
const choice = (values: readonly { value: string; label: string }[], value: string, label: string, set: (v: string) => void): HTMLSelectElement => {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }, ...values.map((v) => h("option", { value: v.value, text: v.label }))) as HTMLSelectElement;
  el.value = value;
  el.addEventListener("change", () => set(el.value));
  return el;
};
const table = (heads: readonly string[], rows: readonly HTMLElement[]): HTMLElement =>
  h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...heads.map((t) => h("th", { text: t })))), h("tbody", {}, ...rows)));
const row = (...cells: (HTMLElement | string)[]): HTMLElement => h("tr", {}, ...cells.map((c) => (typeof c === "string" ? h("td", { text: c }) : h("td", {}, c))));

/** ConnectCAD Settings: the drawing's defaults for the schematic tools. */
export async function connectcadSettings(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const was = settingsOf();
  const metric = metricIn(s);
  const draft = JSON.parse(JSON.stringify(was)) as Draft;
  const builtIn = new Map(SIGNALS.map((x) => [x.name, x]));
  // the pane showing, built again after an Add or Delete (set once the tabs are made)
  const shown = { refresh: (): void => {} };
  const refresh = (): void => shown.refresh();

  const general = (): HTMLElement =>
    h(
      "div",
      { cls: "ccad-pane" },
      field("Number Format", choice(NUMBER_FORMATS.map((f) => ({ value: String(f.digits), label: f.label })), String(draft.digits), "Number Format", (v) => (draft.digits = Number(v)))),
      (() => {
        const box = h("input", { checked: draft.autoHop, attrs: { type: "checkbox", "aria-label": "Enable automatic hopover" } }) as HTMLInputElement;
        box.addEventListener("change", () => (draft.autoHop = box.checked));
        return h("label", { cls: "menu-dialog-check" }, box, "Enable automatic hopover");
      })(),
      note(
        "Number Format is the least number of digits in the numbers a Linear Array gives sockets, socket loops, externals and distribution amplifiers (01, 02…). With automatic hopover, each polyline circuit hops the circuits drawn before it wherever it crosses them, and the HopOver tool stands aside; turned on, it hops the circuits already drawn. Rodeo's schematics keep their own grid, units, circuit label places and circuit graphics, and there's no Device Builder or half rack unit mounting, so those settings aren't here.",
      ),
    );

  const panels = (): HTMLElement => {
    const sizes = (kind: "jack" | "term", label: string): HTMLElement =>
      row(label, ...PANEL_CATEGORIES.map((c) => count(draft.sizes[kind][c.category], `${label} ${c.label} size`, (v) => (draft.sizes[kind][c.category] = v))));
    return h(
      "div",
      { cls: "ccad-pane" },
      field("Jackfield Prefix", input(draft.prefixes.jack, "Jackfield Prefix", (v) => (draft.prefixes.jack = v))),
      field("Term Panel Prefix", input(draft.prefixes.term, "Term Panel Prefix", (v) => (draft.prefixes.term = v))),
      field("Custom Panel Prefix", input(draft.prefixes.connector, "Custom Panel Prefix", (v) => (draft.prefixes.connector = v))),
      table(["Panel Size", ...PANEL_CATEGORIES.map((c) => c.label)], [sizes("jack", "Jack Panel"), sizes("term", "Terminal Panel")]),
      field("DIN Rail Panel Size", count(draft.sizes.din, "DIN Rail Panel Size", (v) => (draft.sizes.din = v))),
      field("Custom Panel Size", count(draft.sizes.custom, "Custom Panel Size", (v) => (draft.sizes.custom = v))),
      note(
        "A panel size is the most ports a panel takes before the Term Panel, Jackfield, Linked Jackfield and Connector Panel tools start the next one; linked jackfields go by the jack panel sizes. The prefixes become the tools' own, for panels placed from now on. Ports are numbered 01, 02…: group and panel series, alphabetical labels and delimiters aren't offered.",
      ),
    );
  };

  const systems = (): HTMLElement =>
    h(
      "div",
      { cls: "ccad-pane" },
      table(
        ["Use", "Cable Numbering System"],
        NUMBERING_SYSTEMS.map((n) => {
          const radio = h("input", { checked: draft.numbering === n, attrs: { type: "radio", name: "ccad-numbering", "aria-label": `Use ${n}` } }) as HTMLInputElement;
          radio.addEventListener("change", () => radio.checked && (draft.numbering = n));
          return row(radio, n);
        }),
      ),
      note("The system Number Cables starts on in this drawing. New numbering systems and rules can't be made."),
    );

  const signals = (): HTMLElement => {
    const own = (name: string) => draft.signals.find((x) => x.name === name);
    const rows: HTMLElement[] = [];
    // the built-in ones in their order, a changed one in its place; then the drawing's new ones
    const list = [...SIGNALS.map((b) => own(b.name) ?? b), ...draft.signals.filter((x) => !builtIn.has(x.name))];
    list.forEach((x) => {
      const mine = draft.signals.find((d) => d === x);
      const n = rows.length + 1;
      if (!mine) {
        rows.push(
          row(
            x.name,
            x.category,
            x.letter,
            x.connectors.join(", "),
            button("Edit", () => {
              draft.signals.push({ name: x.name, category: x.category, letter: x.letter, connectors: [...x.connectors] });
              refresh();
            }),
          ),
        );
        return;
      }
      const changed = builtIn.has(mine.name);
      rows.push(
        row(
          changed ? h("strong", { text: mine.name }) : input(mine.name, `Name of signal ${n}`, (v) => (mine.name = v)),
          choice([...new Set([...SIGNAL_CATEGORIES, mine.category])].map((c) => ({ value: c, label: c })), mine.category, `Category of signal ${n}`, (v) => (mine.category = v)),
          input(mine.letter, `Letter of signal ${n}`, (v) => (mine.letter = v), false),
          input(mine.connectors.join(", "), `Connectors of signal ${n}`, (v) => (mine.connectors = connectorList(v))),
          button(changed ? "Reset" : "Delete", () => {
            draft.signals = draft.signals.filter((d) => d !== mine);
            refresh();
          }),
        ),
      );
    });
    return h(
      "div",
      { cls: "ccad-pane" },
      table(["Signal", "Category", "Letter", "Connectors", ""], rows),
      h(
        "div",
        { cls: "ccad-actions" },
        button("Add", () => {
          const taken = new Set([...builtIn.keys(), ...draft.signals.map((x) => x.name)]);
          let k = 1;
          while (taken.has(`Signal ${k}`)) k++;
          draft.signals.push({ name: `Signal ${k}`, category: "Other", letter: "X", connectors: [] });
          refresh();
        }),
      ),
      note(
        "Edit makes a built-in signal the drawing's own, shown in bold, and Reset takes it back. A signal's letter stands for it in cable numbers (Signal and Sequence), its category gives its circuits their colour, and its connectors are offered first for its sockets. Line types and class attributes aren't offered: a circuit takes its colour from its signal's category.",
      ),
    );
  };

  /** a pane of names and descriptions the drawing adds */
  const named = (list: { name: string; description: string }[], what: string, about: string): HTMLElement =>
    h(
      "div",
      { cls: "ccad-pane" },
      table(
        [what, "Description", ""],
        list.map((x, i) =>
          row(
            input(x.name, `${what} ${i + 1}`, (v) => (x.name = v)),
            input(x.description, `Description of ${what.toLowerCase()} ${i + 1}`, (v) => (x.description = v)),
            button("Delete", () => {
              list.splice(i, 1);
              refresh();
            }),
          ),
        ),
      ),
      h(
        "div",
        { cls: "ccad-actions" },
        button("Add", () => {
          list.push({ name: "", description: "" });
          refresh();
        }),
      ),
      note(about),
    );

  const lengths = (): HTMLElement =>
    h(
      "div",
      { cls: "ccad-pane" },
      table(
        ["Cable Length", ""],
        draft.lengths.map((l, i) =>
          row(
            input(l, `Cable length ${i + 1}`, (v) => (draft.lengths[i] = v)),
            button("Delete", () => {
              draft.lengths.splice(i, 1);
              refresh();
            }),
          ),
        ),
      ),
      h(
        "div",
        { cls: "ccad-actions" },
        button("Add", () => {
          draft.lengths.push("");
          refresh();
        }),
        button("Restore Defaults", () => {
          draft.lengths = [...(metric ? METRIC_LENGTHS : IMPERIAL_LENGTHS)];
          refresh();
        }),
      ),
      note("A circuit's Cable Length in the Object Info palette is chosen from these; with none listed, it's typed in."),
    );

  const builtInConnectors = [...new Set(SIGNALS.flatMap((x) => x.connectors))].sort((a, b) => a.localeCompare(b));
  const view = tabs([
    { id: "general", label: "General", build: general },
    { id: "panels", label: "Panel Settings", build: panels },
    { id: "numbering", label: "Numbering", build: systems },
    { id: "signals", label: "Signals", build: signals },
    {
      id: "connectors",
      label: "Connectors",
      build: () => named(draft.connectors, "Connector", `The drawing's own connectors are offered for any socket, panel or adapter, with the built-in ones: ${builtInConnectors.join(", ")}. Panel connector symbols aren't offered.`),
    },
    { id: "cables", label: "Cables", build: () => named(draft.cables, "Cable", "With cables listed, a circuit's Cable in the Object Info palette is chosen from them; with none, it's typed in. Cable types and their diameters aren't offered.") },
    { id: "lengths", label: "Cable Lengths", build: lengths },
  ]);
  shown.refresh = view.refresh;

  const chosen = await showDialog<CcadSettings>({
    title: "ConnectCAD Settings",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [view.element],
    check: () => {
      const signalsNow = draft.signals.map((x) => ({ ...x, name: x.name.trim() }));
      const problems = signalProblems(signalsNow);
      if (problems.length) return { error: `Signals: ${problems.join("; ")}.` };
      const twice = (list: { name: string }[], what: string): string => {
        const seen = new Set<string>();
        for (const x of list.map((y) => y.name.trim()).filter(Boolean)) {
          if (seen.has(x)) return `There are two ${what} named ${x}.`;
          seen.add(x);
        }
        return "";
      };
      const error = twice(draft.connectors, "connectors") || twice(draft.cables, "cables");
      if (error) return { error };
      return { value: settingsFrom({ ...draft, signals: signalsNow }, metric) };
    },
  });
  if (!chosen) return;
  const hopNow = chosen.autoHop && !was.autoHop;
  const r = attempt("ConnectCAD Settings", (session) =>
    session.batch(() => {
      writeShowIn(session, KEY, chosen);
      if (hopNow) hopAllCircuits(session);
    }),
  );
  if (!r) return;
  applyToTools(chosen);
  if (hopNow) {
    const n = circuitsIn(store.session!).length;
    toast(`ConnectCAD Settings: automatic hopover is on; ${n} circuit${n === 1 ? "" : "s"} checked for crossings.`, "info");
  }
}
