// Vectorworks plug-ins: Plug-ins > Vectorworks Plug-ins > Install… takes menu commands (.vsm),
// tools (.vst) and objects (.vso) made with Vectorworks' Plug-in Manager, whose script is Python or
// Vectorscript, with the Python files they import (chosen with them, or a zipped plug-in folder).
// Commands and tools are listed in that submenu and run on the drawing; objects are placed with the
// Plug-in Insertion tool and drawn again when Object Info changes them. An object whose script lays out
// Object Info itself (dividers, buttons, indents, greyed and hidden widgets) is shown that way. Plug-ins
// whose script its author encrypted, and those built with the SDK (.vlb), are refused: they can't be read.

import { appContext, preferPluginDriver, registerMenu, registerPluginDrivers, type PluginDriver, type PluginWidget, type PluginWidgetStates } from "../../app/ext.ts";
import { h } from "../../app/dom.ts";
import type { Row } from "../../app/menu.ts";
import { showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { isVwPlugin, objectShape, readVwPlugin, type VwPlugin } from "../../import/vwplugin.ts";
import { unzip } from "../../import/zip.ts";
import { showAlert } from "../plugins/ui.ts";
import type { PluginUi } from "../python/runner.ts";
import type { Installed } from "./run.ts";
import { listFiles, putFile, removeFile, type InstalledFile } from "./store.ts";
import "../plugins/plugins.css";

const KIND_LABEL: Readonly<Record<VwPlugin["kind"], string>> = { command: "menu command", tool: "tool", object: "object" };
const ACCEPT = ".vsm,.vst,.vso,.py,.zip";

let installed: Installed[] = [];

const runner = (): Promise<typeof import("./run.ts")> => import("./run.ts");

/** A stored file read; null (and left out) when it no longer reads. */
function readInstalled(f: InstalledFile): Installed | null {
  try {
    const plugin = readVwPlugin(f.bytes);
    return { id: f.id, file: f.file, plugin, modules: f.modules, shape: objectShape([plugin.script, ...Object.values(f.modules)]) };
  } catch {
    return null;
  }
}

async function load(): Promise<void> {
  try {
    installed = (await listFiles()).map(readInstalled).filter((x): x is Installed => x !== null);
  } catch (err) {
    console.warn("openvwx: Vectorworks plug-ins couldn't be read", err);
  }
  installed.sort((a, b) => a.plugin.name.localeCompare(b.plugin.name));
}

void load();

// ---- installing ---------------------------------------------------------------------------------

/** A path made safe to write under the plug-in's folder: no leading slash, no "." or ".." parts. */
function cleanPath(path: string): string | null {
  const parts = path.replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".");
  return parts.length && !parts.includes("..") ? parts.join("/") : null;
}

interface Picked {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** The files chosen, with a zip's entries in its place (its folders' "__MACOSX" copies left out). */
async function expand(files: readonly File[]): Promise<Picked[]> {
  const out: Picked[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!/\.zip$/i.test(f.name)) {
      out.push({ path: f.name, bytes });
      continue;
    }
    for (const [path, read] of unzip(bytes)) {
      if (path.endsWith("/") || path.startsWith("__MACOSX/") || /(^|\/)\._/.test(path)) continue;
      if (/\.(vsm|vst|vso|py)$/i.test(path)) out.push({ path, bytes: read() });
    }
  }
  return out;
}

