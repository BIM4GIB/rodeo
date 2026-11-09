// ConnectCAD's Calculate Cable Lengths: the Cable Length Options dialog (all circuits or the selected
// ones, and the allowances for cable in racks), then each circuit whose Cable Length is left empty (or
// Auto) gets a Calculated Cable Length from where the equipment items named as its devices stand: in
// one rack or racks side by side, from the allowances (cableLengthShapes.ts); otherwise along the
// shortest way through the cable paths (cableRoute.ts), joined at a rack, at equipment standing on its
// own, or at the drop point it names, with the drop points' slack (cableRouteShapes.ts). Circuits whose
// length can't be worked out are marked as Check Drawing marks problems (markup.ts), and a Cable Length
// typed in is never overridden.

import "./connectcad.css";
import type { EditSession } from "../../../core/index.ts";
import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { formatLength, formatLengthValue, lengthSuffix, parseLength } from "../../../app/units.ts";
import type { LengthOptions } from "./cableLengthShapes.ts";
import { circuitRouter } from "./cableRouting.ts";
import { ringAround, type Issue } from "./ccadChecks.ts";
import { MARKUP_CLASS, markIssues } from "./markup.ts";
import { cableEndsOf, circuitFacts, circuitsIn, setCalculatedLengths } from "./schematic.ts";

/** what the dialog last OKed, mm */
const options = { all: true, swanNeck: 300, tail: 500, floor: 300 };

const SVG = "http://www.w3.org/2000/svg";

/** The dialog's rack diagram: two racks on a false floor, a cable between them with its allowances numbered as the fields are. */
function rackDiagram(): SVGSVGElement {
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    return e;
  };
  const svg = el("svg", { viewBox: "0 0 280 150", width: 280, height: 150, role: "img", "aria-label": "Equipment rack diagram", class: "ccad-diagram" });
  const line = { fill: "none", stroke: "currentColor", "stroke-width": 1.2 };
  svg.append(
    el("rect", { x: 50, y: 12, width: 64, height: 106, ...line }),
    el("rect", { x: 114, y: 12, width: 64, height: 106, ...line }),
    el("line", { x1: 10, y1: 118, x2: 270, y2: 118, ...line }),
    el("line", { x1: 10, y1: 140, x2: 270, y2: 140, ...line, "stroke-dasharray": "4 3" }),
    el("rect", { x: 56, y: 26, width: 52, height: 8, fill: "currentColor", opacity: 0.35 }),
    el("rect", { x: 120, y: 62, width: 52, height: 14, fill: "currentColor", opacity: 0.35 }),
    el("path", { d: "M108 30 c 10 0 10 12 0 12 L104 42 L104 130 L126 130 L126 82 c -10 0 -10 -12 0 -12 L120 70", fill: "none", stroke: "var(--accent)", "stroke-width": 2 }),
    el("path", { d: "M222 118 L222 140 M218 122 L222 118 L226 122 M218 136 L222 140 L226 136", ...line }),
  );
  const mark = (x: number, y: number, n: string): void => {
    svg.append(el("circle", { cx: x, cy: y, r: 7, ...line }), el("text", { x, y: y + 3.5, "text-anchor": "middle", "font-size": 10, fill: "currentColor" }, n));
  };
  mark(32, 36, "1");
  svg.append(el("line", { x1: 39, y1: 36, x2: 100, y2: 36, ...line, "stroke-dasharray": "2 2" }));
  mark(196, 76, "2");
  svg.append(el("line", { x1: 189, y1: 76, x2: 132, y2: 76, ...line, "stroke-dasharray": "2 2" }));
  mark(244, 129, "3");
  return svg;
}

