// native/test_main.cpp: boots a ROM in the native core and checks it the way test/bench.mjs
// checks the wasm one. Built for aarch64 Linux and run under qemu by tools/build_native.sh test.
//   uo_test rom.nds frames jit(0/1) fastmem(0/1) out.rgba
#include "uo_core.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <vector>

static uint32_t crc(const uint8_t* p, size_t n) { uint32_t c = 0xFFFFFFFF; for (size_t i = 0; i < n; i++) { c ^= p[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c; }
static double now() { return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
static int16_t abuf[4096 * 2];
static int drain() { int n, t = 0; do { n = uo_read_audio(abuf, 4096); t += n; } while (n == 4096); return t; }
static void vars(uint32_t* v) { memcpy(v, uo_mainram() + 0x100000, 20); }

int main(int argc, char** argv)
{
    const char* path = argc > 1 ? argv[1] : "bullpup_test.nds";
    int N = argc > 2 ? atoi(argv[2]) : 120, jit = argc > 3 ? atoi(argv[3]) : 1, fm = argc > 4 ? atoi(argv[4]) : 1;
    uo_set_log_level(2);
    uo_set_audio(48000, 0, 0);
    uo_set_jit(jit, fm);
    if (!uo_rom_from_file(path)) { puts("rom read failed"); return 1; }
    if (!uo_load(nullptr, 0)) { puts("load failed"); return 1; }
    printf("jit active %d\n", uo_jit_active());
    double t = now(); int samples = 0;
    for (int i = 0; i < N; i++) { uo_frame(0, 1, 1); samples += drain(); }
    printf("%d frames %.2f ms/frame (qemu), %d audio frames\n", N, (now() - t) / N, samples);
    uint32_t wh = uo_compose(0, 0, 0);
    std::vector<uint32_t> pic(256 * 384);
    uo_copy_composed(pic.data(), (uint32_t)pic.size());
    printf("picture %ux%u crc %08x avg %06x\n", wh >> 16, wh & 0xFFFF, crc((uint8_t*)pic.data(), pic.size() * 4), uo_avg_color());
    uint32_t v[5]; vars(v); printf("vars %u %u %u %u %u\n", v[0], v[1], v[2], v[3], v[4]);
    // keys and touch
    uo_frame(1, 1, 1); uo_frame(1, 1, 1); uo_frame(1, 1, 1);
    uint32_t h0; vars(v); h0 = v[1];
    uo_touch(200, 150, 1); for (int i = 0; i < 4; i++) uo_frame(0, 1, 1);
    vars(v); printf("health %u touch %u %u pen %u\n", h0, v[2] & 0xFF, (v[2] >> 8) & 0xFF, v[2] >> 16);
    uo_touch(0, 0, 0);
    // states
    uint32_t len = uo_state_save(); std::vector<uint8_t> st(uo_state_ptr(), uo_state_ptr() + len);
    vars(v); uint32_t f0 = v[0];
    for (int i = 0; i < 30; i++) uo_frame(0, 1, 1);
    int ok = uo_state_load(st.data(), len); vars(v);
    printf("state %.2f MB, load %d, frame %u == %u\n", len / 1048576.0, ok, v[0], f0);
    // rewind
    uo_rewind_reset(64);
    for (int i = 0; i < 60; i++) { uo_frame(0, 1, 1); drain(); if (i % 2 == 0) uo_rewind_capture(); }
    vars(v); uint32_t fa = v[0]; int steps = 0; for (int i = 0; i < 10; i++) steps += uo_rewind_step();
    vars(v); printf("rewind %d deltas, %d steps ok, frame %u -> %u\n", uo_rewind_count() + steps, steps, fa, v[0]);
    printf("save memory %u bytes\n", uo_save_len());
    for (int i = 0; i < 2; i++) uo_frame(0, 1, 1);
    wh = uo_compose(0, 0, 0); uo_copy_composed(pic.data(), (uint32_t)pic.size());
    if (argc > 5) { FILE* f = fopen(argv[5], "wb"); fwrite(pic.data(), 4, (wh >> 16) * (wh & 0xFFFF), f); fclose(f); }
    vars(v); printf("end vars %u %u %u %u %u crc %08x\n", v[0], v[1], v[2], v[3], v[4], crc((uint8_t*)pic.data(), (wh >> 16) * (wh & 0xFFFF) * 4));
    uo_unload();
    return 0;
}
