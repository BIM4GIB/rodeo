// The library's API as the agents read it: each method of EditSession (the edits) and VwxDocument
// (the reads) with its signature and doc comment, and each exported type, parsed from the source
// of core/types.ts, so it never drifts from the code. The prompt lists the names; the api_docs
// tool gives the details on demand.

import TYPES from "../../core/types.ts?raw";

export type ApiInterface = "EditSession" | "VwxDocument";

export interface Member {
  readonly name: string;
  readonly signature: string;
  readonly doc: string;
  /** the comment heading the group it is in ("layers", "walls", ...) */
  readonly section: string;
  readonly method: boolean;
}

const LINES = TYPES.split("\n");

/** The doc comment's text without its stars. */
function cleanDoc(lines: readonly string[]): string {
  return lines
    .map((l) => l.trim().replace(/^\/\*\*\s?|\s?\*\/$|^\*\s?/g, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Where a top-level block starts and ends (its closing line at column 0). */
function blockEnd(start: number): number {
  for (let i = start + 1; i < LINES.length; i++) if (/^[}\]]/.test(LINES[i])) return i;
  return LINES.length - 1;
}

function parseInterface(name: ApiInterface): Member[] {
  const start = LINES.findIndex((l) => l.startsWith(`export interface ${name} `));
  if (start < 0) return [];
  const end = blockEnd(start);
  const out: Member[] = [];
  let doc: string[] = [];
  let inDoc = false;
  let section = "";
  for (let i = start + 1; i < end; i++) {
    const line = LINES[i];
    const t = line.trim();
    if (inDoc) {
      doc.push(line);
      if (t.endsWith("*/")) inDoc = false;
      continue;
    }
    if (t.startsWith("/**")) {
      doc = [line];
      inDoc = !t.endsWith("*/");
      continue;
    }
    if (t.startsWith("//")) {
      section = t.replace(/^\/\/\s*/, "");
      continue;
    }
    const m = /^ {2}(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)([(:<])/.exec(line);
    if (!m) {
      if (t) doc = [];
      continue;
    }
    // the signature runs to the line ending its brackets with a semicolon
    const sig: string[] = [t];
    let depth = 0;
    const count = (s: string): void => {
      for (const ch of s) {
        if (ch === "(" || ch === "{" || ch === "[") depth++;
        else if (ch === ")" || ch === "}" || ch === "]") depth--;
      }
    };
    count(t);
    while ((depth > 0 || !sig[sig.length - 1].endsWith(";")) && i + 1 < end) {
      i++;
      const next = LINES[i].trim();
      sig.push(next);
      count(next);
    }
    out.push({ name: m[1], signature: sig.join(" ").replace(/\s+/g, " "), doc: cleanDoc(doc), section, method: m[3] !== ":" });
    doc = [];
  }
  return out;
}

const MEMBERS: Record<ApiInterface, Member[]> = { EditSession: parseInterface("EditSession"), VwxDocument: parseInterface("VwxDocument") };

/** Names of the methods of an interface, in source order. */
export function methodNames(iface: ApiInterface): string[] {
  return MEMBERS[iface].filter((m) => m.method).map((m) => m.name);
}

/** Every member (methods and properties) of an interface. */
export function members(iface: ApiInterface): readonly Member[] {
  return MEMBERS[iface];
}

/** The source of an exported type or interface (or a const's declaration line), or null. */
export function typeSource(name: string): string | null {
  const re = new RegExp(`^export (?:interface|type|const|enum) ${name.replace(/[^\w$]/g, "")}\\b`);
  const start = LINES.findIndex((l) => re.test(l));
  if (start < 0) return null;
  // a leading doc comment belongs to it
  let from = start;
  if (LINES[start - 1]?.trim().endsWith("*/")) {
    while (from > 0 && !LINES[from - 1].trim().startsWith("/**")) from--;
    from--;
  }
  const head = LINES[start];
  let end = start;
  if (/\{\s*$/.test(head) || /=\s*$/.test(head) || /\[\s*$/.test(head)) {
    end = /^export type .*=\s*$/.test(head) ? typeEnd(start) : blockEnd(start);
  } else if (!head.trim().endsWith(";")) {
    end = typeEnd(start);
  }
  return LINES.slice(Math.max(0, from), end + 1).join("\n");
}

/** A multi-line `export type X =` ends at the first line ending with a semicolon outside brackets. */
function typeEnd(start: number): number {
  let depth = 0;
  for (let i = start; i < LINES.length; i++) {
    for (const ch of LINES[i]) {
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
    }
    if (depth <= 0 && LINES[i].trim().endsWith(";")) return i;
  }
  return LINES.length - 1;
}

/** Exported type names in types.ts. */
export function typeNames(): string[] {
  const out: string[] = [];
  for (const l of LINES) {
    const m = /^export (?:interface|type) ([A-Za-z_$][\w$]*)/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Docs for names (methods of either interface, or types), as text for a model. */
export function docsFor(names: readonly string[]): string {
  const parts: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/^(?:session|doc|edit|EditSession|VwxDocument)\./, "").trim();
    if (!name) continue;
    const found: string[] = [];
    for (const iface of ["EditSession", "VwxDocument"] as const) {
      for (const m of MEMBERS[iface]) {
        if (m.name !== name) continue;
        found.push(`${iface === "EditSession" ? "edit" : "doc"}.${m.signature}${m.doc ? `\n  ${m.doc}` : ""}`);
      }
    }
    const t = typeSource(name);
    if (t) found.push(t);
    parts.push(found.length ? found.join("\n") : `${name}: not found (api_docs with search finds names)`);
  }
  return parts.join("\n\n");
}

/** Members and types whose name or doc mentions every word of `query`, as one line each. */
export function searchDocs(query: string, limit = 40): string {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const hit = (s: string): boolean => words.every((w) => s.includes(w));
  const lines: string[] = [];
  for (const iface of ["EditSession", "VwxDocument"] as const) {
    for (const m of MEMBERS[iface]) {
      if (!hit(`${m.name} ${m.section} ${m.doc}`.toLowerCase())) continue;
      const first = m.doc.split(/(?<=\.)\s/)[0] ?? "";
      lines.push(`${iface === "EditSession" ? "edit" : "doc"}.${m.name}${m.method ? "()" : ""}${first ? ` — ${first.slice(0, 160)}` : ""}`);
    }
  }
  for (const t of typeNames()) if (hit(t.toLowerCase())) lines.push(`type ${t}`);
  return lines.length > limit ? `${lines.slice(0, limit).join("\n")}\n… ${lines.length - limit} more: narrow the search` : lines.join("\n");
}
