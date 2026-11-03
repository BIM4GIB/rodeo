// The meshes of Site Context in the 3D view: the imported buildings (footprints extruded to their
// heights, standing on the terrain) and the terrain grid, a group per import. Loaded with three.js when the
// open drawing first has context to show (overlay3d.ts).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ContextImport, ContextTerrain } from "./model.ts";

const BUILDING_COLOUR = 0xdcd8cc;
const TERRAIN_COLOUR = 0xb9c09a;

function terrainMesh(t: ContextTerrain): THREE.Mesh {
  const { nx, ny } = t;
  const position = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      position[3 * k] = t.x0 + i * t.dx;
      position[3 * k + 1] = t.y0 + j * t.dy;
      position[3 * k + 2] = t.z[k];
    }
  }
  // two triangles per cell, counter-clockwise seen from above
  const index = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let n = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      index.set([a, b, d, a, d, c], n);
      n += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: TERRAIN_COLOUR, side: THREE.DoubleSide }));
  mesh.name = "site-context-terrain";
  // hills shade the ground and buildings behind them; buildings' shadows fall on it
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** An import as one group: its buildings in one mesh, its terrain grid in another. */
export function buildGroup(imp: ContextImport): THREE.Group {
  const group = new THREE.Group();
  group.name = "site-context";
  const pieces: THREE.BufferGeometry[] = [];
  for (const b of imp.buildings) {
    if (b.ring.length < 3) continue;
    const shape = new THREE.Shape(b.ring.map((p) => new THREE.Vector2(p.x, p.y)));
    const solid = new THREE.ExtrudeGeometry(shape, { depth: b.heightMm, bevelEnabled: false, steps: 1 });
    solid.translate(0, 0, b.baseMm);
    pieces.push(solid);
  }
  if (pieces.length > 0) {
    // every piece has the same attributes (position, normal, uv), so they merge into one mesh
    const merged = mergeGeometries(pieces, false);
    for (const p of pieces) p.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: BUILDING_COLOUR }));
      mesh.name = "site-context-buildings";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (imp.terrain) group.add(terrainMesh(imp.terrain));
  return group;
}

export function disposeGroup(group: THREE.Group): void {
  group.removeFromParent();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
