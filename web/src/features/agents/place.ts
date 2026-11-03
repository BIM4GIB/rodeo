// Puts the parts the build tool makes (build.ts) into the drawing: upright prisms as extrudes of
// their outline, everything else as meshes, each in a class named for its category, filled with
// the drawing's colour nearest its own, and the parts that share a group key grouped and named.
// The caller runs it inside one batch, so the whole build is one undo step.

import type { Attributes, EditSession, NewShape, Pt } from "../../core/types.ts";
import type { BuildPart } from "./build.ts";

export interface Placed {
  /** what was made at the top level, in order: groups and loose parts */
  ids: string[];
  /** group key to the group's id */
  groups: Record<string, string>;
  /** category to how many parts it holds */
  counts: Record<string, number>;
  /** classes made for categories the drawing didn't have */
  newClasses: string[];
}

/** The drawing's colour nearest each "#rrggbb", by palette index. */
function colorMatcher(s: EditSession): (css: string) => number {
  const rgb = (css: string): [number, number, number] | null => {
    const m = /^#([0-9a-f]{6})/i.exec(css);
    return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
  };
  const palette = s.doc.colors().flatMap((c) => {
    const v = rgb(c.css);
    return v ? [{ index: c.index, v }] : [];
  });
  const seen = new Map<string, number>();
  return (css) => {
    const hit = seen.get(css);
    if (hit !== undefined) return hit;
    const want = rgb(css) ?? [128, 128, 128];
    let best = palette[0]?.index ?? 0;
    let bestD = Infinity;
    for (const p of palette) {
      // weighted as the eye weighs the channels, so greens and browns land on greens and browns
      const d = 3 * (p.v[0] - want[0]) ** 2 + 4 * (p.v[1] - want[1]) ** 2 + 2 * (p.v[2] - want[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p.index;
      }
    }
    seen.set(css, best);
    return best;
  };
}

/**
 * Places `parts` on design layer `layerId`, moved by `offset` in plan. Prisms become extrudes of
 * their outline lifted to their bottom; meshes keep their faces. Returns what was made.
 */
export function placeParts(s: EditSession, layerId: string, parts: readonly BuildPart[], offset: Pt = { x: 0, y: 0 }): Placed {
  const colorOf = colorMatcher(s);
  const classes = new Map(s.doc.classes().map((c) => [c.name, c.index]));
  const newClasses: string[] = [];
  const classOf = (category: string): number => {
    const name = category.trim() || "3D";
    let index = classes.get(name);
    if (index === undefined) {
      index = s.createClass(name);
      classes.set(name, index);
      newClasses.push(name);
    }
    return index;
  };
  const attrsOf = (p: BuildPart): Partial<Attributes> => {
    const c = colorOf(p.color);
    return { fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: Math.max(0, Math.min(100, Math.round(p.opacity ?? 100))) };
  };
  const shift = (q: Pt): Pt => ({ x: q.x + offset.x, y: q.y + offset.y });

  // each part's id, in the order of `parts`
  const made: string[] = new Array<string>(parts.length).fill("");
  const byCategory = new Map<string, number[]>();
  parts.forEach((p, i) => {
    const list = byCategory.get(p.category);
    if (list) list.push(i);
    else byCategory.set(p.category, [i]);
  });
  for (const [category, members] of byCategory) {
    const cls = classOf(category);
    const prisms = members.filter((i) => parts[i].shape.kind === "prism");
    const meshes = members.filter((i) => parts[i].shape.kind === "mesh");
    if (prisms.length) {
      const shapes: NewShape[] = prisms.map((i) => {
        const sh = parts[i].shape as Extract<BuildPart["shape"], { kind: "prism" }>;
        return { kind: "polygon", points: sh.outline.map(shift), closed: true };
      });
      const outlines = s.addObjects(layerId, shapes, cls, prisms.map((i) => attrsOf(parts[i])));
      // extruded a height at a time and lifted a bottom at a time: extrudeObjects keeps the
      // order it is given, which is the order they were drawn in
      const byHeight = new Map<number, number[]>();
      prisms.forEach((i, k) => {
        const sh = parts[i].shape as Extract<BuildPart["shape"], { kind: "prism" }>;
        const h = Math.round((sh.z1 - sh.z0) * 1e4) / 1e4;
        const list = byHeight.get(h);
        if (list) list.push(k);
        else byHeight.set(h, [k]);
      });
      for (const [h, ks] of byHeight) {
        const ext = s.extrudeObjects(ks.map((k) => outlines[k]), h);
        if (ext.length !== ks.length) throw new Error(`${ks.length - ext.length} ${category} outline${ks.length - ext.length === 1 ? "" : "s"} couldn't be extruded`);
        ks.forEach((k, j) => (made[prisms[k]] = ext[j]));
      }
      const byBase = new Map<number, string[]>();
      for (const i of prisms) {
        const z0 = Math.round((parts[i].shape as Extract<BuildPart["shape"], { kind: "prism" }>).z0 * 1e4) / 1e4;
        if (z0 === 0) continue;
        const list = byBase.get(z0);
        if (list) list.push(made[i]);
        else byBase.set(z0, [made[i]]);
      }
      for (const [z0, ids] of byBase) s.moveObjects3D(ids, 0, 0, z0);
    }
    if (meshes.length) {
      const faces = meshes.map((i) => {
        const sh = parts[i].shape as Extract<BuildPart["shape"], { kind: "mesh" }>;
        return sh.faces.map((f) => f.map((v, k) => (k % 3 === 0 ? v + offset.x : k % 3 === 1 ? v + offset.y : v)));
      });
      const ids = s.addMeshes(layerId, faces, cls, meshes.map((i) => attrsOf(parts[i])));
      meshes.forEach((i, k) => (made[i] = ids[k]));
    }
  }

  // groups, then names: a group takes its key as its name, a loose part its own
  const keys: string[] = [];
  const sets = new Map<string, string[]>();
  parts.forEach((p, i) => {
    if (!p.group) return;
    const list = sets.get(p.group);
    if (list) list.push(made[i]);
    else {
      sets.set(p.group, [made[i]]);
      keys.push(p.group);
    }
  });
  const groupIds = keys.length ? s.groupEach(keys.map((k) => sets.get(k)!)) : [];
  const groups: Record<string, string> = {};
  keys.forEach((k, j) => (groups[k] = groupIds[j]));
  const taken = new Set<string>();
  const nameOnce = (id: string, name: string): void => {
    const base = name.trim();
    if (!base) return;
    // names are unique in a document: one the drawing has already takes a number
    for (let i = 1; i <= 50; i++) {
      const n = i === 1 ? base : `${base} ${i}`;
      if (taken.has(n)) continue;
      try {
        s.setObjectName(id, n);
        taken.add(n);
        return;
      } catch {
        taken.add(n);
      }
    }
  };
  keys.forEach((k, j) => nameOnce(groupIds[j], k));
  parts.forEach((p, i) => {
    if (!p.group) nameOnce(made[i], p.name);
  });

  const ids: string[] = [];
  const done = new Set<string>();
  parts.forEach((p, i) => {
    const id = p.group ? groups[p.group] : made[i];
    if (!done.has(id)) {
      done.add(id);
      ids.push(id);
    }
  });
  const counts: Record<string, number> = {};
  for (const p of parts) counts[p.category] = (counts[p.category] ?? 0) + 1;
  return { ids, groups, counts, newClasses };
}
