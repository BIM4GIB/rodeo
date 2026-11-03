// AEC > Electrical > Conduit Sizing Calc…, Vectorworks' Conduit Sizing Calculator: the conduit a set
// of wires needs. The wires' areas are shared between the conduits, the fill allowed gives the
// area each conduit must have inside, and from that come its actual diameter and the smallest
// trade size of the chosen kind that holds it. Vectorworks' wire specifications database
// (manufacturers and part numbers) isn't here: the wires and conduits are those of the NEC's
// Chapter 9, Tables 4 and 5, and the suggested fill its Table 1 (53% for one wire in a conduit, 31%
// for two, 40% for more). Other takes any wire's area. It works its answer out as values change.

import { h } from "./dom.ts";
import { numberText } from "./engineeringProperties.ts";
import { showDialog } from "./menubar.ts";
import "./calculators.css";

const AWG = ["14 AWG", "12 AWG", "10 AWG", "8 AWG", "6 AWG", "4 AWG"];
const LARGE = ["3 AWG", "2 AWG", "1 AWG", "1/0 AWG", "2/0 AWG", "3/0 AWG", "4/0 AWG", "250 kcmil", "300 kcmil", "350 kcmil", "400 kcmil", "500 kcmil"];

export interface WireType {
  readonly id: string;
  readonly label: string;
  /** the sizes it comes in here, with their areas (sq in) */
  readonly sizes: readonly string[];
  readonly areas: readonly number[];
}

/** NEC Chapter 9, Table 5: the wires' areas with their insulation, in square inches. */
export const WIRE_TYPES: readonly WireType[] = [
  {
    id: "thhn",
    label: "THHN, THWN, THWN-2",
    sizes: [...AWG, ...LARGE],
    areas: [0.0097, 0.0133, 0.0211, 0.0366, 0.0507, 0.0824, 0.0973, 0.1158, 0.1562, 0.1855, 0.2223, 0.2679, 0.3237, 0.397, 0.4608, 0.5242, 0.5863, 0.7073],
  },
  {
    id: "xhhw",
    label: "XHHW, XHHW-2",
    sizes: [...AWG, ...LARGE],
    areas: [0.0139, 0.0181, 0.0243, 0.0437, 0.059, 0.0814, 0.0962, 0.1146, 0.1534, 0.1825, 0.219, 0.2642, 0.3197, 0.3904, 0.4536, 0.5166, 0.5782, 0.6984],
  },
  { id: "tw", label: "TW, THW, THW-2", sizes: AWG, areas: [0.0139, 0.0181, 0.0243, 0.0437, 0.0726, 0.0973] },
  { id: "rhw", label: "RHW, RHW-2 (no outer covering)", sizes: AWG, areas: [0.0209, 0.026, 0.0333, 0.0556, 0.0726, 0.0973] },
];

export interface ConduitType {
  readonly id: string;
  readonly label: string;
  /** the trade sizes' total inside areas (sq in), as [trade size in inches, metric designator, area] */
  readonly sizes: readonly (readonly [string, number, number])[];
}

const TRADE: readonly (readonly [string, number])[] = [
  ['1/2"', 16],
  ['3/4"', 21],
  ['1"', 27],
  ['1 1/4"', 35],
  ['1 1/2"', 41],
  ['2"', 53],
  ['2 1/2"', 63],
  ['3"', 78],
  ['3 1/2"', 91],
  ['4"', 103],
  ['5"', 129],
  ['6"', 155],
];
const conduit = (id: string, label: string, areas: readonly number[]): ConduitType => ({ id, label, sizes: areas.map((a, i) => [TRADE[i][0], TRADE[i][1], a] as const) });

/** NEC Chapter 9, Table 4: each kind's total inside area by trade size, in square inches. */
export const CONDUIT_TYPES: readonly ConduitType[] = [
  conduit("emt", "EMT", [0.304, 0.533, 0.864, 1.496, 2.036, 3.356, 5.858, 8.846, 11.545, 14.753]),
  conduit("rmc", "RMC (rigid metal)", [0.314, 0.549, 0.887, 1.526, 2.071, 3.408, 4.866, 7.499, 10.01, 12.882, 20.212, 29.158]),
  conduit("imc", "IMC", [0.342, 0.586, 0.959, 1.647, 2.225, 3.63, 5.135, 7.922, 10.584, 13.631]),
  conduit("fmc", "FMC (flexible metal)", [0.317, 0.533, 0.817, 1.277, 1.858, 3.269, 4.909, 7.069, 9.621, 12.566]),
  conduit("lfmc", "LFMC (liquidtight flexible metal)", [0.314, 0.541, 0.873, 1.528, 1.981, 3.246, 4.881, 7.475, 9.731, 12.692]),
  conduit("pvc40", "PVC Schedule 40", [0.285, 0.508, 0.832, 1.453, 1.986, 3.291, 4.695, 7.268, 9.737, 12.554, 19.761, 28.567]),
  conduit("pvc80", "PVC Schedule 80", [0.217, 0.409, 0.688, 1.237, 1.711, 2.874, 4.119, 6.442, 8.688, 11.258, 17.855, 25.598]),
];

