#!/bin/sh
# Rebuilds web/vendor/rvt-rs from rvt-rs's source (github.com/DrunkOnJava/rvt-rs, Apache-2.0):
# the Revit reader Rodeo's Revit import runs in a worker. Needs rustup's wasm32-unknown-unknown
# target and wasm-bindgen-cli of the version rvt-rs's Cargo.lock pins (0.2.118 at v0.12.2).
#   scripts/rvt-wasm.sh [tag]   (default v0.12.2)
set -eu
TAG="${1:-v0.12.2}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/vendor/rvt-rs"
SRC="$(mktemp -d)"
git clone --quiet --depth 1 --branch "$TAG" https://github.com/DrunkOnJava/rvt-rs.git "$SRC"
(cd "$SRC" && cargo build -p rvt-wasm --release --target wasm32-unknown-unknown --locked)
wasm-bindgen --target web --out-dir "$OUT" --out-name rvt "$SRC/target/wasm32-unknown-unknown/release/rvt_wasm.wasm"
{ cat "$SRC/NOTICE"; echo; echo "----"; echo; cat "$SRC/LICENSE"; } > "$OUT/../../public/licences/rvt-rs.txt"
rm -rf "$SRC"
echo "rvt-rs $TAG built into $OUT"
