// ConnectCAD's Analyze Cable Routes and Edit Cabling. Analyze Cable Routes finds each circuit's way
// through the cable paths (cableRouting.ts) and writes each path's Cable Count, the circuits along
// it; circuits it can't route are listed, and Mark up Circuits marks them as Check Drawing marks
// problems (markup.ts). Circuits within one rack or racks side by side need no cable path, and those
// to externals are left out. The Edit Cabling tool lists the cables along the cable path clicked, or
// between two drop points clicked one after the other, with their routes (Route Index: the same
// number for the same way, lettered by its rank between its ends); a double-click on a row shows its
// route on the drawing. Spare cables (pre-cabling) are added between drop points, as circuits between
// two externals on the Spare Cabling layer, and deleted; Select Alternative Route keeps a longer route
// for the cables selected; New Worksheet makes a worksheet of the list.

import "./connectcad.css";
import type { BBox, EditSession, Pt } from "../../../core/index.ts";
import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { ACCENT } from "../../../app/renderer.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { BaseTool, strokeScreen, type Painter, type PointerInfo } from "../../../app/tools.ts";
import { formatLength } from "../../../app/units.ts";
import { lengthOptions } from "./cableLengths.ts";
import { cablePathsIn, dropPointsIn, routeTarget, setCableCounts } from "./cableRoute.ts";
import { routeLetter, spareNumber, type Network } from "./cableRouteShapes.ts";
import { circuitRouter, type CircuitWay, type RouteChoice } from "./cableRouting.ts";
import { settingsNow } from "./ccadShapes.ts";
import { ringAround, type Issue } from "./ccadChecks.ts";
import { report } from "./reports.ts";
import { cablePullRows, type PulledCable, type ReportRow } from "./ccadReports.ts";
import { MARKUP_CLASS, markIssues } from "./markup.ts";
import { addSpareCable, ccadSettings, circuitFacts, circuitsIn, deleteSpareCables, nextSpareAt, reportFacts, routeChoiceOf, setCircuitCable, setCircuitRoutes, SPARE_LAYER } from "./schematic.ts";

type CircuitRouter = ReturnType<typeof circuitRouter>;
/** drop points the path search pairs at most */
const MAX_DROPS = 60;

