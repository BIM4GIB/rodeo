// Script palettes, as Vectorworks keeps document scripts: named palettes of Python scripts and
// Vectorscripts, each run on the open drawing by a double-click (or Run on its right-click menu),
// what it changes one undo step. Window > Script Palettes lists the palettes (choosing one shows it)
// and makes new ones; the Script Palettes palette shows them a section each, a palette's right-click
// menu adds, imports and renames, a script's edits (in a Script Editor with its language), renames,
// duplicates, exports and deletes. Vectorworks keeps script palettes in the drawing; Rodeo keeps them
// in this browser, the same for every drawing, and doesn't read those a .vwx file holds.

import { appContext } from "../../app/ext.ts";
import { h } from "../../app/dom.ts";
import { openContextMenu, type Row } from "../../app/menu.ts";
import { confirmDialog, showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { showAlert } from "../plugins/ui.ts";

export const SCRIPT_PALETTES = "scriptPalettes";

const KEY = "openvwx.scriptPalettes";

type Language = "python" | "vectorscript";

interface Script {
  readonly name: string;
  readonly language: Language;
  readonly code: string;
}

interface ScriptPalette {
  name: string;
  scripts: Script[];
  /** shown with its scripts, rather than rolled up to its name */
  open: boolean;
}

const LANGUAGES: readonly (readonly [Language, string])[] = [
  ["python", "Python Script"],
  ["vectorscript", "VectorScript"],
];

const TEMPLATE: Readonly<Record<Language, string>> = {
  python: "import vs\n\n# runs on the open drawing; what it changes is one undo step\n",
  vectorscript: "PROCEDURE Main;\nBEGIN\n\t{ runs on the open drawing; what it changes is one undo step }\nEND;\nRUN(Main);\n",
};

function load(): ScriptPalette[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v.flatMap((p: Partial<ScriptPalette>): ScriptPalette[] => {
      if (typeof p?.name !== "string" || !Array.isArray(p.scripts)) return [];
      const scripts = p.scripts.filter(
        (s): s is Script => typeof s?.name === "string" && typeof s.code === "string" && (s.language === "python" || s.language === "vectorscript"),
      );
      return [{ name: p.name, scripts, open: p.open !== false }];
    });
  } catch {
    // storage blocked or the entry unreadable: none, for this visit
    return [];
  }
}

let palettes: ScriptPalette[] = load();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(palettes));
  } catch {
    // storage blocked: kept for this visit only
  }
  render();
}

/** `base`, or `base 2`, `base 3`… the first that `taken` doesn't hold. */
function freeName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

const fileName = (s: Script): string => `${s.name}.${s.language === "vectorscript" ? "vs" : "py"}`;

// ---- running -------------------------------------------------------------------------------------

/** Runs a script on the open drawing; an error shows in an alert with its line, anything it prints in a toast. */
async function runScriptOf(s: Script): Promise<void> {
  if (!store.session) {
    toast("Open a drawing to run a script on it.", "info");
    return;
  }
  const { runScript, scriptRunning } = await import("./runner.ts");
  if (scriptRunning()) {
    toast("A script is running already.", "info");
    return;
  }
  const printed: string[] = [];
  const outcome = await runScript(s.code, fileName(s), {
    print: (kind, text) => {
      if (kind === "system") toast(text, "info");
      else if (text.trim()) printed.push(text.trim());
    },
  });
  const e = outcome.error;
  if (e) {
    const what = e.name === "Stopped" || e.name === "Busy" ? e.message : `${e.name}: ${e.message}`;
    await showAlert(s.name, e.line ? `${what} (line ${e.line})` : what);
    return;
  }
  const said = printed.slice(-3).join("\n");
  toast(said || (outcome.steps > 0 ? `${s.name}: done, one undo step.` : `${s.name}: done; the drawing wasn't changed.`), "info");
}

// ---- editing -------------------------------------------------------------------------------------

function field(label: string, control: HTMLElement): HTMLElement {
  return h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
}

/** Asks for a name, not one of `taken`; null when cancelled. */
async function askName(title: string, value: string, taken: readonly string[], okLabel = "OK"): Promise<string | null> {
  const input = h("input", { cls: "menu-dialog-input sp-input", value, attrs: { type: "text", "aria-label": "Name", autocomplete: "off" } });
  return showDialog<string>({
    title,
    okLabel,
    body: [field("Name", input)],
    check: () => {
      const name = input.value.trim();
      if (!name) return { error: "Enter a name.", focus: input };
      if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) return { error: `There is one called ${name} already.`, focus: input };
      return { value: name };
    },
  });
}

