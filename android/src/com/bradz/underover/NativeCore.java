package com.bradz.underover;

/**
 * melonDS with the ARM64 JIT (native/uo_core.cpp, native/uo_jni.cpp). Bytes go in and out as
 * base64 because the page talks to it through the WebView bridge, which only carries strings.
 * Every call except copyComposed, composedSerial and avgColor must come from one thread (the
 * WebView's JavaBridge thread); those three are safe from the GL thread.
 */
final class NativeCore {
    static final boolean OK;
    static {
        boolean ok = false;
        try { System.loadLibrary("underover"); ok = "arm64-v8a".equals(abi()); }
        catch (Throwable t) { ok = false; }
        OK = ok;
    }
    private NativeCore() { }

    static native String abi();
    static native void setLogLevel(int lv);
    static native void setUser(String name, int lang, int color, int month, int day);
    static native void setAudio(double rate, int interp, int bits);
    static native void setJit(boolean on, boolean fastmem);
    static native boolean jitActive();

    static native boolean romBegin(int len);
    static native boolean romAppend(String b64);
    static native boolean romFromFile(String path);
    static native boolean romToFile(String path);
    static native boolean load(String saveB64);
    static native void unload();
    static native void reset();
    static native boolean loaded();
    static native boolean isThreaded();
    static native void setThreaded(boolean on);

    static native String frame(int keys, boolean draw, boolean next, boolean wantAudio);
    static native void touch(int x, int y, boolean down);
    static native void setLid(boolean closed);
    static native boolean lid();
    static native void micBlow(boolean on);
    static native void micLive(boolean on);
    static native void micPush(String b64);
    static native boolean topIsMain();

    static native int compose(int layout, boolean swap, int gap);
    static native String composedB64();
    static native int copyComposed(java.nio.ByteBuffer direct);
    static native int composedSerial();
    static native int avgColor();

    static native boolean saveDirty();
    static native String sram();
    static native void sramImport(String b64);
    static native String stateSave();
    static native boolean stateLoad(String b64);

    static native void rewindReset(int mb);
    static native int rewindCount();
    static native int rewindBytes();
    static native boolean rewindCapture();
    static native boolean rewindStep();

    static native void cheatsClear();
    static native void cheatAdd(String hexWords);

    static native String mainRam();
    static native int ramRead(int addr, int bits);
    static native void ramWrite(int addr, int bits, int val);
    static native int frameCount();
}
