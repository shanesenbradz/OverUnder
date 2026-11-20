package com.bradz.underover;

import android.content.Context;
import android.graphics.SurfaceTexture;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLSurface;
import android.opengl.GLES20;
import android.view.TextureView;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * The game picture for the native core. Sits under the (transparent) WebView, lined up with the
 * page's #screen element, and draws the composed DS screens with the same GLSL the page's WebGL
 * renderer uses, so every shader in the Look tab looks the same here. Drawing happens on its own
 * thread; the emulation thread only composes the picture and asks for a redraw.
 */
final class VideoView extends TextureView implements TextureView.SurfaceTextureListener {
    private static final String VS = "attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }";
    private static final String FALLBACK_FS = "precision mediump float; varying vec2 uv; uniform sampler2D uCur; void main(){ gl_FragColor = vec4(texture2D(uCur, uv).rgb, 1.0); }";

    private final Object lock = new Object();
    private SurfaceTexture surface;
    private int surfW, surfH;
    private boolean dirty, running = true, surfaceChanged;
    private Thread thread;

    // settings from the page (guarded by lock)
    private String fsSrc = FALLBACK_FS;
    private boolean linear = false, srcChanged = true;
    private float blend, cc, bright = 1, sat = 1, contrast = 1;

    VideoView(Context c) {
        super(c);
        setOpaque(true);
        setSurfaceTextureListener(this);
    }

    void setShader(String src, boolean lin) {
        synchronized (lock) { fsSrc = src == null || src.isEmpty() ? FALLBACK_FS : src; linear = lin; srcChanged = true; dirty = true; lock.notifyAll(); }
    }

    void setParams(float blend, float cc, float bright, float sat, float contrast) {
        synchronized (lock) { this.blend = blend; this.cc = cc; this.bright = bright; this.sat = sat; this.contrast = contrast; dirty = true; lock.notifyAll(); }
    }

    void requestRender() {
        synchronized (lock) { dirty = true; lock.notifyAll(); }
    }

