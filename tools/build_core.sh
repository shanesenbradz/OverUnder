#!/bin/bash
# Rebuilds vendor/melonds/melonds.js and melonds.wasm from source: melonDS at the pinned
# commit, plus vendor/melonds/bullpup.patch (frame skip hooks, 4 MB DS save states, an
# Emscripten-friendly teakra build) and vendor/melonds/src/melonds_shim.cpp (the flat API).
#
# Needs Emscripten. Either have emcc on PATH (emsdk), or point EMSCRIPTEN_DIR at an
# Emscripten 3.1.50 checkout configured with EM_CONFIG (system clang 18 + binaryen 116
# built from source works when the prebuilt emsdk compilers can't be downloaded).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=${WORK:-$ROOT/.toolchain/core}
MELON_REF=361ffa9501b631d53d7150fe57dec40a8341f664
[ -n "${EMSCRIPTEN_DIR:-}" ] && export PATH="$EMSCRIPTEN_DIR:$PATH"
command -v emcc >/dev/null || { echo "emcc not found"; exit 1; }
mkdir -p "$WORK"
if [ ! -d "$WORK/melonDS/.git" ]; then
  git init -q "$WORK/melonDS" && git -C "$WORK/melonDS" remote add origin https://github.com/melonDS-emu/melonDS
fi
STAMP="$MELON_REF $(sha256sum "$ROOT/vendor/melonds/bullpup.patch" | cut -c1-16)"
if [ "$(cat "$WORK/stamp" 2>/dev/null)" != "$STAMP" ] && [ -z "${KEEP_SRC:-}" ]; then
  git -C "$WORK/melonDS" fetch -q --depth 1 origin $MELON_REF
  git -C "$WORK/melonDS" checkout -q -f FETCH_HEAD
  git -C "$WORK/melonDS" apply "$ROOT/vendor/melonds/bullpup.patch"
  echo "$STAMP" > "$WORK/stamp"
fi
FLAGS="-O3 -msimd128 -fwrapv -flto"   # LTO: about 5% faster frames
COMMON=(-std=gnu++17 -DNDEBUG -I"$WORK/melonDS/src" -Wno-invalid-offsetof --no-entry -sWASM_BIGINT -sMODULARIZE=1
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=1048576
  -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=stringToNewUTF8)
cfg() { # build dir, extra flags
  [ -f "$WORK/$1/build.ninja" ] || emcmake cmake -S "$WORK/melonDS" -B "$WORK/$1" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_QT_SDL=OFF -DENABLE_JIT=OFF -DENABLE_OGLRENDERER=OFF -DENABLE_GDBSTUB=OFF -DENABLE_LTO_RELEASE=OFF \
    "-DCMAKE_CXX_FLAGS=$FLAGS $2" "-DCMAKE_C_FLAGS=$FLAGS $2" >/dev/null
  cmake --build "$WORK/$1" --target core -j "$(nproc)"
}
# 1. single threaded: runs anywhere, including from a plain file
cfg lto ""
em++ $FLAGS "${COMMON[@]}" -I"$WORK/lto/src" "$ROOT/vendor/melonds/src/melonds_shim.cpp" "$WORK/lto/src/libcore.a" "$WORK/lto/src/teakra/src/libteakra.a" \
  -sEXPORT_NAME=createMelonModule -sENVIRONMENT=web,node -o "$ROOT/vendor/melonds/melonds.js"
# 2. threaded: the 3D renderer on a second core. Needs a cross-origin isolated page (the Android
#    app and the GitHub Pages service worker send the headers for it)
cfg mt "-pthread"
mkdir -p "$ROOT/vendor/melonds/mt"
em++ $FLAGS -pthread "${COMMON[@]}" -I"$WORK/mt/src" "$ROOT/vendor/melonds/src/melonds_shim.cpp" "$WORK/mt/src/libcore.a" "$WORK/mt/src/teakra/src/libteakra.a" \
  -sPTHREAD_POOL_SIZE=1 -Wno-pthreads-mem-growth -sEXPORT_NAME=createMelonModuleMT -sENVIRONMENT=web,worker,node -o "$ROOT/vendor/melonds/mt/melonds.js"
ls -l "$ROOT"/vendor/melonds/melonds.* "$ROOT"/vendor/melonds/mt/
