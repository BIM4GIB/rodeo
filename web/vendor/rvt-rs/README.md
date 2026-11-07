# rvt-rs (vendored build)

The WebAssembly build of [rvt-rs](https://github.com/DrunkOnJava/rvt-rs), an open-source,
clean-room reader for Revit files (Apache-2.0; licence and notice in
`public/licences/rvt-rs.txt`, linked from Help > About). `src/import/rvtModel.ts` reads a Revit
model's levels, elements, geometry and parameters with it, in the import's worker
(`src/app/revitImport.worker.ts`) in the browser and directly under Node in the checks.

- Version: v0.15.0 (commit 0945d5a3), `rvt-wasm` crate, release profile, no wasm-opt.
- Patched with `scripts/rvt-wasm.patch`: `savedMeshes` also takes `"all"` (every element rvt-rs has
  only as its record's box drawn from the mesh Revit saved for display, as
  `rvt-ifc --saved-meshes`), and `familyExtrusions: true` is `rvt-ifc --family-extrusions`. It also
  reads saved graphics on Revit 2015 to 2022 files (upstream: 2023 to 2027), follows an external
  symbol whose `m_GRepId` is absent (Revit 2022 stairs and columns), and offers a family instance
  drawn as its turned box (RE-87) its saved mesh too. It treats a flip control (GBiFlipControl) as
  holding no surface, takes a railing's saved mesh only where it fills its box, tolerates a curved
  edge whose fixed parameter drifts, and meshes ruled faces between arc, ellipse and Hermite
  profiles, refusing (keeping the box) one whose edges disagree with its neighbours by more than
  0.003 ft or which doesn't fill its box (one short axis allowed where the owner left out parts
  Revit hides in 3D, if no triangle spans more than half the box, a flat triangle lying parallel
  to a side of the box excepted). Trimmed faces mesh inside their boundary loops; where the interior lattice can't meet the
  chord tolerance, or the face has holes, a constrained Delaunay triangulation refined inside
  the boundary (never splitting it) does. An element still boxed because a trim loop's
  corners miss by up to 1e-3 ft is decoded once more with that join, and with a ruled surface's
  point end read as its apex, islands meshed beside the outline, and constraints recovered by
  cavity retriangulation; on that pass a boundary chord too coarse for the tolerance is split at one point on the shared edge in both faces, and a curved edge may sit up to 1e-4 ft off the plane beside it; it also reads Hermite surfaces (bicubic patches), meshed inside their trim loops, and joins model-space trim loops within 1e-3 ft. The retry is kept only where the element then passes every check. An element with
  up to four faces (at most a tenth) that did not decode is drawn from the rest where they fill its
  box on every axis with no triangle spanning it; railings excepted.
- Built with rustc 1.97.1 and wasm-bindgen 0.2.118 (`--target web --out-name rvt`).
- `rvt_bg.wasm` sha256 `7f6806101d3d7f734c868eae9b9d8804829cf74728286770238769c6853e7da0`.

Rebuild with `scripts/rvt-wasm.sh [tag]`. These files are generated: don't edit them.
