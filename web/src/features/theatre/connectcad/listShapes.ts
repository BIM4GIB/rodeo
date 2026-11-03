// The sums behind ConnectCAD's cable list commands (lists.ts): a cable list's columns found by their
// headings (as the circuit reports write them, or near enough), its rows read as circuits from one
// device's socket to another's, and the list compared with the circuits on the drawing: a circuit
// on both whose number differs, one in the list but not on the drawing, and one on the drawing but
// not in the list. Device and socket names match whatever their case. Kept apart so it runs without
// the page.

import type { Pt } from "../../../core/index.ts";

export type Table = readonly (readonly string[])[];

export interface ListEnd {
  readonly device: string;
  readonly socket: string;
}

/** A row of a cable list: its row in the table (from 0), its number and cable, and its two ends. */
export interface ListCircuit {
  readonly row: number;
  readonly number: string;
  readonly cable: string;
  readonly source: ListEnd;
  readonly destination: ListEnd;
}

/** A circuit on the drawing, as a list names it, and halfway along its run. */
export interface DrawnCircuit {
  readonly id: string;
  readonly number: string;
  readonly source: ListEnd;
  readonly destination: ListEnd;
  readonly mid: Pt;
}

export type ListCheck =
  | { readonly kind: "ok"; readonly id: string }
  | { readonly kind: "number"; readonly id: string; readonly drawn: string }
  /** both its sockets are on the drawing, but no circuit joins them */
  | { readonly kind: "missing" }
  /** a device or socket it names isn't on the drawing */
  | { readonly kind: "absent"; readonly what: string };

const COLUMNS = {
  number: ["number", "circuitnumber", "circuitno", "cablenumber", "cableno", "no", "num"],
  cable: ["cable", "cabletype"],
  sourceDevice: ["sourcedevice", "srcdevice", "fromdevice", "source", "src", "from"],
  sourceSocket: ["sourcesocket", "srcsocket", "fromsocket", "sourceport", "srcport", "fromport"],
  destinationDevice: ["destinationdevice", "destdevice", "dstdevice", "todevice", "destination", "dest", "dst", "to"],
  destinationSocket: ["destinationsocket", "destsocket", "dstsocket", "tosocket", "destinationport", "destport", "toport"],
} as const;

export type ListColumns = { readonly [K in keyof typeof COLUMNS]: number };

const plain = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The first row whose headings name both ends' devices and sockets, and each column it names (-1 for none). */
export function listHeader(rows: Table): { readonly header: number; readonly columns: ListColumns } | null {
  for (let r = 0; r < rows.length; r++) {
    const heads = rows[r].map(plain);
    const columns = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, heads.findIndex((x) => (names as readonly string[]).includes(x))])) as unknown as ListColumns;
    if (columns.sourceDevice >= 0 && columns.sourceSocket >= 0 && columns.destinationDevice >= 0 && columns.destinationSocket >= 0) return { header: r, columns };
  }
  return null;
}

/** The circuits a cable list's rows below its header name: those naming both devices. */
export function listCircuits(rows: Table, header: number, columns: ListColumns): ListCircuit[] {
  const at = (row: readonly string[], col: number): string => (col >= 0 ? (row[col] ?? "").trim() : "");
  return rows.slice(header + 1).flatMap((row, i): ListCircuit[] => {
    const source = { device: at(row, columns.sourceDevice), socket: at(row, columns.sourceSocket) };
    const destination = { device: at(row, columns.destinationDevice), socket: at(row, columns.destinationSocket) };
    return source.device && destination.device ? [{ row: header + 1 + i, number: at(row, columns.number), cable: at(row, columns.cable), source, destination }] : [];
  });
}

/** A socket's key in a lookup: its device's name and its own, whatever their case. */
export const endKey = (e: ListEnd): string => `${e.device.trim().toLowerCase()}\n${e.socket.trim().toLowerCase()}`;
/** A circuit's ends, either way round. */
const pairKey = (a: ListEnd, b: ListEnd): string => [endKey(a), endKey(b)].sort().join("\n\n");

/**
 * A cable list compared with the drawing's circuits: for each of its circuits, whether the drawing
 * has it (and with the list's number), or why not (`has` says whether a socket is on the drawing);
 * and the drawing's circuits the list hasn't. A list without a number for a circuit doesn't differ
 * from the drawing's number.
 */
export function compareList(list: readonly ListCircuit[], drawn: readonly DrawnCircuit[], has: (e: ListEnd) => boolean): { checks: ListCheck[]; unlisted: DrawnCircuit[] } {
  const by = new Map<string, DrawnCircuit[]>();
  for (const c of drawn) {
    const k = pairKey(c.source, c.destination);
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  const used = new Set<string>();
  // a row whose number the drawing has first, so two circuits between the same sockets pair up by number
  const order = [...list.keys()].sort((a, b) => Number(!list[a].number) - Number(!list[b].number));
  const checks: ListCheck[] = new Array(list.length);
  for (const i of order) {
    const c = list[i];
    const free = (by.get(pairKey(c.source, c.destination)) ?? []).filter((d) => !used.has(d.id));
    const match = free.find((d) => d.number === c.number) ?? free[0];
    if (match) {
      used.add(match.id);
      checks[i] = c.number && match.number !== c.number ? { kind: "number", id: match.id, drawn: match.number } : { kind: "ok", id: match.id };
      continue;
    }
    const gone = [c.source, c.destination].find((e) => !has(e));
    checks[i] = gone ? { kind: "absent", what: `${gone.device} : ${gone.socket}` } : { kind: "missing" };
  }
  return { checks, unlisted: drawn.filter((d) => !used.has(d.id)) };
}

/** What a list's Check column says of a row. */
export function checkText(c: ListCheck): string {
  if (c.kind === "ok") return "OK";
  if (c.kind === "number") return `Number differs: the drawing has ${c.drawn || "no number"}`;
  if (c.kind === "missing") return "Not on the drawing";
  return `Not on the drawing: ${c.what} isn't on the layer`;
}

/** The list's rows with a Check column after its last: its heading, then each circuit's check. */
export function checkedRows(rows: Table, header: number, list: readonly ListCircuit[], checks: readonly ListCheck[]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const said = new Map(list.map((c, i) => [c.row, checkText(checks[i])]));
  return rows.map((r, i) => [...r, ...Array.from({ length: width - r.length }, () => ""), i === header ? "Check" : (said.get(i) ?? "")]);
}

/** A text file's delimiter: a tab, a semicolon or a comma, whichever its first line has most of. */
export function delimiterOf(text: string): string {
  const first = text.split(/\r\n|\r|\n/, 1)[0] ?? "";
  const count = (c: string): number => first.split(c).length - 1;
  return ["\t", ";", ","].reduce((best, c) => (count(c) > count(best) ? c : best), ",");
}
