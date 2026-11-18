/*
    Brad's Bullpup DS: flat C API over the melonDS core for WebAssembly.

    Everything the web app needs goes through the nds_* functions below:
    boot a ROM, run a frame, read the two screens already laid out and
    converted to RGBA, drain audio, feed buttons, stylus, lid and mic,
    read and write cart saves, save states and Action Replay cheats.

    Released under the GNU GPL v3 or later, like melonDS.
*/
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <memory>
#include <string>
#include <vector>
#include <deque>
#include <functional>
#include <emscripten/emscripten.h>
#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

#include "NDS.h"
#include "NDSCart.h"
#include "GPU.h"
#include "GPU_Soft.h"
#include "SPU.h"
#include "SPI.h"
#include "RTC.h"
#include "Savestate.h"
#include "AREngine.h"
#include "Platform.h"
#include "FreeBIOS.h"
#include "frontend/mic_blow.h"

using namespace melonDS;

#define EXPORT extern "C" EMSCRIPTEN_KEEPALIVE

/* ---------------------------------------------------------------- state */
static NDS* nds = nullptr;
static double g_rate = 48000.0;
static bool g_threaded = false;
static int g_interp = 0;     // AudioInterpolation
static int g_bitdepth = 0;   // AudioBitDepth
static std::string g_name = "Brad";
static int g_lang = 1, g_color = 0, g_bmonth = 1, g_bday = 1;
static u32 g_keys = 0;       // active-high DS buttons, bit order as the hardware
static int g_saveDirty = 0;

static u32* g_out = nullptr; // composed RGBA frame
static int g_outW = 256, g_outH = 384;
static Savestate* g_state = nullptr;

/* mic: either the real microphone (pushed from JS) or the built-in blow sample */
static s16 micRing[8192];
static u32 micW = 0, micR = 0;
static int micBlow = 0, micBlowPos = 0, micLive = 0;

