// The plug-in host on the main thread: keeps the installed plug-ins, runs them
// (from the editor, or kept alive for their menu items and render engines), answers their calls
// (the pure ones through dispatch.ts; the window's, fetch and dialogs here), and
// keeps the Plug-ins menu's items. Nothing a plug-in sends is trusted: every call
// is checked against the API before it touches the drawing.

import type { AppContext } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { setActiveLayer, setSelection } from "../../app/commands.ts";
import { h } from "../../app/dom.ts";
import { showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import type { View } from "../../app/view.ts";
import { EXAMPLES } from "./examples.ts";
import { parseHeader, UNTITLED } from "./header.ts";
import { dispatch, type CallEnv, type Effects } from "./dispatch.ts";
import { deletePlugin, getMeta, listPlugins, newId, type PluginRecord, savePlugin, setMeta } from "./store.ts";
import { PluginWorker, type LogLevel, type Outcome, type PluginError } from "./worker.ts";
import { pluginEngine } from "./renderEngine.ts";
import { registerRenderEngine } from "../render/engines.ts";
import { progress, promptValues, showAlert } from "./ui.ts";

// ---- the editor, as the host reaches it -----------------------------------------

let appCtx: AppContext | null = null;

/** Called once the editor runs (from index.ts). */
export function attachEditor(ctx: AppContext): void {
  appCtx = ctx;
}

function currentView(): View | null {
  return appCtx?.view ?? null;
}

const effects: Effects = {
  select(ids) {
    const doc = store.session?.doc;
    if (!doc) return [];
    // the same rule the editor uses: objects on the active layer, directly in the group being edited
    const keep = ids.filter((id) => {
      const o = doc.object(id);
      return !!o && o.layerId === store.activeLayerId && o.parentId === store.editGroupId;
    });
    setSelection(keep);
    return keep;
  },
  zoomTo(box) {
    const view = currentView();
    if (!view) return;
    view.fit(box);
    store.emit("view");
  },
  setActiveLayer(id) {
    setActiveLayer(id);
  },
};

function callEnv(): CallEnv {
  return {
    session: store.session,
    activeLayerId: store.activeLayerId,
    selection: [...store.selection],
    effects,
  };
}

// ---- what a plug-in may reach origins for --------------------------------------

/** The origins a plug-in may reach, as the user has answered: true allowed, false refused, absent asked. */
export interface Grants {
  get(origin: string): boolean | undefined;
  set(origin: string, allowed: boolean): void;
}

/** Grants kept on a saved plug-in's record. */
export function grantsFor(rec: PluginRecord): Grants {
  return {
    get: (origin) => rec.grants[origin],
    set: (origin, allowed) => {
      rec.grants = { ...rec.grants, [origin]: allowed };
      savePlugin(rec).catch((err: unknown) => console.warn("openvwx: could not save a plug-in's grant", err));
    },
  };
}

/** Grants for a plug-in that is not saved (an editor's draft, the script console): kept until the page reloads. */
export function memoryGrants(): Grants {
  const map = new Map<string, boolean>();
  return {
    get: (origin) => map.get(origin),
    set: (origin, allowed) => {
      map.set(origin, allowed);
    },
  };
}

const asking = new Map<string, Promise<boolean>>();

async function mayReach(name: string, grants: Grants, origin: string): Promise<boolean> {
  const known = grants.get(origin);
  if (known !== undefined) return known;
  const key = name + "\n" + origin;
  let answer = asking.get(key);
  if (!answer) {
    answer = (async () => {
      const allowed = await showDialog<true>({
        title: `Allow ${name} to reach ${origin}?`,
        okLabel: "Allow",
        body: [
          h("p", {
            cls: "pi-note",
            text: "The request is sent without cookies, but the site sees your browser's address, as with any web request. Your answer is kept for this plug-in.",
          }),
        ],
        check: () => ({ value: true }),
      });
      const ok = allowed === true;
      grants.set(origin, ok);
      return ok;
    })().finally(() => asking.delete(key));
    asking.set(key, answer);
  }
  return answer;
}

/** openvwx.fetch: an http or https request sent from the page, on the plug-in's behalf. */
async function fetchFor(name: string, grants: Grants, url: unknown, init: unknown): Promise<unknown> {
  const text = typeof url === "string" ? url : String(url);
  let target: URL;
  try {
    target = new URL(text);
  } catch {
    throw new Error(`openvwx.fetch: "${text}" is not a web address.`);
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("openvwx.fetch reaches only http and https addresses.");
  if (!(await mayReach(name, grants, target.origin))) throw new Error(`Not allowed to reach ${target.origin}.`);
  const opts = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string | Uint8Array };
  const response = await fetch(target.href, {
    method: opts.method ?? "GET",
    headers: opts.headers,
    body: opts.body as BodyInit | undefined,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers,
    text: new TextDecoder().decode(bytes),
    bytes,
  };
}

/** Answers one call from a plug-in named `name`. */
export async function answer(name: string, grants: Grants, method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    case "fetch":
      return fetchFor(name, grants, args[0], args[1]);
    case "ui.toast":
      toast(String(args[0] ?? ""), "info");
      return undefined;
    case "ui.alert":
      await showAlert(String(args[0] ?? ""), String(args[1] ?? ""));
      return undefined;
    case "ui.prompt":
      return promptValues(String(args[0] ?? ""), args[1]);
    case "ui.progress":
      progress(typeof args[0] === "number" ? args[0] : null, typeof args[1] === "string" ? args[1] : "");
      return undefined;
    default:
      return dispatch(method, args, callEnv());
  }
}

// ---- running a plug-in ----------------------------------------------------------

/** Where a run's console output goes (the editor's console pane, or the page's console). */
export interface Sink {
  log(level: LogLevel, text: string, line: number | null): void;
}

export interface RunResult {
  readonly ok: boolean;
  /** Stop was pressed while it ran */
  readonly stopped: boolean;
  readonly error: PluginError | null;
  /** menu items the code added */
  readonly menuItems: number;
}

export interface RunHandle {
  readonly finished: Promise<RunResult>;
  stop(): void;
}

/** "name: message" for a log line; the line number goes separately. */
export function describe(err: PluginError): string {
  return `${err.name}: ${err.message}`;
}

/**
 * Runs `code` once in its own worker: its top level, then (with `invokeMenus`) each
 * menu item it added, in order. The worker is stopped when that is done.
 */
export function runPlugin(opts: { name: string; code: string; grants: Grants; sink: Sink; invokeMenus: boolean }): RunHandle {
  const menus: { id: string; label: string }[] = [];
  let stopped = false;
  const worker = new PluginWorker(opts.code, {
    call: (method, args) => answer(opts.name, opts.grants, method, args),
    log: (level, text, line) => opts.sink.log(level, text, line),
    menu: (id, label) => {
      menus.push({ id, label });
    },
    // a run from the editor ends with its worker: Render Image takes an engine from a plug-in that is turned on
    engine: (_id, spec) => {
      const name = spec && typeof spec === "object" && typeof (spec as { name?: unknown }).name === "string" ? (spec as { name: string }).name : "a render engine";
      opts.sink.log("log", `Added ${name}: Render Image lists it while the plug-in is turned on.`, null);
    },
    uncaught: (err) => opts.sink.log("error", describe(err), err.line),
  });
  const finished = (async (): Promise<RunResult> => {
    const start: Outcome = await worker.start();
    const fail = (error: PluginError | null, extra: Partial<RunResult> = {}): RunResult => ({
      ok: false,
      stopped,
      error,
      menuItems: menus.length,
      ...extra,
    });
    if (!start.ok) {
      worker.kill();
      if (start.error.name === "Stopped" || stopped) return fail(null, { stopped: true });
      opts.sink.log("error", describe(start.error), start.error.line);
      return fail(start.error);
    }
    if (opts.invokeMenus) {
      for (const item of [...menus]) {
        if (stopped) break;
        opts.sink.log("log", `Running menu item "${item.label}".`, null);
        const r = await worker.invoke(item.id);
        if (!r.ok && !stopped) {
          if (r.error.name === "Stopped") break;
          opts.sink.log("error", describe(r.error), r.error.line);
        }
      }
    }
    worker.kill();
    return { ok: true, stopped, error: null, menuItems: menus.length };
  })();
  return {
    finished,
    stop(): void {
      stopped = true;
      worker.kill();
    },
  };
}

// ---- installed plug-ins ----------------------------------------------------------

export interface MenuItem {
  readonly id: string;
  readonly label: string;
}

interface Active {
  readonly code: string;
  readonly worker: PluginWorker;
  readonly menus: MenuItem[];
  /** takes each render engine it added out of Render Image */
  readonly engines: (() => void)[];
  /** why it did not load, when it did not */
  error: PluginError | null;
}

const records = new Map<string, PluginRecord>();
const active = new Map<string, Active>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const fn of listeners) fn();
}

