#!/bin/sh
# Rebuilds the cadmpeg WebAssembly modules Rodeo's import workers run, from cadmpeg
# (github.com/cadmpeg/cadmpeg, Apache-2.0) at the commit pinned below, with the bridge in
# web/scripts/cadmpeg-wasm/:
#   web/vendor/cadmpeg-xt/          Parasolid B-rep of a bare transmit stream, tessellated
#                                   (xt_mesh, xt_last_report); the SolidWorks codec only
#   web/vendor/cadmpeg/<format>/    one module per format, each reading that format and writing
#                                   STEP in memory (to_step): sldprt, inventor, fcstd, f3d, nx, creo
# and writes web/public/licences/cadmpeg.txt. cadmpeg-wasm.patch is the one change to cadmpeg: a
# codec entry point for a bare Parasolid stream (crates/cadmpeg-codec-sldprt/src/bare_parasolid.rs).
# Needs rustup with the toolchain cadmpeg pins (rust-toolchain.toml, 1.97.0) and its
# wasm32-unknown-unknown target, and wasm-bindgen-cli 0.2.118 (the version the bridge pins).
# The bridge's release profile favours size (see cadmpeg-wasm/Cargo.toml). The modules are built
# without their name and producers sections. If wasm-opt is on PATH, each module is also shrunk
# with -Oz, which is slow on the larger modules.
#   scripts/cadmpeg-wasm.sh
#   CADMPEG_SRC=<clone>      read the pinned commit from this clone instead of GitHub
#   CADMPEG_WORK=<dir>       keep the source tree and bridge there (default: a temporary directory)
#   CARGO_TARGET_DIR=<dir>   keep build outputs there (default: inside the work directory)
set -eu
PIN=c688932a844a61140ec05bb1eefea724678e4c28
FORMATS="sldprt inventor fcstd f3d nx creo"
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$(cd "$HERE/.." && pwd)"
PATCH="$HERE/cadmpeg-wasm.patch"
BRIDGE_SRC="$HERE/cadmpeg-wasm"
export PATH="$HOME/.cargo/bin:$PATH"

started=$(date +%s)
command -v cargo >/dev/null || { echo "cargo not found; install rustup" >&2; exit 1; }
command -v wasm-bindgen >/dev/null || { echo "wasm-bindgen not found; cargo install wasm-bindgen-cli --version 0.2.118" >&2; exit 1; }
case "$(wasm-bindgen --version)" in
  "wasm-bindgen 0.2.118") ;;
  *) echo "wasm-bindgen must be 0.2.118, found: $(wasm-bindgen --version)" >&2; exit 1 ;;
esac
rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown \
  || { echo "rustup target add wasm32-unknown-unknown first" >&2; exit 1; }

if [ -n "${CADMPEG_WORK:-}" ]; then
  WORK="$CADMPEG_WORK"
  mkdir -p "$WORK"
else
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
fi
SRC="$WORK/cadmpeg"
BRIDGE="$WORK/bridge"
rm -rf "$SRC" "$BRIDGE"
mkdir -p "$SRC"

# The source tree at the pinned commit, from a local clone or from GitHub.
if [ -n "${CADMPEG_SRC:-}" ]; then
  git -C "$CADMPEG_SRC" archive --format=tar "$PIN" | tar -x -C "$SRC"
else
  git -C "$SRC" init -q
  git -C "$SRC" fetch -q --depth 1 https://github.com/cadmpeg/cadmpeg.git "$PIN"
  git -C "$SRC" checkout -q FETCH_HEAD
  [ "$(git -C "$SRC" rev-parse HEAD)" = "$PIN" ] || { echo "fetched commit is not $PIN" >&2; exit 1; }
  rm -rf "$SRC/.git"
fi
(cd "$SRC" && git apply "$PATCH")

# The bridge sits beside the tree, so its path dependencies and cadmpeg's rust-toolchain.toml
# resolve; cadmpeg's Cargo.lock pins every crate the builds share.
mkdir -p "$BRIDGE/src"
cp "$BRIDGE_SRC/Cargo.toml" "$BRIDGE/"
cp "$BRIDGE_SRC/src/lib.rs" "$BRIDGE/src/"
cp "$SRC/Cargo.lock" "$SRC/rust-toolchain.toml" "$BRIDGE/"

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$WORK/target}"
WASM="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/cadmpeg_wasm.wasm"

build() {
  # $1 cargo feature, $2 output directory, $3 output name
  (cd "$BRIDGE" && cargo build --release --target wasm32-unknown-unknown --features "$1")
  rm -rf "$2"
  mkdir -p "$2"
  wasm-bindgen --target web --remove-name-section --remove-producers-section \
    --out-dir "$2" --out-name "$3" "$WASM"
  if command -v wasm-opt >/dev/null 2>&1; then
    wasm-opt -Oz --all-features -o "$2/$3""_bg.wasm" "$2/$3""_bg.wasm"
  fi
}

build xt "$WEB/vendor/cadmpeg-xt" cadmpeg_xt
rm -rf "$WEB/vendor/cadmpeg"
for format in $FORMATS; do
  build "$format" "$WEB/vendor/cadmpeg/$format" cadmpeg
done

{
  cat "$SRC/LICENSE"
  echo
  echo "----"
  echo
  echo "The format documents in docs/ are licensed under CC BY 4.0 (LICENSE-docs)."
} > "$WEB/public/licences/cadmpeg.txt"

echo "cadmpeg $PIN built in $(( $(date +%s) - started )) s"
for module in "$WEB/vendor/cadmpeg-xt/cadmpeg_xt_bg.wasm" $(for format in $FORMATS; do echo "$WEB/vendor/cadmpeg/$format/cadmpeg_bg.wasm"; done); do
  echo "$module: $(wc -c < "$module") bytes, gzip -9 $(gzip -9 -c "$module" | wc -c) bytes"
done
