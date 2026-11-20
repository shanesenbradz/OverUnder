package com.bradz.underover;

import android.app.Activity;
import android.os.Process;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.widget.FrameLayout;

import java.io.File;
import java.util.Arrays;

/**
 * Exposed to the page as window.UnderoverNative when the native core loaded. The page's
 * NativeCore class (web/js/2b_native.js) calls these from its emulation loop, so they all run on
 * the WebView's JavaBridge thread, one at a time, which is the thread melonDS lives on.
 */
final class CoreBridge {
    private final Activity a;
    private final VideoView video;
    private final File romDir;
    private boolean boosted;

    CoreBridge(Activity a, VideoView video) {
        this.a = a; this.video = video;
        romDir = new File(a.getFilesDir(), "roms");
    }

    @JavascriptInterface public String info() {
        return "{\"abi\":\"" + NativeCore.abi() + "\",\"jit\":true}";
    }

    @JavascriptInterface public void setUser(String name, int lang, int color, int month, int day) { NativeCore.setUser(name == null ? "Brad" : name, lang, color, month, day); }
    @JavascriptInterface public void setAudio(double rate, int interp, int bits) { NativeCore.setAudio(rate, interp, bits); }
    @JavascriptInterface public void setJit(boolean on, boolean fastmem) { NativeCore.setJit(on, fastmem); }
    @JavascriptInterface public boolean jitActive() { return NativeCore.jitActive(); }

    /* ---- the ROM: kept in the app's own storage after the first boot, so later boots skip the copy ---- */
    private File romFile(String id) { return new File(romDir, id.replaceAll("[^A-Za-z0-9_-]", "_") + ".nds"); }

    @JavascriptInterface public boolean romCached(String id, int len) {
        File f = romFile(id);
        if (!f.isFile() || f.length() != len) return false;
        if (!NativeCore.romFromFile(f.getAbsolutePath())) return false;
        f.setLastModified(System.currentTimeMillis());
        return true;
    }
    @JavascriptInterface public boolean romBegin(int len) { return NativeCore.romBegin(len); }
    @JavascriptInterface public boolean romAppend(String b64) { return NativeCore.romAppend(b64); }
    /** keeps the ROM just handed over; the three most recently played stay */
    @JavascriptInterface public void romStore(String id) {
        try {
            if (!romDir.isDirectory() && !romDir.mkdirs()) return;
            NativeCore.romToFile(romFile(id).getAbsolutePath());
            File[] all = romDir.listFiles((d, n) -> n.endsWith(".nds"));
            if (all != null && all.length > 3) {
                Arrays.sort(all, (x, y) -> Long.compare(y.lastModified(), x.lastModified()));
                for (int i = 3; i < all.length; i++) all[i].delete();
            }
        } catch (Exception ignored) { }
    }
    @JavascriptInterface public void romForget(String id) { try { romFile(id).delete(); } catch (Exception ignored) { } }

    @JavascriptInterface public boolean load(String saveB64) {
        if (!boosted) {
            // the emulation runs on this thread: give it display priority so the scheduler keeps it on a fast core
            try { Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_DISPLAY); } catch (Exception ignored) { }
            boosted = true;
        }
        return NativeCore.load(saveB64 == null ? "" : saveB64);
    }
    @JavascriptInterface public void unload() { NativeCore.unload(); }
    @JavascriptInterface public void reset() { NativeCore.reset(); }
    @JavascriptInterface public boolean isThreaded() { return NativeCore.isThreaded(); }
    @JavascriptInterface public void setThreaded(boolean on) { NativeCore.setThreaded(on); }

    @JavascriptInterface public String frame(int keys, boolean draw, boolean next, boolean wantAudio) { return NativeCore.frame(keys, draw, next, wantAudio); }
    @JavascriptInterface public void touch(int x, int y, boolean down) { NativeCore.touch(x, y, down); }
    @JavascriptInterface public void setLid(boolean closed) { NativeCore.setLid(closed); }
    @JavascriptInterface public boolean lid() { return NativeCore.lid(); }
    @JavascriptInterface public void micBlow(boolean on) { NativeCore.micBlow(on); }
    @JavascriptInterface public void micLive(boolean on) { NativeCore.micLive(on); }
    @JavascriptInterface public void micPush(String b64) { NativeCore.micPush(b64); }
    @JavascriptInterface public boolean topIsMain() { return NativeCore.topIsMain(); }

    /* ---- picture ---- */
    /** lays the screens out and hands the picture to the video view. Returns w<<16|h */
    @JavascriptInterface public int present(int layout, boolean swap, int gap) {
        int wh = NativeCore.compose(layout, swap, gap);
        if (wh != 0) video.requestRender();
        return wh;
    }
    @JavascriptInterface public String picture() { return NativeCore.composedB64(); }
    @JavascriptInterface public int avgColor() { return NativeCore.avgColor(); }
    @JavascriptInterface public void setShader(String fragmentSrc, boolean linear) { video.setShader(fragmentSrc, linear); }
    @JavascriptInterface public void setParams(float blend, float cc, float bright, float sat, float contrast) { video.setParams(blend, cc, bright, sat, contrast); }
    /** where the page's screen element is, in device pixels. hidden = false shows the picture there */
    @JavascriptInterface public void setRect(int x, int y, int w, int h, boolean visible) {
        a.runOnUiThread(() -> {
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) video.getLayoutParams();
            int ww = Math.max(1, w), hh = Math.max(1, h);
            if (lp.width != ww || lp.height != hh || lp.leftMargin != x || lp.topMargin != y) {
                lp.width = ww; lp.height = hh; lp.leftMargin = x; lp.topMargin = y;
                video.setLayoutParams(lp);
            }
            video.setVisibility(visible ? View.VISIBLE : View.INVISIBLE);
            video.requestRender();
        });
    }

    /* ---- saves and states ---- */
    @JavascriptInterface public boolean saveDirty() { return NativeCore.saveDirty(); }
    @JavascriptInterface public String sram() { return NativeCore.sram(); }
    @JavascriptInterface public void sramImport(String b64) { NativeCore.sramImport(b64); }
    @JavascriptInterface public String stateSave() { return NativeCore.stateSave(); }
    @JavascriptInterface public boolean stateLoad(String b64) { return NativeCore.stateLoad(b64); }

    @JavascriptInterface public void rewindReset(int mb) { NativeCore.rewindReset(mb); }
    @JavascriptInterface public int rewindCount() { return NativeCore.rewindCount(); }
    @JavascriptInterface public int rewindBytes() { return NativeCore.rewindBytes(); }
    @JavascriptInterface public boolean rewindCapture() { return NativeCore.rewindCapture(); }
    @JavascriptInterface public boolean rewindStep() { return NativeCore.rewindStep(); }

    @JavascriptInterface public void cheatsClear() { NativeCore.cheatsClear(); }
    @JavascriptInterface public void cheatAdd(String hexWords) { NativeCore.cheatAdd(hexWords); }

    @JavascriptInterface public String mainRam() { return NativeCore.mainRam(); }
    @JavascriptInterface public int ramRead(int addr, int bits) { return NativeCore.ramRead(addr, bits); }
    @JavascriptInterface public void ramWrite(int addr, int bits, int val) { NativeCore.ramWrite(addr, bits, val); }
}