/** Calls `fn` when the installed plug-ins, or their menu items, change. */
export function onPluginsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Every installed plug-in, oldest first. */
export function installed(): PluginRecord[] {
  return [...records.values()].sort((a, b) => a.created - b.created);
}

/** What the Manager shows about an enabled plug-in: its menu items, or why it failed to load. */
export function activeState(id: string): { readonly menus: readonly MenuItem[]; readonly error: PluginError | null; readonly loaded: boolean } {
  const a = active.get(id);
  return { menus: a?.menus ?? [], error: a?.error ?? null, loaded: a !== undefined };
}

/**
 * Starts an enabled plug-in's code in its own worker, to collect the menu items and render engines
 * it adds. A worker with either is kept alive; one without is stopped at once.
 */
async function activate(rec: PluginRecord): Promise<void> {
  deactivate(rec.id);
  const menus: MenuItem[] = [];
  const engines: (() => void)[] = [];
  const grants = grantsFor(rec);
  const worker = new PluginWorker(rec.code, {
    call: (method, args) => answer(rec.name, grants, method, args),
    log: (level, text, line) => {
      const where = "[" + rec.name + (line ? " line " + line : "") + "] ";
      if (level === "error") console.error(where + text);
      else if (level === "warn") console.warn(where + text);
      else console.log(where + text);
    },
    menu: (id, label) => {
      if (!menus.some((m) => m.id === id)) menus.push({ id, label });
      changed();
    },
    engine: (id, spec) => {
      const engine = pluginEngine(rec.id, rec.name, id, spec, () => (active.get(rec.id) === entry ? worker : null));
      if (typeof engine === "string") {
        console.warn(`[${rec.name}] ${engine}`);
        return;
      }
      engines.push(registerRenderEngine(engine));
      changed();
    },
    uncaught: (err) => {
      console.warn("[" + rec.name + "] " + describe(err));
      toast(`${rec.name}${err.line ? ", line " + err.line : ""}: ${err.message}`);
    },
  });
  const entry: Active = { code: rec.code, worker, menus, engines, error: null };
  active.set(rec.id, entry);
  changed();
  const started = await worker.start();
  if (active.get(rec.id) !== entry) return; // disabled or changed while it started
  if (!started.ok) {
    entry.error = started.error;
    worker.kill();
    for (const drop of engines.splice(0)) drop();
  } else if (menus.length === 0 && engines.length === 0) {
    worker.kill();
  }
  changed();
}

