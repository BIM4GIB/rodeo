// Resources > Import from Another File…: brings symbols, textures, hatches, gradients, line types,
// text styles and data record formats in from another Vectorworks file, as the Resource Manager's
// import does. The other file's resources of
// those kinds are listed to tick; one whose name the drawing already uses comes in renamed
// (Name-2), replaces the drawing's own of that kind (a symbol's instances then draw what it now
// holds), or stays out, as chosen. A hatch's colours are matched to this drawing's palette, and
// each import draws its previews anew. A symbol brings what it uses that the drawing lacks: the
// symbols nested in it, its classes, line types, hatches, gradients, text styles and record formats,
// and the textures its 3D objects show, by name; the drawing's own of the same name are used as
// they are. A texture comes with its shaders' images and settings, and the shader record formats
// the drawing lacks (one it has must hold the same fields). A record format that replaces the
// drawing's keeps the values of the fields both have, of the same kind, in the records already
// attached; the rest start at their defaults. All come in as one undo step. Geometric
// line types (whose dashes aren't simple lengths), symbols holding plug-in objects and the other
// kinds don't import yet.

import {
  blobSource,
  bytesSource,
  newFieldsProblem,
  openVwxStream,
  type ClipboardData,
  type EditSession,
  type GradientStop,
  type HatchFill,
  type RecordField,
  type ResourceInfo,
  type ResourceKind,
  type TextStyleSpec,
  type TextureData,
  type VwxDocument,
} from "../core/index.ts";
import "./batchRename.css";
import { h, nextPaint } from "./dom.ts";
import { pickFile } from "./fileio.ts";
import { gradientPreviews } from "./gradientEditor.ts";
import { inflater } from "./inflate.ts";
import { hatchPreviews } from "./hatchEditor.ts";
import { lineTypePreviews } from "./lineTypeEditor.ts";
import { showLoading } from "./loading.ts";
import { showDialog } from "./menubar.ts";
import { KIND_LABEL } from "./panels/resources.ts";
import { store } from "./state.ts";
import { textStylePreviews } from "./textStyleEditor.ts";
import { errorMessage, toast } from "./toast.ts";

type Kind = "hatch" | "gradient" | "line-type" | "symbol" | "texture" | "text-style" | "record-format";
type Taken = "rename" | "replace" | "skip";

/** each kind, and the drawing's kinds a new one of it is copied from (a first gradient comes from a hatch; a texture is all its own) */
const KINDS: readonly { readonly kind: Kind; readonly from: readonly ResourceKind[]; readonly one: string }[] = [
  { kind: "hatch", from: ["hatch"], one: "hatch" },
  { kind: "gradient", from: ["gradient", "hatch"], one: "gradient" },
  { kind: "line-type", from: ["line-type"], one: "line type" },
  { kind: "symbol", from: ["symbol"], one: "symbol definition" },
  { kind: "texture", from: [], one: "texture" },
  { kind: "text-style", from: ["text-style", "hatch", "gradient"], one: "text style" },
  { kind: "record-format", from: ["record-format"], one: "record format" },
];

interface Item {
  readonly kind: Kind;
  readonly name: string;
  readonly hatch?: HatchFill;
  readonly stops?: readonly GradientStop[];
  readonly dashes?: readonly number[];
  /** a symbol's contents, or why they can't be copied */
  readonly symbol?: ClipboardData;
  readonly texture?: TextureData;
  /** a text style's font, size and alignment */
  readonly style?: TextStyleSpec;
  /** a record format's fields with their defaults */
  readonly fields?: readonly RecordField[];
  readonly cant?: string;
}

/** What an import does: comes in under `name`, replaces resource `replaces`, stays out as its name is taken (`skip`), or can't come in (`why`). */
interface Outcome {
  readonly name: string;
  readonly replaces?: ResourceInfo;
  readonly skip?: boolean;
  readonly why?: string;
}