    @Override public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
        synchronized (lock) { surface = st; surfW = w; surfH = h; surfaceChanged = true; dirty = true; lock.notifyAll(); }
        if (thread == null) { thread = new Thread(this::loop, "UnderoverGL"); thread.start(); }
    }
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) {
        synchronized (lock) { surfW = w; surfH = h; dirty = true; lock.notifyAll(); }
    }
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
        synchronized (lock) {
            surface = null; surfaceChanged = true; lock.notifyAll();
            // wait for the GL thread to let go of the surface before Android frees it
            long until = System.currentTimeMillis() + 500;
            while (eglSurfaceLive && System.currentTimeMillis() < until) { try { lock.wait(50); } catch (InterruptedException e) { break; } }
        }
        return true;
    }
    @Override public void onSurfaceTextureUpdated(SurfaceTexture st) { }

    void shutdown() {
        synchronized (lock) { running = false; lock.notifyAll(); }
    }

    /* ---------------- GL thread ---------------- */
    private volatile boolean eglSurfaceLive;
    private EGLDisplay dpy = EGL14.EGL_NO_DISPLAY;
    private EGLContext ctx = EGL14.EGL_NO_CONTEXT;
    private EGLSurface eglSurf = EGL14.EGL_NO_SURFACE;
    private EGLConfig cfg;
    private int prog, vs, locP, uCur, uPrev, uTex, uOut, uBlend, uCC, uBright, uSat, uCon;
    private final int[] tex = new int[2];
    private int texW, texH, lastSerial = -1, curFilter = -1;
    private ByteBuffer pix = ByteBuffer.allocateDirect(1024 * 576 * 4).order(ByteOrder.nativeOrder());
    private FloatBuffer quad;

    private void loop() {
        if (!initEgl()) return;
        while (true) {
            SurfaceTexture st; int w, h; String src = null; boolean lin; float b, c, br, sa, co;
            boolean recreate;
            synchronized (lock) {
                while (running && (!dirty || surface == null) && !surfaceChanged) {
                    try { lock.wait(); } catch (InterruptedException e) { return; }
                }
                if (!running) break;
                st = surface; w = surfW; h = surfH; recreate = surfaceChanged; surfaceChanged = false;
                if (srcChanged) { src = fsSrc; srcChanged = false; }
                lin = linear; b = blend; c = cc; br = bright; sa = sat; co = contrast;
                dirty = false;
            }
            if (recreate) {
                releaseSurface();
                if (st != null) {
                    eglSurf = EGL14.eglCreateWindowSurface(dpy, cfg, st, new int[] { EGL14.EGL_NONE }, 0);
                    if (eglSurf == null || eglSurf == EGL14.EGL_NO_SURFACE) { eglSurf = EGL14.EGL_NO_SURFACE; continue; }
                    eglSurfaceLive = true;
                    if (!EGL14.eglMakeCurrent(dpy, eglSurf, eglSurf, ctx)) { releaseSurface(); continue; }
                    if (prog == 0) setupGl();
                    // the page's shader survives a surface change, so make sure one is built
                    if (src == null && prog == 0) src = currentSrc();
                }
                synchronized (lock) { lock.notifyAll(); }
            }
            if (st == null || eglSurf == EGL14.EGL_NO_SURFACE) continue;
            if (src != null) buildProgram(src);
            if (prog == 0) buildProgram(currentSrc());
            draw(w, h, lin, b, c, br, sa, co);
            EGL14.eglSwapBuffers(dpy, eglSurf);
        }
        releaseSurface();
        if (ctx != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(dpy, ctx);
        EGL14.eglTerminate(dpy);
    }

    private String currentSrc() { synchronized (lock) { return fsSrc; } }

    private void releaseSurface() {
        if (eglSurf != EGL14.EGL_NO_SURFACE) {
            EGL14.eglMakeCurrent(dpy, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
            EGL14.eglDestroySurface(dpy, eglSurf);
            eglSurf = EGL14.EGL_NO_SURFACE;
            prog = 0; texW = texH = 0; lastSerial = -1; curFilter = -1; // the context stays, but rebuild on the next surface
        }
        eglSurfaceLive = false;
        synchronized (lock) { lock.notifyAll(); }
    }

    private boolean initEgl() {
        dpy = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        int[] v = new int[2];
        if (!EGL14.eglInitialize(dpy, v, 0, v, 1)) return false;
        int[] attr = { EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 0,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT, EGL14.EGL_NONE };
        EGLConfig[] cs = new EGLConfig[1]; int[] n = new int[1];
        if (!EGL14.eglChooseConfig(dpy, attr, 0, cs, 0, 1, n, 0) || n[0] == 0) return false;
        cfg = cs[0];
        ctx = EGL14.eglCreateContext(dpy, cfg, EGL14.EGL_NO_CONTEXT, new int[] { EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE }, 0);
        return ctx != null && ctx != EGL14.EGL_NO_CONTEXT;
    }

    private void setupGl() {
        // the context is shared across surfaces, but textures and programs are simply rebuilt
        quad = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        quad.put(new float[] { -1, -1, 1, -1, -1, 1, 1, 1 }).position(0);
        GLES20.glGenTextures(2, tex, 0);
        GLES20.glDisable(GLES20.GL_DEPTH_TEST); GLES20.glDisable(GLES20.GL_BLEND); GLES20.glDisable(GLES20.GL_DITHER);
        GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 4);
        vs = compile(GLES20.GL_VERTEX_SHADER, VS);
    }

    private static int compile(int type, String src) {
        int s = GLES20.glCreateShader(type);
        GLES20.glShaderSource(s, src);
        GLES20.glCompileShader(s);
        int[] ok = new int[1];
        GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) { GLES20.glDeleteShader(s); return 0; }
        return s;
    }

    private void buildProgram(String src) {
        if (vs == 0) setupGl();
        int fs = compile(GLES20.GL_FRAGMENT_SHADER, src);
        if (fs == 0) fs = compile(GLES20.GL_FRAGMENT_SHADER, FALLBACK_FS);
        int p = GLES20.glCreateProgram();
        GLES20.glAttachShader(p, vs); GLES20.glAttachShader(p, fs);
        GLES20.glLinkProgram(p);
        GLES20.glDeleteShader(fs);
        if (prog != 0) GLES20.glDeleteProgram(prog);
        prog = p;
        GLES20.glUseProgram(p);
        locP = GLES20.glGetAttribLocation(p, "p");
        uCur = GLES20.glGetUniformLocation(p, "uCur"); uPrev = GLES20.glGetUniformLocation(p, "uPrev");
        uTex = GLES20.glGetUniformLocation(p, "uTex"); uOut = GLES20.glGetUniformLocation(p, "uOut");
        uBlend = GLES20.glGetUniformLocation(p, "uBlend"); uCC = GLES20.glGetUniformLocation(p, "uCC");
        uBright = GLES20.glGetUniformLocation(p, "uBright"); uSat = GLES20.glGetUniformLocation(p, "uSat"); uCon = GLES20.glGetUniformLocation(p, "uContrast");
        GLES20.glEnableVertexAttribArray(locP);
        GLES20.glVertexAttribPointer(locP, 2, GLES20.GL_FLOAT, false, 0, quad);
        GLES20.glUniform1i(uCur, 0); GLES20.glUniform1i(uPrev, 1);
    }

    private void draw(int w, int h, boolean lin, float blendOn, float ccOn, float br, float sa, float co) {
        int serial = NativeCore.composedSerial();
        if (serial != lastSerial) {
            pix.clear();
            int wh = NativeCore.copyComposed(pix);
            if (wh != 0) {
                lastSerial = serial;
                int fw = wh >>> 16, fh = wh & 0xFFFF;
                // the previous picture is only kept (in tex[1]) when frame blending needs it
                if (blendOn > 0.5f) { int t = tex[0]; tex[0] = tex[1]; tex[1] = t; }
                pix.position(0);
                if (fw != texW || fh != texH) {
                    for (int t : tex) {
                        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t);
                        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, fw, fh, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pix);
                    }
                    texW = fw; texH = fh; curFilter = -1;
                } else {
                    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex[0]);
                    GLES20.glTexSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, fw, fh, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pix);
                }
            }
        }
        if (texW == 0) { GLES20.glClearColor(0, 0, 0, 1); GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT); return; }
        int filt = lin ? GLES20.GL_LINEAR : GLES20.GL_NEAREST;
        if (filt != curFilter) {
            for (int t : tex) {
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t);
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, filt);
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, filt);
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
            }
            curFilter = filt;
        }
        GLES20.glViewport(0, 0, w, h);
        GLES20.glUseProgram(prog);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE1); GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex[1]);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0); GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex[0]);
        GLES20.glUniform2f(uTex, texW, texH); GLES20.glUniform2f(uOut, w, h);
        GLES20.glUniform1f(uBlend, blendOn); GLES20.glUniform1f(uCC, ccOn);
        GLES20.glUniform1f(uBright, br); GLES20.glUniform1f(uSat, sa); GLES20.glUniform1f(uCon, co);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    }
}