/** Every circuit's way through the drawing as it is, by circuit, the network they take, and how many run along each cable path. */
export function analyzeRoutes(s: EditSession): { ways: Map<string, CircuitWay>; net: Network; counts: Map<string, number>; router: CircuitRouter } {
  const router = circuitRouter(s);
  const ways = new Map(circuitsIn(s).map((c) => [c.id, router.way(c, lengthOptions())]));
  const net = router.net();
  const counts = new Map<string, number>();
  for (const w of ways.values()) {
    if (w.external || !w.route) continue;
    for (const path of new Set(w.route.edges.map((e) => net.edges[e].path))) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return { ways, net, counts, router };
}

/** Analyze Cable Routes: the paths' Cable Counts written, then a count, or the circuits it couldn't route with Mark up Circuits. */
export async function analyzeCableRoutes(): Promise<void> {
  const s = store.session;
  if (!s) return;
  if (!circuitsIn(s).length) {
    toast("Analyze Cable Routes: the drawing has no circuits.", "info");
    return;
  }
  const r = attempt("Analyze Cable Routes", (session) => session.batch(() => {
    const a = analyzeRoutes(session);
    setCableCounts(session, a.counts);
    return a;
  }));
  if (!r) return;
  const ways = [...r.value.ways];
  const routed = ways.filter(([, w]) => !w.external && w.route).length;
  const racked = ways.filter(([, w]) => !w.external && w.racked).length;
  const external = ways.filter(([, w]) => w.external).length;
  const failed = ways.filter(([, w]) => !w.external && !w.route && !w.racked);
  const many = (n: number, one: string, more: string): string => `${n} ${n === 1 ? one : more}`;
  const said = [many(routed, "circuit runs along the cable paths", "circuits run along the cable paths"), racked ? many(racked, "circuit stays within racks", "circuits stay within racks") : null, external ? many(external, "circuit to externals left out", "circuits to externals left out") : null].filter(Boolean).join(", ");
  if (!failed.length) {
    toast(`Analyze Cable Routes: ${said}.`, "info");
    return;
  }
  const facts = new Map(circuitsIn(s).map((c) => [c.id, c]));
  const issues: Issue[] = failed.flatMap(([id, w]) => {
    const c = facts.get(id);
    if (!c) return [];
    const f = circuitFacts(s, c);
    return [
      {
        severity: w.problems.some((p) => p.severity === "Error") ? "Error" : "Warning",
        kind: "Cable Routes",
        problem: w.problems.map((p) => p.problem).join("; ") || "No cable route found",
        information: `${f.number || "(no number)"}: ${f.source} to ${f.destination}`,
        group: `route:${id}`,
        outline: ringAround(f.mid, 0.8 * f.pitch),
        layerId: c.layerId,
      },
    ];
  });
  const mark = await showDialog<boolean>({
    title: "Analyze Cable Routes",
    okLabel: "Mark up Circuits",
    cls: "ccad-dialog",
    body: [
      h("p", { text: `${said}; ${many(failed.length, "circuit couldn't be given a cable route", "circuits couldn't be given a cable route")}:` }),
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("tr", {}, h("th", { text: "Circuit" }), h("th", { text: "Problem" })), ...issues.map((i) => h("tr", {}, h("td", { text: i.information }), h("td", { text: i.problem }))))),
      h("p", { cls: "muted", text: `Mark up Circuits marks them in the class ${MARKUP_CLASS}. A camera not yet joined to the cable paths can wait; join it with the Cable Route tool, or name its drop point in its equipment's Object Info.` }),
    ],
    check: () => ({ value: true }),
  });
  if (!mark || store.session !== s) return;
  attempt("Mark up Circuits", (session) =>
    session.batch(() => {
      for (const layerId of new Set(circuitsIn(session).map((c) => c.layerId))) markIssues(session, layerId, "Cable Routes", issues.filter((i) => i.layerId === layerId));
    }),
  );
}

/** Cable Pull Report: a worksheet of the cables to pull along each cable route, by cable type, with their lengths, as the drawing is now. */
export async function cablePullReport(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const { ways } = analyzeRoutes(s);
  const facts = new Map(reportFacts(s).circuits.map((c) => [c.id, c]));
  const cables: PulledCable[] = [];
  for (const [id, w] of ways) {
    if (w.external || !w.route || w.mm === null) continue;
    cables.push({ from: w.route.joins[0], to: w.route.joins[1], way: [...w.route.edges].sort((a, b) => a - b).join(), cable: facts.get(id)?.cable.trim() ?? "", mm: w.mm });
  }
  if (!cables.length) {
    toast("Cable Pull Report: no cables run along the cable paths. Analyze Cable Routes says why.", "info");
    return;
  }
  await report("Cable Pull Report", cablePullRows(cables, (mm) => lengthText(s, mm)));
}

/** the routes' colours on the drawing, by letter: the shortest orange, the next blue, then on by length; a row's colour box changes its letter's for the session */
const routeInks = ["#f08c00", "#1c7ed6", "#2f9e44", "#ae3ec9", "#e03131", "#0c8599"];

/** a row of the Edit Cabling list: a circuit's cable, a spare one, or a spare one to make */
interface CablingRow {
  readonly id: string;
  /** a spare cable (Edit Cabling's pre-cabling): its cable type can be edited, and it can be deleted */
  readonly spare: boolean;
  /** to be made on OK */
  readonly fresh: boolean;
  /** the drop points a spare one runs between */
  readonly drops: readonly [string, string] | null;
  readonly number: string;
  readonly signal: string;
  cable: string;
  readonly source: string;
  readonly destination: string;
  /** what it joins the cable paths at, at each end */
  readonly joins: readonly [string, string];
  /** its route: 0 the shortest */
  rank: number;
  edges: readonly number[];
  mm: number | null;
  /** the same number for the same way */
  index: number;
  /** the ways it could take, shortest first */
  readonly choices: () => readonly RouteChoice[];
}

