# melonDS core

`melonds.js` and `melonds.wasm` are built from source by `tools/build_core.sh`:

- melonDS (https://github.com/melonDS-emu/melonDS) at commit 361ffa9501b631d53d7150fe57dec40a8341f664,
  built as a static library with Emscripten 3.1.50, `-O3 -msimd128 -flto`, no JIT (WebAssembly can't
  run one), software renderer, single threaded
- `bullpup.patch`, applied on top:
  - frame skip hooks (`SkipDraw2D`, `SkipRender3D`): a frame nobody will see skips the 2D layers, and the
    3D scene is only rendered for frames that get shown. Both stay on while a game uses display capture
  - DS save states store the 4 MB of main RAM a DS has instead of the 16 MB array kept for the DSi,
    which takes a state from 19 MB to about 6 MB
  - Action Replay codes run once per frame from the frontend instead of from the ARM7 VBlank handler,
    so they work in every game and in homebrew that never enables that interrupt
  - teakra (the DSi DSP) builds without a threads library under Emscripten
- `src/melonds_shim.cpp`: the flat C API the app calls (`nds_*`), the Platform layer (files, mic,
  saves), screen layout and RGBA conversion with WASM SIMD, and rewind deltas computed in C

melonDS uses its built-in FreeBIOS and a generated firmware, so no BIOS or firmware dumps are needed.
Games are always booted directly.

Everything here is under the GNU General Public License version 3 (see LICENSE in this folder).
