// The sums behind Tools > Class and Layer Mapping: what a list of proposed names asks for, and Vectorworks'
// mapping files, a text file for classes and another for layers. Kept apart from the page so a check can run it.

/** A class or layer and the name proposed for it: blank to delete it, another's to merge with it. */
export interface MappingRow {
  readonly existing: string;
  readonly proposed: string;
}

export interface MappingPlan {
  /** those going into another, by name */
  readonly merges: readonly { readonly from: string; readonly into: string }[];
  readonly deletes: readonly string[];
  /** those keeping their contents under a new name; one's new name may be what another is called now */
  readonly renames: readonly { readonly from: string; readonly to: string }[];
}

export type MappingKind = "class" | "layer";

const clean = (rows: readonly MappingRow[]): MappingRow[] => rows.map((r) => ({ existing: r.existing, proposed: r.proposed.trim() }));

/** Those proposing one name go into the one already called it, or else the first of them, which takes the name. */
export function mappingPlan(rows: readonly MappingRow[]): MappingPlan {
  const merges: { from: string; into: string }[] = [];
  const deletes: string[] = [];
  const renames: { from: string; to: string }[] = [];
  const groups = new Map<string, MappingRow[]>();
  for (const r of clean(rows)) {
    if (!r.proposed) deletes.push(r.existing);
    else groups.set(r.proposed, [...(groups.get(r.proposed) ?? []), r]);
  }
  for (const [name, group] of groups) {
    const keeper = group.find((r) => r.existing === name) ?? group[0];
    if (keeper.existing !== name) renames.push({ from: keeper.existing, to: name });
    for (const r of group) if (r !== keeper) merges.push({ from: r.existing, into: keeper.existing });
  }
  return { merges, deletes, renames };
}

/** The rows as a mapping file: those to delete aren't listed. */
export function mappingText(kind: MappingKind, rows: readonly MappingRow[]): string {
  const plan = mappingPlan(rows);
  const merged = new Set(plan.merges.map((m) => m.from));
  const lines = clean(rows)
    .filter((r) => r.proposed)
    .map((r) => `${r.existing === r.proposed ? "Same" : merged.has(r.existing) ? "Merged" : "Renamed"}\t${r.existing}\t${r.proposed}`);
  return [`This is the ${kind} mapping file`, ...lines, `End of ${kind} mapping`].join("\n") + "\n";
}

/** What a mapping file proposes for each it lists (those it doesn't list are to be deleted), or why it can't be read. */
export function parseMapping(kind: MappingKind, text: string): ReadonlyMap<string, string> | string {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (lines[0]?.trim() !== `This is the ${kind} mapping file`) return `That isn't a ${kind} mapping file: its first line should be "This is the ${kind} mapping file".`;
  if (lines.at(-1)?.trim() !== `End of ${kind} mapping`) return `That ${kind} mapping file has no last line "End of ${kind} mapping".`;
  const out = new Map<string, string>();
  for (const line of lines.slice(1, -1)) {
    const [how, existing, proposed] = line.split("\t");
    if (!["Renamed", "Same", "Merged"].includes(how?.trim() ?? "") || !existing || proposed === undefined) return `This line in the mapping file can't be read: ${line}`;
    out.set(existing, how.trim() === "Same" ? existing : proposed);
  }
  return out;
}