/** a way a new spare cable can take: between two drop points, as the Route Index list offers it */
interface SpareWay {
  readonly label: string;
  readonly drops: readonly [string, string];
  readonly rank: number;
  readonly route: RouteChoice;
  readonly choices: () => readonly RouteChoice[];
}

const once = <T,>(make: () => T): (() => T) => {
  let made: { value: T } | null = null;
  return () => (made ??= { value: make() }).value;
};

/** Numbers the rows' ways, the same number for the same pieces, and sorts them by it and their number. */
function numberWays(rows: CablingRow[]): CablingRow[] {
  const indexes = new Map<string, number>();
  for (const r of rows) {
    const key = [...r.edges].sort((a, b) => a - b).join();
    if (!indexes.has(key)) indexes.set(key, indexes.size + 1);
    r.index = indexes.get(key)!;
  }
  return rows.sort((a, b) => a.index - b.index || a.number.localeCompare(b.number, undefined, { numeric: true }));
}

/** The circuits whose routes `along` picks, spare cables among them. */
function cablingRows(s: EditSession, a: ReturnType<typeof analyzeRoutes>, along: (w: CircuitWay) => boolean): CablingRow[] {
  const facts = new Map(reportFacts(s).circuits.map((c) => [c.id, c]));
  const circuits = new Map(circuitsIn(s).map((c) => [c.id, c]));
  const rows: CablingRow[] = [];
  for (const [id, w] of a.ways) {
    const c = facts.get(id);
    const rec = circuits.get(id);
    if (w.external || !w.route || !along(w) || !c || !rec) continue;
    const kept = routeChoiceOf(s, rec);
    rows.push({ id, spare: !!kept.spare, fresh: false, drops: kept.spare, number: c.number, signal: c.signal, cable: c.cable, source: c.sourceDevice, destination: c.destinationDevice, joins: w.route.joins, rank: kept.rank, edges: w.route.edges, mm: w.mm, index: 0, choices: once(() => a.router.routes(rec, lengthOptions())) });
  }
  return numberWays(rows);
}

const HEADS = ["Route Index", "Number", "Signal", "Cable", "Source", "Destination", "Drop Points", "Length"] as const;
const lengthText = (s: EditSession, mm: number | null): string => (mm === null ? "" : formatLength(Math.ceil(mm - 1e-6), s.doc.info.units));
const cells = (s: EditSession, r: CablingRow): string[] => [`${r.index}${routeLetter(r.rank)}`, r.number, r.signal, r.cable, r.source, r.destination, `${r.joins[0]} – ${r.joins[1]}`, lengthText(s, r.mm)];
/** the same two ends, whichever way round */
const endsKey = (r: CablingRow): string => [...r.joins].sort().join("\u0000");

/** Select Route: the ways between a cable's ends, shortest first; the one picked, or null. */
async function selectRoute(s: EditSession, choices: readonly RouteChoice[], rank: number): Promise<number | null> {
  let picked = Math.min(rank, choices.length - 1);
  const rows = choices.map((c, k) => {
    const use = h("input", { checked: k === picked, attrs: { type: "radio", name: "ccad-route", "aria-label": `Use route ${routeLetter(k)}` } }) as HTMLInputElement;
    use.addEventListener("change", () => use.checked && (picked = k));
    const box = h("span", { cls: "ccad-swatch", attrs: { style: `background:${routeInks[k]}` } });
    return h("tr", {}, h("td", { cls: "ccad-centre" }, use), h("td", { text: routeLetter(k) }), h("td", {}, box), h("td", { text: lengthText(s, c.mm) }), h("td", { text: `${c.edges.length} piece${c.edges.length === 1 ? "" : "s"}` }));
  });
  return showDialog<number>({
    title: "Select Route",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h("p", { text: `The routes between ${choices[0].joins[0]} and ${choices[0].joins[1]}, shortest first.` }),
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...["Use", "Route", "", "Length", "Cable Paths"].map((t) => h("th", { text: t })))), h("tbody", {}, ...rows))),
    ],
    check: () => ({ value: picked }),
  });
}