/* ---------------------------------------------------------------- Platform */
namespace melonDS { namespace Platform {

void SignalStop(StopReason, void*) {}

struct FileHandle { FILE* f; };

static std::string ModeStr(FileMode mode, bool exists)
{
    bool r = mode & FileMode::Read, w = mode & FileMode::Write;
    bool app = mode & FileMode::Append, pres = mode & FileMode::Preserve;
    std::string s;
    if (app) s = r ? "a+" : "a";
    else if (r && w) s = (pres && exists) ? "r+" : (pres ? "w+" : (exists ? "r+" : "w+"));
    else if (w) s = (pres && exists) ? "r+" : "w";
    else s = "r";
    if (!(mode & FileMode::Text)) s += "b";
    return s;
}

FileHandle* OpenFile(const std::string& path, FileMode mode)
{
    FILE* t = fopen(path.c_str(), "rb");
    bool exists = t != nullptr; if (t) fclose(t);
    if ((mode & FileMode::NoCreate) && !exists) return nullptr;
    FILE* f = fopen(path.c_str(), ModeStr(mode, exists).c_str());
    if (!f) return nullptr;
    return new FileHandle{f};
}
std::string GetLocalFilePath(const std::string& filename) { return "/" + filename; }
FileHandle* OpenLocalFile(const std::string& path, FileMode mode) { return OpenFile(GetLocalFilePath(path), mode); }
bool FileExists(const std::string& name) { FILE* f = fopen(name.c_str(), "rb"); if (f) fclose(f); return f != nullptr; }
bool LocalFileExists(const std::string& name) { return FileExists(GetLocalFilePath(name)); }
bool CheckFileWritable(const std::string&) { return true; }
bool CheckLocalFileWritable(const std::string&) { return true; }
bool CloseFile(FileHandle* file) { if (!file) return false; fclose(file->f); delete file; return true; }
bool IsEndOfFile(FileHandle* file) { return feof(file->f) != 0; }
bool FileReadLine(char* str, int count, FileHandle* file) { return fgets(str, count, file->f) != nullptr; }
u64 FilePosition(FileHandle* file) { return ftell(file->f); }
bool FileSeek(FileHandle* file, s64 offset, FileSeekOrigin origin)
{
    int o = origin == FileSeekOrigin::Start ? SEEK_SET : origin == FileSeekOrigin::Current ? SEEK_CUR : SEEK_END;
    return fseek(file->f, (long)offset, o) == 0;
}
void FileRewind(FileHandle* file) { rewind(file->f); }
u64 FileRead(void* data, u64 size, u64 count, FileHandle* file) { return fread(data, size, count, file->f); }
bool FileFlush(FileHandle* file) { return fflush(file->f) == 0; }
u64 FileWrite(const void* data, u64 size, u64 count, FileHandle* file) { return fwrite(data, size, count, file->f); }
u64 FileWriteFormatted(FileHandle* file, const char* fmt, ...)
{
    va_list a; va_start(a, fmt); int n = vfprintf(file->f, fmt, a); va_end(a); return n < 0 ? 0 : n;
}
u64 FileLength(FileHandle* file)
{
    long p = ftell(file->f); fseek(file->f, 0, SEEK_END); long n = ftell(file->f); fseek(file->f, p, SEEK_SET); return n;
}

static int g_logLevel = 3;
void Log(LogLevel level, const char* fmt, ...)
{
    if ((int)level < g_logLevel) return;
    char buf[512]; va_list a; va_start(a, fmt); vsnprintf(buf, sizeof buf, fmt, a); va_end(a);
    fputs(buf, stderr);
}

/* single-threaded build: the software 3D renderer runs in line, so these never block */
struct Thread { std::function<void()> fn; };
Thread* Thread_Create(std::function<void()> func) { return new Thread{std::move(func)}; }
void Thread_Free(Thread* t) { delete t; }
void Thread_Wait(Thread*) {}
struct Semaphore { int n; };
Semaphore* Semaphore_Create() { return new Semaphore{0}; }
void Semaphore_Free(Semaphore* s) { delete s; }
void Semaphore_Reset(Semaphore* s) { s->n = 0; }
void Semaphore_Wait(Semaphore* s) { if (s->n > 0) s->n--; }
bool Semaphore_TryWait(Semaphore* s, int) { if (s->n > 0) { s->n--; return true; } return false; }
void Semaphore_Post(Semaphore* s, int count) { s->n += count; }
struct Mutex { int x; };
Mutex* Mutex_Create() { return new Mutex{0}; }
void Mutex_Free(Mutex* m) { delete m; }
void Mutex_Lock(Mutex*) {}
void Mutex_Unlock(Mutex*) {}
bool Mutex_TryLock(Mutex*) { return true; }
void Sleep(u64) {}
u64 GetMSCount() { return (u64)emscripten_get_now(); }
u64 GetUSCount() { return (u64)(emscripten_get_now() * 1000.0); }

void WriteNDSSave(const u8*, u32, u32, u32, void*) { g_saveDirty = 1; }
void WriteGBASave(const u8*, u32, u32, u32, void*) {}
void WriteFirmware(const Firmware&, u32, u32, void*) {}
void WriteDateTime(int, int, int, int, int, int, void*) {}

void MP_Begin(void*) {}
void MP_End(void*) {}
int MP_SendPacket(u8*, int, u64, void*) { return 0; }
int MP_RecvPacket(u8*, u64*, void*) { return 0; }
int MP_SendCmd(u8*, int, u64, void*) { return 0; }
int MP_SendReply(u8*, int, u64, u16, void*) { return 0; }
int MP_SendAck(u8*, int, u64, void*) { return 0; }
int MP_RecvHostPacket(u8*, u64*, void*) { return 0; }
u16 MP_RecvReplies(u8*, u64, u16, void*) { return 0; }
int Net_SendPacket(u8*, int, void*) { return 0; }
int Net_RecvPacket(u8*, void*) { return 0; }

void Mic_Start(void*) {}
void Mic_Stop(void*) {}
int Mic_ReadInput(s16* data, int maxlength, void*)
{
    if (micBlow)
    {
        const int n = sizeof(mic_blow) / sizeof(mic_blow[0]);
        for (int i = 0; i < maxlength; i++) { data[i] = mic_blow[micBlowPos++]; if (micBlowPos >= n) micBlowPos = 0; }
        return maxlength;
    }
    int i = 0;
    for (; i < maxlength && micR != micW; i++) data[i] = micRing[micR++ & 8191];
    if (micLive) return i;   // real microphone: hand over what has arrived, the core waits for more
    for (; i < maxlength; i++) data[i] = 0;
    return maxlength;
}

void Camera_Start(int, void*) {}
void Camera_Stop(int, void*) {}
void Camera_CaptureFrame(int, u32* frame, int width, int height, bool, void*) { memset(frame, 0, width * height * 4); }

bool Addon_KeyDown(KeyType, void*) { return false; }
void Addon_RumbleStart(u32, void*) {}
void Addon_RumbleStop(void*) {}
float Addon_MotionQuery(MotionQueryType, void*) { return 0.f; }

struct AACDecoder { int x; };
AACDecoder* AAC_Init() { return nullptr; }
void AAC_DeInit(AACDecoder*) {}
bool AAC_Configure(AACDecoder*, int, int) { return false; }
bool AAC_DecodeFrame(AACDecoder*, const void*, int, void*, int) { return false; }

DynamicLibrary* DynamicLibrary_Load(const char*) { return nullptr; }
void DynamicLibrary_Unload(DynamicLibrary*) {}
void* DynamicLibrary_LoadFunction(DynamicLibrary*, const char*) { return nullptr; }

}} // namespace melonDS::Platform

