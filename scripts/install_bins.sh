#!/bin/bash
# install_bins.sh — stage parakeet-server + koko (+ espeak-ng-data) into package bin/.
#
# Simplest standalone setup for dottie-talk. Does not vendor binaries in git.
#
# Usage:
#   ./scripts/install_bins.sh              # → ../bin
#   ./scripts/install_bins.sh /path/to/bin  # explicit
#
# Env:
#   FORCE_REBUILD=1     rebuild parakeet even if present
#   KOKOROS_REF         git ref for lucasjinreal/Kokoros (default: main)
#   SKIP_PARAKEET=1     skip STT binary
#   SKIP_KOKO=1         skip TTS binary

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${1:-${BUNDLE_OUT:-$PKG_ROOT/bin}}"
CACHE_DIR="${HOME}/.dottie-build-cache"
KOKOROS_REF="${KOKOROS_REF:-main}"
DESKTOP_BIN=""
if [ -d "$PKG_ROOT/../../../bin" ]; then
  DESKTOP_BIN="$(cd "$PKG_ROOT/../../../bin" && pwd)"
elif [ -d "$HOME/Projects/dottie-desktop/bin" ]; then
  DESKTOP_BIN="$HOME/Projects/dottie-desktop/bin"
fi
DOTTIE_APP_BIN="/Applications/Dottie.app/Contents/Resources/bin"

log() { printf '[talk-bins] %s\n' "$*" >&2; }
die() { printf '[talk-bins] ERROR: %s\n' "$*" >&2; exit 1; }

mkdir -p "$OUT"

# ---- parakeet-server --------------------------------------------------------
if [ -z "${SKIP_PARAKEET:-}" ]; then
  if [ -x "$OUT/parakeet-server" ] && [ -z "${FORCE_REBUILD:-}" ]; then
    log "parakeet-server already at $OUT"
  elif [ -n "$DESKTOP_BIN" ] && [ -x "$DESKTOP_BIN/parakeet-server" ] && [ -z "${FORCE_REBUILD:-}" ]; then
    cp -a "$DESKTOP_BIN/parakeet-server" "$OUT/parakeet-server"
    chmod +x "$OUT/parakeet-server"
    [ -f "$DESKTOP_BIN/.parakeet-version" ] && cp -a "$DESKTOP_BIN/.parakeet-version" "$OUT/" || true
    log "parakeet-server copied from $DESKTOP_BIN"
  elif [ -x "$DOTTIE_APP_BIN/parakeet-server" ] && [ -z "${FORCE_REBUILD:-}" ]; then
    cp -a "$DOTTIE_APP_BIN/parakeet-server" "$OUT/parakeet-server"
    chmod +x "$OUT/parakeet-server"
    log "parakeet-server copied from $DOTTIE_APP_BIN"
  else
    log "installing parakeet-server → $OUT (cmake build)"
    BUNDLE_OUT="$OUT" bash "$SCRIPT_DIR/install_parakeet_bundle.sh" "$OUT"
  fi
fi

# ---- koko -------------------------------------------------------------------
install_koko_from_copy() {
  local src="$1"
  [ -n "$src" ] || return 1
  [ -x "$src" ] || return 1
  cp -a "$src" "$OUT/koko"
  chmod +x "$OUT/koko"
  log "koko copied from $src"
  return 0
}

install_koko_espeak() {
  local src_dir=""
  for d in \
    "$OUT/espeak-ng-data" \
    ${DESKTOP_BIN:+"$DESKTOP_BIN/espeak-ng-data"} \
    "$DOTTIE_APP_BIN/espeak-ng-data" \
    ${DOTTIE_BIN_DIR:+"$DOTTIE_BIN_DIR/espeak-ng-data"} \
    "/opt/homebrew/share/espeak-ng-data" \
    "/usr/local/share/espeak-ng-data"; do
    [ -n "$d" ] || continue
    if [ -f "$d/phontab" ]; then
      src_dir="$d"
      break
    fi
  done
  if [ -z "$src_dir" ]; then
    log "WARN: espeak-ng-data not found — brew install espeak-ng, or copy espeak-ng-data into $OUT"
    return 0
  fi
  if [ "$src_dir" = "$OUT/espeak-ng-data" ]; then
    return 0
  fi
  rm -rf "$OUT/espeak-ng-data"
  cp -a "$src_dir" "$OUT/espeak-ng-data"
  log "espeak-ng-data from $src_dir"
}

install_koko_cargo() {
  command -v cargo >/dev/null || return 1
  local staging="$CACHE_DIR/kokoros-src"
  mkdir -p "$CACHE_DIR"
  if [ ! -d "$staging/.git" ]; then
    log "cloning lucasjinreal/Kokoros @$KOKOROS_REF"
    rm -rf "$staging"
    git clone --depth 1 --branch "$KOKOROS_REF" https://github.com/lucasjinreal/Kokoros.git "$staging" \
      || git clone --depth 1 https://github.com/lucasjinreal/Kokoros.git "$staging"
  else
    git -C "$staging" fetch -q --depth 1 origin "$KOKOROS_REF" 2>/dev/null || true
    git -C "$staging" checkout -q FETCH_HEAD 2>/dev/null || git -C "$staging" pull -q --ff-only || true
  fi
  log "cargo build --release (kokoros) — needs pkg-config + opus (brew install pkg-config opus)"
  (cd "$staging" && cargo build --release --bin koko)
  local built
  built=$(find "$staging/target/release" -maxdepth 1 -type f -name koko -perm +111 | head -1)
  [ -n "$built" ] || return 1
  cp -a "$built" "$OUT/koko"
  chmod +x "$OUT/koko"
  log "koko built → $OUT/koko"
  return 0
}

if [ -z "${SKIP_KOKO:-}" ]; then
  if [ -x "$OUT/koko" ] && [ -z "${FORCE_REBUILD:-}" ]; then
    log "koko already at $OUT"
  else
    if { [ -n "$DESKTOP_BIN" ] && install_koko_from_copy "$DESKTOP_BIN/koko"; } \
      || install_koko_from_copy "$DOTTIE_APP_BIN/koko" \
      || { [ -n "${DOTTIE_BIN_DIR:-}" ] && install_koko_from_copy "$DOTTIE_BIN_DIR/koko"; } \
      || install_koko_from_copy /usr/local/bin/koko \
      || install_koko_from_copy /opt/homebrew/bin/koko \
      || install_koko_cargo; then
      :
    else
      die "koko not found — place binary at $OUT/koko, or install Rust (cargo) + brew pkg-config opus"
    fi
  fi
  install_koko_espeak
fi

log "done. $OUT"
ls -lh "$OUT/parakeet-server" "$OUT/koko" 2>/dev/null || true