/** The Cable Length Options dialog: which circuits and the allowances; null when cancelled. */
async function chooseOptions(selected: number, units: string | undefined): Promise<typeof options | null> {
  const radio = (all: boolean): HTMLInputElement => h("input", { checked: all ? options.all || !selected : !options.all && selected > 0, attrs: { type: "radio", name: "ccad-lengths-for", value: all ? "all" : "selected" } });
  const all = radio(true);
  const some = radio(false);
  some.disabled = !selected;
  const suffix = lengthSuffix(units);
  const length = (label: string, mm: number): HTMLInputElement => h("input", { cls: "menu-dialog-input", value: formatLengthValue(mm, units), attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const field = (label: string, input: HTMLInputElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input, suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null);
  const swanNeck = length("Jackfield Swan-Neck", options.swanNeck);
  const tail = length("Equipment Tail", options.tail);
  const floor = length("False Floor Depth", options.floor);
  return showDialog<typeof options>({
    title: "Cable Length Options",
    okLabel: "OK",
    body: [
      rackDiagram(),
      h("div", { cls: "menu-dialog-label", text: "Calculate Cable Lengths for" }),
      h("label", { cls: "menu-dialog-check" }, all, "All circuits"),
      h("label", { cls: "menu-dialog-check" }, some, selected ? `Selected circuits (${selected})` : "Selected circuits (none selected)"),
      h("div", { cls: "menu-dialog-label", text: "Equipment Rack Estimates" }),
      field("1 Jackfield Swan-Neck", swanNeck),
      field("2 Equipment Tail", tail),
      field("3 False Floor Depth", floor),
      h("p", {
        cls: "muted",
        text: "A circuit gets a length when the devices at its ends have equipment items of their names: in one rack, the height between them; in racks side by side, down to the floor, under it along the row and up again; otherwise the shortest way along the cable paths, from a rack or equipment a path reaches, or the drop point equipment names, adding the drop points' Cable Slack. Each end adds a tail, or the swan-neck at a patch panel. A Cable Length typed in is kept.",
      }),
    ],
    check: () => {
      const read = (el: HTMLInputElement): number | null => {
        const mm = parseLength(el.value, units);
        return mm !== null && mm >= 0 ? mm : null;
      };
      const values = [read(swanNeck), read(tail), read(floor)];
      const bad = values.findIndex((v) => v === null);
      if (bad >= 0) return { error: "Enter a length, 0 or more.", focus: [swanNeck, tail, floor][bad] };
      return { value: { all: all.checked, swanNeck: values[0]!, tail: values[1]!, floor: values[2]! } };
    },
  });
}

/** Works out the circuits' lengths, as part of a batch: their Calculated Cable Lengths written and the ones that can't be marked. */
function calculate(s: EditSession, ids: ReadonlySet<string> | null, o: LengthOptions): { worked: number; kept: number; marked: Issue[] } {
  const circuits = circuitsIn(s).filter((c) => !ids || ids.has(c.id));
  const router = circuitRouter(s);
  const lengths = new Map<string, string>();
  const issues: Issue[] = [];
  let kept = 0;
  for (const c of circuits) {
    const typed = cableEndsOf(s, c).length;
    if (typed && typed.toLowerCase() !== "auto") {
      kept++;
      continue;
    }
    const { mm, problems } = router.way(c, o);
    lengths.set(c.id, mm === null ? "" : formatLength(Math.ceil(mm - 1e-6), s.doc.info.units));
    if (!problems.length) continue;
    const facts = circuitFacts(s, c);
    issues.push({
      severity: problems.some((p) => p.severity === "Error") ? "Error" : "Warning",
      kind: "Cable Lengths",
      problem: problems.map((p) => p.problem).join("; "),
      information: `${facts.number || "(no number)"}: ${facts.source} to ${facts.destination}`,
      group: `length:${c.id}`,
      outline: ringAround(facts.mid, 0.8 * facts.pitch),
      layerId: c.layerId,
    });
  }
  setCalculatedLengths(s, lengths);
  // the markup an earlier run left on these circuits goes, all of it on their layers for all circuits
  const groups = ids ? new Set(circuits.map((c) => `length:${c.id}`)) : undefined;
  for (const layerId of new Set(circuits.map((c) => c.layerId))) markIssues(s, layerId, "Cable Lengths", issues.filter((i) => i.layerId === layerId), groups);
  return { worked: [...lengths.values()].filter(Boolean).length, kept, marked: issues };
}

/** The allowances the Cable Length Options dialog last OKed, mm. */
export const lengthOptions = (): LengthOptions => options;

/** Calculate Cable Lengths: the dialog, then the lengths and a count. */
export async function calculateCableLengths(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const circuits = circuitsIn(s);
  if (!circuits.length) {
    toast("Calculate Cable Lengths: the drawing has no circuits.", "info");
    return;
  }
  const selected = circuits.filter((c) => store.selection.has(c.id)).map((c) => c.id);
  const chosen = await chooseOptions(selected.length, s.doc.info.units);
  if (!chosen || store.session !== s) return;
  Object.assign(options, chosen);
  const r = attempt("Calculate Cable Lengths", (session) => session.batch(() => calculate(session, chosen.all ? null : new Set(selected), chosen)));
  if (!r) return;
  const { worked, kept, marked } = r.value;
  const many = (n: number, one: string, more: string): string => `${n} ${n === 1 ? one : more}`;
  const parts = [many(worked, "circuit worked out", "circuits worked out"), kept ? many(kept, "circuit kept its own Cable Length", "circuits kept their own Cable Length") : null, marked.length ? `${many(marked.length, "circuit couldn't be worked out", "circuits couldn't be worked out")}, marked in the class ${MARKUP_CLASS}` : null].filter(Boolean);
  toast(`Calculate Cable Lengths: ${parts.join(", ")}.`, "info");
}