/* ---------------------------------------------------------------- helpers */
static Firmware MakeFirmware()
{
    Firmware fw(0);
    auto& d = fw.GetEffectiveUserData();
    size_t n = std::min<size_t>(g_name.size(), 10);
    memset(d.Nickname, 0, sizeof d.Nickname);
    for (size_t i = 0; i < n; i++) d.Nickname[i] = (u8)g_name[i];
    d.NameLength = n;
    d.Settings &= ~Firmware::Language::Reserved;
    d.Settings |= (Firmware::Language)(g_lang & 7);
    d.FavoriteColor = g_color & 15;
    d.BirthdayMonth = g_bmonth; d.BirthdayDay = g_bday;
    fw.UpdateChecksums();
    return fw;
}

static void ApplyRendererSettings()
{
    RendererSettings s{};
    s.ScaleFactor = 1; s.Threaded = g_threaded; s.HiresCoordinates = false; s.BetterPolygons = false;
    nds->GetRenderer().SetRenderSettings(s);
}

static void SetClockNow()
{
    double t = EM_ASM_DOUBLE({ var d = new Date(); return d.getTime() - d.getTimezoneOffset() * 60000; }) / 1000.0;
    time_t tt = (time_t)t; struct tm g; gmtime_r(&tt, &g);
    nds->RTC.SetDateTime(g.tm_year + 1900, g.tm_mon + 1, g.tm_mday, g.tm_hour, g.tm_min, g.tm_sec);
}

/* ---------------------------------------------------------------- API */
EXPORT void nds_set_log_level(int lv) { Platform::g_logLevel = lv; }
EXPORT void nds_set_user(const char* name, int lang, int color, int month, int day)
{
    g_name = name ? name : "Brad"; g_lang = lang; g_color = color; g_bmonth = month ? month : 1; g_bday = day ? day : 1;
}
EXPORT void nds_set_audio(double rate, int interp, int bitdepth)
{
    g_rate = rate; g_interp = interp; g_bitdepth = bitdepth;
    if (nds)
    {
        nds->SPU.SetOutputSampleRate(rate);
        nds->SPU.SetInterpolation((AudioInterpolation)interp);
        nds->SPU.SetDegrade10Bit((AudioBitDepth)bitdepth);
    }
}

EXPORT void nds_unload()
{
    if (g_state) { delete g_state; g_state = nullptr; }
    if (nds) { delete nds; nds = nullptr; }
}