/** Installs the plug-in files among `files`, each with the Python files beside it or under its folder. */
async function install(files: readonly File[]): Promise<void> {
  let picked: Picked[];
  try {
    picked = await expand(files);
  } catch (err) {
    await showAlert("Install Vectorworks Plug-ins", `Those files couldn't be read: ${errorMessage(err)}`);
    return;
  }
  const python = picked.filter((p) => /\.py$/i.test(p.path));
  const done: string[] = [];
  const refused: string[] = [];
  for (const p of picked) {
    if (/\.py$/i.test(p.path)) continue;
    const file = p.path.split("/").pop() ?? p.path;
    if (!isVwPlugin(p.bytes)) {
      refused.push(`${file}: not a Vectorworks plug-in file`);
      continue;
    }
    let plugin: VwPlugin;
    try {
      plugin = readVwPlugin(p.bytes);
    } catch (err) {
      refused.push(`${file}: ${errorMessage(err)}`);
      continue;
    }
    if (plugin.encrypted) {
      refused.push(`${plugin.name}: its author encrypted its script, so it can't be read or run`);
      continue;
    }
    // the Python files in its folder, by their path from there
    const folder = p.path.includes("/") ? p.path.slice(0, p.path.lastIndexOf("/") + 1) : "";
    const modules: Record<string, string> = {};
    for (const py of python) {
      if (!py.path.startsWith(folder)) continue;
      const path = cleanPath(py.path.slice(folder.length));
      if (path) modules[path] = new TextDecoder().decode(py.bytes);
    }
    try {
      await putFile({ id: `${plugin.kind}:${plugin.name}`, file, bytes: p.bytes, modules, installed: Date.now() });
      done.push(`${plugin.name} (${KIND_LABEL[plugin.kind]}, ${plugin.language === "python" ? "Python" : "Vectorscript"})`);
    } catch (err) {
      refused.push(`${plugin.name}: ${errorMessage(err)}`);
    }
  }
  await load();
  if (!done.length && !refused.length) {
    await showAlert("Install Vectorworks Plug-ins", "None of those files is a Vectorworks plug-in (.vsm, .vst or .vso, or a .zip holding them).");
    return;
  }
  const lines = [done.length ? `Installed: ${done.join("; ")}.` : "", refused.length ? `Not installed: ${refused.join("; ")}.` : ""];
  await showAlert("Install Vectorworks Plug-ins", lines.filter(Boolean).join("\n\n"));
}

function chooseFiles(): void {
  const input = h("input", { attrs: { type: "file", accept: ACCEPT, multiple: "" } });
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    if (files.length) void install(files);
  });
  input.click();
}

/** The installed plug-ins, each with Remove, and Install… for more. */
async function openManager(): Promise<void> {
  const list = h("div", { cls: "pi-list", attrs: { role: "list" } });
  const fill = (): void => {
    if (!installed.length) {
      list.replaceChildren(h("p", { cls: "pi-empty muted", text: "None installed. Install… takes .vsm, .vst and .vso files with the .py files they import, or a zipped plug-in folder." }));
      return;
    }
    list.replaceChildren(
      ...installed.map((it) => {
        const remove = h("button", { cls: "btn small", text: "Remove", attrs: { type: "button" } });
        remove.addEventListener("click", () => {
          void removeFile(it.id).then(load).then(fill);
        });
        const modules = Object.keys(it.modules).length;
        const meta = [KIND_LABEL[it.plugin.kind], it.plugin.language === "python" ? "Python" : "Vectorscript", it.plugin.category, modules ? `${modules} Python file${modules === 1 ? "" : "s"}` : ""];
        return h(
          "div",
          { cls: "pi-row", attrs: { role: "listitem" } },
          h(
            "div",
            { cls: "pi-row-main" },
            h("div", { cls: "pi-row-title" }, h("span", { cls: "pi-row-name", text: it.plugin.name }), h("span", { cls: "pi-row-meta muted", text: meta.filter(Boolean).join(" · ") })),
            h("div", { cls: "pi-row-desc muted", text: it.file }),
          ),
          h("div", { cls: "pi-row-actions" }, remove),
        );
      }),
    );
  };
  fill();
  const add = h("button", { cls: "btn small", text: "Install…", attrs: { type: "button" } });
  add.addEventListener("click", chooseFiles);
  await showDialog<true>({
    title: "Vectorworks Plug-ins",
    okLabel: "Done",
    cls: "pi-dialog",
    body: [
      h("p", { cls: "pi-note", text: "Plug-ins made with Vectorworks' Plug-in Manager, in Python or Vectorscript. They run in this browser, on the drawing in front; installed ones stay in this browser." }),
      list,
      h("div", { cls: "pi-manager-actions" }, add),
    ],
    check: () => ({ value: true }),
  });
}

