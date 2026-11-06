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
  Revit hides in 3D, if no triangle spans more than half the box). Trimmed faces mesh inside their
  boundary loops.
- Built with rustc 1.97.1 and wasm-bindgen 0.2.118 (`--target web --out-name rvt`).
- `rvt_bg.wasm` sha256 `ad80276a1f8fc1d768d2801609f76601ec859be6d159075ea432b832d533f3c0`.

Rebuild with `scripts/rvt-wasm.sh [tag]`. These files are generated: don't edit them.
