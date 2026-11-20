/*
    Brad's Underover native core: melonDS with the ARM64 JIT.

    The Android app runs this in place of the WebAssembly build. The JIT turns
    the game's ARM code into native ARM64 code as it runs, which is where the
    big speedup comes from; fast memory maps the DS address space straight onto
    the phone's MMU. The 3D scene is drawn on its own thread.

    Released under the GNU GPL v3 or later, like melonDS.
*/
#include "uo_core.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <ctime>
#include <memory>
#include <string>
#include <vector>
#include <deque>
#include <mutex>
#include <thread>
#include <functional>
#include <algorithm>
#include <semaphore.h>
#include <dlfcn.h>
#include <unistd.h>
#include <sys/resource.h>
#ifdef __ANDROID__
#include <android/log.h>
#endif
#ifdef __aarch64__
#include <arm_neon.h>
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

/* ---------------------------------------------------------------- state */
static NDS* nds = nullptr;
static double g_rate = 48000.0;
static bool g_threaded = true;
static int g_interp = 0, g_bitdepth = 0;
static std::string g_name = "Brad";
static int g_lang = 1, g_color = 0, g_bmonth = 1, g_bday = 1;
static int g_saveDirty = 0;
static bool g_jit = true, g_fastmem = true;

static u8* g_rom = nullptr;
static u32 g_romLen = 0, g_romFill = 0;

static Savestate* g_state = nullptr;

/* composed picture: written by the emulation thread, read by the GL thread */
static std::mutex g_picLock;
static std::vector<u32> g_back, g_front;
static u32 g_frontWH = 0, g_serial = 0;

/* mic: either the real microphone (pushed from the page) or the built-in blow sample */
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
// melonDS never needs local files here (FreeBIOS, generated firmware), so they all live nowhere
std::string GetLocalFilePath(const std::string& filename) { return "/nonexistent/" + filename; }
FileHandle* OpenLocalFile(const std::string& path, FileMode mode) { return OpenFile(GetLocalFilePath(path), mode); }
bool FileExists(const std::string& name) { FILE* f = fopen(name.c_str(), "rb"); if (f) fclose(f); return f != nullptr; }
bool LocalFileExists(const std::string& name) { return FileExists(GetLocalFilePath(name)); }
bool CheckFileWritable(const std::string&) { return false; }
bool CheckLocalFileWritable(const std::string&) { return false; }
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

int g_logLevel = 2;
void Log(LogLevel level, const char* fmt, ...)
{
    if ((int)level < g_logLevel) return;
    char buf[512]; va_list a; va_start(a, fmt); vsnprintf(buf, sizeof buf, fmt, a); va_end(a);
#ifdef __ANDROID__
    __android_log_write(level >= LogLevel::Error ? ANDROID_LOG_ERROR : level >= LogLevel::Warn ? ANDROID_LOG_WARN : ANDROID_LOG_INFO, "melonDS", buf);
#else
    fputs(buf, stderr);
#endif
}

struct Thread { std::thread t; };
// melonDS's own threads (the 3D renderer) get display priority too, like the emulation thread
Thread* Thread_Create(std::function<void()> func)
{
    return new Thread{std::thread([f = std::move(func)] {
#ifdef __ANDROID__
        setpriority(PRIO_PROCESS, 0, -8);
#endif
        f();
    })};
}
void Thread_Free(Thread* t) { if (t->t.joinable()) t->t.detach(); delete t; }
void Thread_Wait(Thread* t) { if (t->t.joinable()) t->t.join(); }
struct Semaphore { sem_t s; };
Semaphore* Semaphore_Create() { auto* x = new Semaphore; sem_init(&x->s, 0, 0); return x; }
void Semaphore_Free(Semaphore* x) { sem_destroy(&x->s); delete x; }
void Semaphore_Reset(Semaphore* x) { while (sem_trywait(&x->s) == 0) {} }
void Semaphore_Wait(Semaphore* x) { while (sem_wait(&x->s) != 0) {} }
bool Semaphore_TryWait(Semaphore* x, int timeout_ms)
{
    if (!timeout_ms) return sem_trywait(&x->s) == 0;
    struct timespec ts; clock_gettime(CLOCK_REALTIME, &ts);
    ts.tv_nsec += (long)timeout_ms * 1000000L; ts.tv_sec += ts.tv_nsec / 1000000000L; ts.tv_nsec %= 1000000000L;
    return sem_timedwait(&x->s, &ts) == 0;
}
void Semaphore_Post(Semaphore* x, int count) { for (int i = 0; i < count; i++) sem_post(&x->s); }
struct Mutex { std::mutex m; };
Mutex* Mutex_Create() { return new Mutex; }
void Mutex_Free(Mutex* m) { delete m; }
void Mutex_Lock(Mutex* m) { m->m.lock(); }
void Mutex_Unlock(Mutex* m) { m->m.unlock(); }
bool Mutex_TryLock(Mutex* m) { return m->m.try_lock(); }