// ---- menus and the insertion tool -------------------------------------------------------------------

/** A command or tool runs; an object makes the Plug-in Insertion tool place it. */
function row(it: Installed): Row {
  if (it.plugin.kind !== "object") {
    return { label: it.plugin.name, enabled: () => !!store.session, run: () => void runner().then((m) => m.runCommand(it)) };
  }
  return {
    label: `${it.plugin.name}…`,
    enabled: () => !!store.session,
    run: () => {
      preferPluginDriver(it.plugin.name);
      appContext()?.setTool("plugin");
    },
  };
}

registerMenu(
  "Plug-ins",
  () => [
    {
      label: "Vectorworks Plug-ins",
      items: () => [
        ...installed.map(row),
        ...(installed.length ? ["-" as const] : []),
        { label: "Install…", run: chooseFiles },
        { label: "Manage…", run: () => void openManager() },
      ],
    },
  ],
  { after: "Run Script…" },
);

// ---- its own Object Info layout ---------------------------------------------------------------------

/** Vectorworks' widget types (vsoAddWidget's) that Object Info shows; fields not bound to a parameter are left out. */
const WIDGET_KINDS: Readonly<Record<number, PluginWidget["kind"]>> = { 12: "button", 13: "text", 14: "divider", 100: "divider" };
/** SetObjPropVS's properties: the plug-in lays out Object Info itself, and greys and hides its widgets per object */
const HAS_UI_OVERRIDE = "8";
const HAS_WIDGET_VISIBILITIES = "12";

interface Layout {
  readonly widgets: readonly PluginWidget[] | null;
  /** whether its script greys and hides widgets for each object (a run per object's values) */
  readonly prepares: boolean;
  /** the states it set up with */
  readonly initial: PluginWidgetStates;
}

const NO_LAYOUT: Layout = { widgets: null, prepares: false, initial: new Map() };
const layouts = new WeakMap<Installed, Layout | Promise<Layout>>();
/** each object's widget states, by plug-in (as installed) and object, with the values they are for */
const prepared = new WeakMap<Installed, Map<string, { readonly values: string; readonly states: PluginWidgetStates }>>();
/** the runs working them out, by plug-in, object and values */
const preparing = new Map<string, Promise<PluginWidgetStates | null>>();

/** Whether its script handles events and adds widgets, so that running it to set up a layout is worth it. */
function addsWidgets(it: Installed): boolean {
  const text = [it.plugin.script, ...Object.values(it.modules)].join("\n");
  return /\bvsoGetEventInfo\b/i.test(text) && /\bvso(Add|Append)\w*Widget\b|\bvsoInsertAllParams\b/i.test(text);
}

function statesOf(raw: PluginUi["states"]): PluginWidgetStates {
  return new Map(Object.entries(raw).map(([id, st]) => [Number(id), { enabled: st.enabled !== false, visible: st.visible !== false }]));
}

function sameStates(a: PluginWidgetStates, b: PluginWidgetStates): boolean {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].every((k) => (a.get(k)?.enabled ?? true) === (b.get(k)?.enabled ?? true) && (a.get(k)?.visible ?? true) === (b.get(k)?.visible ?? true));
}

