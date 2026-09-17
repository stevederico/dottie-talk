#!/bin/bash
# install_parakeet_bundle.sh — build + stage parakeet.cpp's parakeet-server into $1.
#
# Pinned commit. Unlike llama.cpp there are no prebuilt macOS release assets,
# so this compiles from source (cmake + Xcode CLT required on the build host)
# and caches the result. The pin is the head of upstream PR #8 (mudler's
# OpenAI-compatible server example) which also includes the Apple Metal GPU
# fast path from PR #4 — the v0.1.x tags are stale (they predate Metal support
# and abort with "unsupported op 'CONV_2D_DW'"). Move the pin to a tag once
# the PR merges and upstream cuts a release.
#
# Static link (BUILD_SHARED_LIBS=OFF): one self-contained Mach-O (~3 MB,
# system frameworks only). Avoids shipping ggml dylibs that collide with other
# vendored binaries in a flat bin/ dir.
#
# Build flags:
#   PARAKEET_GGML_METAL=ON   parakeet.cpp force-overrides ggml's Apple Metal
#                            default to OFF; -DGGML_METAL=ON alone is IGNORED.
#   GGML_NATIVE=OFF          upstream force-defaults it ON; OFF keeps the
#                            binary portable across Apple Silicon generations.
#
# Usage:
#   ./scripts/install_parakeet_bundle.sh /path/to/bin   # explicit
#   ./scripts/install_parakeet_bundle.sh                # → ../bin (package-local)
#
# Prefer scripts/install_bins.sh for full STT+TTS setup.
#
# Local patches: patches/parakeet/*.patch (relative to this package) applied on
# top of the pin in lexical order (currently 01-server-stream-endpoints.patch —
# the /v1/stream/* incremental streaming + EOU API). The patch-set hash is part
# of the cache identity and the .parakeet-version sentinel, so editing a patch
# invalidates both.
#
# Env:
#   PARAKEET_REF         Override pinned commit (default: see constant below).
#   FORCE_REBUILD        Set to 1 to ignore cache.
#   BUNDLE_OUT           Default output dir when no positional arg is given.

set -euo pipefail

PARAKEET_REF="${PARAKEET_REF:-23bd49cb3d1fee6a0d69a4d2407e9069c7100ad2}"
REPO_URL="https://github.com/mudler/parakeet.cpp"
SHORT_REF="${PARAKEET_REF:0:12}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Default: package-local bin/ (standalone). Pass a path or BUNDLE_OUT to override
# (e.g. dottie-desktop/bin when packaging the Mac app).
if [ -n "${1:-}" ]; then
    OUT="$1"
elif [ -n "${BUNDLE_OUT:-}" ]; then
    OUT="$BUNDLE_OUT"
else
    OUT="$SCRIPT_DIR/../bin"
fi
CACHE_DIR="$HOME/.dottie-build-cache"

