# rvt-rs (vendored build)

The WebAssembly build of [rvt-rs](https://github.com/DrunkOnJava/rvt-rs), an open-source,
clean-room reader for Revit files (Apache-2.0; licence and notice in
`public/licences/rvt-rs.txt`, linked from Help > About). `src/import/rvtModel.ts` reads a Revit
model's levels, elements, geometry and parameters with it, in the import's worker
(`src/app/revitImport.worker.ts`) in the browser and directly under Node in the checks.

- Version: v0.15.0 (commit 0945d5a3), `rvt-wasm` crate, release profile, no wasm-opt.
- Patched with `scripts/rvt-wasm.patch`: `savedMeshes` also takes `"all"` (every element rvt-rs has
  only as its record's box drawn from the mesh Revit saved for display, Revit 2023 to 2027, as
  `rvt-ifc --saved-meshes`), and `familyExtrusions: true` is `rvt-ifc --family-extrusions`.
- Built with rustc 1.97.1 and wasm-bindgen 0.2.118 (`--target web --out-name rvt`).
- `rvt_bg.wasm` sha256 `eeef0cfaa99b305847981648e28eee7b8815e9e60689d954228b18a6d2eaaa7b`.

Rebuild with `scripts/rvt-wasm.sh [tag]`. These files are generated: don't edit them.
