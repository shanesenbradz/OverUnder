/*
    JNI glue for com.bradz.underover.NativeCore. Bytes cross to and from the page
    as base64 strings (the WebView bridge only carries strings); the encoding is
    done here in C++ because it runs every frame for the sound.

    Released under the GNU GPL v3 or later, like melonDS.
*/
#include <jni.h>
#include <string>
#include <vector>
#include <cstring>
#include <cstdlib>
#include "uo_core.h"
#include <zlib.h>

/* Save states are about 6 MB, mostly RAM: gzipped here (to around 100 KB) before they cross the
   bridge, so an auto snapshot doesn't stall a frame pushing 8 MB of base64 to the page. */
static std::vector<uint8_t> gz(const uint8_t* p, size_t n)
{
    std::vector<uint8_t> out;
    z_stream z{}; if (deflateInit2(&z, 1, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY) != Z_OK) return out;
    out.resize(deflateBound(&z, n) + 32);
    z.next_in = (Bytef*)p; z.avail_in = (uInt)n; z.next_out = out.data(); z.avail_out = (uInt)out.size();
    int r = deflate(&z, Z_FINISH);
    out.resize(r == Z_STREAM_END ? z.total_out : 0);
    deflateEnd(&z);
    return out;
}
static std::vector<uint8_t> gunzip(const std::vector<uint8_t>& in)
{
    std::vector<uint8_t> out;
    z_stream z{}; if (inflateInit2(&z, 15 + 32) != Z_OK) return out;
    out.resize(8u << 20);
    z.next_in = (Bytef*)in.data(); z.avail_in = (uInt)in.size();
    int r;
    for (;;)
    {
        z.next_out = out.data() + z.total_out; z.avail_out = (uInt)(out.size() - z.total_out);
        r = inflate(&z, Z_NO_FLUSH);
        if (r == Z_STREAM_END) break;
        if (r != Z_OK && r != Z_BUF_ERROR) { out.clear(); inflateEnd(&z); return out; }
        if (z.avail_out == 0) out.resize(out.size() * 2);
        else if (z.avail_in == 0) { out.clear(); inflateEnd(&z); return out; }
    }
    out.resize(z.total_out);
    inflateEnd(&z);
    return out;
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string b64enc(const uint8_t* p, size_t n)
{
    std::string o; o.resize((n + 2) / 3 * 4);
    char* d = &o[0]; size_t i = 0;
    for (; i + 3 <= n; i += 3)
    {
        uint32_t v = p[i] << 16 | p[i + 1] << 8 | p[i + 2];
        *d++ = B64[v >> 18]; *d++ = B64[(v >> 12) & 63]; *d++ = B64[(v >> 6) & 63]; *d++ = B64[v & 63];
    }
    if (i < n)
    {
        uint32_t v = p[i] << 16 | (i + 1 < n ? p[i + 1] << 8 : 0);
        *d++ = B64[v >> 18]; *d++ = B64[(v >> 12) & 63];
        *d++ = i + 1 < n ? B64[(v >> 6) & 63] : '='; *d++ = '=';
    }
    return o;
}

static uint8_t DEC[256];
static bool decInit = [] { memset(DEC, 255, sizeof DEC); for (int i = 0; i < 64; i++) DEC[(uint8_t)B64[i]] = i; DEC['-'] = 62; DEC['_'] = 63; return true; }();

static size_t b64dec(const char* s, size_t n, uint8_t* out)
{
    uint32_t acc = 0; int bits = 0; size_t o = 0;
    for (size_t i = 0; i < n; i++)
    {
        uint8_t c = DEC[(uint8_t)s[i]];
        if (c == 255) continue; // padding, whitespace
        acc = acc << 6 | c; bits += 6;
        if (bits >= 8) { bits -= 8; out[o++] = (uint8_t)(acc >> bits); }
    }
    return o;
}

/* a Java string of base64 as bytes */
static std::vector<uint8_t> fromJ(JNIEnv* env, jstring js)
{
    std::vector<uint8_t> v;
    if (!js) return v;
    jsize n = env->GetStringUTFLength(js);
    const char* s = env->GetStringUTFChars(js, nullptr);
    v.resize(n / 4 * 3 + 3);
    v.resize(b64dec(s, n, v.data()));
    env->ReleaseStringUTFChars(js, s);
    return v;
}
static jstring toJ(JNIEnv* env, const uint8_t* p, size_t n)
{
    if (!p || !n) return env->NewStringUTF("");
    std::string s = b64enc(p, n);
    return env->NewStringUTF(s.c_str());
}

#define FN(ret, name, ...) extern "C" JNIEXPORT ret JNICALL Java_com_bradz_underover_NativeCore_##name(JNIEnv* env, jclass, ##__VA_ARGS__)

FN(jstring, abi) { return env->NewStringUTF(
#ifdef __aarch64__
    "arm64-v8a"
#else
    "other"
#endif
); }
FN(void, setLogLevel, jint lv) { uo_set_log_level(lv); }
FN(void, setUser, jstring name, jint lang, jint color, jint month, jint day)
{
    const char* s = env->GetStringUTFChars(name, nullptr);
    uo_set_user(s, lang, color, month, day);
    env->ReleaseStringUTFChars(name, s);
}
FN(void, setAudio, jdouble rate, jint interp, jint bits) { uo_set_audio(rate, interp, bits); }
FN(void, setJit, jboolean on, jboolean fastmem) { uo_set_jit(on, fastmem); }
FN(jboolean, jitActive) { return uo_jit_active() != 0; }

FN(jboolean, romBegin, jint len) { return uo_rom_begin((uint32_t)len) != 0; }
FN(jboolean, romAppend, jstring b64) { auto v = fromJ(env, b64); return uo_rom_append(v.data(), (uint32_t)v.size()) != 0; }
FN(jboolean, romFromFile, jstring path)
{
    const char* s = env->GetStringUTFChars(path, nullptr); int ok = uo_rom_from_file(s); env->ReleaseStringUTFChars(path, s); return ok != 0;
}
FN(jboolean, romToFile, jstring path)
{
    const char* s = env->GetStringUTFChars(path, nullptr); int ok = uo_rom_to_file(s); env->ReleaseStringUTFChars(path, s); return ok != 0;
}
FN(jboolean, load, jstring saveB64)
{
    auto v = fromJ(env, saveB64);
    return uo_load(v.empty() ? nullptr : v.data(), (uint32_t)v.size()) != 0;
}
FN(void, unload) { uo_unload(); }
FN(void, reset) { uo_reset(); }
FN(jboolean, loaded) { return uo_loaded() != 0; }
FN(jboolean, isThreaded) { return uo_is_threaded() != 0; }
FN(void, setThreaded, jboolean on) { uo_set_threaded(on); }

/* runs one frame and hands back its sound (interleaved stereo s16) as base64 */
static int16_t g_audio[8192 * 2];
FN(jstring, frame, jint keys, jboolean draw, jboolean next, jboolean wantAudio)
{
    uo_frame((uint32_t)keys, draw, next);
    int total = 0;
    for (;;)
    {
        int room = 8192 - total; if (room <= 0) break;
        int n = uo_read_audio(g_audio + total * 2, room > 4096 ? 4096 : room);
        if (n <= 0) break;
        total += n;
        if (n < 4096) break;
    }
    if (!wantAudio || !total) return env->NewStringUTF("");
    return toJ(env, (const uint8_t*)g_audio, (size_t)total * 4);
}
FN(void, touch, jint x, jint y, jboolean down) { uo_touch(x, y, down); }
FN(void, setLid, jboolean closed) { uo_set_lid(closed); }
FN(jboolean, lid) { return uo_lid() != 0; }
FN(void, micBlow, jboolean on) { uo_mic_blow(on); }
FN(void, micLive, jboolean on) { uo_mic_live(on); }
FN(void, micPush, jstring b64) { auto v = fromJ(env, b64); uo_mic_push((const int16_t*)v.data(), (int)(v.size() / 2)); }
FN(jboolean, topIsMain) { return uo_top_is_main() != 0; }

FN(jint, compose, jint layout, jboolean swap, jint gap) { return (jint)uo_compose(layout, swap, gap); }
FN(jstring, composedB64)
{
    static std::vector<uint32_t> buf(1024 * 576);
    uint32_t wh = uo_copy_composed(buf.data(), (uint32_t)buf.size());
    if (!wh) return env->NewStringUTF("");
    return toJ(env, (const uint8_t*)buf.data(), (size_t)(wh >> 16) * (wh & 0xFFFF) * 4);
}
/* for the GL thread: fills a direct ByteBuffer with the last picture */
FN(jint, copyComposed, jobject direct)
{
    void* p = env->GetDirectBufferAddress(direct);
    jlong cap = env->GetDirectBufferCapacity(direct);
    if (!p || cap < 4) return 0;
    return (jint)uo_copy_composed((uint32_t*)p, (uint32_t)(cap / 4));
}
FN(jint, composedSerial) { return (jint)uo_composed_serial(); }
FN(jint, avgColor) { return (jint)uo_avg_color(); }

FN(jboolean, saveDirty) { return uo_save_dirty() != 0; }
FN(jstring, sram) { return toJ(env, uo_save_ptr(), uo_save_len()); }
FN(void, sramImport, jstring b64) { auto v = fromJ(env, b64); if (!v.empty()) uo_save_import(v.data(), (uint32_t)v.size()); }

FN(jstring, stateSave)
{
    uint32_t n = uo_state_save(); if (!n) return env->NewStringUTF("");
    auto z = gz(uo_state_ptr(), n);
    return z.empty() ? toJ(env, uo_state_ptr(), n) : toJ(env, z.data(), z.size());
}
/* a state, gzipped or not */
FN(jboolean, stateLoad, jstring b64)
{
    auto v = fromJ(env, b64);
    if (v.size() > 2 && v[0] == 0x1F && v[1] == 0x8B) v = gunzip(v);
    return v.size() >= 16 && uo_state_load(v.data(), (uint32_t)v.size()) != 0;
}

FN(void, rewindReset, jint mb) { uo_rewind_reset((uint32_t)mb); }
FN(jint, rewindCount) { return uo_rewind_count(); }
FN(jint, rewindBytes) { return (jint)uo_rewind_bytes(); }
FN(jboolean, rewindCapture) { return uo_rewind_capture() != 0; }
FN(jboolean, rewindStep) { return uo_rewind_step() != 0; }

FN(void, cheatsClear) { uo_cheats_clear(); }
/* one code: its 32-bit words as hex, separated by commas */
FN(void, cheatAdd, jstring hex)
{
    const char* s = env->GetStringUTFChars(hex, nullptr);
    std::vector<uint32_t> w;
    for (const char* p = s; *p;)
    {
        char* e; unsigned long v = strtoul(p, &e, 16);
        if (e == p) break;
        w.push_back((uint32_t)v);
        p = *e == ',' ? e + 1 : e;
    }
    env->ReleaseStringUTFChars(hex, s);
    if (!w.empty()) uo_cheat_add(w.data(), (int)w.size());
}

/* main RAM for the RAM search: 4 MB at 0x02000000 */
FN(jstring, mainRam) { uint8_t* p = uo_mainram(); return p ? toJ(env, p, 0x400000) : env->NewStringUTF(""); }
FN(jint, ramRead, jint addr, jint bits)
{
    uint8_t* p = uo_mainram(); if (!p || ((uint32_t)addr >> 24) != 2) return 0;
    uint32_t a = (uint32_t)addr & 0x3FFFFF;
    if (bits == 8) return p[a];
    if (bits == 16) return p[a] | p[(a + 1) & 0x3FFFFF] << 8;
    return (jint)(p[a] | p[(a + 1) & 0x3FFFFF] << 8 | p[(a + 2) & 0x3FFFFF] << 16 | (uint32_t)p[(a + 3) & 0x3FFFFF] << 24);
}
FN(void, ramWrite, jint addr, jint bits, jint val)
{
    uint8_t* p = uo_mainram(); if (!p || ((uint32_t)addr >> 24) != 2) return;
    uint32_t a = (uint32_t)addr & 0x3FFFFF, v = (uint32_t)val;
    p[a] = v;
    if (bits >= 16) p[(a + 1) & 0x3FFFFF] = v >> 8;
    if (bits >= 32) { p[(a + 2) & 0x3FFFFF] = v >> 16; p[(a + 3) & 0x3FFFFF] = v >> 24; }
}
FN(jint, frameCount) { return (jint)uo_frame_count(); }