/** The colour index in `doc`'s palette for each colour of `src`: the same index when it holds the same colour, else one that does, else the nearest. */
function paletteMatch(src: VwxDocument, doc: VwxDocument): (index: number) => number {
  const palette = doc.colors().map((c) => ({ index: c.index, css: c.css.toLowerCase() }));
  const rgb = (css: string): number[] => [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));
  const found = new Map<number, number>();
  return (index) => {
    let to = found.get(index);
    if (to !== undefined) return to;
    const want = src.color(index).toLowerCase();
    const same = palette.find((c) => c.index === index && c.css === want) ?? palette.find((c) => c.css === want);
    to = same?.index ?? index;
    if (!same) {
      const [r, g, b] = rgb(want);
      let best = Infinity;
      for (const c of palette) {
        const [r2, g2, b2] = rgb(c.css);
        const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
        if (d < best) [best, to] = [d, c.index];
      }
    }
    found.set(index, to);
    return to;
  };
}

/** The names of the symbols placed in a symbol's contents. */
function nestedSymbols(data: ClipboardData): Set<string> {
  return new Set(data.records.flatMap((r) => (r.symbol ? [r.symbol] : [])));
}

/**
 * The symbols to import for `roots`, the ones nested in them first: `roots` and what they hold
 * that the drawing has no symbol of the same name for (`own`). Throws when one can't come in.
 */
function symbolOrder(roots: readonly Item[], byName: ReadonlyMap<string, Item>, own: ReadonlySet<string>, usedElse: ReadonlySet<string>): Item[] {
  const out: Item[] = [];
  const seen = new Set<Item>();
  const visit = (it: Item, via: readonly string[]): void => {
    if (seen.has(it)) return;
    seen.add(it);
    for (const name of nestedSymbols(it.symbol!)) {
      if (own.has(name)) continue;
      const path = [...via, name].map((n) => `“${n}”`).join(" in ");
      const inner = byName.get(name);
      if (!inner) throw new Error(`it holds ${path}, which isn't in either file`);
      if (inner.cant) throw new Error(`it holds ${path}, which can't be imported: ${inner.cant}`);
      if (usedElse.has(name)) throw new Error(`it holds ${path}, and this drawing uses that name for something else`);
      if (via.includes(name)) throw new Error(`${path} holds itself`);
      visit(inner, [...via, name]);
    }
    out.push(it);
  };
  for (const it of roots) visit(it, [it.name]);
  return out;
}

/**
 * Brings into `session` what the symbols' contents name that its drawing lacks and `from` has, under
 * the same names: classes, line types, hatches, gradients, text styles, record formats and textures.
 * One whose name the drawing uses for something else, or that can't be made here, stays out: its
 * objects then draw in the None class, solid, without the text style or the texture, and its
 * records are left off.
 */