# Our local patches (patches/parakeet/*.patch, applied in lexical order).
# Their hash is part of the cache identity — without it, editing a patch
# would keep shipping the stale pre-patch cached binary forever.
# Under `set -euo pipefail`, `cat` of a non-matching glob exits nonzero and
# aborts the script, so collect the actual matches first ([ -e ] guards the
# unexpanded-glob token) and only hash when files exist; zero patches yields
# a stable sentinel ("none"), which is a valid state.
PATCHES_DIR="$SCRIPT_DIR/../patches/parakeet"
PATCH_FILES=()
for _p in "$PATCHES_DIR"/*.patch; do
    [ -e "$_p" ] && PATCH_FILES+=("$_p")
done
if [ "${#PATCH_FILES[@]}" -gt 0 ]; then
    PATCH_HASH=$(cat "${PATCH_FILES[@]}" | shasum -a 256 | cut -c1-12)
else
    PATCH_HASH=none
fi
BUILD_ID="${PARAKEET_REF}+${PATCH_HASH}"

CACHED_BUNDLE="$CACHE_DIR/parakeet-${SHORT_REF}-${PATCH_HASH}"
mkdir -p "$CACHE_DIR" "$OUT"

log() { printf '[parakeet-bundle] %s\n' "$*" >&2; }
die() { printf '[parakeet-bundle] ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(uname -m)" = "arm64" ] || die "arm64 build host required (got $(uname -m))"

# -- idempotency ---------------------------------------------------------------
SENTINEL="$OUT/.parakeet-version"
if [ -x "$OUT/parakeet-server" ] && [ -f "$SENTINEL" ] && [ -z "${FORCE_REBUILD:-}" ]; then
    if [ "$(cat "$SENTINEL")" = "$BUILD_ID" ]; then
        log "$SHORT_REF+$PATCH_HASH already installed at $OUT"
        exit 0
    fi
fi

# -- cache hit -----------------------------------------------------------------
if [ -x "$CACHED_BUNDLE/parakeet-server" ] && [ -z "${FORCE_REBUILD:-}" ]; then
    log "cache hit: $CACHED_BUNDLE"
    rm -f "$OUT/parakeet-server" "$SENTINEL"
    cp -a "$CACHED_BUNDLE/parakeet-server" "$OUT/"
    chmod +x "$OUT/parakeet-server"
    echo "$BUILD_ID" > "$SENTINEL"
    exit 0
fi

# -- cache miss: clone + build ---------------------------------------------------
command -v cmake >/dev/null || die "cmake required to build parakeet.cpp (brew install cmake)"

STAGING="$CACHE_DIR/staging-parakeet-$$"
trap 'rm -rf "$STAGING"' EXIT
mkdir -p "$STAGING"

log "fetching $REPO_URL @ $SHORT_REF"
git -C "$STAGING" init -q
git -C "$STAGING" remote add origin "$REPO_URL"
# GitHub allows fetching arbitrary reachable SHAs. The PR-head pin stays
# fetchable even after merge; if upstream force-pushes the branch the old
# commit eventually becomes unreachable and this fails loudly — bump the pin.
git -C "$STAGING" fetch -q --depth 1 origin "$PARAKEET_REF" \
    || die "commit $SHORT_REF not fetchable from $REPO_URL — upstream may have force-pushed; bump PARAKEET_REF"
git -C "$STAGING" checkout -q FETCH_HEAD
git -C "$STAGING" submodule update -q --init --recursive --depth 1

# Apply upstream's in-tree ggml patches OURSELVES and fail hard. CMake also
# runs this script at configure time, but a failure there is only a WARNING —
# a PARAKEET_REF bump whose patches no longer apply would silently ship an
# unpatched-ggml binary. Running it here first makes failure fatal; the
# configure-time re-run then no-ops (the script is idempotent).
bash "$STAGING/scripts/apply_ggml_patches.sh" \
    || die "ggml patch application failed — PARAKEET_REF bump with conflicting patches?"

# Apply OUR patches (patches/parakeet/*.patch) in lexical order.
# --check first so a conflicting patch fails loudly before half-applying.
# Glob is expanded into an array so `set -u` + zero matches stays safe.
OUR_PATCHES=()
for p in "$PATCHES_DIR"/*.patch; do
    [ -e "$p" ] && OUR_PATCHES+=("$p")
done
for p in ${OUR_PATCHES[@]+"${OUR_PATCHES[@]}"}; do
    log "applying patch $(basename "$p")"
    git -C "$STAGING" apply --check "$p" \
        || die "patch $(basename "$p") does not apply against $SHORT_REF — rebase it"
    git -C "$STAGING" apply "$p" \
        || die "patch $(basename "$p") failed to apply"
done

log "building parakeet-server (Release, Metal, static)"
cmake -S "$STAGING" -B "$STAGING/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DPARAKEET_GGML_METAL=ON \
    -DGGML_NATIVE=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    >/dev/null
cmake --build "$STAGING/build" -j --target parakeet-server >/dev/null

SRC=$(find "$STAGING/build" -type f -name 'parakeet-server' -perm +111 | head -1)
[ -n "$SRC" ] || die "parakeet-server not produced; check upstream build layout"

# Verify the static link held — a shared build would ship @rpath libggml*
# dylibs that collide with other vendored bins in the same dir.
if otool -L "$SRC" | grep -q '@rpath'; then
    die "parakeet-server links @rpath dylibs (shared build?) — must be static"
fi

mkdir -p "$CACHED_BUNDLE"
rm -rf "${CACHED_BUNDLE:?}"/*
cp -a "$SRC" "$CACHED_BUNDLE/"
chmod +x "$CACHED_BUNDLE/parakeet-server"

rm -f "$OUT/parakeet-server" "$SENTINEL"
cp -a "$CACHED_BUNDLE/parakeet-server" "$OUT/"
chmod +x "$OUT/parakeet-server"
echo "$BUILD_ID" > "$SENTINEL"

log "done. $OUT/parakeet-server ($SHORT_REF+$PATCH_HASH)"
du -sh "$OUT/parakeet-server"