/** The Edit Cabling dialog: the cables listed, with spare ones added, deleted and given other routes; null when cancelled. */
async function editCabling(s: EditSession, title: string, listed: readonly CablingRow[], ways: readonly SpareWay[], show: (r: CablingRow) => void): Promise<{ rows: CablingRow[]; gone: string[]; sheet: boolean } | null> {
  let rows = [...listed];
  const gone: string[] = [];
  const selected = new Set<string>();
  let sheet = false;
  let fresh = 0;
  const cableList = settingsNow().cables;
  const body = h("div", { cls: "ccad-pane" });
  const note = h("p", { cls: "ccad-note", attrs: { role: "status" } });
  const say = (text: string): void => {
    note.textContent = text;
  };
  const cableInput = (value: string, label: string, set: (v: string) => void): HTMLElement => {
    const el = (cableList.length
      ? h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }, ...[...new Set(["", ...cableList, value])].map((v) => h("option", { value: v, text: v || "None" })))
      : h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label } })) as HTMLInputElement | HTMLSelectElement;
    el.value = value;
    el.addEventListener("change", () => set(el.value));
    return el;
  };
  // what Add makes
  let addCable = cableList[0] ?? "";
  let addCount = 1;
  let addWay = 0;

  const render = (): void => {
    rows = numberWays(rows);
    const tbody = h("tbody", {});
    rows.forEach((r, i) => {
      const n = i + 1;
      const pick = h("input", { checked: selected.has(r.id), attrs: { type: "checkbox", "aria-label": `Select row ${n}` } }) as HTMLInputElement;
      pick.addEventListener("change", () => (pick.checked ? selected.add(r.id) : selected.delete(r.id)));
      const ink = h("input", { cls: "ccad-swatch", value: routeInks[r.rank], attrs: { type: "color", "aria-label": `Colour of row ${n}`, title: "The colour its route shows in" } }) as HTMLInputElement;
      ink.addEventListener("change", () => {
        routeInks[r.rank] = ink.value;
        render();
      });
      const text = cells(s, r);
      const tr = h(
        "tr",
        { cls: r.spare ? "" : "ccad-assigned", attrs: { title: r.spare ? "A spare cable · double-click to show its route" : "Assigned to a circuit · double-click to show its route" } },
        h("td", { cls: "ccad-centre" }, pick),
        h("td", {}, ink),
        h("td", { cls: "ccad-num", text: text[0] }),
        ...text.slice(1).map((v, k) => (k === 2 && r.spare ? h("td", {}, cableInput(r.cable, `Cable of row ${n}`, (c) => (r.cable = c))) : h("td", { text: v }))),
      );
      tr.addEventListener("dblclick", (e) => {
        if ((e.target as HTMLElement).closest("input, select")) return;
        show(r);
        // the keys stay with the dialog
        pick.focus();
      });
      tbody.append(tr);
    });
    const routeList = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Route Index" } }, ...(ways.length ? ways.map((w, k) => h("option", { value: String(k), text: w.label })) : [h("option", { value: "", text: "No drop points to join" })])) as HTMLSelectElement;
    routeList.value = ways.length ? String(addWay) : "";
    routeList.addEventListener("change", () => (addWay = Number(routeList.value)));
    const count = h("input", { cls: "menu-dialog-input ccad-num", value: String(addCount), attrs: { type: "text", "aria-label": "Quantity" } }) as HTMLInputElement;
    count.addEventListener("input", () => {
      const v = Math.round(Number(count.value));
      if (v >= 1 && v <= 100) addCount = v;
    });
    const add = button("Add", () => {
      const w = ways[addWay];
      if (!w) return;
      for (let k = 0; k < addCount; k++) {
        const id = `new:${++fresh}`;
        rows.push({ id, spare: true, fresh: true, drops: w.drops, number: "(new)", signal: ccadSettings.signal, cable: addCable, source: w.drops[0], destination: w.drops[1], joins: w.route.joins, rank: w.rank, edges: w.route.edges, mm: w.route.mm, index: 0, choices: w.choices });
      }
      say(`${addCount} spare cable${addCount === 1 ? "" : "s"} added between ${w.drops[0]} and ${w.drops[1]}; OK makes ${addCount === 1 ? "it" : "them"} on the ${SPARE_LAYER} layer.`);
      render();
    });
    add.disabled = !ways.length;
    const picked = (): CablingRow[] => rows.filter((r) => selected.has(r.id));
    body.replaceChildren(
      h("p", { text: `${title} · Cable Count: ${rows.length}` }),
      h(
        "div",
        { cls: "ccad-scroll" },
        h("table", { cls: "ccad-table ccad-cabling" }, h("thead", {}, h("tr", {}, h("th", { text: "" }), h("th", { text: "" }), ...HEADS.map((t) => h("th", { text: t })))), tbody),
      ),
      h(
        "div",
        { cls: "ccad-actions" },
        h("span", { cls: "menu-dialog-label", text: "Cable Type" }),
        cableInput(addCable, "Cable Type", (v) => (addCable = v)),
        h("span", { cls: "menu-dialog-label", text: "Quantity" }),
        count,
        h("span", { cls: "menu-dialog-label", text: "Route Index" }),
        routeList,
        add,
      ),
      h(
        "div",
        { cls: "ccad-actions" },
        button("Delete", () => {
          const chosen = picked();
          if (!chosen.length) return say("Select the spare cables to delete first.");
          const spare = chosen.filter((r) => r.spare);
          for (const r of spare) {
            if (!r.fresh) gone.push(r.id);
            selected.delete(r.id);
          }
          rows = rows.filter((r) => !spare.includes(r));
          const kept = chosen.length - spare.length;
          say(`${spare.length} spare cable${spare.length === 1 ? "" : "s"} deleted${kept ? `; ${kept} assigned to circuits can't be deleted here` : ""}.`);
          render();
        }),
        button("Select Alternative Route", () => {
          const chosen = picked();
          if (!chosen.length) return say("Select the cables to give another route first.");
          if (new Set(chosen.map(endsKey)).size > 1) return say("The cables selected run between different places: select cables between the same two.");
          const choices = chosen[0].choices();
          if (choices.length < 2) return say(`No other route joins ${chosen[0].joins[0]} and ${chosen[0].joins[1]}.`);
          void selectRoute(s, choices, chosen[0].rank).then((rank) => {
            if (rank === null) return;
            for (const r of chosen) {
              const c = r.choices()[rank];
              if (!c) continue;
              Object.assign(r, { rank, edges: c.edges, mm: c.mm });
            }
            say(`${chosen.length} cable${chosen.length === 1 ? "" : "s"} given route ${routeLetter(rank)}.`);
            render();
          });
        }),
        button("New Worksheet", () => {
          sheet = true;
          (body.closest("form") as HTMLFormElement | null)?.requestSubmit();
        }),
      ),
      note,
      h("p", {
        cls: "muted",
        text: `Cables assigned to circuits are grey and can only be given another route; spare ones (pre-cabling) can be added between drop points, given a cable type, and deleted. Rows of one Route Index take the same way; its letter is the route between its ends, A the shortest. Double-click a row to show its route; the colour boxes set the routes' colours. OK makes the spare cables on the ${SPARE_LAYER} layer and keeps the routes; New Worksheet does so and lists the cables.`,
      }),
    );
  };
  render();
  return showDialog({
    title: "Edit Cabling",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [body],
    check: () => ({ value: { rows, gone, sheet } }),
  });
}

