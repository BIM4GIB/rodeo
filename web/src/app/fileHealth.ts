// Tools > Check File Health…: the tests of Vectorworks' File Health Check that Rodeo can run, each
// with the limit it is run at (kept in this browser): objects far from the internal origin, outlying
// objects that make the drawing's extent large, polygons with many vertices, symbols drawn
// transparent, groups of many 3D polygons, hatches of many levels, large texture images, a long
// colour table, and Class Options set to Show Others. Run Selected or Run All lists what fails, by
// test; the issues ticked are located (selected and zoomed to, a hatch opened in its editor),
// deleted, or resolved where Rodeo can (Simplify Polys on the polygons; the class option set back).
// The results stay while the drawing is open, each issue checked again when the dialog reopens, so
// the ones put right show as resolved. Vectorworks' tests of connected-line 3D geometry, sweep
// increments, corrupted plug-ins, cropped perspectives, legacy options and symbol sizes need what
// Rodeo doesn't read, so they aren't offered.

import "./fileHealth.css";
import type { ObjectInfo } from "../core/index.ts";
import { attempt, setActiveLayer, setEditGroup, setSelection, zoomToSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { editHatch } from "./hatchEditor.ts";
import { showDialog } from "./menubar.ts";
import type { Scene } from "./scene.ts";
import { simplifyPolysDialog } from "./simplifyPolys.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLength, formatLengthValue, lengthSuffix, millimetresPerUnit, parseLength } from "./units.ts";
import type { View } from "./view.ts";

const STORAGE_KEY = "openvwx.filehealth.v1";
/** Vectorworks' polygon, polyline and 3D polygon object types */
const POLY_TYPES = new Set([5, 21, 25]);
const POLY3D_TYPE = 25;

/** What an issue is about: an object, a hatch or texture resource, or the drawing as a whole. */
type Target =
  | { readonly kind: "object"; readonly id: string; readonly layerId: string }
  | { readonly kind: "hatch"; readonly index: number }
  | { readonly kind: "texture" }
  | { readonly kind: "drawing" };

interface Issue {
  readonly test: TestKey;
  readonly target: Target;
  /** what it is: "Polygon on Design Layer-1" */
  readonly label: string;
  /** why it failed: "2,400 vertices" */
  readonly detail: string;
  /** true while it still fails the test at the limit it was run at */
  readonly still: () => boolean;
}

type TestKey = "farOrigin" | "largeBox" | "vertices" | "transparentSymbols" | "polys3dInGroups" | "hatchLevels" | "textureSize" | "colours" | "classOptions";

interface Limit {
  readonly label: string;
  readonly unit: "length" | "count" | "px";
  readonly fallback: number;
  /** the default in a drawing in inches, feet or miles, where the metric one reads oddly */
  readonly imperial?: number;
  readonly min: number;
}

interface Test {
  readonly key: TestKey;
  readonly name: string;
  readonly about: string;
  readonly limit?: Limit;
  /** the issues at limit `n` (mm, a count or pixels) */
  readonly run: (cx: Context, n: number) => Issue[];
  /** what Auto-Resolve does for it */
  readonly fix?: "simplify" | "classOptions";
}

interface Context {
  readonly scene: Scene;
  /** every object of every layer, groups expanded, with its layer's name */
  readonly objects: readonly { readonly obj: ObjectInfo; readonly layer: string; readonly design: boolean }[];
}

function counted(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function objectLabel(obj: ObjectInfo, layer: string): string {
  const type = obj.typeName.charAt(0).toUpperCase() + obj.typeName.slice(1);
  return `${obj.name ? `${type} “${obj.name}”` : type} on ${layer}`;
}

/** The object with `id`, if it is still in the drawing. */
function live(id: string): ObjectInfo | null {
  return store.session?.doc.object(id) ?? null;
}

function contextOf(scene: Scene): Context {
  const objects: Context["objects"][number][] = [];
  for (const l of scene.layers()) {
    for (const obj of scene.index(l.id).objects) objects.push({ obj, layer: l.name, design: l.kind === "design" });
  }
  return { scene, objects };
}

/** The design layers' top-level objects with their bounds (and everything in them). */
function topBoxes(scene: Scene): { id: string; layerId: string; layer: string; box: { x0: number; y0: number; x1: number; y1: number } }[] {
  return scene
    .layers()
    .filter((l) => l.kind === "design")
    .flatMap((l) => scene.topLevelEntries(l.id).flatMap((e) => (e.bbox ? [{ id: e.id, layerId: l.id, layer: l.name, box: e.bbox }] : [])));
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function vertexCount(obj: ObjectInfo): number {
  return obj.shape ? (obj.shape.vertices?.length ?? obj.shape.points.length) : 0;
}

function units(): string | undefined {
  return store.session?.doc.info.units;
}

const TESTS: readonly Test[] = [
  {
    key: "farOrigin",
    name: "Bounding Box Far from Origin",
    about: "Objects on design layers reaching farther than this from the internal origin along X or Y, where drawing loses accuracy.",
    limit: { label: "Maximum distance", unit: "length", fallback: 10_000_000, imperial: 30_000 * 304.8, min: 1 },
    run: (cx, max) => {
      const scene = cx.scene;
      return topBoxes(scene).flatMap(({ id, layerId, layer, box }) => {
        const far = (b: typeof box): number => Math.max(Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.y0), Math.abs(b.y1));
        const reach = far(box);
        const obj = live(id);
        if (reach <= max || !obj) return [];
        return [
          {
            test: "farOrigin",
            target: { kind: "object", id, layerId },
            label: objectLabel(obj, layer),
            detail: `${formatLength(reach, units())} from the origin`,
            still: () => {
              const e = live(id) && scene.topLevelEntries(layerId).find((t) => t.id === id);
              return !!e && !!e.bbox && far(e.bbox) > max;
            },
          },
        ];
      });
    },
  },
  {
    key: "largeBox",
    name: "Large Bounding Box",
    about:
      "When the design layers' objects together span more than this, the objects lying outside a square this size around the middle of the rest: often ones placed or moved there by accident.",
    limit: { label: "Maximum size", unit: "length", fallback: 5_000_000, imperial: 15_000 * 304.8, min: 1 },
    run: (cx, max) => {
      const scene = cx.scene;
      const all = topBoxes(scene);
      if (!all.length) return [];
      const x0 = Math.min(...all.map((a) => a.box.x0));
      const x1 = Math.max(...all.map((a) => a.box.x1));
      const y0 = Math.min(...all.map((a) => a.box.y0));
      const y1 = Math.max(...all.map((a) => a.box.y1));
      if (x1 - x0 <= max && y1 - y0 <= max) return [];
      // the square around the middle of most objects; what lies outside it makes the extent large
      const cx0 = median(all.map((a) => (a.box.x0 + a.box.x1) / 2));
      const cy0 = median(all.map((a) => (a.box.y0 + a.box.y1) / 2));
      const outside = (b: { x0: number; y0: number; x1: number; y1: number }): boolean =>
        b.x0 < cx0 - max / 2 || b.x1 > cx0 + max / 2 || b.y0 < cy0 - max / 2 || b.y1 > cy0 + max / 2;
      return all.flatMap(({ id, layerId, layer, box }) => {
        const obj = live(id);
        if (!obj || !outside(box)) return [];
        const away = Math.hypot((box.x0 + box.x1) / 2 - cx0, (box.y0 + box.y1) / 2 - cy0);
        return [
          {
            test: "largeBox",
            target: { kind: "object", id, layerId },
            label: objectLabel(obj, layer),
            detail: `${formatLength(away, units())} from the middle of the drawing`,
            still: () => {
              const e = live(id) && scene.topLevelEntries(layerId).find((t) => t.id === id);
              return !!e && !!e.bbox && outside(e.bbox);
            },
          },
        ];
      });
    },
  },
  {
    key: "vertices",
    name: "Polygons with High Vertex Count",
    about: "Polygons, polylines and 3D polygons with more vertices than this, which are slow to draw, snap to and edit. Auto-Resolve opens Simplify Polys on them.",
    limit: { label: "Maximum vertices", unit: "count", fallback: 2000, min: 3 },
    fix: "simplify",
    run: (cx, max) =>
      cx.objects.flatMap(({ obj, layer }) => {
        const n = POLY_TYPES.has(obj.type) ? vertexCount(obj) : 0;
        if (n <= max) return [];
        return [
          {
            test: "vertices",
            target: { kind: "object", id: obj.id, layerId: obj.layerId },
            label: objectLabel(obj, layer),
            detail: counted(n, "vertex", "vertices"),
            still: () => {
              const o = live(obj.id);
              return !!o && vertexCount(o) > max;
            },
          },
        ];
      }),
  },
  {
    key: "transparentSymbols",
    name: "Transparent 2D Symbols",
    about: "Symbol instances drawn at less than full opacity, which every redraw has to blend.",
    run: (cx) =>
      cx.objects.flatMap(({ obj, layer }) => {
        const faded = (o: ObjectInfo): number | null => {
          const a = o.kind === "symbol" ? o.attrs : null;
          return a && (a.fillOpacity < 100 || a.penOpacity < 100) ? Math.min(a.fillOpacity, a.penOpacity) : null;
        };
        const opacity = faded(obj);
        if (opacity === null) return [];
        return [
          {
            test: "transparentSymbols",
            target: { kind: "object", id: obj.id, layerId: obj.layerId },
            label: objectLabel(obj, layer),
            detail: `${Math.round(opacity)}% opacity`,
            still: () => {
              const o = live(obj.id);
              return !!o && faded(o) !== null;
            },
          },
        ];
      }),
  },
  {
    key: "polys3dInGroups",
    name: "3D Polygons in Groups",
    about: "Groups holding more 3D polygons than this (in groups inside them too), which are slow to draw and render.",
    limit: { label: "Maximum 3D polygons", unit: "count", fallback: 1000, min: 1 },
    run: (cx, max) => {
      const scene = cx.scene;
      const polysIn = (o: ObjectInfo): number => {
        let n = 0;
        const stack = [...(scene.index(o.layerId).children.get(o.id) ?? [])];
        for (let c = stack.pop(); c !== undefined; c = stack.pop()) {
          if (c.type === POLY3D_TYPE) n++;
          stack.push(...(scene.index(c.layerId).children.get(c.id) ?? []));
        }
        return n;
      };
      return cx.objects.flatMap(({ obj, layer }) => {
        // the outermost group only, so a group's 3D polygons aren't counted again for the one around it
        const parent = obj.parentId ? live(obj.parentId) : null;
        if (obj.kind !== "group" || parent?.kind === "group") return [];
        const n = polysIn(obj);
        if (n <= max) return [];
        return [
          {
            test: "polys3dInGroups",
            target: { kind: "object", id: obj.id, layerId: obj.layerId },
            label: objectLabel(obj, layer),
            detail: counted(n, "3D polygon"),
            still: () => {
              const o = live(obj.id);
              return !!o && polysIn(o) > max;
            },
          },
        ];
      });
    },
  },
  {
    key: "hatchLevels",
    name: "Hatch Complexity",
    about: "Hatches with more levels than this, each level a family of lines every fill draws. Locate opens the hatch in its editor.",
    limit: { label: "Maximum levels", unit: "count", fallback: 16, min: 1 },
    run: (_cx, max) => {
      const doc = store.session?.doc;
      const levels = (index: number): number => doc?.resources().find((r) => r.kind === "hatch" && r.index === index)?.hatch?.lines.length ?? 0;
      return (doc?.resources() ?? []).flatMap((r) => {
        const n = r.kind === "hatch" ? (r.hatch?.lines.length ?? 0) : 0;
        if (n <= max) return [];
        return [
          {
            test: "hatchLevels",
            target: { kind: "hatch", index: r.index },
            label: `Hatch “${r.name}”`,
            detail: counted(n, "level"),
            still: () => levels(r.index) > max,
          },
        ];
      });
    },
  },
  {
    key: "textureSize",
    name: "Texture Size",
    about: "Textures whose image is wider or taller than this, which are slow to render and make the file large.",
    limit: { label: "Maximum width or height", unit: "px", fallback: 4096, min: 16 },
    run: (_cx, max) => {
      const doc = store.session?.doc;
      const size = (index: number): { width: number; height: number } | undefined =>
        doc?.resources().find((r) => r.kind === "texture" && r.index === index)?.imagePixels;
      return (doc?.resources() ?? []).flatMap((r) => {
        const px = r.kind === "texture" ? r.imagePixels : undefined;
        if (!px || Math.max(px.width, px.height) <= max) return [];
        return [
          {
            test: "textureSize",
            target: { kind: "texture" },
            label: `Texture “${r.name}”`,
            detail: `${px.width.toLocaleString()} × ${px.height.toLocaleString()} px`,
            still: () => {
              const now = size(r.index);
              return !!now && Math.max(now.width, now.height) > max;
            },
          },
        ];
      });
    },
  },
  {
    key: "colours",
    name: "Too Many Document Colors",
    about: "A colour table with more colours than this, nearing the 32,768 a Vectorworks palette holds.",
    limit: { label: "Maximum colours", unit: "count", fallback: 30_000, min: 2 },
    run: (_cx, max) => {
      const count = (): number => store.session?.doc.colors().length ?? 0;
      const n = count();
      if (n <= max) return [];
      return [{ test: "colours", target: { kind: "drawing" }, label: "The drawing's colour table", detail: counted(n, "colour"), still: () => count() > max }];
    },
  },
  {
    key: "classOptions",
    name: "Classes Set to Show Others",
    about: "Class Options set to Show Others, where objects in other classes show but can't be snapped to or selected. Auto-Resolve sets Show/Snap/Modify Others.",
    fix: "classOptions",
    run: () => {
      const still = (): boolean => store.classMode === "show-others";
      return still() ? [{ test: "classOptions", target: { kind: "drawing" }, label: "View > Class Options", detail: "Show Others", still }] : [];
    },
  },
];

interface Saved {
  readonly limits: Partial<Record<TestKey, number>>;
  readonly off: TestKey[];
}

function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    return { limits: v?.limits ?? {}, off: Array.isArray(v?.off) ? v.off : [] };
  } catch {
    return { limits: {}, off: [] };
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // a private window may refuse; the dialog still works
  }
}

