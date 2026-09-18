#!/usr/bin/env bash
# CI helper: build koko for Linux x86_64 and pack it with the .so files it needs.
# Output: dist/koko-linux-x86_64.tar.gz  (koko + lib/*.so)
# No sudo. Expects build deps already installed (GitHub Actions apt, or a fat machine).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="${HOME}/.dottie-build-cache"
STAGING="${CACHE_DIR}/kokoros-src"
KOKOROS_REF="${KOKOROS_REF:-main}"
DIST="${PKG_ROOT}/dist"
STAGE="${DIST}/koko-linux-x86_64"

log() { printf '[linux-koko] %s\n' "$*" >&2; }
die() { printf '[linux-koko] ERROR: %s\n' "$*" >&2; exit 1; }

command -v cargo >/dev/null || die "cargo required"
command -v cmake >/dev/null || die "cmake required"

mkdir -p "$CACHE_DIR"
if [ ! -d "$STAGING/.git" ]; then
  log "clone Kokoros @$KOKOROS_REF"
  rm -rf "$STAGING"
  git clone --depth 1 --branch "$KOKOROS_REF" https://github.com/lucasjinreal/Kokoros.git "$STAGING" \
    || git clone --depth 1 https://github.com/lucasjinreal/Kokoros.git "$STAGING"
else
  git -C "$STAGING" fetch -q --depth 1 origin "$KOKOROS_REF" 2>/dev/null || true
  git -C "$STAGING" checkout -q FETCH_HEAD 2>/dev/null || true
fi

log "cargo build --release --bin koko"
(cd "$STAGING" && cargo build --release --bin koko)
BUILT="$STAGING/target/release/koko"
[ -x "$BUILT" ] || die "koko did not build"

rm -rf "$STAGE"
mkdir -p "$STAGE/lib"
cp -a "$BUILT" "$STAGE/koko"
chmod +x "$STAGE/koko"

# Bundle non-glibc deps so Arch/Omarchy does not need pacman.
if command -v patchelf >/dev/null; then
  :
else
  log "WARN: patchelf missing — rpath not set; copy .so anyway"
fi

ldd "$STAGE/koko" | awk '
  / => / {
    lib=$1; path=$3
    if (path ~ /^\// && path !~ /ld-linux/ && lib !~ /^libc\.so/ && lib !~ /^libm\.so/ && lib !~ /^libpthread\.so/ && lib !~ /^libdl\.so/ && lib !~ /^librt\.so/ && lib !~ /^libgcc_s/ && lib !~ /^libstdc\+\+/ && lib !~ /^ld-linux/)
      print path
  }
' | while read -r so; do
  [ -f "$so" ] || continue
  cp -a "$so" "$STAGE/lib/"
  log "bundle $(basename "$so")"
done

if command -v patchelf >/dev/null; then
  patchelf --set-rpath '$ORIGIN/lib' "$STAGE/koko"
  log "rpath \$ORIGIN/lib"
fi

mkdir -p "$DIST"
tar -C "$STAGE" -czf "$DIST/koko-linux-x86_64.tar.gz" koko lib
log "wrote $DIST/koko-linux-x86_64.tar.gz ($(du -h "$DIST/koko-linux-x86_64.tar.gz" | awk '{print $1}'))"
