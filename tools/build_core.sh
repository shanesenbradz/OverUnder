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
if [ "$(cat "$WORK/stamp" 2>/dev/null)" != "$STAMP" ]; then
  git -C "$WORK/melonDS" fetch -q --depth 1 origin $MELON_REF
  git -C "$WORK/melonDS" checkout -q -f FETCH_HEAD
  git -C "$WORK/melonDS" apply "$ROOT/vendor/melonds/bullpup.patch"
  echo "$STAMP" > "$WORK/stamp"
fi
FLAGS="-O3 -msimd128 -fwrapv -flto"   # LTO: about 5% faster frames
[ -f "$WORK/lto/build.ninja" ] || emcmake cmake -S "$WORK/melonDS" -B "$WORK/lto" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_QT_SDL=OFF -DENABLE_JIT=OFF -DENABLE_OGLRENDERER=OFF -DENABLE_GDBSTUB=OFF -DENABLE_LTO_RELEASE=OFF \
  "-DCMAKE_CXX_FLAGS=$FLAGS" "-DCMAKE_C_FLAGS=$FLAGS" >/dev/null
cmake --build "$WORK/lto" --target core -j "$(nproc)"
em++ $FLAGS -std=gnu++17 -DNDEBUG -I"$WORK/melonDS/src" -I"$WORK/lto/src" -Wno-invalid-offsetof \
  "$ROOT/vendor/melonds/src/melonds_shim.cpp" "$WORK/lto/src/libcore.a" "$WORK/lto/src/teakra/src/libteakra.a" \
  --no-entry -sWASM_BIGINT -sMODULARIZE=1 -sEXPORT_NAME=createMelonModule -sENVIRONMENT=web,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=1048576 \
  -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=stringToNewUTF8 \
  -o "$ROOT/vendor/melonds/melonds.js"
ls -l "$ROOT/vendor/melonds/melonds.js" "$ROOT/vendor/melonds/melonds.wasm"