/** NEC Chapter 9, Table 1's fill, in percent, for `wires` in `conduits`: as many wires as the fullest conduit holds. */
export function suggestedFill(wires: number, conduits: number): number {
  const each = Math.ceil(wires / Math.max(1, conduits));
  return each <= 1 ? 53 : each === 2 ? 31 : 40;
}

export interface ConduitAnswer {
  /** the inside area one conduit must have, sq in */
  readonly area: number;
  /** the inside diameter that gives it, inches */
  readonly diameter: number;
  /** the smallest trade size of the kind that holds it; null past its largest */
  readonly trade: { readonly size: string; readonly metric: number; readonly area: number } | null;
}

/** The conduit that `conduits` of the kind need to share wires of `wireArea` sq in in all at `fill` percent; null when a value is out of range. */
export function conduitFor(wireArea: number, conduits: number, fill: number, kind: ConduitType): ConduitAnswer | null {
  if (!(wireArea > 0 && conduits >= 1 && Number.isInteger(conduits) && fill > 0 && fill <= 100)) return null;
  const area = wireArea / conduits / (fill / 100);
  const hit = kind.sizes.find(([, , a]) => a >= area);
  return { area, diameter: Math.sqrt((4 * area) / Math.PI), trade: hit ? { size: hit[0], metric: hit[1], area: hit[2] } : null };
}

interface Added {
  readonly label: string;
  readonly count: number;
  readonly area: number;
}

/** Remembered between openings, as Vectorworks keeps a calculator's last values. */
const last = { wire: "thhn", size: "1", count: "1", other: "", conduit: "emt", conduits: "1", added: [] as Added[] };

