// What Search Everything can pick: menu commands, tools, Quick Preferences, palettes,
// layers, classes, saved views, symbol definitions and objects. Each is an Item with a group, its
// text, an icon, what picking it does and, for a symbol or a class, the target
// Find Usages looks for (⌘Enter). Objects are scored as they are scanned, with a cap
// on the hits.

import type { ObjectInfo, VwxDocument } from "../../core/index.ts";
import type { AppContext } from "../../app/ext.ts";
import { setActiveClass, setActiveLayer } from "../../app/commands.ts";
import { TOOL_ICON, UI_ICON } from "../../app/icons.ts";
import { QUICK_PREFS } from "../../app/quickPrefs.ts";
import { shortcutText, type Row } from "../../app/menu.ts";
import { allMenus } from "../../app/menubar.ts";
import { savedViews } from "../../app/panels/views.ts";
import { store } from "../../app/state.ts";
import { allTools } from "../../app/toolbar.ts";
import { toolKeyLabel } from "../../app/toolKeys.ts";
import { fuzzyMatch } from "./fuzzy.ts";
import { isDerivedId, kindName, labelOf, namesOf, textOf, type Names } from "./describe.ts";
import { COMMAND_ICON, GROUP_ICON, PALETTE_ICON, QUERY_ICON, SYMBOL_ICON } from "./glyphs.ts";
import { revealObject } from "./select.ts";
import type { UsageTarget } from "./usages.ts";

export type GroupName = "Recent" | "Commands" | "Tools" | "Quick Preferences" | "Palettes" | "Layers" | "Classes" | "Saved Views" | "Symbols" | "Objects";

/** The order the groups are listed in. */
export const GROUP_ORDER: readonly GroupName[] = ["Recent", "Commands", "Tools", "Quick Preferences", "Palettes", "Layers", "Classes", "Saved Views", "Symbols", "Objects"];

/** Groups an empty query does not list: they are long, and a query is what finds in them. */
export const BROWSE_GROUPS: ReadonlySet<GroupName> = new Set<GroupName>(["Symbols", "Objects"]);

export interface Item {
  /** a stable key, which the recent picks keep */
  readonly id: string;
  readonly group: GroupName;
  readonly label: string;
  readonly detail: string;
  /** the shortcut as the menus show it, e.g. "⇧⌘K" */
  readonly keys?: string;
  /** trusted static markup */
  readonly icon: string;
  readonly run: () => void;
  /** what Find Usages looks up for ⌘Enter, when it applies */
  readonly usage?: UsageTarget;
  /** a Quick Preference: whether it is on; picking it turns it over and leaves the palette open */
  readonly checked?: () => boolean;
}

/** An item and how well it matched the query. */
export interface Scored {
  readonly item: Item;
  readonly score: number;
  /** ranges of the label the query matched, for highlighting */
  readonly ranges: readonly (readonly [number, number])[];
}

/** Submenus that list files, drawings or commands already listed, rather than commands of their own. */
const LIST_MENUS: ReadonlySet<string> = new Set(["File › Open Recent", "Edit › Recent Commands", "Window › Drawings"]);

/** Every enabled menu command with a run, as "Menu › Item" with its shortcut. Submenus are read as they stand, those built as they open too. */
export function commandItems(): Item[] {
  const out: Item[] = [];
  const walk = (prefix: string, rows: readonly Row[]): void => {
    for (const row of rows) {
      if (row === "-") continue;
      const path = `${prefix} › ${row.label}`;
      if (row.items) {
        if (LIST_MENUS.has(path) || (row.enabled && !row.enabled())) continue;
        let sub: readonly Row[];
        try {
          sub = typeof row.items === "function" ? row.items() : row.items;
        } catch {
          continue;
        }
        walk(path, sub);
        continue;
      }
      if (!row.run || (row.enabled && !row.enabled())) continue;
      out.push({
        id: `cmd:${path}`,
        group: "Commands",
        label: path,
        detail: "",
        ...(row.keys ? { keys: shortcutText(row.keys) } : {}),
        icon: COMMAND_ICON,
        run: row.run,
      });
    }
  };
  for (const menu of allMenus()) walk(menu.title, menu.rows);
  return out;
}

export function toolItems(ctx: AppContext): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const t of allTools()) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const key = toolKeyLabel(t.id);
    out.push({
      id: `tool:${t.id}`,
      group: "Tools",
      label: t.label,
      detail: key ? `Tool · ${key}` : "Tool",
      icon: TOOL_ICON[t.id],
      run: () => ctx.setTool(t.id),
    });
  }
  return out;
}

/** Every Quick Preference, listed in the View bar's pop-up or not, each a switch. */
export function prefItems(): Item[] {
  return QUICK_PREFS.map((p) => ({
    id: `pref:${p.id}`,
    group: "Quick Preferences",
    label: p.label,
    detail: "Quick preference",
    icon: UI_ICON.quickPrefs,
    run: () => p.set(!p.on()),
    checked: () => p.on(),
  }));
}

export function paletteItems(ctx: AppContext): Item[] {
  return ctx.palettes.entries().map((p) => ({
    id: `palette:${p.id}`,
    group: "Palettes",
    label: p.name,
    detail: "Palette · show",
    icon: PALETTE_ICON,
    run: () => ctx.palettes.reveal(p.id),
  }));
}

