# rvt-rs (vendored build)

The WebAssembly build of [rvt-rs](https://github.com/DrunkOnJava/rvt-rs), an open-source,
clean-room reader for Revit files (Apache-2.0; licence and notice in
`public/licences/rvt-rs.txt`, linked from Help > About). `src/import/rvtModel.ts` reads a Revit
model's levels, elements, geometry and parameters with it, in the import's worker
(`src/app/revitImport.worker.ts`) in the browser and directly under Node in the checks.

- Version: v0.12.2 (commit 3cbb2ec8), `rvt-wasm` crate, release profile, no wasm-opt.
- Built with rustc 1.97.1 and wasm-bindgen 0.2.118 (`--target web --out-name rvt`).
- `rvt_bg.wasm` sha256 `c7c4478ef07281092687bb248d3014a603249650a89f94feb548bfddb5af6bf6`.

Rebuild with `scripts/rvt-wasm.sh [tag]`. These files are generated: don't edit them.