void Sleep(u64 usecs) { usleep((useconds_t)usecs); }
static u64 NowUS() { struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts); return (u64)ts.tv_sec * 1000000ull + ts.tv_nsec / 1000; }
u64 GetMSCount() { return NowUS() / 1000; }
u64 GetUSCount() { return NowUS(); }

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
    if (micLive) return i;
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

// fast memory on Android finds ASharedMemory_create in libandroid.so through these
DynamicLibrary* DynamicLibrary_Load(const char* lib) { return (DynamicLibrary*)dlopen(lib, RTLD_NOW | RTLD_LOCAL); }
void DynamicLibrary_Unload(DynamicLibrary* lib) { if (lib) dlclose(lib); }
void* DynamicLibrary_LoadFunction(DynamicLibrary* lib, const char* name) { return lib ? dlsym(lib, name) : nullptr; }

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
    time_t tt = time(nullptr); struct tm g; localtime_r(&tt, &g);
    nds->RTC.SetDateTime(g.tm_year + 1900, g.tm_mon + 1, g.tm_mday, g.tm_hour, g.tm_min, g.tm_sec);
}

/* ---------------------------------------------------------------- API */
extern "C" {

void uo_set_log_level(int lv) { Platform::g_logLevel = lv; }
void uo_set_user(const char* name, int lang, int color, int month, int day)
{
    g_name = name ? name : "Brad"; g_lang = lang; g_color = color; g_bmonth = month ? month : 1; g_bday = day ? day : 1;
}
void uo_set_audio(double rate, int interp, int bitdepth)
{
    g_rate = rate; g_interp = interp; g_bitdepth = bitdepth;
    if (nds)
    {
        nds->SPU.SetOutputSampleRate(rate);
        nds->SPU.SetInterpolation((AudioInterpolation)interp);
        nds->SPU.SetDegrade10Bit((AudioBitDepth)bitdepth);
    }
}
void uo_set_jit(int on, int fastmem) { g_jit = on != 0; g_fastmem = fastmem != 0; }
int uo_jit_active() { return nds && nds->IsJITEnabled(); }

void uo_unload()
{
    if (g_state) { delete g_state; g_state = nullptr; }
    if (nds) { delete nds; nds = nullptr; }
    std::lock_guard<std::mutex> l(g_picLock); g_frontWH = 0;
}
int uo_loaded() { return nds != nullptr; }

int uo_rom_begin(u32 len)
{
    free(g_rom); g_rom = nullptr; g_romLen = g_romFill = 0;
    if (!len) return 0;
    g_rom = (u8*)malloc(len);
    if (!g_rom) return 0;
    g_romLen = len;
    return 1;
}
int uo_rom_append(const u8* data, u32 n)
{
    if (!g_rom || g_romFill + n > g_romLen) return 0;
    memcpy(g_rom + g_romFill, data, n); g_romFill += n;
    return 1;
}
int uo_rom_from_file(const char* path)
{
    FILE* f = fopen(path, "rb"); if (!f) return 0;
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    if (n <= 0 || !uo_rom_begin((u32)n)) { fclose(f); return 0; }
    size_t got = fread(g_rom, 1, n, f); fclose(f);
    g_romFill = (u32)got;
    return got == (size_t)n;
}
int uo_rom_to_file(const char* path)
{
    if (!g_rom || g_romFill != g_romLen) return 0;
    std::string tmp = std::string(path) + ".part";
    FILE* f = fopen(tmp.c_str(), "wb"); if (!f) return 0;
    size_t put = fwrite(g_rom, 1, g_romLen, f);
    bool ok = fclose(f) == 0 && put == g_romLen;
    if (ok) ok = rename(tmp.c_str(), path) == 0;
    if (!ok) remove(tmp.c_str());
    return ok;
}

/* boots the ROM handed over with uo_rom_*; the save (if any) is copied */
int uo_load(const u8* save, u32 savelen)
{
    if (!g_rom || g_romFill != g_romLen) return 0;
    uo_unload();
    NDSArgs args{};
    args.Firmware = MakeFirmware();
    if (g_jit) { JITArgs j{}; j.MaxBlockSize = 32; j.LiteralOptimizations = true; j.BranchOptimizations = true; j.FastMemory = g_fastmem; args.JIT = j; }
    else args.JIT = std::nullopt;
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
    // the cart takes the ROM buffer over instead of copying it
    std::unique_ptr<u8[]> romdata(g_rom);
    u32 romlen = g_romLen;
    g_rom = nullptr; g_romLen = g_romFill = 0;
    auto cart = NDSCart::ParseROM(std::move(romdata), romlen, nullptr, std::move(cargs));
    if (!cart) { uo_unload(); return 0; }
    nds->SetNDSCart(std::move(cart));
    nds->Reset();
    // FreeBIOS and a generated firmware can't run the DS menu, so the cart is always booted directly
    nds->SetupDirectBoot("game.nds");
    SetClockNow();
    nds->Start();
    g_saveDirty = 0;
    return 1;
}

void uo_reset()
{
    if (!nds) return;
    nds->Reset();
    nds->SetupDirectBoot("game.nds");
    SetClockNow();
    nds->Start();
}

int uo_is_threaded() { return g_threaded; }
void uo_set_threaded(int on) { g_threaded = on != 0; if (nds) ApplyRendererSettings(); }

u32 uo_frame(u32 keys, int draw2d, int render3d)
{
    if (!nds) return 0;
    nds->SetKeyMask(~keys & 0xFFF);
    SkipDraw2D = !draw2d; SkipRender3D = !render3d;
    u32 r = nds->RunFrame();
    SkipDraw2D = SkipRender3D = false;
    if (!nds->AREngine.Cheats.empty()) nds->AREngine.RunCheats();
    return r;
}
int uo_read_audio(s16* out, int frames) { return nds ? nds->SPU.ReadOutput(out, frames) : 0; }

void uo_touch(int x, int y, int down)
{
    if (!nds) return;
    if (down) nds->TouchScreen((u16)std::clamp(x, 0, 255), (u16)std::clamp(y, 0, 191));
    else nds->ReleaseScreen();
}
void uo_set_lid(int closed) { if (nds) nds->SetLidClosed(closed != 0); }
int uo_lid() { return nds && nds->IsLidClosed(); }
void uo_mic_blow(int on) { micBlow = on; if (!on) micBlowPos = 0; }
void uo_mic_live(int on) { micLive = on; micR = micW = 0; }
void uo_mic_push(const s16* data, int n)
{
    for (int i = 0; i < n; i++) { if (micW - micR >= 8191) micR++; micRing[micW++ & 8191] = data[i]; }
}
int uo_top_is_main() { return nds ? (nds->PowerControl9 >> 15) & 1 : 1; }

/* melonDS writes 0x00RRGGBB words; GL wants R,G,B,A bytes, so swap R and B and force alpha */
static inline void CopyLine(u32* dst, const u32* src)
{
#ifdef __aarch64__
    static const uint8_t idx[16] = {2,1,0,3, 6,5,4,7, 10,9,8,11, 14,13,12,15};
    const uint8x16_t shuf = vld1q_u8(idx);
    const uint32x4_t alpha = vdupq_n_u32(0xFF000000u);
    for (int i = 0; i < 256; i += 4)
    {
        uint8x16_t v = vld1q_u8((const uint8_t*)(src + i));
        v = vqtbl1q_u8(v, shuf);
        vst1q_u32(dst + i, vorrq_u32(vreinterpretq_u32_u8(v), alpha));
    }
#else
    for (int i = 0; i < 256; i++) { u32 c = src[i]; dst[i] = 0xFF000000 | (c & 0xFF00) | ((c >> 16) & 0xFF) | ((c & 0xFF) << 16); }
#endif
}

/* layout 0: stacked, 1: side by side, 2: one screen. swap exchanges top and bottom. */
u32 uo_compose(int layout, int swap, int gap)
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
    g_back.assign((size_t)w * h, 0xFF000000u);
    u32* out = g_back.data();
    if (layout == 1)
        for (int y = 0; y < 192; y++) { CopyLine(out + y * w, A + y * 256); CopyLine(out + y * w + 256 + gap, B + y * 256); }
    else if (layout == 2)
        for (int y = 0; y < 192; y++) CopyLine(out + y * 256, A + y * 256);
    else
    {
        for (int y = 0; y < 192; y++) CopyLine(out + y * 256, A + y * 256);
        for (int y = 0; y < 192; y++) CopyLine(out + (192 + gap + y) * 256, B + y * 256);
    }
    std::lock_guard<std::mutex> l(g_picLock);
    g_front.swap(g_back);
    g_frontWH = (u32)w << 16 | (u32)h;
    g_serial++;
    return g_frontWH;
}
u32 uo_copy_composed(u32* dst, u32 capPixels)
{
    std::lock_guard<std::mutex> l(g_picLock);
    u32 n = (g_frontWH >> 16) * (g_frontWH & 0xFFFF);
    if (!n || n > capPixels || g_front.size() < n) return 0;
    memcpy(dst, g_front.data(), (size_t)n * 4);
    return g_frontWH;
}
u32 uo_composed_serial() { return g_serial; }
u32 uo_avg_color()
{
    std::lock_guard<std::mutex> l(g_picLock);
    u32 n = (g_frontWH >> 16) * (g_frontWH & 0xFFFF);
    if (!n) return 0;
    u64 r = 0, g = 0, b = 0, k = 0;
    for (u32 i = 0; i < n; i += 31) { u32 c = g_front[i]; r += c & 0xFF; g += (c >> 8) & 0xFF; b += (c >> 16) & 0xFF; k++; }
    return (u32)(r / k) << 16 | (u32)(g / k) << 8 | (u32)(b / k);
}