/** The Script Editor: a new script for palette `p` (`s` null), or `s` edited; saved into the palette. */
async function editScript(p: ScriptPalette, s: Script | null, start?: Partial<Script>): Promise<void> {
  const others = p.scripts.filter((x) => x !== s).map((x) => x.name);
  const name = h("input", { cls: "menu-dialog-input sp-input", value: s?.name ?? start?.name ?? freeName("Script", others), attrs: { type: "text", "aria-label": "Name", autocomplete: "off" } });
  const language = h("select", { cls: "select sp-input", attrs: { "aria-label": "Language" } }, ...LANGUAGES.map(([v, label]) => h("option", { text: label, attrs: { value: v } })));
  const first = s?.language ?? start?.language ?? "python";
  language.value = first;
  const code = h("textarea", { cls: "sp-code", attrs: { spellcheck: "false", autocapitalize: "off", autocomplete: "off", wrap: "off", "aria-label": "Script" } });
  code.value = s?.code ?? start?.code ?? TEMPLATE[first];
  // an untouched starting script follows the language chosen
  language.addEventListener("change", () => {
    if (LANGUAGES.some(([v]) => code.value === TEMPLATE[v])) code.value = TEMPLATE[language.value as Language];
  });
  code.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    code.setRangeText(language.value === "python" ? "    " : "\t", code.selectionStart, code.selectionEnd, "end");
  });
  const v = await showDialog<Script>({
    title: s ? `Edit Script: ${s.name}` : "New Script",
    okLabel: "Save",
    cls: "sp-editor",
    body: [h("p", { cls: "muted", text: `In the script palette ${p.name}. Double-click it there to run it on the open drawing.` }), field("Name", name), field("Language", language), code],
    check: () => {
      const n = name.value.trim();
      if (!n) return { error: "Enter the script's name.", focus: name };
      if (others.some((o) => o.toLowerCase() === n.toLowerCase())) return { error: `${p.name} has a script called ${n} already.`, focus: name };
      return { value: { name: n, language: language.value as Language, code: code.value } };
    },
  });
  if (!v) return;
  const at = s ? p.scripts.indexOf(s) : -1;
  if (at >= 0) p.scripts[at] = v;
  else p.scripts.push(v);
  p.open = true;
  save();
}

/** A palette made and named; null when cancelled. */
async function newPalette(): Promise<ScriptPalette | null> {
  const taken = palettes.map((p) => p.name);
  const name = await askName("New Script Palette", freeName("Script Palette", taken), taken, "Create");
  if (name === null) return null;
  const p: ScriptPalette = { name, scripts: [], open: true };
  palettes.push(p);
  save();
  showScriptPalette(p.name);
  return p;
}

/** The palette a new script goes in: the one given, the only one, or (with none) one made first. */
async function paletteFor(p?: ScriptPalette): Promise<ScriptPalette | null> {
  if (p) return p;
  if (palettes.length === 0) return newPalette();
  if (palettes.length === 1) return palettes[0];
  const select = h("select", { cls: "select", attrs: { "aria-label": "Script palette" } }, ...palettes.map((x, i) => h("option", { text: x.name, attrs: { translate: "no", value: String(i) } })));
  const i = await showDialog<number>({
    title: "Select Script Palette",
    okLabel: "Select",
    body: [field("Script palette", select)],
    check: () => ({ value: Number(select.value) }),
  });
  return i === null ? null : (palettes[i] ?? null);
}

async function newScript(into?: ScriptPalette, start?: Partial<Script>): Promise<void> {
  const p = await paletteFor(into);
  if (p) await editScript(p, null, start);
}

/** A .py, .vs or .px file read into a palette as a script, then shown in the Script Editor. */
function importScript(into?: ScriptPalette): void {
  const input = h("input", { attrs: { type: "file", accept: ".py,.vs,.px,.txt,text/x-python,text/plain" } });
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (!f) return;
    void f.text().then((code) => {
      const language: Language = /\.(vs|px)$/i.test(f.name) ? "vectorscript" : "python";
      return newScript(into, { name: f.name.replace(/\.[^.]*$/, "") || "Script", language, code });
    });
  });
  input.click();
}