const button = (label: string, run: () => void): HTMLButtonElement => {
  const b = h("button", { cls: "menu-dialog-button", text: label, attrs: { type: "button" } }) as HTMLButtonElement;
  b.addEventListener("click", run);
  return b;
};

/** Writes what Edit Cabling changed, in one undo step: spare cables deleted and made (on the Spare Cabling layer, at `layerOf`'s scale when it's new), routes kept and spare cables' types; then the paths' Cable Counts. */
function applyCabling(done: { rows: readonly CablingRow[]; gone: readonly string[] }, layerOf: string | null): void {
  const fresh = done.rows.filter((r) => r.fresh);
  const r = attempt("Edit Cabling", (s) =>
    s.batch(() => {
      deleteSpareCables(s, done.gone);
      const circuits = new Map(circuitsIn(s).map((c) => [c.id, c]));
      const facts = new Map(reportFacts(s).circuits.map((c) => [c.id, c]));
      const ranks = new Map<string, number>();
      let cables = 0;
      for (const row of done.rows) {
        const c = circuits.get(row.id);
        if (!c) continue;
        if (routeChoiceOf(s, c).rank !== row.rank) ranks.set(row.id, row.rank);
        if (row.spare && facts.get(row.id)?.cable !== row.cable) {
          setCircuitCable(s, row.id, row.cable);
          cables++;
        }
      }
      setCircuitRoutes(s, ranks);
      if (fresh.length) {
        const layerId = s.doc.layers().find((l) => l.kind === "design" && l.name === SPARE_LAYER)?.id ?? s.createLayer(SPARE_LAYER, "design", s.doc.layers().find((l) => l.id === layerOf)?.scale);
        const numbers = new Set([...facts.values()].map((c) => c.number));
        for (const row of fresh) {
          const number = spareNumber(row.drops![0], row.drops![1], numbers);
          numbers.add(number);
          addSpareCable(s, layerId, nextSpareAt(s, layerId), row.drops!, number, row.cable, row.rank);
        }
      }
      setCableCounts(s, analyzeRoutes(s).counts);
      return { made: fresh.length, gone: done.gone.length, routes: ranks.size, cables };
    }),
  );
  if (!r) return;
  const { made, gone, routes, cables } = r.value;
  const said = [made ? `${made} spare cable${made === 1 ? "" : "s"} made on the ${SPARE_LAYER} layer` : "", gone ? `${gone} deleted` : "", routes ? `${routes} route${routes === 1 ? "" : "s"} kept` : "", cables ? `${cables} cable type${cables === 1 ? "" : "s"} set` : ""].filter(Boolean);
  if (said.length) toast(`Edit Cabling: ${said.join(", ")}.`, "info");
}