/** The layout its script set up: only when it says it lays out Object Info itself, and adds something. */
function toLayout(it: Installed, ui: PluginUi | null): Layout {
  if (!ui?.props[HAS_UI_OVERRIDE]) return NO_LAYOUT;
  const widgets: PluginWidget[] = [];
  for (const w of ui.widgets) {
    if (w.all) {
      // vsoInsertAllParams: each parameter, numbered from 1
      it.plugin.params.forEach((p, i) => widgets.push({ id: i + 1, kind: "param", field: p.name, label: "", level: w.level }));
    } else if (w.param !== undefined) {
      widgets.push({ id: w.id ?? 0, kind: "param", field: w.param, label: w.label ?? "", level: w.level });
    } else {
      const kind = WIDGET_KINDS[w.type ?? -1];
      if (kind) widgets.push({ id: w.id ?? 0, kind, label: w.label ?? "", level: w.level });
    }
  }
  if (!widgets.length) return NO_LAYOUT;
  return { widgets, prepares: ui.props[HAS_WIDGET_VISIBILITIES] === true, initial: statesOf(ui.states) };
}

/** Its layout when known; undefined while its script sets it up, with `ready` called once it has. */
function layoutOf(it: Installed, ready: () => void): Layout | undefined {
  let known = layouts.get(it);
  if (!known) {
    if (!addsWidgets(it)) known = NO_LAYOUT;
    else {
      const setUp = runner()
        .then((m) => m.setUpLayout(it))
        .then((ui) => toLayout(it, ui), () => NO_LAYOUT);
      void setUp.then((l) => layouts.set(it, l));
      known = setUp;
    }
    layouts.set(it, known);
  }
  if (!(known instanceof Promise)) return known;
  void known.then(ready);
  return undefined;
}

/** The object's values, as the key its widget states are kept under. */
function valuesKey(it: Installed, id: string): string {
  const own = store.session?.doc.records(id).find((r) => r.name === it.plugin.name);
  return JSON.stringify(own?.fields.map((f) => [f.name, f.value]) ?? null);
}

function widgetStates(it: Installed, id: string, apply: (states: PluginWidgetStates) => void): void {
  const l = layouts.get(it);
  if (!l || l instanceof Promise || !l.widgets) return;
  let byObject = prepared.get(it);
  if (!byObject) prepared.set(it, (byObject = new Map()));
  const known = byObject.get(id);
  const now = known?.states ?? l.initial;
  apply(now);
  if (!l.prepares) return;
  const values = valuesKey(it, id);
  if (known?.values === values) return;
  const run = `${it.id}\n${id}\n${values}`;
  let next = preparing.get(run);
  if (!next) {
    next = runner()
      .then((m) => m.prepareWidgets(it, id))
      .then((raw) => (raw ? statesOf(raw) : null), () => null);
    preparing.set(run, next);
    void next.then((states) => {
      preparing.delete(run);
      if (states) byObject.set(id, { values, states });
    });
  }
  void next.then((states) => {
    if (states && !sameStates(states, now)) apply(states);
  });
}

function driver(it: Installed): PluginDriver {
  const param = (field: string) => it.plugin.params.find((p) => p.name === field);
  return {
    name: it.plugin.name,
    shape: it.shape === "path" ? "point" : it.shape,
    label: (field) => {
      const p = param(field);
      return p && p.label !== p.name ? p.label : undefined;
    },
    readOnly: (field) => param(field)?.kind === "static",
    choices: (field) => {
      const p = param(field);
      return p && (p.kind === "popup" || p.kind === "radio") ? p.choices : undefined;
    },
    place: (layer, at, angle, size) => void runner().then((m) => m.placeObject(it, layer, at, angle, size)).catch((err) => toast(errorMessage(err))),
    edit: (id, values) => void runner().then((m) => m.editObject(it, id, values)).catch((err) => toast(errorMessage(err))),
    reset: (id) => runner().then((m) => m.resetObject(it, id)).catch((err: unknown) => errorMessage(err)),
    layout: (ready) => {
      const l = layoutOf(it, ready);
      return l === undefined ? undefined : l.widgets;
    },
    widgetStates: (id, apply) => widgetStates(it, id, apply),
    press: (id, widget) => void runner().then((m) => m.pressButton(it, id, widget)).catch((err) => toast(errorMessage(err))),
  };
}

registerPluginDrivers(() => installed.filter((it) => it.plugin.kind === "object").map(driver));
