// Tool shortcuts: the key that picks each tool, which Window > Workspaces > Tool
// Shortcuts… changes, as Vectorworks' Workspace Editor does. A key is a letter,
// alone or with Shift. The defaults are openvwx's own (mostly Vectorworks');
// changes are kept in this browser (localStorage).

import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import type { ToolId } from "./state.ts";

const STORAGE_KEY = "openvwx.toolkeys.v1";
const SHIFT = "⇧";

/** Keys by tool: a lower-case letter, after ⇧ when Shift is held with it. */
type KeyMap = Partial<Record<ToolId, string>>;

const DEFAULT_KEYS: Readonly<KeyMap> = {
  select: "v",
  reshape: "⇧v",
  pan: "h",
  zoom: "⇧z",
  text: "t",
  line: "l",
  doubleline: "w",
  dlpolygon: "⇧w",
  rect: "r",
  roundrect: "⇧r",
  circle: "c",
  arc: "a",
  freehand: "u",
  polyline: "y",
  polygon: "p",
  // G over the drawing sets a datum, as Vectorworks keys it
  regpoly: "⇧g",
  oval: "b",
  spiral: "⇧s",
  mirror: "m",
  rotate: "o",
  moveby: "⇧m",
  eyedropper: "i",
  offset: "e",
  // F opens Quick Search, as Vectorworks keys it
  fillet: "⇧f",
  chamfer: "q",
  trim: "x",
  clip: "⇧x",
  split: "s",
  // J held while clicking selects among coincident objects, as Vectorworks keys it
  connect: "⇧j",
  dimension: "d",
  measure: "n",
  callout: "⇧c",
  cloud: "⇧l",
  symbol: "k",
};

const listeners = new Set<() => void>();
let keys: KeyMap = load();

function load(): KeyMap {
  try {
    return fromChanges(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

/** The keys that kept changes (tool id to key, "" for none) make of the defaults; bad entries are skipped. */
function fromChanges(raw: unknown): KeyMap {
  const out: KeyMap = { ...DEFAULT_KEYS };
  if (!raw || typeof raw !== "object") return out;
  for (const [id, key] of Object.entries(raw)) {
    if (!(id in DEFAULT_KEYS) || typeof key !== "string") continue;
    const parsed = parseKey(key);
    if (key === "") delete out[id as ToolId];
    else if (parsed) out[id as ToolId] = parsed;
  }
  return out;
}

/** How `next` differs from the defaults: tool id to key, "" for a tool left without one. */
function changesOf(next: KeyMap): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const id of Object.keys(DEFAULT_KEYS) as ToolId[]) {
    if ((next[id] ?? "") !== (DEFAULT_KEYS[id] ?? "")) changed[id] = next[id] ?? "";
  }
  return changed;
}

/** The tool keys changed from the defaults, as a workspace file keeps them. */
export function toolKeyChanges(): Record<string, string> {
  return changesOf(keys);
}

/** Takes the tool keys a workspace file kept (changes from the defaults; anything else is ignored). */
export function applyToolKeyChanges(raw: unknown): void {
  save(fromChanges(raw));
}

function save(next: KeyMap): void {
  keys = next;
  // only the changes are kept, so later defaults still reach tools left alone
  const changed = changesOf(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
  } catch {
    // storage blocked: the keys last for this visit only
  }
  for (const fn of listeners) fn();
}

/** A typed key ("R", "⇧R", "Shift+R", "shift r") as stored ("r", "⇧r"); null when it is not a letter. */
function parseKey(text: string): string | null {
  const m = /^\s*(?:(⇧|shift)\s*\+?\s*)?([a-z])\s*$/i.exec(text);
  return m ? `${m[1] ? SHIFT : ""}${m[2].toLowerCase()}` : null;
}

/** How a stored key reads: "V", "⇧R"; "" for none. */
function labelOf(key: string | undefined): string {
  return key ? key.toUpperCase() : "";
}

/** The key that picks `id`, as the toolbar shows it ("V", "⇧R"), or "" when it has none. */
export function toolKeyLabel(id: ToolId): string {
  return labelOf(keys[id]);
}

/** The tool a letter picks (with Shift or not), or null. */
export function toolForKey(letter: string, shift: boolean): ToolId | null {
  const key = `${shift ? SHIFT : ""}${letter.toLowerCase()}`;
  for (const [id, k] of Object.entries(keys)) if (k === key) return id as ToolId;
  return null;
}

/** Calls `fn` whenever the keys change. */
export function onToolKeys(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Window > Workspaces > Tool Shortcuts…: a key for each tool, checked for clashes. */
export async function toolKeysDialog(tools: readonly { readonly id: ToolId; readonly label: string }[]): Promise<void> {
  const inputs = tools.map((t) => {
    const input = h("input", {
      cls: "menu-dialog-input tk-input",
      value: toolKeyLabel(t.id),
      attrs: { type: "text", "aria-label": `${t.label} key`, spellcheck: "false", maxlength: "8" },
    });
    return { tool: t, input };
  });
  const restore = h("button", { cls: "btn small", text: "Restore Defaults", attrs: { type: "button" } });
  restore.addEventListener("click", () => {
    for (const { tool, input } of inputs) input.value = labelOf(DEFAULT_KEYS[tool.id]);
  });
  const next = await showDialog<KeyMap>({
    title: "Tool Shortcuts",
    okLabel: "OK",
    cls: "tk-dialog",
    body: [
      h("p", { cls: "muted", text: "A letter picks a tool; ⇧ in front (or Shift+) means with Shift. Leave a field empty for no key. Over the drawing, Z opens the Snap Loupe and G sets a datum; F opens Quick Search and J held while clicking picks among coincident objects." }),
      h(
        "div",
        { cls: "tk-list" },
        ...inputs.map(({ tool, input }) => h("label", { cls: "tk-row" }, h("span", { cls: "tk-label", text: tool.label }), input)),
      ),
      h("div", { cls: "tk-actions" }, restore),
    ],
    check: () => {
      const map: KeyMap = {};
      const owner = new Map<string, string>();
      for (const { tool, input } of inputs) {
        if (input.value.trim() === "") continue;
        const key = parseKey(input.value);
        if (!key) return { error: `${tool.label}: enter a letter, or ⇧ and a letter.`, focus: input };
        const other = owner.get(key);
        if (other) return { error: `${labelOf(key)} is the key of both ${other} and ${tool.label}.`, focus: input };
        owner.set(key, tool.label);
        map[tool.id] = key;
      }
      return { value: map };
    },
  });
  if (next) save(next);
}
