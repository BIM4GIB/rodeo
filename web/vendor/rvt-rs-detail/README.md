# rvt-rs, detail build (vendored)

A second WebAssembly build of [rvt-rs](https://github.com/DrunkOnJava/rvt-rs) (Apache-2.0; licence
and notice in `public/licences/rvt-rs.txt`), loaded only by the Revit import's worker
(`src/app/revitImport.worker.ts`) once the drawing is open, so opening a model costs what it did
with `vendor/rvt-rs` alone.

- Version: v0.15.0 (commit 0945d5a3), `rvt-wasm` crate, release profile, no wasm-opt, built with
  `scripts/rvt-wasm.sh v0.15.0 detail`.
- Patched with `scripts/rvt-wasm-detail.patch`: everything `scripts/rvt-wasm.patch` did when this
  was built (not the retry rules the main build has gained since), plus a third, slow decode of an
  element every earlier pass left as its box (a spiral railing, an appliance, a door): exact
  predicates in the constrained triangulation, and a check that the mesh closes as drawn.
  `thirdPass: "only"` in the open limits runs it and answers
  `{ replaced: [{ element_id, index, entity }] }`, the elements it draws in full, which
  `readDetailWith` (`src/import/rvtModel.ts`) swaps into the model by `element_id` where the
  opened model still has a box. Without it (`thirdPass: "off"`, the default) it reads a model as
  `vendor/rvt-rs` did then.
- Built with rustc 1.97.1 and wasm-bindgen 0.2.118 (`--target web --out-name rvt`).
- `rvt_bg.wasm` sha256 `740416390a9ea138ee0c56833b9c367426ed1a08e36bf669245009700ef840c8`.
