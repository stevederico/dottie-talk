#!/bin/bash
# install_bins.sh — stage parakeet-server + koko (+ espeak-ng-data) into package bin/.
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
#   DOTTIE_STT          voxtype|parakeet — on linux defaults to skip parakeet unless parakeet

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${1:-${BUNDLE_OUT:-$PKG_ROOT/bin}}"
CACHE_DIR="${HOME}/.dottie-build-cache"
KOKOROS_REF="${KOKOROS_REF:-main}"

log() { printf '[talk-bins] %s\n' "$*" >&2; }
die() { printf '[talk-bins] ERROR: %s\n' "$*" >&2; exit 1; }

# Linux/Omarchy: Voxtype is system STT — skip bundling parakeet unless forced.
if [ -z "${SKIP_PARAKEET:-}" ]; then
  case "$(uname -s)" in
    Linux)
      case "${DOTTIE_STT:-voxtype}" in
        parakeet) ;;
        *) SKIP_PARAKEET=1; log "SKIP_PARAKEET=1 (linux STT=voxtype; set DOTTIE_STT=parakeet to build)" ;;
      esac
      ;;
  esac
fi

mkdir -p "$OUT"

# ---- parakeet-server --------------------------------------------------------
if [ -z "${SKIP_PARAKEET:-}" ]; then
  if [ -x "$OUT/parakeet-server" ] && [ -z "${FORCE_REBUILD:-}" ]; then
    log "parakeet-server already at $OUT"
  else
    log "installing parakeet-server → $OUT (cmake build)"
    BUNDLE_OUT="$OUT" bash "$SCRIPT_DIR/install_parakeet_bundle.sh" "$OUT"
  fi
fi

# ---- koko -------------------------------------------------------------------
install_koko_from_copy() {
  local src="$1"
  is_native_koko "$src" || return 1
  cp -a "$src" "$OUT/koko"
  chmod +x "$OUT/koko"
  log "koko copied from $src"
  return 0
}

install_koko_espeak() {
  local src_dir=""
  for d in \
    "$OUT/espeak-ng-data" \
    "/opt/homebrew/share/espeak-ng-data" \
    "/usr/local/share/espeak-ng-data" \
    "/usr/share/espeak-ng-data"; do
    if [ -f "$d/phontab" ]; then
      src_dir="$d"
      break
    fi
  done
  if [ -z "$src_dir" ]; then
    log "WARN: espeak-ng-data not found — install espeak-ng (brew/pacman/apt), or keep espeak-ng-data in $OUT"
    return 0
  fi
  if [ "$src_dir" = "$OUT/espeak-ng-data" ]; then
    return 0
  fi
  rm -rf "$OUT/espeak-ng-data"
  cp -a "$src_dir" "$OUT/espeak-ng-data"
  log "espeak-ng-data from $src_dir"
}

opus_hint() {
  case "$(uname -s)" in
    Darwin) printf 'brew install pkg-config opus' ;;
    Linux) printf 'sudo pacman -S --needed libsonic pcaudiolib espeak-ng pkgconf opus cmake  # or: sudo apt install libsonic-dev libpcaudio-dev espeak-ng pkg-config libopus-dev cmake' ;;
    *) printf 'install pkg-config + opus' ;;
  esac
}

# Repo ships a Darwin koko. Skip it on Linux (and skip ELF on macOS).
is_native_koko() {
  local f="$1"
  [ -f "$f" ] || return 1
  local mag
  mag=$(od -An -N4 -tx1 "$f" 2>/dev/null | tr -d ' \n')
  case "$(uname -s)" in
    Linux)  [ "$mag" = "7f454c46" ] ;;
    Darwin) [ "$mag" = "cfaedefe" ] || [ "$mag" = "feedfacf" ] || [ "$mag" = "cefaedfe" ] ;;
    *) return 0 ;;
  esac
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
  if ! command -v cmake >/dev/null 2>&1; then
    local mise_cmake
    mise_cmake=$(echo "$HOME"/.local/share/mise/installs/cmake/*/cmake-*-linux-*/bin)
    if [ -n "$mise_cmake" ] && [ -x "${mise_cmake%% *}/cmake" ]; then
      PATH="${mise_cmake%% *}:$PATH"
      log "cmake from mise: $(command -v cmake)"
    fi
  fi
  log "cargo build --release (kokoros) — needs $(opus_hint)"
  (cd "$staging" && cargo build --release --bin koko)
  local built="$staging/target/release/koko"
  [ -x "$built" ] || return 1
  cp -a "$built" "$OUT/koko"
  chmod +x "$OUT/koko"
  log "koko built → $OUT/koko"
  return 0
}

if [ -z "${SKIP_KOKO:-}" ]; then
  if is_native_koko "$OUT/koko" && [ -z "${FORCE_REBUILD:-}" ]; then
    log "koko already at $OUT"
  else
    if [ -f "$OUT/koko" ] && ! is_native_koko "$OUT/koko"; then
      log "ignoring non-native koko at $OUT/koko — building for $(uname -s)"
    fi
    if install_koko_from_copy /usr/local/bin/koko \
      || install_koko_from_copy /opt/homebrew/bin/koko \
      || install_koko_cargo; then
      :
    else
      die "koko not found — place binary at $OUT/koko, or install Rust (cargo) + $(opus_hint)"
    fi
  fi
  install_koko_espeak
fi

log "done. $OUT"
ls -lh "$OUT/parakeet-server" "$OUT/koko" 2>/dev/null || ls -lh "$OUT/koko" 2>/dev/null || true