/* rom must come from malloc and now belongs to the core; save is copied. Returns 1 on success */
EXPORT int nds_load(const u8* rom, u32 romlen, const u8* save, u32 savelen, int directBoot)
{
    nds_unload();
    NDSArgs args{};
    args.Firmware = MakeFirmware();
    args.JIT = std::nullopt;
    args.Interpolation = (AudioInterpolation)g_interp;
    args.BitDepth = (AudioBitDepth)g_bitdepth;
    args.OutputSampleRate = g_rate;
    nds = new NDS(std::move(args), nullptr);
    nds->SetRenderer(std::make_unique<SoftRenderer>(*nds));
    ApplyRendererSettings();
    nds->Reset();

    NDSCart::NDSCartArgs cargs{};
    if (save && savelen)
    {
        cargs.SRAM = std::make_unique<u8[]>(savelen);
        memcpy(cargs.SRAM.get(), save, savelen);
        cargs.SRAMLength = savelen;
    }
    // The cart takes over the buffer JS malloc'd for the ROM instead of copying it, so a
    // 512 MB game needs 512 MB of heap, not twice that. (operator delete[] is free() here.)
    std::unique_ptr<u8[]> romdata((u8*)rom);
    auto cart = NDSCart::ParseROM(std::move(romdata), romlen, nullptr, std::move(cargs));
    if (!cart) { nds_unload(); return 0; }
    nds->SetNDSCart(std::move(cart));
    nds->Reset();
    // FreeBIOS and a generated firmware can't run the DS menu, so the cart is always booted directly
    if (directBoot || nds->NeedsDirectBoot()) nds->SetupDirectBoot("game.nds");
    SetClockNow();
    nds->Start();
    g_saveDirty = 0;
    return 1;
}

EXPORT void nds_reset()
{
    if (!nds) return;
    nds->Reset();
    nds->SetupDirectBoot("game.nds");
    SetClockNow();
    nds->Start();
}

EXPORT void nds_set_threaded(int on) { g_threaded = on != 0; if (nds) ApplyRendererSettings(); }

/* buttons, active high: A B Sel Start Right Left Up Down R L X Y (bits 0..11) */
EXPORT void nds_set_keys(u32 mask) { g_keys = mask & 0xFFF; }
EXPORT void nds_touch(int x, int y, int down)
{
    if (!nds) return;
    if (down) nds->TouchScreen((u16)std::clamp(x, 0, 255), (u16)std::clamp(y, 0, 191));
    else nds->ReleaseScreen();
}
EXPORT void nds_set_lid(int closed) { if (nds) nds->SetLidClosed(closed != 0); }
EXPORT int nds_lid() { return nds && nds->IsLidClosed(); }
EXPORT void nds_mic_blow(int on) { micBlow = on; if (!on) micBlowPos = 0; }
EXPORT void nds_mic_live(int on) { micLive = on; micR = micW = 0; }
EXPORT void nds_mic_push(const s16* data, int n)
{
    for (int i = 0; i < n; i++) { if (micW - micR >= 8191) micR++; micRing[micW++ & 8191] = data[i]; }
}

/* draw2d = 0 skips drawing this frame's picture, render3d = 0 skips rendering the 3D scene
   the next frame would show. Both stay on while the game uses display capture. */
EXPORT u32 nds_run_frame(int draw2d, int render3d)
{
    if (!nds) return 0;
    nds->SetKeyMask(~g_keys & 0xFFF);
    SkipDraw2D = !draw2d; SkipRender3D = !render3d;
    u32 r = nds->RunFrame();
    SkipDraw2D = SkipRender3D = false;
    // Action Replay codes run once a frame, at the end of it (just after VBlank starts)
    if (!nds->AREngine.Cheats.empty()) nds->AREngine.RunCheats();
    return r;
}
/* which engine drives the top screen right now (1 = engine A on top): lets the app guess the main screen */
EXPORT int nds_top_is_main() { return nds ? (nds->PowerControl9 >> 15) & 1 : 1; }

/* Lay the two 256x192 screens out into one RGBA picture.
   layout 0: stacked, 1: side by side, 2: one screen only.
   swap exchanges top and bottom (in layout 2 it picks the bottom screen).
   gap is the black gap in pixels between the screens. Returns w<<16|h. */
