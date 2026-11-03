// The sums behind the Device tool's eyedropper (Pick Up and Apply; schematic.ts transferDevice): a
// target device's sockets after a source device's are transferred onto it. A socket of the same name
// takes the source socket's settings and place, keeping its own number so its circuits stay; a socket
// only the source has is added, moved down a row at a time past any socket in its way; one only the
// target has is kept or deleted as asked (Missing Socket Action). Kept apart so it runs without the
// page.

import type { Socket } from "./ccadShapes.ts";

export type MissingSockets = "keep" | "unconnected" | "all";

export const MISSING_SOCKETS: readonly { readonly id: MissingSockets; readonly label: string }[] = [
  { id: "keep", label: "Do not delete any sockets" },
  { id: "unconnected", label: "Delete if not connected" },
  { id: "all", label: "Delete even if connected" },
];

/**
 * A target device's sockets with a source device's transferred onto them (`connected`: the target's
 * socket numbers a circuit joins): its new sockets, and the numbers of those deleted.
 */
export function transferredSockets(source: readonly Socket[], target: readonly Socket[], missing: MissingSockets, connected: ReadonlySet<number>): { sockets: Socket[]; deleted: number[] } {
  const named = new Map<string, Socket>();
  for (const k of target) if (!named.has(k.name)) named.set(k.name, k);
  const matched = new Set(source.flatMap((k) => (named.has(k.name) ? [k.name] : [])));
  let next = Math.max(0, ...target.map((k) => k.id));
  // each source socket's number on the target: the same-named socket's, or a new one
  const idOf = new Map(source.map((k) => [k.id, named.get(k.name)?.id ?? ++next]));
  const taken = new Set<string>();
  const place = (k: Socket): Socket => {
    let slot = k.slot;
    while (taken.has(`${k.side}${slot}`)) slot++;
    taken.add(`${k.side}${slot}`);
    return slot === k.slot ? k : { ...k, slot };
  };
  const copy = (k: Socket): Socket => {
    const { loop, ...rest } = k;
    const partner = loop === undefined ? undefined : idOf.get(loop);
    return { ...rest, id: idOf.get(k.id)!, ...(partner === undefined ? {} : { loop: partner }) };
  };
  const unique = target.filter((k) => named.get(k.name) !== k || !matched.has(k.name));
  const deleted = unique.filter((k) => missing === "all" || (missing === "unconnected" && !connected.has(k.id))).map((k) => k.id);
  // the matched in the source's places, then the target's own kept where they are if they can be, then the new
  const sockets = [
    ...source.filter((k) => matched.has(k.name)).map((k) => place(copy(k))),
    ...unique.filter((k) => !deleted.includes(k.id)).map(place),
    ...source.filter((k) => !matched.has(k.name)).map((k) => place(copy(k))),
  ];
  return { sockets, deleted };
}