/** AEC > Electrical > Conduit Sizing Calc…: the conduit a set of wires needs. */
export async function conduitSizingDialog(): Promise<void> {
  const input = (label: string, value: string): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const select = (label: string, options: readonly (readonly [string, string])[]): HTMLSelectElement =>
    h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map(([value, text]) => h("option", { value, text })));
  const field = (label: string, ...control: Node[]): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), ...control);
  const button = (text: string): HTMLButtonElement => h("button", { cls: "btn small", text, attrs: { type: "button" } });

  const wire = select("Type", [...WIRE_TYPES.map((w): [string, string] => [w.id, w.label]), ["other", "Other"]]);
  wire.value = last.wire;
  const size = select("Size", []);
  const count = input("Number of conductors", last.count);
  const area = input("C-S Area of conductor in sq inches", last.other);
  const add = button("Add >>");
  const remove = button("Remove");
  const clear = button("Clear All");
  const list = h("select", { cls: "menu-dialog-input conduit-list", attrs: { size: "6", "aria-label": "Conductors Currently in Conduit" } });
  const kind = select("Conduit Type", CONDUIT_TYPES.map((c): [string, string] => [c.id, c.label]));
  kind.value = last.conduit;
  const conduits = input("Number of conduits", last.conduits);
  const fill = input("Conduit stuff percentage", "40");
  const holder = h("div", { cls: "props-holder" });
  const added = [...last.added];

  const num = (el: HTMLInputElement): number => (el.value.trim() ? Number(el.value.trim().replace(",", ".")) : NaN);
  /** The type's sizes; Other has none, and leaves the area to be typed. */
  const fillSizes = (): void => {
    const w = WIRE_TYPES.find((t) => t.id === wire.value);
    size.replaceChildren(...(w ? w.sizes.map((s, i) => h("option", { value: String(i), text: s })) : []));
    size.disabled = !w;
    area.disabled = !!w;
  };
  const showArea = (): void => {
    const w = WIRE_TYPES.find((t) => t.id === wire.value);
    if (w) area.value = String(w.areas[Number(size.value)] ?? "");
  };
  const showList = (): void => {
    list.replaceChildren(...added.map((a, i) => h("option", { value: String(i), text: `${a.count} × ${a.label} (${numberText(a.count * a.area)} sq in)` })));
    remove.disabled = added.length === 0;
    clear.disabled = added.length === 0;
  };
  const wires = (): number => added.reduce((s, a) => s + a.count, 0);
  /** The list or the number of conduits changed: the suggestion follows, and can be typed over again. */
  const suggest = (): void => {
    const n = num(conduits);
    fill.value = String(suggestedFill(wires(), Number.isInteger(n) && n >= 1 ? n : 1));
  };
  const solve = (): void => {
    const total = added.reduce((s, a) => s + a.count * a.area, 0);
    const c = CONDUIT_TYPES.find((t) => t.id === kind.value) ?? CONDUIT_TYPES[0];
    if (added.length === 0) return void holder.replaceChildren(h("p", { cls: "muted", text: "Add the conductors that go in the conduit." }));
    const r = conduitFor(total, num(conduits), num(fill), c);
    if (!r) return void holder.replaceChildren(h("p", { cls: "muted", text: "The number of conduits is a whole number of at least 1, and the percentage more than 0 and at most 100." }));
    const rows: [string, string][] = [
      ["Conductors", `${wires()}, ${numberText(total)} sq in in all`],
      ["Actual Conduit Size required", `${r.diameter.toFixed(3)} in / ${(r.diameter * 25.4).toFixed(1)} mm`],
      ["Nominal Conduit (Trade) size required", r.trade ? `${r.trade.size} / ${r.trade.metric} mm` : `larger than the largest ${c.label} listed, ${c.sizes[c.sizes.length - 1][0]}`],
    ];
    if (r.trade) rows.push(["Fill at that size", `${((total / num(conduits) / r.trade.area) * 100).toFixed(1)}% of ${numberText(r.trade.area)} sq in`]);
    holder.replaceChildren(h("dl", { cls: "props-list" }, ...rows.flatMap(([k, val]) => [h("dt", { text: k }), h("dd", { text: val })])));
  };

  fillSizes();
  size.value = last.size;
  if (size.selectedIndex < 0 && size.options.length > 0) size.selectedIndex = 0;
  showArea();
  showList();
  suggest();
  solve();

  wire.addEventListener("input", () => {
    fillSizes();
    showArea();
  });
  size.addEventListener("input", showArea);
  add.addEventListener("click", () => {
    const n = num(count);
    const a = num(area);
    if (!(Number.isInteger(n) && n >= 1 && a > 0)) {
      holder.replaceChildren(h("p", { cls: "muted", text: "The number of conductors is a whole number of at least 1, and the area more than 0." }));
      return;
    }
    const w = WIRE_TYPES.find((t) => t.id === wire.value);
    added.push({ label: w ? `${w.sizes[Number(size.value)]} ${w.label.split(",")[0]}` : `Other, ${numberText(a)} sq in each`, count: n, area: a });
    showList();
    suggest();
    solve();
  });
  remove.addEventListener("click", () => {
    const i = list.selectedIndex >= 0 ? list.selectedIndex : added.length - 1;
    if (i >= 0) added.splice(i, 1);
    showList();
    suggest();
    solve();
  });
  clear.addEventListener("click", () => {
    added.length = 0;
    showList();
    suggest();
    solve();
  });
  conduits.addEventListener("input", () => {
    suggest();
    solve();
  });
  for (const el of [kind, fill]) el.addEventListener("input", solve);

  await showDialog<boolean>({
    title: "Conduit Sizing Calculator",
    okLabel: "Close",
    cls: "props-dialog",
    body: [
      field("Type", wire),
      field("Size", size),
      field("Number of conductors", count),
      field("C-S Area of conductor in sq inches", area),
      h("div", { cls: "conduit-buttons" }, add, remove, clear),
      h("label", { cls: "menu-dialog-field conduit-list-field" }, h("span", { cls: "menu-dialog-label", text: "Conductors Currently in Conduit" }), list),
      field("Conduit Type", kind),
      field("Number of conduits", conduits),
      field("Conduit stuff percentage", fill),
      holder,
      h("p", { cls: "muted", text: "Areas and fill from the NEC's Chapter 9, Tables 1, 4 and 5. Check them against the code edition that applies." }),
    ],
    check: () => ({ value: true }),
  });
  Object.assign(last, { wire: wire.value, size: size.value, count: count.value, other: wire.value === "other" ? area.value : "", conduit: kind.value, conduits: conduits.value, added });
}
