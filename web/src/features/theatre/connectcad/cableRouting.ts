// The way each circuit's cable takes, for Calculate Cable Lengths (cableLengths.ts), Analyze Cable
// Routes and the Edit Cabling tool (cableAnalysis.ts): from the equipment items named as the devices
// at its ends, within one rack or racks side by side by the Cable Length Options' allowances
// (cableLengthShapes.ts), otherwise along the shortest way through the cable paths (cableRoute.ts), or
// the route kept for it (Select Alternative Route: the second shortest, the third…), joined at a
// rack, at equipment standing on its own, or at the drop point it names (cableRouteShapes.ts); a
// spare cable between the two drop points it names; and what stands in the way when there's none.

import type { EditSession, Pt } from "../../../core/index.ts";
import { alongRacks, cableLength, endAllowance, type CableEnd, type LengthOptions } from "./cableLengthShapes.ts";
import { cableNetwork, dropPointsIn } from "./cableRoute.ts";
import { ATTACH, joinAtDrop, joinAtOutline, nodesNear, routeLetter, shortestRoute, shortestRoutes, type Network } from "./cableRouteShapes.ts";
import type { Severity } from "./ccadChecks.ts";
import { equipmentSpots, type EquipmentSpot } from "./equipmentItem.ts";
import { rackFeet, rackPlace } from "./equipmentRack.ts";
import { cableEndsOf, routeChoiceOf, type CableDevice, type circuitsIn } from "./schematic.ts";

type Circuit = ReturnType<typeof circuitsIn>[number];

export interface Problem {
  readonly severity: Severity;
  readonly problem: string;
}

/** A circuit's way: its length with the allowances (null when it can't be found), whether it stays within racks, its way through the cable network (by edge) with where it joins at each end, and what stands in the way. */
export interface CircuitWay {
  readonly mm: number | null;
  readonly racked: boolean;
  readonly route: { readonly edges: readonly number[]; readonly joins: readonly [string, string]; readonly places: readonly [Pt, Pt]; readonly layers: readonly [string, string] } | null;
  readonly problems: readonly Problem[];
  /** an end is an external, outside the system */
  readonly external: boolean;
}

/** A way a cable could take through the network: its length with the allowances, its pieces (by edge) and where it joins at each end. */
export interface RouteChoice {
  readonly mm: number;
  readonly edges: readonly number[];
  readonly joins: readonly [string, string];
}

type End = CableEnd & { name: string; spot: EquipmentSpot };
type Join = { at: Map<number, number>; slack: number; by: string; place: Pt; layer: string };
/** where a cable's ends join the network, with the length it takes besides; or the way it takes without the network */
type Ends = { from: Join; to: Join; extra: number; names: readonly [string, string]; external: boolean } | { way: CircuitWay };

