#!/bin/sh
# Rebuilds web/vendor/rvt-rs from rvt-rs's source (github.com/DrunkOnJava/rvt-rs, Apache-2.0):
# the Revit reader Rodeo's Revit import runs in a worker. Needs rustup's wasm32-unknown-unknown
# target and wasm-bindgen-cli of the version rvt-rs's Cargo.lock pins (0.2.118 at v0.15.0).
# rvt-wasm.patch lets the open limits ask for every boxed element's saved mesh (savedMeshes: "all")
# and for family extrusions (familyExtrusions), which rvt-rs's own binding doesn't offer, reads saved
# graphics on Revit 2015 to 2022 too, and draws Revit 2022 stairs and turned family boxes from them.
# With "detail", it builds vendor/rvt-rs-detail from rvt-wasm-detail.patch instead: the same with
# the slow last pass for the elements left as boxes, which the import's worker runs once the
# drawing is open (thirdPass: "only").
#   scripts/rvt-wasm.sh [tag] [detail]   (default v0.15.0)
set -eu
TAG="${1:-v0.15.0}"
SUFFIX="${2:+-$2}"
PATCH="$(cd "$(dirname "$0")" && pwd)/rvt-wasm$SUFFIX.patch"
OUT="$(cd "$(dirname "$0")/.." && pwd)/vendor/rvt-rs$SUFFIX"
SRC="$(mktemp -d)"
git clone --quiet --depth 1 --branch "$TAG" https://github.com/DrunkOnJava/rvt-rs.git "$SRC"
(cd "$SRC" && git apply "$PATCH" && cargo build -p rvt-wasm --release --target wasm32-unknown-unknown --locked)
wasm-bindgen --target web --out-dir "$OUT" --out-name rvt "$SRC/target/wasm32-unknown-unknown/release/rvt_wasm.wasm"
{ cat "$SRC/NOTICE"; echo; echo "----"; echo; cat "$SRC/LICENSE"; } > "$OUT/../../public/licences/rvt-rs.txt"
rm -rf "$SRC"
echo "rvt-rs $TAG built into $OUT"
