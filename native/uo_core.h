/*
    Brad's Underover native core: the melonDS API the Android app drives,
    with the ARM64 JIT. Same shape as vendor/melonds/src/melonds_shim.cpp
    (the WebAssembly build), minus Emscripten.

    Released under the GNU GPL v3 or later, like melonDS.
*/
#pragma once
#include <cstdint>
#include <cstddef>

extern "C" {
typedef uint8_t u8_t;

void uo_set_log_level(int lv);
void uo_set_user(const char* name, int lang, int color, int month, int day);
void uo_set_audio(double rate, int interp, int bitdepth);
void uo_set_jit(int on, int fastmem);
int uo_jit_active();

/* ROM handover: begin allocates, chunk appends, load boots it (the buffer then belongs to the core) */
int uo_rom_begin(uint32_t len);
int uo_rom_append(const uint8_t* data, uint32_t n);
int uo_rom_from_file(const char* path);
int uo_rom_to_file(const char* path);
int uo_load(const uint8_t* save, uint32_t savelen);
void uo_unload();
void uo_reset();
int uo_loaded();

int uo_is_threaded();
void uo_set_threaded(int on);

uint32_t uo_frame(uint32_t keys, int draw2d, int render3d);
int uo_read_audio(int16_t* out, int frames);
void uo_touch(int x, int y, int down);
void uo_set_lid(int closed);
int uo_lid();
void uo_mic_blow(int on);
void uo_mic_live(int on);
void uo_mic_push(const int16_t* data, int n);
int uo_top_is_main();

/* the two screens laid out as one RGBA picture (R,G,B,A bytes). Returns w<<16|h, 0 if nothing to show */
uint32_t uo_compose(int layout, int swap, int gap);
/* copies the last composed picture (thread safe, for the GL thread). Returns w<<16|h, 0 if it doesn't fit */
uint32_t uo_copy_composed(uint32_t* dst, uint32_t capPixels);
/* bumps every time a new picture is composed */
uint32_t uo_composed_serial();
/* average colour of the last composed picture, 0xRRGGBB */
uint32_t uo_avg_color();

uint8_t* uo_save_ptr();
uint32_t uo_save_len();
int uo_save_dirty();
void uo_save_import(const uint8_t* data, uint32_t len);

uint32_t uo_state_save();
const uint8_t* uo_state_ptr();
int uo_state_load(const uint8_t* data, uint32_t len);

void uo_rewind_reset(uint32_t budgetMB);
int uo_rewind_count();
uint32_t uo_rewind_bytes();
int uo_rewind_capture();
int uo_rewind_step();

void uo_cheats_clear();
void uo_cheat_add(const uint32_t* words, int n);

uint8_t* uo_mainram();
uint32_t uo_mainram_mask();
uint32_t uo_frame_count();
}