function deactivate(id: string): void {
  const a = active.get(id);
  if (!a) return;
  active.delete(id);
  a.worker.kill();
  for (const drop of a.engines.splice(0)) drop();
  changed();
}

/** Runs a menu item of an enabled plug-in. */
export async function invokeMenuItem(pluginId: string, menuId: string): Promise<void> {
  const a = active.get(pluginId);
  const rec = records.get(pluginId);
  if (!a || !rec) return;
  const r = await a.worker.invoke(menuId);
  if (!r.ok && r.error.name !== "Stopped") {
    toast(`${rec.name}${r.error.line ? ", line " + r.error.line : ""}: ${r.error.message}`);
  }
}

/** The Plug-ins menu's rows for enabled plug-ins' menu items, read each time the menu opens. */
export function menuItemRows(): Row[] {
  const rows: Row[] = [];
  for (const rec of installed()) {
    const a = active.get(rec.id);
    if (!a || !rec.enabled) continue;
    for (const item of a.menus) rows.push({ label: item.label, run: () => void invokeMenuItem(rec.id, item.id) });
  }
  return rows;
}

/** Saves a plug-in (new or edited) and starts or stops it to match `enabled`. */
export async function savePluginRecord(rec: PluginRecord): Promise<void> {
  const header = parseHeader(rec.code);
  rec.name = header.name;
  rec.description = header.description;
  rec.version = header.version;
  rec.author = header.author;
  rec.updated = Date.now();
  records.set(rec.id, rec);
  await savePlugin(rec);
  if (!rec.enabled) deactivate(rec.id);
  // an enabled plug-in restarts only when its code changed
  else if (active.get(rec.id)?.code !== rec.code) await activate(rec);
  changed();
}

/** Turns a plug-in on or off. */
export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const rec = records.get(id);
  if (!rec) return;
  rec.enabled = enabled;
  await savePluginRecord(rec);
}

/** Deletes a plug-in and its stored code. */
export async function removePlugin(id: string): Promise<void> {
  deactivate(id);
  records.delete(id);
  await deletePlugin(id);
  changed();
}

/** A new plug-in from code (a new id; off until it is turned on). */
export function newRecord(code: string): PluginRecord {
  const now = Date.now();
  const header = parseHeader(code);
  return {
    id: newId(),
    code,
    enabled: false,
    name: header.name,
    description: header.description,
    version: header.version,
    author: header.author,
    created: now,
    updated: now,
    grants: {},
  };
}

/** Puts the examples on the page on the first run only, disabled. */
async function installExamples(): Promise<void> {
  if ((await getMeta("examples-installed")) === "1") return;
  for (const [i, ex] of EXAMPLES.entries()) {
    if (records.has(ex.id)) continue;
    const rec = { ...newRecord(ex.code), id: ex.id, created: Date.now() + i };
    await savePlugin(rec);
    records.set(rec.id, rec);
  }
  await setMeta("examples-installed", "1");
}

/** Reads the installed plug-ins and starts the enabled ones. Called once, when the editor is ready. */
export async function loadInstalled(): Promise<void> {
  try {
    for (const rec of await listPlugins()) records.set(rec.id, rec);
    await installExamples();
  } catch (err) {
    console.warn("openvwx: could not read the installed plug-ins", err);
  }
  changed();
  for (const rec of installed()) {
    if (rec.enabled) await activate(rec);
  }
}

/** Name of a plug-in's header, or the untitled name, for the Manager. */
export function displayName(rec: PluginRecord): string {
  return rec.name || UNTITLED;
}

/** Calls from a plug-in that is not saved (the editor's draft, the script console). */
export function draftCalls(name: string, grants: Grants): (method: string, args: unknown[]) => Promise<unknown> {
  return (method, args) => answer(name, grants, method, args);
}