/** The Edit Cabling tool: a click on a cable path, or on one drop point and then another, lists the cables along it or between them, to add spare ones, delete them and give them other routes; a row double-clicked shows its route. */
export class EditCablingTool extends BaseTool {
  readonly id = "cceditcabling";
  readonly cursor = "crosshair";
  private pointer: Pt | null = null;
  /** the first drop point clicked */
  private from: { id: string; name: string; at: Pt } | null = null;
  /** the route shown, as lines on the drawing, and its colour */
  private shown: Pt[][] = [];
  private ink = routeInks[0];

  hint(): string {
    if (this.from) return `Click the drop point at the other end from ${this.from.name} · Esc cancels`;
    return "Click a cable path to list the cables along it, or a drop point, then another, for those between them";
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const s = store.session;
    if (!s) return;
    this.shown = [];
    const on = routeTarget(s.doc, p.raw, 8 / this.env.view.scale);
    if (!on) return;
    if (on.kind === "drop") {
      const name = String(s.doc.records(on.id).find((r) => r.parametric)?.fields.find((f) => f.name === "Name")?.value ?? "").trim();
      if (!this.from || this.from.id === on.id) {
        this.from = { id: on.id, name, at: on.at };
        return;
      }
      const a = this.from.name;
      this.from = null;
      return void this.list(
        `Between drop points ${a} and ${name}`,
        (w) => !!w.route && ((w.route.joins[0] === a && w.route.joins[1] === name) || (w.route.joins[0] === name && w.route.joins[1] === a)),
        (router) => router.between(a, name).map((route, rank) => ({ label: `${routeLetter(rank)} · ${lengthText(s, route.mm)}`, drops: [a, name] as const, rank, route, choices: once(() => router.between(a, name)) })),
        `no circuits run between drop points ${a} and ${name}, and no cable route joins them`,
      );
    }
    this.from = null;
    const path = on.id;
    void this.list(
      "Along the cable path clicked",
      (w, net) => !!w.route && w.route.edges.some((e) => net.edges[e].path === path),
      (router, net) => {
        // spare cables go between drop points: those whose shortest route runs along it
        const names = [...new Set(dropPointsIn(s.doc).map((d) => d.name).filter(Boolean))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).slice(0, MAX_DROPS);
        const out: SpareWay[] = [];
        for (let i = 0; i < names.length; i++)
          for (let j = i + 1; j < names.length; j++) {
            const [route] = router.between(names[i], names[j], 1);
            const drops = [names[i], names[j]] as const;
            if (route?.edges.some((e) => net.edges[e].path === path)) out.push({ label: `${drops[0]} – ${drops[1]} · ${lengthText(s, route.mm)}`, drops, rank: 0, route, choices: once(() => router.between(drops[0], drops[1])) });
          }
        return out;
      },
      "no circuits run along that cable path, and no two drop points' route does",
    );
  }