function importDependencies(session: EditSession, from: EditSession, contents: readonly ClipboardData[]): void {
  const src = from.doc;
  const records = contents.flatMap((c) => c.records);
  const want = (key: "className" | "lineType" | "fill" | "textStyle" | "format"): Set<string> => new Set(records.flatMap((r) => (r[key] ? [r[key]!] : [])));
  const doc = (): VwxDocument => session.doc;
  const taken = (name: string): boolean => {
    const d = doc();
    return d.classes().some((c) => c.name === name) || d.layers().some((l) => l.name === name) || d.stories().some((s) => s.name === name) || d.resources().some((r) => r.name === name);
  };
  const has = (kind: ResourceKind): boolean => doc().resources().some((r) => r.kind === kind);
  const srcRes = new Map(src.resources().map((r) => [r.name, r]));

  for (const name of want("className")) if (!taken(name)) session.createClass(name);
  const dashes = new Map(src.lineTypes().map((t) => [t.name, t.dashes]));
  for (const name of want("lineType")) {
    const d = dashes.get(name);
    if (d?.length && !taken(name) && has("line-type")) session.createLineType(name, d, lineTypePreviews(doc(), d));
  }
  const match = paletteMatch(src, doc());
  for (const name of want("fill")) {
    const r = srcRes.get(name);
    if (!r || taken(name)) continue;
    if (r.kind === "hatch" && r.hatch && has("hatch")) {
      const hatch: HatchFill = { ...r.hatch, background: match(r.hatch.background), lines: r.hatch.lines.map((l) => ({ ...l, color: match(l.color) })) };
      session.createHatch(name, hatch, hatchPreviews(doc(), hatch));
    } else if (r.kind === "gradient" && r.gradient?.length && (has("gradient") || has("hatch"))) {
      session.createGradient(name, r.gradient, gradientPreviews(doc(), r.gradient));
    }
  }
  for (const name of want("textStyle")) {
    const def = srcRes.get(name)?.textStyle;
    const font = def && src.fonts()[def.fontIndex];
    if (!def || !font || taken(name) || !(has("text-style") || has("hatch") || has("gradient"))) continue;
    session.createTextStyle(name, { font, points: def.points, hAlign: def.hAlign, vAlign: def.vAlign }, textStylePreviews(doc(), font));
  }
  const formats = new Map(src.recordFormats().map((f) => [f.name, f.format]));
  for (const name of want("format")) {
    const format = formats.get(name);
    const fields = format === undefined ? null : src.recordFormatFields(format);
    if (!fields || taken(name)) continue;
    try {
      session.createRecordFormat(name, fields.map((f) => ({ name: f.name, kind: f.kind, value: f.value })));
    } catch {
      // no format here to copy settings from: the records stay out
    }
  }
  for (const name of new Set(records.flatMap((r) => r.textures ?? []))) {
    const r = srcRes.get(name);
    if (!name || r?.kind !== "texture" || taken(name)) continue;
    try {
      const texture = from.copyTexture(r.index);
      if (!session.textureImportProblem(texture)) session.importTexture(name, texture);
    } catch {
      // a texture that doesn't copy stays out: the parts that show it go without
    }
  }
}

/** Asks for a .vwx file, then which of its symbols, textures, hatches, gradients, line types, text styles and record formats to bring in. */
export async function importResources(): Promise<void> {
  if (!store.session) return;
  let picked;
  try {
    picked = await pickFile();
  } catch (err) {
    toast(`Import failed: ${errorMessage(err)}`);
    return;
  }
  if (picked) await importResourcesFrom(picked.file, picked.name);
}