/** The last run's issues by test, for the drawing they were found in. */
let last: { session: unknown; issues: Map<TestKey, Issue[]> } | null = null;

type Outcome = { kind: "locate"; issues: Issue[] } | { kind: "simplify"; ids: string[] } | { kind: "done" };

/** Tools > Check File Health…: the tests, their limits, and what the last run found. */
export async function fileHealthDialog(scene: Scene, view: View): Promise<void> {
  const session = store.session;
  if (!session) return;
  const saved = loadSaved();
  if (last?.session !== session) last = { session, issues: new Map() };
  const issues = last.issues;
  const u = units();
  // inches, feet, yards and miles are whole numbers of 25.4 mm
  const perUnit = millimetresPerUnit(u) / 25.4;
  const imperial = Math.abs(perUnit - Math.round(perUnit)) < 1e-9;

  // the tests, each with Run, its limit and the result bubble
  const rows = TESTS.map((t) => {
    const run = h("input", { checked: !saved.off.includes(t.key), attrs: { type: "checkbox", "aria-label": `Run ${t.name}` } });
    const lim = t.limit;
    const n = lim ? (saved.limits[t.key] ?? (imperial ? (lim.imperial ?? lim.fallback) : lim.fallback)) : 0;
    const input = lim
      ? h("input", {
          cls: "menu-dialog-input",
          value: lim.unit === "length" ? formatLengthValue(n, u) : String(n),
          attrs: { type: "text", inputmode: "decimal", "aria-label": lim.label, title: lim.label },
        })
      : null;
    const unit = lim ? (lim.unit === "length" ? lengthSuffix(u) : lim.unit === "px" ? "px" : "") : "";
    const bubble = h("button", { cls: "fh-bubble", attrs: { type: "button" } });
    const el = h(
      "div",
      { cls: "fh-test" },
      run,
      h("span", { cls: "fh-name", text: t.name, title: t.about }),
      input ? h("span", { cls: "fh-limit" }, input, unit ? h("span", { cls: "fh-unit", text: unit }) : null) : h("span", { cls: "fh-limit muted", text: "—" }),
      bubble,
    );
    return { t, run, input, bubble, el };
  });
  const allRun = h("input", { attrs: { type: "checkbox", "aria-label": "Run every test" } });
  const syncAll = (): void => {
    const on = rows.filter((r) => r.run.checked).length;
    allRun.checked = on === rows.length;
    allRun.indeterminate = on > 0 && on < rows.length;
  };
  allRun.addEventListener("change", () => {
    for (const r of rows) r.run.checked = allRun.checked;
  });
  for (const r of rows) r.run.addEventListener("change", syncAll);
  syncAll();

  const error = h("p", { cls: "menu-dialog-error", attrs: { role: "alert" }, hidden: true });
  const limitOf = (r: (typeof rows)[number]): number | null => {
    const lim = r.t.limit;
    if (!lim || !r.input) return 0;
    const text = r.input.value.trim();
    const v = lim.unit === "length" ? parseLength(text, u) : Number(text.replace(/[,\s]/g, ""));
    if (v === null || !Number.isFinite(v) || v < lim.min) return null;
    return lim.unit === "length" ? v : Math.round(v);
  };

  const summary = h("div", { cls: "fh-summary" });
  const hideResolved = h("input", { checked: true, attrs: { type: "checkbox" } });
  const list = h("div", { cls: "fh-issues", attrs: { role: "list" } });
  const deleteBtn = h("button", { cls: "btn", text: "Delete Objects", attrs: { type: "button" } });
  const fixBtn = h("button", { cls: "btn", text: "Auto-Resolve Issue", attrs: { type: "button" } });
  const locateBtn = h("button", { cls: "btn", text: "Locate Object and Resolve Issue Manually", attrs: { type: "button" } });
  const results = h(
    "div",
    { cls: "fh-results", hidden: true },
    h("div", { cls: "fh-results-head" }, summary, h("label", { cls: "menu-dialog-check" }, hideResolved, "Hide resolved issues")),
    list,
    h("div", { cls: "fh-actions" }, deleteBtn, fixBtn, locateBtn),
  );

  /** the issues ticked in the list */
  const ticked = new Set<Issue>();
  let outcome: Outcome = { kind: "done" };
  const finish = (o: Outcome): void => {
    outcome = o;
    results.closest("form")?.requestSubmit();
  };

  const render = (): void => {
    for (const r of rows) {
      const found = issues.get(r.t.key);
      const open = found?.filter((i) => i.still()).length ?? 0;
      r.bubble.className = "fh-bubble";
      r.bubble.disabled = !found?.length;
      if (!found) {
        r.bubble.textContent = "";
        r.bubble.title = "Not run";
      } else if (open === 0) {
        r.bubble.classList.add("pass");
        r.bubble.textContent = "✓";
        r.bubble.title = found.length ? "Every issue resolved" : "Passed";
      } else {
        r.bubble.classList.add(open < found.length ? "partly" : "fail");
        r.bubble.textContent = String(open);
        r.bubble.title = `${counted(open, "issue")} to resolve: show them`;
      }
    }
    const ran = [...issues.values()];
    results.hidden = ran.length === 0;
    const total = ran.reduce((n, f) => n + f.filter((i) => i.still()).length, 0);
    summary.textContent = `Issues found: ${total.toLocaleString()}`;
    for (const i of [...ticked]) if (!i.still()) ticked.delete(i);
    list.replaceChildren(
      ...TESTS.flatMap((t) => {
        const found = issues.get(t.key);
        if (!found?.length) return [];
        const shown = found.filter((i) => !hideResolved.checked || i.still());
        if (!shown.length) return [];
        const group = h("details", { cls: "fh-group", attrs: { open: "", "data-test": t.key } });
        group.append(h("summary", { text: `${t.name} (${found.filter((i) => i.still()).length})` }));
        for (const i of shown) {
          const ok = !i.still();
          const box = h("input", { checked: ticked.has(i), disabled: ok, attrs: { type: "checkbox", "aria-label": `${i.label}: ${i.detail}` } });
          box.addEventListener("change", () => {
            if (box.checked) ticked.add(i);
            else ticked.delete(i);
            syncActions();
          });
          group.append(
            h(
              "label",
              { cls: ok ? "fh-issue resolved" : "fh-issue", attrs: { role: "listitem" } },
              box,
              h("span", { cls: "fh-issue-label", text: i.label }),
              h("span", { cls: "fh-issue-detail", text: i.detail }),
              h("span", { cls: "fh-issue-status", text: ok ? (i.target.kind === "object" && !live(i.target.id) ? "Deleted" : "Resolved") : "" }),
            ),
          );
        }
        return [group];
      }),
    );
    syncActions();
  };

  const syncActions = (): void => {
    const picked = [...ticked];
    deleteBtn.disabled = !picked.some((i) => i.target.kind === "object");
    fixBtn.disabled = !picked.some((i) => TESTS.find((t) => t.key === i.test)?.fix);
    const hatches = picked.filter((i) => i.target.kind === "hatch");
    locateBtn.disabled = !(picked.some((i) => i.target.kind === "object") || hatches.length === 1);
  };
  hideResolved.addEventListener("change", render);

  const runTests = (which: "selected" | "all"): void => {
    error.hidden = true;
    const chosen = rows.filter((r) => which === "all" || r.run.checked);
    if (!chosen.length) {
      error.textContent = "Tick the tests to run.";
      error.hidden = false;
      return;
    }
    const limits: Partial<Record<TestKey, number>> = {};
    for (const r of chosen) {
      const n = limitOf(r);
      if (n === null) {
        const lim = r.t.limit!;
        error.textContent = `${r.t.name}: ${lim.label.toLowerCase()} must be ${lim.unit === "length" ? "a length" : "a number"} of at least ${lim.unit === "length" ? formatLength(lim.min, u) : lim.min}.`;
        error.hidden = false;
        r.input?.focus();
        return;
      }
      limits[r.t.key] = n;
    }
    const cx = contextOf(scene);
    for (const r of chosen) issues.set(r.t.key, r.t.run(cx, limits[r.t.key] ?? 0));
    for (const i of [...ticked]) if (!issues.get(i.test)?.includes(i)) ticked.delete(i);
    save({ limits: { ...saved.limits, ...limits }, off: rows.filter((r) => !r.run.checked).map((r) => r.t.key) });
    render();
    const failed = chosen.filter((r) => issues.get(r.t.key)?.length).length;
    toast(failed ? `${counted(failed, "test")} of ${chosen.length} found issues.` : `All ${counted(chosen.length, "test")} passed.`, "info");
  };

  const runSelected = h("button", { cls: "btn", text: "Run Selected", attrs: { type: "button" } });
  const runAll = h("button", { cls: "btn", text: "Run All", attrs: { type: "button" } });
  runSelected.addEventListener("click", () => runTests("selected"));
  runAll.addEventListener("click", () => runTests("all"));
  // Enter in a limit runs the tests rather than closing the dialog
  for (const r of rows) {
    r.input?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      runTests("selected");
    });
  }
  for (const r of rows) {
    r.bubble.addEventListener("click", () => {
      const group = list.querySelector<HTMLDetailsElement>(`details[data-test="${r.t.key}"]`);
      if (!group) return;
      group.open = true;
      group.scrollIntoView({ block: "nearest" });
    });
  }

  deleteBtn.addEventListener("click", () => {
    const ids = [...ticked].flatMap((i) => (i.target.kind === "object" && live(i.target.id) ? [i.target.id] : []));
    if (!ids.length) return;
    if (!attempt("Delete Objects", (s) => s.deleteObjects(ids))) return;
    setSelection([...store.selection].filter((id) => live(id)));
    ticked.clear();
    render();
    toast(`Deleted ${counted(ids.length, "object")}.`, "info");
  });
  fixBtn.addEventListener("click", () => {
    const picked = [...ticked];
    if (picked.some((i) => i.test === "classOptions")) {
      store.classMode = "modify-others";
      store.emit("display");
    }
    const polys = picked.flatMap((i) => (i.test === "vertices" && i.target.kind === "object" && live(i.target.id) ? [i.target.id] : []));
    if (polys.length) {
      finish({ kind: "simplify", ids: polys });
      return;
    }
    render();
  });
  locateBtn.addEventListener("click", () => finish({ kind: "locate", issues: [...ticked] }));

  render();
  const ok = await showDialog<true>({
    title: "File Health Check",
    okLabel: "OK",
    cls: "fh-dialog",
    body: [
      h("p", {
        cls: "muted",
        text: "Tests for what slows a drawing down or makes it inaccurate. Hover a test for what it looks for; the limits are kept in this browser.",
      }),
      h("div", { cls: "fh-tests" }, h("div", { cls: "fh-test fh-head" }, allRun, h("span", { text: "Test" }), h("span", { text: "Limit" }), h("span", { text: "Result" })), ...rows.map((r) => r.el)),
      h("div", { cls: "fh-run" }, runSelected, runAll),
      error,
      results,
    ],
    check: () => ({ value: true }),
  });
  if (!ok || store.session !== session) return;
  // set by the buttons, which TypeScript doesn't follow into
  const o = outcome as Outcome;
  if (o.kind === "simplify") {
    await simplifyPolysDialog(o.ids);
    return;
  }
  if (o.kind === "locate") locate(o.issues, scene, view);
}

/**
 * Locate: the ticked objects on one layer selected (the outermost group or symbol they sit in, as a
 * click picks) and zoomed to, that layer made active; a hatch opened in its editor.
 */
function locate(picked: readonly Issue[], scene: Scene, view: View): void {
  const objects = picked.flatMap((i) => (i.target.kind === "object" && live(i.target.id) ? [i.target] : []));
  if (!objects.length) {
    const hatch = picked.find((i) => i.target.kind === "hatch")?.target;
    if (hatch?.kind === "hatch") void editHatch(hatch.index);
    return;
  }
  const layerId = objects[0].layerId;
  const here = objects.filter((t) => t.layerId === layerId);
  if (store.view3d) appContext()?.show2d();
  setActiveLayer(layerId);
  const tops = new Set(here.map((t) => scene.topOf(live(t.id)!)));
  setEditGroup(null, tops);
  zoomToSelection(scene, view);
  const elsewhere = objects.length - here.length;
  const layer = scene.layer(layerId)?.name ?? "the layer";
  toast(`Selected ${counted(tops.size, "object")} on ${layer}${elsewhere ? `; ${counted(elsewhere, "other")} on other layers` : ""}.`, "info");
}
