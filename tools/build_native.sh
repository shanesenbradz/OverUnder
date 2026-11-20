#!/bin/bash
# Builds native/arm64-v8a/libunderover.so: melonDS with the ARM64 JIT for the Android app.
#
#   ./tools/build_native.sh          the Android library
#   ./tools/build_native.sh test     also builds the core for aarch64 Linux and runs the test ROM
#                                    under qemu-aarch64, with the JIT off and on
#
# Compiler: either the Android NDK (set ANDROID_NDK_HOME, r27 or newer), or any clang 18+ with
# lld plus the NDK's sysroot and clang resource folder (set NDK_SYSROOT_DIR to a folder holding
# sysroot/ and clang/: the NDK's toolchains/llvm/prebuilt/*/sysroot and lib/clang copied side by side).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=${WORK:-$ROOT/.toolchain/native}
MELON_REF=361ffa9501b631d53d7150fe57dec40a8341f664
API=24
mkdir -p "$WORK"

# --- compilers
if [ -n "${ANDROID_NDK_HOME:-}" ]; then
  TCB="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
  CC="$TCB/aarch64-linux-android$API-clang"; CXX="$TCB/aarch64-linux-android$API-clang++"
  AR="$TCB/llvm-ar"; RANLIB="$TCB/llvm-ranlib"; STRIP="$TCB/llvm-strip"
else
  S=${NDK_SYSROOT_DIR:?set ANDROID_NDK_HOME or NDK_SYSROOT_DIR}
  RD=$(ls -d "$S"/clang/clang/* | head -1)
  for t in clang clang++; do
    cat > "$WORK/android-$t" <<EOF
#!/bin/sh
exec $t --target=aarch64-linux-android$API --sysroot=$S/sysroot -resource-dir=$RD -Qunused-arguments -fuse-ld=lld -rtlib=compiler-rt -unwindlib=libunwind "\$@"
EOF
    chmod +x "$WORK/android-$t"
  done
  CC="$WORK/android-clang"; CXX="$WORK/android-clang++"; AR=llvm-ar; RANLIB=llvm-ranlib; STRIP=llvm-strip
fi

# --- melonDS source: the pinned commit, the Bullpup patch (shared with the wasm build) and the Android JIT patch
SRC="$WORK/melonDS"
if [ ! -d "$SRC/.git" ]; then git init -q "$SRC" && git -C "$SRC" remote add origin https://github.com/melonDS-emu/melonDS; fi
STAMP="$MELON_REF $(cat "$ROOT/vendor/melonds/bullpup.patch" "$ROOT/native/android-jit.patch" | sha256sum | cut -c1-16)"
if [ "$(cat "$WORK/stamp" 2>/dev/null)" != "$STAMP" ]; then
  git -C "$SRC" fetch -q --depth 1 origin $MELON_REF
  git -C "$SRC" checkout -q -f FETCH_HEAD
  git -C "$SRC" apply "$ROOT/vendor/melonds/bullpup.patch"
  git -C "$SRC" apply "$ROOT/native/android-jit.patch"
  rm -rf "$WORK/android" "$WORK/linux"
  echo "$STAMP" > "$WORK/stamp"
fi

FLAGS="-O3 -fPIC -ffunction-sections -fdata-sections -fvisibility=hidden"
cat > "$WORK/android.cmake" <<EOF
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER $CC)
set(CMAKE_CXX_COMPILER $CXX)
set(CMAKE_ASM_COMPILER $CC)
set(CMAKE_AR $(command -v $AR || echo $AR))
set(CMAKE_RANLIB $(command -v $RANLIB || echo $RANLIB))
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
EOF
core() { # build dir, toolchain file, flags
  [ -f "$WORK/$1/build.ninja" ] || cmake -S "$SRC" -B "$WORK/$1" -G Ninja -DCMAKE_TOOLCHAIN_FILE="$2" -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_QT_SDL=OFF -DENABLE_JIT=ON -DENABLE_OGLRENDERER=OFF -DENABLE_GDBSTUB=OFF -DENABLE_LTO_RELEASE=OFF \
    "-DCMAKE_CXX_FLAGS=$3" "-DCMAKE_C_FLAGS=$3" >/dev/null
  cmake --build "$WORK/$1" --target core -j "$(nproc)"
}
core android "$WORK/android.cmake" "$FLAGS"
OUT="$ROOT/native/arm64-v8a"; mkdir -p "$OUT"
"$CXX" -std=gnu++17 $FLAGS -I"$SRC/src" -I"$WORK/android/src" -DJIT_ENABLED -DARCHITECTURE_ARM64=1 -shared -static-libstdc++ \
  "$ROOT/native/uo_core.cpp" "$ROOT/native/uo_jni.cpp" "$WORK/android/src/libcore.a" "$WORK/android/src/teakra/src/libteakra.a" \
  -llog -ldl -lz -Wl,-soname,libunderover.so -Wl,--gc-sections -Wl,--exclude-libs,ALL -Wl,-z,max-page-size=16384 -Wl,--no-undefined -o "$OUT/libunderover.so"
$STRIP --strip-unneeded "$OUT/libunderover.so"
ls -l "$OUT/libunderover.so"
# Empty stand-ins for the other ABIs: an APK whose only native code is arm64 won't install on 32-bit
# or x86 phones at all. With these it installs everywhere; the stub has no JNI functions, so the app
# sees no native core there and runs the WebAssembly one.
echo 'int underover_stub;' > "$WORK/stub.c"
for a in armeabi-v7a:armv7a-linux-androideabi x86:i686-linux-android x86_64:x86_64-linux-android; do
  mkdir -p "$ROOT/native/${a%%:*}"
  clang --target=${a#*:}$API -nostdlib -shared -fuse-ld=lld -Wl,-soname,libunderover.so -Wl,-z,max-page-size=16384 "$WORK/stub.c" -o "$ROOT/native/${a%%:*}/libunderover.so"
done

if [ "${1:-}" = test ]; then
  # the same core for aarch64 Linux, run under qemu: needs g++-aarch64-linux-gnu and qemu-user
  cat > "$WORK/linux.cmake" <<EOF
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)
set(CMAKE_ASM_COMPILER aarch64-linux-gnu-gcc)
EOF
  core linux "$WORK/linux.cmake" "-O2 -fPIC"
  aarch64-linux-gnu-g++ -std=gnu++17 -O2 -I"$SRC/src" -I"$WORK/linux/src" -DJIT_ENABLED -DARCHITECTURE_ARM64=1 \
    "$ROOT/native/uo_core.cpp" "$ROOT/native/test_main.cpp" "$WORK/linux/src/libcore.a" "$WORK/linux/src/teakra/src/libteakra.a" \
    -lpthread -ldl -static -o "$WORK/uo_test"
  for cfg in "0 0" "1 1"; do
    echo "== JIT $cfg (jit, fast memory)"
    qemu-aarch64 "$WORK/uo_test" "$ROOT/test/rom/bullpup_test.nds" 120 $cfg
  done
fi