export function layerItems(doc: VwxDocument): Item[] {
  return doc.layers().map((l) => ({
    id: `layer:${l.id}`,
    group: "Layers",
    label: l.title ? `${l.name} · ${l.title}` : l.name,
    detail: `${l.kind === "sheet" ? "Sheet layer" : `Design layer · 1:${l.scale}`} · ${l.objectCount} objects`,
    icon: UI_ICON.layers,
    run: () => setActiveLayer(l.id),
  }));
}

export function classItems(doc: VwxDocument): Item[] {
  return doc.classes().map((c) => {
    const name = c.name || "None";
    return {
      id: `class:${c.index}`,
      group: "Classes",
      label: name,
      detail: `Class · ${c.objectCount} objects`,
      icon: UI_ICON.classes,
      run: () => setActiveClass(c.index),
      usage: { kind: "class", index: c.index, name },
    };
  });
}

export function viewItems(): Item[] {
  const views = savedViews();
  if (!views) return [];
  return views.names().map((name, i) => ({
    id: `view:${name}`,
    group: "Saved Views",
    label: name,
    detail: "Saved view",
    icon: UI_ICON.savedViews,
    run: () => savedViews()?.open(i),
  }));
}

export function symbolItems(ctx: AppContext, doc: VwxDocument): Item[] {
  return doc.symbolDefs().map((s) => ({
    id: `symbol:${s.index}`,
    group: "Symbols",
    label: s.name,
    detail: s.folder ? `Symbol · ${s.folder}` : "Symbol",
    icon: SYMBOL_ICON,
    run: () => {
      // as the Resources palette chooses a symbol for the Symbol tool
      store.activeSymbol = s.index;
      store.emit("symbol");
      ctx.setTool("symbol");
    },
    usage: { kind: "symbol", index: s.index, name: s.name },
  }));
}

/** The items of every group but Objects, which are searched as the query is typed. */
export function staticItems(ctx: AppContext): Item[] {
  const doc = store.session?.doc ?? null;
  return [
    ...commandItems(),
    ...toolItems(ctx),
    ...prefItems(),
    ...paletteItems(ctx),
    ...(doc ? layerItems(doc) : []),
    ...(doc ? classItems(doc) : []),
    ...viewItems(),
    ...(doc ? symbolItems(ctx, doc) : []),
  ];
}

/** An object as an item: picking it reveals it (select, activate its layer, zoom). */
export function objectItem(ctx: AppContext, names: Names, o: ObjectInfo): Item {
  const layer = names.layers.get(o.layerId) ?? "";
  return {
    id: `object:${o.id}`,
    group: "Objects",
    label: labelOf(o, names),
    detail: `${kindName(o)} · ${o.className || "None"} · ${layer}`,
    icon: objectIcon(o),
    run: () => revealObject(ctx, o.id),
  };
}

function objectIcon(o: ObjectInfo): string {
  switch (o.kind) {
    case "line":
      return TOOL_ICON.line;
    case "rect":
      return TOOL_ICON.rect;
    case "polygon":
      return TOOL_ICON.polygon;
    case "polyline":
      return TOOL_ICON.polyline;
    case "arc":
      return TOOL_ICON.circle;
    case "text":
      return TOOL_ICON.text;
    case "group":
      return GROUP_ICON;
    case "symbol":
      return SYMBOL_ICON;
    default:
      return QUERY_ICON;
  }
}

/** Fuzzy match of an item: its label, or its detail at half weight. */
export function scoreItem(query: string, item: Item): Scored | null {
  const label = fuzzyMatch(query, item.label);
  const detail = item.detail ? fuzzyMatch(query, item.detail) : null;
  if (!label && !detail) return null;
  const detailScore = detail ? detail.score * 0.5 : -Infinity;
  if (label && label.score >= detailScore) return { item, score: label.score, ranges: label.ranges };
  return { item, score: detailScore, ranges: [] };
}

/**
 * The objects a query matches, best first, at most `limit`: by name (or what they are called),
 * text content, kind, class and layer. Parts of symbol instances are not searched (their instance is).
 */
export function objectSearch(ctx: AppContext, doc: VwxDocument, query: string, limit: number): Scored[] {
  const names = namesOf(doc);
  const out: Scored[] = [];
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      if (isDerivedId(o.id)) continue;
      const label = labelOf(o, names);
      const best = fuzzyMatch(query, label);
      let score = best ? best.score : -Infinity;
      let ranges: readonly (readonly [number, number])[] = best ? best.ranges : [];
      const text = textOf(o);
      if (text && text !== label) {
        const m = fuzzyMatch(query, text);
        if (m && m.score * 0.8 > score) {
          score = m.score * 0.8;
          ranges = [];
        }
      }
      const cls = fuzzyMatch(query, o.className || "None");
      if (cls && cls.score * 0.6 > score) {
        score = cls.score * 0.6;
        ranges = [];
      }
      const lay = fuzzyMatch(query, names.layers.get(o.layerId) ?? "");
      if (lay && lay.score * 0.5 > score) {
        score = lay.score * 0.5;
        ranges = [];
      }
      const kind = fuzzyMatch(query, kindName(o));
      if (kind && kind.score * 0.5 > score) {
        score = kind.score * 0.5;
        ranges = [];
      }
      if (score === -Infinity) continue;
      out.push({ item: objectItem(ctx, names, o), score, ranges });
      if (out.length >= limit * 4) break;
    }
    if (out.length >= limit * 4) break;
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
