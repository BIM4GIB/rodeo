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
  the boundary (never splitting it) does. An element with
  up to four faces (at most a tenth) that did not decode is drawn from the rest where they fill its
  box on every axis with no triangle spanning it; railings excepted.
- Built with rustc 1.97.1 and wasm-bindgen 0.2.118 (`--target web --out-name rvt`).
- `rvt_bg.wasm` sha256 `1a01f89e23e0e8f0dcedf9ff08ec90971ee22e585277b338a8c04beddf1e22ff`.

Rebuild with `scripts/rvt-wasm.sh [tag]`. These files are generated: don't edit them.