function exportScript(s: Script): void {
  const url = URL.createObjectURL(new Blob([s.code], { type: "text/plain" }));
  h("a", { attrs: { href: url, download: fileName(s) } }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function scriptRows(p: ScriptPalette, s: Script): Row[] {
  return [
    { label: "Run", enabled: () => !!store.session, run: () => void runScriptOf(s) },
    { label: "Edit…", run: () => void editScript(p, s) },
    "-",
    {
      label: "Rename…",
      run: async () => {
        const name = await askName("Rename Script", s.name, p.scripts.filter((x) => x !== s).map((x) => x.name), "Rename");
        if (name === null) return;
        const at = p.scripts.indexOf(s);
        if (at >= 0) p.scripts[at] = { ...s, name };
        save();
      },
    },
    {
      label: "Duplicate",
      run: () => {
        p.scripts.splice(p.scripts.indexOf(s) + 1, 0, { ...s, name: freeName(s.name, p.scripts.map((x) => x.name)) });
        save();
      },
    },
    { label: "Export…", run: () => exportScript(s) },
    "-",
    {
      label: "Delete",
      run: async () => {
        if (!(await confirmDialog("Delete Script", `Delete the script ${s.name} from ${p.name}? This can't be undone.`, "Delete"))) return;
        p.scripts = p.scripts.filter((x) => x !== s);
        save();
      },
    },
  ];
}

function paletteRows(p: ScriptPalette): Row[] {
  return [
    { label: "New Script…", run: () => void newScript(p) },
    { label: "Import Script…", run: () => importScript(p) },
    "-",
    {
      label: "Rename Palette…",
      run: async () => {
        const name = await askName("Rename Script Palette", p.name, palettes.filter((x) => x !== p).map((x) => x.name), "Rename");
        if (name === null) return;
        p.name = name;
        save();
      },
    },
    {
      label: "Delete Palette",
      run: async () => {
        const n = p.scripts.length;
        const what = n ? ` and its ${n === 1 ? "script" : `${n} scripts`}` : "";
        if (!(await confirmDialog("Delete Script Palette", `Delete the script palette ${p.name}${what}? This can't be undone.`, "Delete"))) return;
        palettes = palettes.filter((x) => x !== p);
        save();
      },
    },
  ];
}

// ---- the palette ---------------------------------------------------------------------------------

const body = h("div", { cls: "sp-body" });

function render(): void {
  const add = h("button", { cls: "btn", text: "+ Script palette", title: "Make a script palette" });
  add.addEventListener("click", () => void newPalette());
  const list = h("div", { cls: "list" });
  body.replaceChildren(h("div", { cls: "toolbar" }, add), list);
  if (palettes.length === 0) {
    list.append(h("div", { cls: "empty", text: "No script palettes yet. Make one, then add Python scripts or Vectorscripts to run with a double-click." }));
    return;
  }
  for (const p of palettes) {
    const head = h(
      "button",
      { cls: "sp-head", attrs: { type: "button", "aria-expanded": String(p.open), "data-palette": p.name }, title: "Click to show or hide its scripts; right-click for more" },
      h("span", { cls: "sp-chevron", text: p.open ? "▾" : "▸" }),
      h("span", { cls: "sp-name", text: p.name }),
      h("span", { cls: "sp-count", text: String(p.scripts.length) }),
    );
    head.addEventListener("click", () => {
      p.open = !p.open;
      save();
    });
    head.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(paletteRows(p), e.clientX, e.clientY, head);
    });
    list.append(head);
    if (!p.open) continue;
    if (p.scripts.length === 0) {
      const none = h("button", { cls: "sp-none", text: "No scripts: + New script", attrs: { type: "button" } });
      none.addEventListener("click", () => void newScript(p));
      list.append(none);
    }
    for (const s of p.scripts) {
      const row = h(
        "div",
        { cls: "row sp-script", attrs: { tabindex: "0", role: "button", "aria-label": `Run ${s.name}` }, title: "Double-click (or Enter) to run on the drawing; right-click to edit" },
        h("span", { cls: "sp-lang", text: s.language === "vectorscript" ? "VS" : "Py" }),
        h("span", { cls: "name", text: s.name }),
      );
      row.addEventListener("dblclick", () => void runScriptOf(s));
      row.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        void runScriptOf(s);
      });
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openContextMenu(scriptRows(p, s), e.clientX, e.clientY, row);
      });
      list.append(row);
    }
  }
}

render();

// another tab's changes show here too
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  palettes = load();
  render();
});

/** The Script Palettes palette, as app/ext.ts registers it. */
export function scriptPalettesBody(): HTMLElement {
  return body;
}

/** Shows the Script Palettes palette with palette `name` open and in view. */
export function showScriptPalette(name: string): void {
  const p = palettes.find((x) => x.name === name);
  if (p && !p.open) {
    p.open = true;
    save();
  }
  appContext()?.palettes.show(SCRIPT_PALETTES);
  requestAnimationFrame(() => body.querySelector<HTMLElement>(`[data-palette="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" }));
}

/**
 * Keeps a script written for the user (Custom Selection's or Custom Modification's) in a script palette:
 * the one there is, one chosen, or a new one when there are none; asks for its name, then shows it.
 * False when cancelled.
 */
export async function addScript(language: Language, code: string, suggested: string): Promise<boolean> {
  const p = await paletteFor();
  if (!p) return false;
  const taken = p.scripts.map((s) => s.name);
  const name = await askName("Name Script", freeName(suggested, taken), taken);
  if (!name) return false;
  p.scripts.push({ name, language, code });
  save();
  showScriptPalette(p.name);
  toast(`${name} is in the script palette ${p.name}: double-click it to run it.`, "info");
  return true;
}

/** Window > Script Palettes: each palette, then New Script Palette…. */
export function scriptPaletteMenuRows(): Row[] {
  return [
    ...palettes.map((p): Row => ({ label: p.name, run: () => showScriptPalette(p.name) })),
    ...(palettes.length ? (["-"] as Row[]) : []),
    { label: "New Script Palette…", run: () => void newPalette() },
  ];
}

/** The palette's title-bar menu. */
export function scriptPalettesMenu(): Row[] {
  return [
    { label: "New Script Palette…", run: () => void newPalette() },
    { label: "New Script…", run: () => void newScript() },
    { label: "Import Script…", run: () => importScript() },
  ];
}