static inline void CopyLine(u32* dst, const u32* src)
{
#ifdef __wasm_simd128__
    // melonDS writes 0xAARRGGBB words, canvas wants R,G,B,A bytes: swap R and B, force alpha
    const v128_t shuf = wasm_i8x16_const(2,1,0,3, 6,5,4,7, 10,9,8,11, 14,13,12,15);
    const v128_t alpha = wasm_i32x4_splat((int)0xFF000000);
    for (int i = 0; i < 256; i += 4)
    {
        v128_t v = wasm_v128_load(src + i);
        v = wasm_v128_or(wasm_i8x16_swizzle(v, shuf), alpha);
        wasm_v128_store(dst + i, v);
    }
#else
    for (int i = 0; i < 256; i++) { u32 c = src[i]; dst[i] = 0xFF000000 | (c & 0xFF00) | ((c >> 16) & 0xFF) | ((c & 0xFF) << 16); }
#endif
}
EXPORT u32 nds_compose(int layout, int swap, int gap)
{
    if (!nds) return 0;
    void *tp, *bp;
    if (!nds->GPU.GetFramebuffers(&tp, &bp)) return 0;
    const u32* A = (const u32*)tp; const u32* B = (const u32*)bp;
    if (swap) std::swap(A, B);
    gap = std::clamp(gap, 0, 192);
    int w, h;
    if (layout == 1) { w = 512 + gap; h = 192; }
    else if (layout == 2) { w = 256; h = 192; }
    else { w = 256; h = 384 + gap; }
    if (!g_out || w * h > g_outW * g_outH || w != g_outW || h != g_outH)
    {
        free(g_out); g_out = (u32*)malloc(w * h * 4); g_outW = w; g_outH = h;
        for (int i = 0; i < w * h; i++) g_out[i] = 0xFF000000;
    }
    if (layout == 1)
    {
        for (int y = 0; y < 192; y++)
        {
            CopyLine(g_out + y * w, A + y * 256);
            CopyLine(g_out + y * w + 256 + gap, B + y * 256);
        }
    }
    else if (layout == 2)
    {
        for (int y = 0; y < 192; y++) CopyLine(g_out + y * 256, A + y * 256);
    }
    else
    {
        for (int y = 0; y < 192; y++) CopyLine(g_out + y * 256, A + y * 256);
        for (int y = 0; y < 192; y++) CopyLine(g_out + (192 + gap + y) * 256, B + y * 256);
    }
    return (u32)w << 16 | (u32)h;
}
EXPORT u32* nds_frame_ptr() { return g_out; }

/* audio: interleaved stereo s16 at the rate from nds_set_audio */
EXPORT int nds_read_audio(s16* out, int frames) { return nds ? nds->SPU.ReadOutput(out, frames) : 0; }
EXPORT int nds_audio_pending() { return nds ? nds->SPU.GetOutputSize() : 0; }

/* cart save memory */
EXPORT u8* nds_save_ptr() { return nds ? nds->GetNDSSave() : nullptr; }
EXPORT u32 nds_save_len() { return nds ? nds->GetNDSSaveLength() : 0; }
EXPORT int nds_save_dirty() { int d = g_saveDirty; g_saveDirty = 0; return d; }
EXPORT void nds_save_import(const u8* data, u32 len) { if (nds) nds->SetNDSSave(data, len); }

/* save states, kept in one reusable buffer */
EXPORT u32 nds_state_save()
{
    if (!nds) return 0;
    if (!g_state) g_state = new Savestate(24 * 1024 * 1024);
    else
    {
        delete g_state; g_state = new Savestate(24 * 1024 * 1024);
    }
    if (g_state->Error) return 0;
    if (!nds->DoSavestate(g_state) || g_state->Error) return 0;
    g_state->Finish();
    return g_state->Length();
}
EXPORT u8* nds_state_ptr() { return g_state ? (u8*)g_state->Buffer() : nullptr; }
EXPORT int nds_state_load(u8* data, u32 len)
{
    if (!nds || len < 16) return 0;
    u32 real; memcpy(&real, data + 8, 4);   // the header carries the state's own length
    if (real > len) return 0;
    Savestate st(data, real, false);
    if (st.Error) return 0;
    if (!nds->DoSavestate(&st) || st.Error) return 0;
    return 1;
}