/** Finds circuits' ways in the drawing as it is: the network and the equipment found once, for all of them. */
export function circuitRouter(s: EditSession): {
  net(): Network;
  way(c: Circuit, o: LengthOptions): CircuitWay;
  /** the ways a circuit's cable could take through the network, shortest first (none when it needs none or has none) */
  routes(c: Circuit, o: LengthOptions): RouteChoice[];
  /** the ways between two drop points, by name, shortest first: `k` at most */
  between(a: string, b: string, k?: number): RouteChoice[];
} {
  const spots = equipmentSpots(s.doc);
  const feet = rackFeet(s.doc);
  const rackName = (id: string): string => rackPlace(s.doc, id)?.rackId || "(no Rack ID)";
  // the cable network and its drop points, found when a circuit first needs them
  let network: Network | null = null;
  const net = (): Network => (network ??= cableNetwork(s.doc));
  let dropList: ReturnType<typeof dropPointsIn> | null = null;
  const drops = (): ReturnType<typeof dropPointsIn> => (dropList ??= dropPointsIn(s.doc));

  /** a spare cable's ends: the drop points it names */
  function dropEnds(names: readonly [string, string], problems: Problem[]): Ends {
    const fail = (severity: Severity, problem: string): null => {
      problems.push({ severity, problem });
      return null;
    };
    const none: Ends = { way: { mm: null, racked: false, route: null, problems, external: false } };
    if (!net().edges.length) {
      fail("Warning", "The drawing has no cable paths");
      return none;
    }
    const at = (name: string): Join | null => {
      const named = drops().filter((d) => d.name === name);
      if (!named.length) return fail("Error", `No drop point is named ${name}`);
      if (named.length > 1) return fail("Warning", `${named.length} drop points are named ${name}`);
      const corners = new Map(nodesNear(net(), named[0].at, ATTACH).map((k) => [k, 0]));
      return corners.size ? { at: corners, slack: named[0].slack, by: name, place: named[0].at, layer: named[0].layerId } : fail("Warning", `Drop point ${name} isn't on a cable path`);
    };
    const [from, to] = [at(names[0]), at(names[1])];
    return from && to ? { from, to, extra: from.slack + to.slack, names, external: false } : none;
  }

  /** where a circuit's cable joins the network at each end, or its way when it takes none */
  function endsOf(c: Circuit, o: LengthOptions, problems: Problem[], spare = routeChoiceOf(s, c).spare): Ends {
    if (spare) return dropEnds(spare, problems);
    const ends = cableEndsOf(s, c);
    const fail = (severity: Severity, problem: string): null => {
      problems.push({ severity, problem });
      return null;
    };
    const where = (d: CableDevice | null, side: string): End | null => {
      if (!d) return fail("Error", `Circuit is disconnected at its ${side}`);
      if (!d.name) return fail("Error", `The ${side}'s device has no name`);
      const found = spots.get(d.name) ?? [];
      if (!found.length) return fail("Error", `No equipment item is named ${d.name}`);
      if (found.length > 1) return fail("Warning", `${found.length} equipment items are named ${d.name}`);
      return { rack: found[0].rack, height: found[0].height, panel: d.panel, name: d.name, spot: found[0] };
    };
    /** where an end joins the cable network (and what joins it there, by name), with the slack it takes there; null (marked) when it doesn't */
    const joins = (e: End): Join | null => {
      const { spot } = e;
      const middle = { x: spot.ring.reduce((n, p) => n + p.x, 0) / (spot.ring.length || 1), y: spot.ring.reduce((n, p) => n + p.y, 0) / (spot.ring.length || 1) };
      if (spot.rack) {
        const foot = feet.find((f) => f.id === spot.rack);
        const at = joinAtOutline(net(), foot?.ring ?? [], spot.height);
        return at.size ? { at, slack: 0, by: rackName(spot.rack), place: foot?.middle ?? middle, layer: s.doc.object(spot.rack)?.layerId ?? "" } : fail("Warning", `Rack ${rackName(spot.rack)} isn't on a cable path, and no rack beside it holds the other end`);
      }
      if (spot.drop) {
        const named = drops().filter((d) => d.name === spot.drop);
        if (!named.length) return fail("Error", `No drop point is named ${spot.drop}`);
        if (named.length > 1) return fail("Warning", `${named.length} drop points are named ${spot.drop}`);
        const at = joinAtDrop(net(), named[0].at, middle, spot.height);
        return at.size ? { at, slack: named[0].slack, by: spot.drop, place: named[0].at, layer: named[0].layerId } : fail("Warning", `Drop point ${spot.drop} isn't on a cable path`);
      }
      // equipment on its own is a drop point itself, joined where a path meets it
      const at = joinAtOutline(net(), spot.ring, spot.height);
      return at.size ? { at, slack: 0, by: e.name, place: middle, layer: s.doc.object(spot.id)?.layerId ?? "" } : fail("Warning", `${e.name} isn't in a rack, on a cable path or given a drop point`);
    };
    const external = !!ends.source?.external || !!ends.destination?.external;
    const none = (racked = false, mm: number | null = null): Ends => ({ way: { mm, racked, route: null, problems, external } });
    const a = where(ends.source, "source");
    const b = where(ends.destination, "destination");
    if (!a || !b) return none();
    // in one rack or racks side by side, as the allowances say; otherwise along the cable paths
    const inRacks = a.rack && b.rack ? cableLength(a, b, a.rack === b.rack ? 0 : alongRacks(feet, a.rack, b.rack), o) : null;
    if (inRacks !== null) return none(true, inRacks);
    if (!net().edges.length) {
      // with no cable paths, only racks side by side find the way
      if (a.rack && b.rack) fail("Warning", `Racks ${rackName(a.rack)} and ${rackName(b.rack)} aren't side by side`);
      else for (const e of [a, b]) if (!e.rack) fail("Warning", `${e.name} isn't in a rack, and the drawing has no cable paths`);
      return none();
    }
    const [ja, jb] = [joins(a), joins(b)];
    return ja && jb ? { from: ja, to: jb, extra: ja.slack + jb.slack + endAllowance(a.panel, o) + endAllowance(b.panel, o), names: [a.name, b.name], external } : none();
  }

  function way(c: Circuit, o: LengthOptions): CircuitWay {
    const problems: Problem[] = [];
    const { rank, spare } = routeChoiceOf(s, c);
    const e = endsOf(c, o, problems, spare);
    if ("way" in e) return e.way;
    const { from, to, extra, names, external } = e;
    let route = rank ? (shortestRoutes(net(), from.at, to.at, rank + 1)[rank] ?? null) : shortestRoute(net(), from.at, to.at);
    if (rank && !route) {
      route = shortestRoute(net(), from.at, to.at);
      if (route) problems.push({ severity: "Notify", problem: `Its route ${routeLetter(rank)} isn't there any more, so it takes the shortest` });
    }
    if (!route) {
      problems.push({ severity: "Warning", problem: `No cable route joins ${names[0]} and ${names[1]}` });
      return { mm: null, racked: false, route: null, problems, external };
    }
    return { mm: route.length + extra, racked: false, route: { edges: route.edges, joins: [from.by, to.by], places: [from.place, to.place], layers: [from.layer, to.layer] }, problems, external };
  }

  const choices = (e: Ends, k?: number): RouteChoice[] => ("way" in e ? [] : shortestRoutes(net(), e.from.at, e.to.at, k).map((r) => ({ mm: r.length + e.extra, edges: r.edges, joins: [e.from.by, e.to.by] as const })));

  return { net, way, routes: (c, o) => choices(endsOf(c, o, [])), between: (a, b, k) => choices(dropEnds([a, b], []), k) };
}