  private async list(title: string, along: (w: CircuitWay, net: Network) => boolean, spares: (router: CircuitRouter, net: Network) => SpareWay[], none: string): Promise<void> {
    const s = store.session;
    if (!s) return;
    // worked out as the drawing is now, nothing written until OK
    const a = analyzeRoutes(s);
    const rows = cablingRows(s, a, (w) => along(w, a.net));
    const ways = spares(a.router, a.net);
    if (!rows.length && !ways.length) {
      toast(`Edit Cabling: ${none}.`, "info");
      return;
    }
    const layerOf = circuitsIn(s).find((c) => rows.some((r) => r.id === c.id))?.layerId ?? store.activeLayerId;
    const done = await editCabling(s, title, rows, ways, (r) => this.show(a.net, r));
    if (!done || store.session !== s) return;
    applyCabling(done, layerOf);
    if (!done.sheet) return;
    const now = analyzeRoutes(s);
    const listed = cablingRows(s, now, (w) => along(w, now.net));
    return report("Edit Cabling", [HEADS.map((h) => ({ value: h, bold: true })), ...listed.map((r) => cells(s, r).map((value) => ({ value })))] as ReportRow[]);
  }

  /** Shows a row's route on the drawing, in its letter's colour, the drawing fitted round it. */
  private show(net: Network, r: CablingRow): void {
    this.ink = routeInks[r.rank];
    this.shown = r.edges.map((e) => {
      const edge = net.edges[e];
      return [net.nodes[edge.a], net.nodes[edge.b]];
    });
    const pts = this.shown.flat();
    if (!pts.length) return;
    const box: BBox = { x0: Math.min(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), x1: Math.max(...pts.map((q) => q.x)), y1: Math.max(...pts.map((q) => q.y)) };
    if (box.x1 - box.x0 > 1 || box.y1 - box.y0 > 1) this.env.view.fit(box, 0.2);
    this.env.requestDraw();
  }

  cancel(): void {
    this.from = null;
    this.shown = [];
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || (!this.from && !this.shown.length)) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    const s = store.session;
    g.ctx.save();
    // the route shown in its letter's colour: orange the shortest, as Vectorworks shows it
    g.ctx.strokeStyle = this.ink;
    g.ctx.lineWidth = 5;
    for (const line of this.shown) strokeScreen(g, line, false);
    g.ctx.strokeStyle = ACCENT;
    g.ctx.lineWidth = 2;
    if (this.from) {
      const c = g.toScreen(this.from.at);
      g.ctx.strokeRect(c.x - 10, c.y - 10, 20, 20);
    }
    const on = s && this.pointer ? routeTarget(s.doc, this.pointer, 8 / this.env.view.scale) : null;
    if (on?.kind === "path") strokeScreen(g, cablePathsIn(s!.doc).find((p) => p.id === on.id)?.points ?? [], false);
    else if (on?.kind === "drop") {
      const c = g.toScreen(on.at);
      g.ctx.strokeRect(c.x - 10, c.y - 10, 20, 20);
    }
    g.ctx.restore();
  }
}