/* Rewind: XOR deltas between consecutive states, run-length coded, newest full state kept.
   Same scheme the GBA app used in JS, done here so a 5 MB state costs a few ms. */
static std::vector<u8> rwCur, rwTmp;
static std::deque<std::vector<u32>> rwDeltas;
static size_t rwBytes = 0, rwBudget = 64u << 20;
static bool rwHas = false;
EXPORT void nds_rewind_reset(u32 budgetMB) { rwDeltas.clear(); rwBytes = 0; rwHas = false; if (budgetMB) rwBudget = (size_t)budgetMB << 20; }
EXPORT int nds_rewind_count() { return (int)rwDeltas.size(); }
EXPORT u32 nds_rewind_bytes() { return (u32)rwBytes; }
EXPORT int nds_rewind_capture()
{
    u32 len = nds_state_save(); if (!len) return 0;
    u32 n = (len + 3) & ~3u;
    if (!rwHas || rwCur.size() != n) { rwCur.assign(n, 0); memcpy(rwCur.data(), g_state->Buffer(), len); rwHas = true; rwDeltas.clear(); rwBytes = 0; return 1; }
    rwTmp.assign(n, 0); memcpy(rwTmp.data(), g_state->Buffer(), len);
    const u32* a = (const u32*)rwCur.data(); const u32* b = (const u32*)rwTmp.data();
    u32 W = n >> 2, i = 0;
    std::vector<u32> out; out.reserve(1024);
    while (i < W)
    {
        u32 z = i;
#ifdef __wasm_simd128__
        while (z + 4 <= W && wasm_i32x4_all_true(wasm_i32x4_eq(wasm_v128_load(a + z), wasm_v128_load(b + z)))) z += 4;
#endif
        while (z < W && a[z] == b[z]) z++;
        u32 zr = z - i; i = z;
        if (i >= W) break;
        u32 l = i; while (l < W && a[l] != b[l]) l++;
        out.push_back(zr); out.push_back(l - i);
        for (u32 k = i; k < l; k++) out.push_back(a[k] ^ b[k]);
        i = l;
    }
    rwCur.swap(rwTmp);
    rwBytes += out.size() * 4;
    rwDeltas.push_back(std::move(out));
    while (rwBytes > rwBudget && rwDeltas.size() > 1) { rwBytes -= rwDeltas.front().size() * 4; rwDeltas.pop_front(); }
    return 1;
}
EXPORT int nds_rewind_step()
{
    if (rwDeltas.empty()) return 0;
    std::vector<u32> d = std::move(rwDeltas.back()); rwDeltas.pop_back(); rwBytes -= d.size() * 4;
    u32* cur = (u32*)rwCur.data(); size_t p = 0, i = 0;
    while (p < d.size()) { i += d[p++]; u32 L = d[p++]; for (u32 k = 0; k < L; k++) cur[i + k] ^= d[p++]; i += L; }
    return nds_state_load(rwCur.data(), (u32)rwCur.size());
}

/* Action Replay DS cheats: codes as 32-bit word pairs */
EXPORT void nds_cheats_clear() { if (nds) nds->AREngine.Cheats.clear(); }
EXPORT void nds_cheat_add(const u32* words, int n)
{
    if (!nds) return;
    ARCode c{}; c.Parent = nullptr; c.Name = "c"; c.Enabled = true;
    c.Code.assign(words, words + n);
    nds->AREngine.Cheats.push_back(std::move(c));
}

/* main RAM, for the RAM search: 4 MB mirrored at 0x02000000 */
EXPORT u8* nds_mainram() { return nds ? nds->MainRAM : nullptr; }
EXPORT u32 nds_mainram_mask() { return nds ? nds->MainRAMMask : 0; }

/* ROM header bits for the library */
EXPORT u32 nds_frame_count() { return nds ? nds->NumFrames : 0; }
EXPORT void nds_set_clock(int y, int mo, int d, int h, int mi, int s) { if (nds) nds->RTC.SetDateTime(y, mo, d, h, mi, s); }