/** Lists the symbols, textures, hatches, gradients, line types, text styles and record formats of the file `data` (named `fileName`) to bring in. */
export async function importResourcesFrom(data: Uint8Array | Blob, fileName: string): Promise<void> {
  if (!store.session) return;
  let from: EditSession;
  const done = showLoading(`Reading ${fileName}…`);
  try {
    await nextPaint();
    from = await openVwxStream(data instanceof Uint8Array ? bytesSource(data) : blobSource(data), fileName, { ...inflater(), onProgress: (f) => done.progress(f) });
  } catch (err) {
    toast(`Could not read ${fileName}: ${errorMessage(err)}`);
    return;
  } finally {
    done();
  }
  const session = store.session;
  if (!session) return;
  const doc = session.doc;
  const src = from.doc;

  const dashes = new Map(src.lineTypes().map((t) => [-t.style, t.dashes]));
  const items: Item[] = [];
  for (const r of src.resources()) {
    if (r.kind === "hatch" && r.hatch) items.push({ kind: "hatch", name: r.name, hatch: r.hatch });
    else if (r.kind === "gradient" && r.gradient?.length) items.push({ kind: "gradient", name: r.name, stops: r.gradient });
    else if (r.kind === "line-type" && dashes.get(r.index)?.length) items.push({ kind: "line-type", name: r.name, dashes: dashes.get(r.index) });
    else if (r.kind === "texture") {
      try {
        const texture = from.copyTexture(r.index);
        const why = session.textureImportProblem(texture);
        items.push({ kind: "texture", name: r.name, texture, ...(why ? { cant: why.replace(/\.$/, "") } : {}) });
      } catch (err) {
        items.push({ kind: "texture", name: r.name, cant: errorMessage(err).replace(/\.$/, "") });
      }
    } else if (r.kind === "text-style" && r.textStyle) {
      const font = src.fonts()[r.textStyle.fontIndex];
      const t = r.textStyle;
      items.push(font ? { kind: "text-style", name: r.name, style: { font, points: t.points, hAlign: t.hAlign, vAlign: t.vAlign } } : { kind: "text-style", name: r.name, cant: "its font isn't in the file's font list" });
    }
  }
  for (const f of src.recordFormats()) {
    const fields = src.recordFormatFields(f.format);
    const problem = fields && newFieldsProblem(fields);
    if (!fields) items.push({ kind: "record-format", name: f.name, cant: "its fields can't be read" });
    else if (problem) items.push({ kind: "record-format", name: f.name, cant: `its fields can't be made here: ${problem}` });
    else items.push({ kind: "record-format", name: f.name, fields });
  }
  for (const def of src.symbolDefs()) {
    try {
      items.push({ kind: "symbol", name: def.name, symbol: from.copySymbol(def.index) });
    } catch (err) {
      items.push({ kind: "symbol", name: def.name, cant: errorMessage(err).replace(/\.$/, "") });
    }
  }
  items.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  if (!items.length) {
    toast(`${fileName} has no symbols, textures, hatches, gradients, line types, text styles or record formats to import.`, "info");
    return;
  }
  const symbolsByName = new Map(items.filter((it) => it.kind === "symbol").map((it) => [it.name, it]));
  const ownSymbols = new Set(doc.symbolDefs().map((d) => d.name));
  const match = paletteMatch(src, doc);
  const ownKinds = new Set(doc.resources().map((r) => r.kind));
  // every name the drawing holds: names are shared by its classes, layers, stories and resources
  const used = new Set([...doc.classes().map((c) => c.name), ...doc.layers().map((l) => l.name), ...doc.stories().map((s) => s.name), ...doc.resources().map((r) => r.name)]);
  const resources = doc.resources();
  // a plug-in's parameter format isn't replaced: a record format replaces only a data record format
  const dataFormats = new Set(doc.recordFormats().map((f) => f.format));
  const usedElse = new Set([...used].filter((n) => !ownSymbols.has(n)));
  /** why a symbol can't come in, from what it holds; "" when it can */
  const symbolWhy = new Map<Item, string>();
  for (const it of symbolsByName.values()) {
    if (it.cant) continue;
    try {
      symbolOrder([it], symbolsByName, ownSymbols, usedElse);
      symbolWhy.set(it, "");
    } catch (err) {
      symbolWhy.set(it, errorMessage(err));
    }
  }

  const unticked = new Set<Item>();
  const kindFilter = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select br-input", attrs: { "aria-label": "Kind" } },
    h("option", { value: "", text: "All kinds" }),
    ...KINDS.filter((k) => items.some((it) => it.kind === k.kind)).map((k) => h("option", { value: k.kind, text: KIND_LABEL[k.kind] })),
  );
  const taken = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select br-input", attrs: { "aria-label": "When a name is taken" } },
    h("option", { value: "rename", text: "Import it as Name-2" }),
    h("option", { value: "replace", text: "Replace the drawing's" }),
    h("option", { value: "skip", text: "Leave it out" }),
  );
  const search = h("input", {
    cls: "menu-dialog-input org-search",
    placeholder: "Search",
    attrs: { type: "search", "aria-label": "Search the list", autocomplete: "off", spellcheck: "false" },
  });
  const field = (label: string, input: HTMLElement): HTMLElement => h("label", { cls: "br-field" }, h("span", { cls: "br-label", text: label }), input);
  const table = h("div", { cls: "org-table br-table ri-table", attrs: { role: "table" } });
  const note = h("p", { cls: "muted br-note" });

  /** the listed rows, each with what its import would do */
  function plan(): { it: Item; ticked: boolean; out: Outcome }[] {
    const q = search.value.trim().toLowerCase();
    const policy = taken.value as Taken;
    const names = new Set(used);
    return items
      .filter((it) => (!kindFilter.value || it.kind === kindFilter.value) && (!q || it.name.toLowerCase().includes(q)))
      .map((it) => {
        const ticked = !unticked.has(it);
        const k = KINDS.find((x) => x.kind === it.kind)!;
        const same = resources.find((r) => r.kind === it.kind && r.name === it.name && (it.kind !== "record-format" || dataFormats.has(r.index)));
        const cant = it.cant ?? symbolWhy.get(it);
        let out: Outcome;
        if (k.from.length && !k.from.some((f) => ownKinds.has(f))) out = { name: it.name, why: `This drawing has no ${k.one} to copy settings from yet.` };
        else if (cant) out = { name: it.name, why: `${cant[0].toUpperCase()}${cant.slice(1)}.` };
        else if (!names.has(it.name)) out = { name: it.name };
        else if (policy === "skip") out = { name: it.name, skip: true };
        else if (policy === "replace" && same) out = { name: it.name, replaces: same };
        else {
          let n = 2;
          while (names.has(`${it.name}-${n}`)) n++;
          out = { name: `${it.name}-${n}` };
        }
        // a later import can't take a name an earlier one comes in under
        if (ticked && !out.why && !out.skip) names.add(out.name);
        return { it, ticked, out };
      });
  }

  function render(focus?: Item): void {
    const rows = plan();
    const all = h("input", { attrs: { type: "checkbox", "aria-label": "Tick every listed row" } });
    all.checked = rows.length > 0 && rows.every((r) => r.ticked);
    all.indeterminate = !all.checked && rows.some((r) => r.ticked);
    all.addEventListener("change", () => {
      for (const r of rows) {
        if (all.checked) unticked.delete(r.it);
        else unticked.add(r.it);
      }
      render();
      all.focus();
    });
    let focusBox: HTMLInputElement | null = null;
    table.replaceChildren(
      h("div", { cls: "org-row org-head", attrs: { role: "row" } }, h("label", { cls: "org-check" }, all), h("span", { text: "Name" }), h("span", { text: "Kind" }), h("span", { text: "Comes in as" })),
      ...rows.map((r) => {
        const box = h("input", { attrs: { type: "checkbox", "aria-label": `Import ${r.it.name}` } });
        box.checked = r.ticked;
        box.addEventListener("change", () => {
          if (box.checked) unticked.delete(r.it);
          else unticked.add(r.it);
          render(r.it);
        });
        if (r.it === focus) focusBox = box;
        const as = !r.ticked ? "—" : r.out.why ? "Can't import" : r.out.skip ? "Left out: the name is taken" : r.out.replaces ? `Replaces “${r.out.name}”` : r.out.name;
        const comes = r.ticked && !r.out.why && !r.out.skip;
        return h(
          "div",
          { cls: "org-row", attrs: { role: "row" } },
          h("label", { cls: "org-check" }, box),
          h("span", { cls: "org-text", text: r.it.name, title: r.it.name }),
          h("span", { cls: "org-text muted", text: KIND_LABEL[r.it.kind] }),
          h("span", {
            cls: `org-text br-new${comes ? " changed" : ""}${r.ticked && r.out.why ? " bad" : ""}`,
            text: as,
            title: r.out.why ?? as,
          }),
        );
      }),
    );
    (focusBox as HTMLInputElement | null)?.focus();
    const coming = rows.filter((r) => r.ticked && !r.out.why && !r.out.skip);
    const out = rows.filter((r) => r.ticked && r.out.skip).length;
    const cant = rows.filter((r) => r.ticked && r.out.why).length;
    const symbols = coming.filter((r) => r.it.kind === "symbol").map((r) => r.it);
    const nested = symbols.length ? symbolOrder(symbols, symbolsByName, ownSymbols, usedElse).length - symbols.length : 0;
    note.textContent = `${coming.length} of ${items.length} will be imported${nested ? `, with ${nested} symbol${nested === 1 ? "" : "s"} nested in them` : ""}${out ? `; ${out} left out` : ""}${cant ? `; ${cant} can't be` : ""}.`;
  }
  search.addEventListener("input", () => render());
  kindFilter.addEventListener("change", () => render());
  taken.addEventListener("change", () => render());
  render();

  const result = await showDialog<{ count: number; nested: number }>({
    title: `Import Resources from ${fileName}`,
    okLabel: "Import",
    cls: "br-dialog",
    body: [
      h("div", { cls: "org-top" }, field("Kind", kindFilter), search),
      h("div", { cls: "br-rules" }, field("Name taken", taken)),
      table,
      note,
      h("p", {
        cls: "muted",
        text: "A symbol brings the symbols, classes, line types, hatches, gradients, text styles, record formats and textures it uses that this drawing lacks, and a texture its images and the shader formats this drawing lacks. Hatches and symbols take this drawing's nearest colours. Geometric line types, symbols holding plug-in objects and the other kinds of resource can't be imported yet.",
      }),
    ],
    check: () => {
      const rows = plan().filter((r) => r.ticked && !r.out.why && !r.out.skip);
      if (!rows.length) return { error: "Tick something that can be imported." };
      let nested = 0;
      try {
        session.batch(() => {
          for (const { it, out } of rows) {
            const own = out.replaces;
            if (it.kind === "symbol") continue;
            if (it.kind === "texture") session.importTexture(out.name, it.texture!, own?.index);
            else if (it.kind === "hatch") {
              const hatch: HatchFill = { ...it.hatch!, background: match(it.hatch!.background), lines: it.hatch!.lines.map((l) => ({ ...l, color: match(l.color) })) };
              const pngs = hatchPreviews(session.doc, hatch, own);
              if (own) session.editHatch(own.index, hatch, pngs);
              else session.createHatch(out.name, hatch, pngs);
            } else if (it.kind === "gradient") {
              const pngs = gradientPreviews(session.doc, it.stops!, own);
              if (own) session.editGradient(own.index, it.stops!, pngs);
              else session.createGradient(out.name, it.stops!, pngs);
            } else if (it.kind === "text-style") {
              const pngs = textStylePreviews(session.doc, it.style!.font, own);
              if (own) session.editTextStyle(own.index, it.style!, pngs);
              else session.createTextStyle(out.name, it.style!, pngs);
            } else if (it.kind === "record-format") {
              const specs = it.fields!.map((f) => ({ name: f.name, kind: f.kind, value: f.value }));
              if (!own) session.createRecordFormat(out.name, specs);
              else {
                // fields both formats have, of the same kind, keep their values in the records attached
                const kept = new Map((session.doc.recordFormatFields(own.index) ?? []).map((f) => [f.name, f.kind]));
                session.editRecordFormat(own.index, specs.map((f) => (kept.get(f.name) === f.kind ? { ...f, from: f.name } : f)));
              }
            } else {
              const pngs = lineTypePreviews(session.doc, it.dashes!, own);
              if (own) session.editLineType(own.index, it.dashes!, pngs);
              else session.createLineType(out.name, it.dashes!, pngs);
            }
          }
          // symbols last, so the resources ticked above are there for them, and nested ones first
          const symbolRows = rows.filter((r) => r.it.kind === "symbol");
          if (!symbolRows.length) return;
          const order = symbolOrder(symbolRows.map((r) => r.it), symbolsByName, ownSymbols, usedElse);
          importDependencies(session, from, order.map((it) => it.symbol!));
          const outcome = new Map(symbolRows.map((r) => [r.it, r.out]));
          for (const it of order) {
            const out = outcome.get(it);
            if (out?.replaces) session.redefineSymbol(out.replaces.index, it.symbol!);
            else session.importSymbol(out?.name ?? it.name, it.symbol!);
          }
          nested = order.length - symbolRows.length;
        });
      } catch (err) {
        return { error: errorMessage(err) };
      }
      return { value: { count: rows.length, nested } };
    },
  });
  if (!result) return;
  const { count, nested } = result;
  toast(`Imported ${count} resource${count === 1 ? "" : "s"}${nested ? ` and ${nested} symbol${nested === 1 ? "" : "s"} nested in them` : ""} from ${fileName}.`, "info");
}