u8* uo_save_ptr() { return nds ? nds->GetNDSSave() : nullptr; }
u32 uo_save_len() { return nds ? nds->GetNDSSaveLength() : 0; }
int uo_save_dirty() { int d = g_saveDirty; g_saveDirty = 0; return d; }
void uo_save_import(const u8* data, u32 len) { if (nds) nds->SetNDSSave(data, len); }

u32 uo_state_save()
{
    if (!nds) return 0;
    delete g_state; g_state = new Savestate(24 * 1024 * 1024);
    if (g_state->Error) return 0;
    if (!nds->DoSavestate(g_state) || g_state->Error) return 0;
    g_state->Finish();
    return g_state->Length();
}
const u8* uo_state_ptr() { return g_state ? (const u8*)g_state->Buffer() : nullptr; }
int uo_state_load(const u8* data, u32 len)
{
    if (!nds || len < 16) return 0;
    u32 real; memcpy(&real, data + 8, 4);
    if (real > len) return 0;
    Savestate st((void*)data, real, false);
    if (st.Error) return 0;
    if (!nds->DoSavestate(&st) || st.Error) return 0;
    return 1;
}

/* Rewind: XOR deltas between consecutive states, run-length coded, newest full state kept */
static std::vector<u8> rwCur, rwTmp;
static std::deque<std::vector<u32>> rwDeltas;
static size_t rwBytes = 0, rwBudget = 64u << 20;
static bool rwHas = false;
void uo_rewind_reset(u32 budgetMB) { rwDeltas.clear(); rwBytes = 0; rwHas = false; if (budgetMB) rwBudget = (size_t)budgetMB << 20; }
int uo_rewind_count() { return (int)rwDeltas.size(); }
u32 uo_rewind_bytes() { return (u32)rwBytes; }
int uo_rewind_capture()
{
    u32 len = uo_state_save(); if (!len) return 0;
    u32 n = (len + 3) & ~3u;
    if (!rwHas || rwCur.size() != n) { rwCur.assign(n, 0); memcpy(rwCur.data(), g_state->Buffer(), len); rwHas = true; rwDeltas.clear(); rwBytes = 0; return 1; }
    rwTmp.assign(n, 0); memcpy(rwTmp.data(), g_state->Buffer(), len);
    const u32* a = (const u32*)rwCur.data(); const u32* b = (const u32*)rwTmp.data();
    u32 W = n >> 2, i = 0;
    std::vector<u32> out; out.reserve(1024);
    while (i < W)
    {
        u32 z = i;
#ifdef __aarch64__
        while (z + 4 <= W && vminvq_u32(vceqq_u32(vld1q_u32(a + z), vld1q_u32(b + z))) == 0xFFFFFFFFu) z += 4;
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
int uo_rewind_step()
{
    if (rwDeltas.empty()) return 0;
    std::vector<u32> d = std::move(rwDeltas.back()); rwDeltas.pop_back(); rwBytes -= d.size() * 4;
    u32* cur = (u32*)rwCur.data(); size_t p = 0, i = 0;
    while (p < d.size()) { i += d[p++]; u32 L = d[p++]; for (u32 k = 0; k < L; k++) cur[i + k] ^= d[p++]; i += L; }
    return uo_state_load(rwCur.data(), (u32)rwCur.size());
}

void uo_cheats_clear() { if (nds) nds->AREngine.Cheats.clear(); }
void uo_cheat_add(const u32* words, int n)
{
    if (!nds) return;
    ARCode c{}; c.Parent = nullptr; c.Name = "c"; c.Enabled = true;
    c.Code.assign(words, words + n);
    nds->AREngine.Cheats.push_back(std::move(c));
}

u8* uo_mainram() { return nds ? nds->MainRAM : nullptr; }
u32 uo_mainram_mask() { return nds ? nds->MainRAMMask : 0; }
u32 uo_frame_count() { return nds ? nds->NumFrames : 0; }

} // extern "C"
