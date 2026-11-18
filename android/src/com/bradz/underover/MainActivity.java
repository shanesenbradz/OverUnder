package com.bradz.underover;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.hardware.input.InputManager;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Brad's Underover shell: a full-screen WebView that serves the bundled page from
 * https://appassets.androidplatform.net/ (a secure origin, so IndexedDB, AudioWorklet
 * and crypto all behave like in Chrome), plus a file picker and a save-to-Downloads bridge.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final int PICK = 41;
    private static final int REQ_MIC = 43;
    private PermissionRequest micRequest;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private int padKeys, padAxes, padSent = -1;
    private Updater updater;
    private float padX, padY, padSentX = 9, padSentY = 9;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(17, 17, 19));
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        immersive();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // Keep the page's renderer process at foreground priority so Android doesn't slow it down
        // or reclaim it while a game runs, and skip Safe Browsing (the page is bundled, offline).
        if (Build.VERSION.SDK_INT >= 26) {
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
            s.setSafeBrowsingEnabled(false);
        }
        // Lite: ask for a 60 Hz display mode. GBA games run at 60 fps, and on 90/120 Hz screens
        // the phone would otherwise composite twice as many frames for nothing.
        if (getPackageName().endsWith(".lite")) prefer60Hz();

        web.addJavascriptInterface(new Bridge(this), "CalzoneAndroid");
        updater = new Updater(this);
        web.addJavascriptInterface(updater, "BullpupUpdate");

        InputManager im = (InputManager) getSystemService(Context.INPUT_SERVICE);
        if (im != null) im.registerInputDeviceListener(new InputManager.InputDeviceListener() {
            @Override public void onInputDeviceAdded(int id) { padEvent(id, true); }
            @Override public void onInputDeviceRemoved(int id) { padKeys = padAxes = 0; padX = padY = 0; sendPad(); js("window.bullpupPadEvent&&bullpupPadEvent(false,'')"); }
            @Override public void onInputDeviceChanged(int id) { }
        }, null);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                try {
                    InputStream in = getAssets().open(path.substring(1));
                    WebResourceResponse r = new WebResourceResponse(mime(path), "utf-8", in);
                    Map<String, String> h = new HashMap<>();
                    h.put("Cache-Control", "no-cache");
                    h.put("Access-Control-Allow-Origin", "*");
                    // cross-origin isolation: lets the page use SharedArrayBuffer, so the DS core can
                    // render 3D on a second CPU core (the page falls back to one core without it)
                    h.put("Cross-Origin-Opener-Policy", "same-origin");
                    h.put("Cross-Origin-Embedder-Policy", "require-corp");
                    r.setResponseHeaders(h);
                    return r;
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // the DS microphone: the page asks through getUserMedia, Android asks the user once
            @Override
            public void onPermissionRequest(PermissionRequest req) {
                boolean audio = false;
                for (String r : req.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                if (!audio) { req.deny(); return; }
                if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    req.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                } else {
                    micRequest = req;
                    requestPermissions(new String[] { android.Manifest.permission.RECORD_AUDIO }, REQ_MIC);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(i, "Choose a file"), PICK);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Android 13+ predictive back. From targetSdk 36 onBackPressed() is no longer called, so the
        // back gesture is routed through an OnBackInvokedCallback that asks the page first.
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        if (saved != null) web.restoreState(saved);
        else web.loadUrl("https://" + HOST + "/index.html");
    }

    private static String mime(String p) {
        p = p.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    @SuppressWarnings("deprecation")
    private void prefer60Hz() {
        if (Build.VERSION.SDK_INT < 23) return;
        try {
            android.view.Display d = getWindowManager().getDefaultDisplay();
            android.view.Display.Mode cur = d.getMode(), best = null;
            for (android.view.Display.Mode m : d.getSupportedModes()) {
                if (m.getPhysicalWidth() != cur.getPhysicalWidth() || m.getPhysicalHeight() != cur.getPhysicalHeight()) continue;
                if (m.getRefreshRate() < 59f) continue;
                if (best == null || m.getRefreshRate() < best.getRefreshRate()) best = m;
            }
            if (best != null && best.getModeId() != cur.getModeId()) {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.preferredDisplayModeId = best.getModeId();
                getWindow().setAttributes(lp);
            }
        } catch (Exception ignored) { }
    }

    private void immersive() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        immersive();
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != PICK || fileCallback == null) return;
        Uri[] out = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                out = new Uri[n];
                for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                out = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(out);
        fileCallback = null;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    /** Lets the page close an open sheet or leave a game first; if it doesn't handle back, the app goes to the background. */
    private void handleBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(window.bullpupBack && window.bullpupBack()) ? 1 : 0", r -> {
            if (!"1".equals(r)) moveTaskToBack(true);
        });
    }

    /* ---------- Bluetooth and USB controllers ----------
     * Android pairs the controller; we read it here and hand the page one combined state in the
     * standard Gamepad API button order, so the page's remapping works the same for every pad.
     * Events are consumed so a pad's B button never doubles as the system back key. */
    private static boolean isPad(InputDevice d) {
        if (d == null || d.isVirtual()) return false;
        int s = d.getSources();
        return (s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    private static int padIndex(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0;
            case KeyEvent.KEYCODE_BUTTON_B: return 1;
            case KeyEvent.KEYCODE_BUTTON_X: return 2;
            case KeyEvent.KEYCODE_BUTTON_Y: return 3;
            case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_R1: return 5;
            case KeyEvent.KEYCODE_BUTTON_L2: return 6;
            case KeyEvent.KEYCODE_BUTTON_R2: return 7;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return 8;
            case KeyEvent.KEYCODE_BUTTON_START: return 9;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            case KeyEvent.KEYCODE_DPAD_UP: return 12;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 13;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 14;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 15;
            case KeyEvent.KEYCODE_BUTTON_MODE: return 16;
            case KeyEvent.KEYCODE_BUTTON_C: return 2;
            case KeyEvent.KEYCODE_BUTTON_Z: return 3;
            default: return -1;
        }
    }

    private void js(String code) { if (web != null) web.evaluateJavascript(code, null); }

    private static String jsStr(String s) {
        StringBuilder b = new StringBuilder("'");
        for (char c : s.toCharArray()) {
            if (c == '\\' || c == '\'') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') { }
            else if (c < 32 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('\'').toString();
    }

    /* ---------- in-place updates (Updater) ---------- */
    void updateEvent(String type, String data) {
        String code = "window.bullpupUpdate&&bullpupUpdate(" + jsStr(type) + "," + jsStr(data) + ")";
        runOnUiThread(() -> js(code));
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == REQ_MIC && micRequest != null) {
            if (results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) micRequest.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            else micRequest.deny();
            micRequest = null;
        }
    }

    private void sendPad() {
        int padButtons = padKeys | padAxes;
        if (padButtons == padSent && Math.abs(padX - padSentX) < 0.05f && Math.abs(padY - padSentY) < 0.05f) return;
        padSent = padButtons; padSentX = padX; padSentY = padY;
        js("window.bullpupPad&&bullpupPad(" + padButtons + "," + padX + "," + padY + ")");
    }

    private void padEvent(int id, boolean added) {
        InputDevice d = InputDevice.getDevice(id);
        if (!isPad(d)) return;
        String name = d.getName() == null ? "Controller" : d.getName().replace("\\", "").replace("'", "");
        js("window.bullpupPadEvent&&bullpupPadEvent(" + added + ",'" + name + "')");
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int idx = padIndex(e.getKeyCode());
        if (idx >= 0 && isPad(e.getDevice())) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) padKeys |= 1 << idx;
            else if (e.getAction() == KeyEvent.ACTION_UP) padKeys &= ~(1 << idx);
            sendPad();
            return true;
        }
        // Let keyboard keys reach the page even when focus wandered off the WebView.
        if (web != null && !web.hasFocus() && e.getKeyCode() != KeyEvent.KEYCODE_BACK) web.requestFocus();
        return super.dispatchKeyEvent(e);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        if ((e.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK && e.getAction() == MotionEvent.ACTION_MOVE) {
            float hx = e.getAxisValue(MotionEvent.AXIS_HAT_X), hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
            float lt = Math.max(e.getAxisValue(MotionEvent.AXIS_LTRIGGER), e.getAxisValue(MotionEvent.AXIS_BRAKE));
            float rt = Math.max(e.getAxisValue(MotionEvent.AXIS_RTRIGGER), e.getAxisValue(MotionEvent.AXIS_GAS));
            // the hat is the D-pad on most Bluetooth pads, the triggers are often axes too
            int hat = (hy < -0.5f ? 1 << 12 : 0) | (hy > 0.5f ? 1 << 13 : 0) | (hx < -0.5f ? 1 << 14 : 0) | (hx > 0.5f ? 1 << 15 : 0);
            int trig = (lt > 0.5f ? 1 << 6 : 0) | (rt > 0.5f ? 1 << 7 : 0);
            padAxes = hat | trig;
            padX = e.getAxisValue(MotionEvent.AXIS_X); padY = e.getAxisValue(MotionEvent.AXIS_Y);
            sendPad();
            return true;
        }
        return super.dispatchGenericMotionEvent(e);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        immersive();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (updater != null) updater.close();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    /** Exposed to the page as window.CalzoneAndroid */
    public static class Bridge {
        private final Activity a;
        public Bridge(Activity a) { this.a = a; }

        @JavascriptInterface
        public String save(String name, String mimeType, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                if (mimeType == null || mimeType.isEmpty()) mimeType = "application/octet-stream";
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Underover");
                    Uri uri = a.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "";
                    OutputStream os = a.getContentResolver().openOutputStream(uri);
                    os.write(bytes);
                    os.close();
                    return "Downloads/Underover/" + safe;
                } else {
                    File dir = a.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) dir = a.getFilesDir();
                    dir.mkdirs();
                    File f = new File(dir, safe);
                    FileOutputStream fo = new FileOutputStream(f);
                    fo.write(bytes);
                    fo.close();
                    return f.getAbsolutePath();
                }
            } catch (Exception e) {
                return "";
            }
        }

        private android.os.Vibrator vib;
        private Boolean predefinedOk;

        @SuppressWarnings("deprecation")
        private android.os.Vibrator vibrator() {
            if (vib != null) return vib;
            if (Build.VERSION.SDK_INT >= 31) {
                android.os.VibratorManager m = (android.os.VibratorManager) a.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (m != null) vib = m.getDefaultVibrator();
            }
            if (vib == null) vib = (android.os.Vibrator) a.getSystemService(Context.VIBRATOR_SERVICE);
            return vib;
        }

        /** Opens Android's Bluetooth screen so a controller can be paired without leaving for Settings by hand. */
        @JavascriptInterface
        public void openBluetooth() {
            a.runOnUiThread(() -> {
                try { a.startActivity(new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)); }
                catch (Exception e) { try { a.startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS)); } catch (Exception ignored) { } }
            });
        }

        /** Names of connected controllers, separated by newlines. */
        @JavascriptInterface
        public String padNames() {
            StringBuilder b = new StringBuilder();
            for (int id : InputDevice.getDeviceIds()) {
                InputDevice d = InputDevice.getDevice(id);
                if (isPad(d)) { if (b.length() > 0) b.append('\n'); b.append(d.getName()); }
            }
            return b.toString();
        }

        /** Legacy entry point kept for pages built before 1.5. */
        @JavascriptInterface
        public void vibrate(int ms) {
            haptic(ms >= 30 ? "strong" : ms >= 18 ? "medium" : "light");
        }

        /**
         * Button-press haptics. The old version called Vibrator.vibrate(6ms), which is below what many
         * motors can play, was filtered on Android 13+ when "touch vibration" was off, and was never
         * called by the page anyway. This tries, in order: a tuned predefined click (API 29+), a
         * one-shot with explicit amplitude (API 26+), then a plain pulse, all tagged as game haptics so
         * they follow the media vibration setting instead of the touch one.
         */
        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void haptic(String level) {
            try {
                android.os.Vibrator v = vibrator();
                if (v == null || !v.hasVibrator()) { viewHaptic(); return; }
                int ms = "strong".equals(level) ? 38 : "medium".equals(level) ? 22 : 14;
                int amp = "strong".equals(level) ? 255 : "medium".equals(level) ? 190 : 120;
                android.media.AudioAttributes aa = new android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_GAME)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
                if (Build.VERSION.SDK_INT >= 29) {
                    int id = "strong".equals(level) ? android.os.VibrationEffect.EFFECT_HEAVY_CLICK
                            : "medium".equals(level) ? android.os.VibrationEffect.EFFECT_CLICK : android.os.VibrationEffect.EFFECT_TICK;
                    if (predefinedOk == null) {
                        predefinedOk = Build.VERSION.SDK_INT < 30
                                || v.areAllEffectsSupported(android.os.VibrationEffect.EFFECT_TICK, android.os.VibrationEffect.EFFECT_CLICK,
                                android.os.VibrationEffect.EFFECT_HEAVY_CLICK) == android.os.Vibrator.VIBRATION_EFFECT_SUPPORT_YES;
                    }
                    if (predefinedOk) { v.vibrate(android.os.VibrationEffect.createPredefined(id), aa); return; }
                }
                if (Build.VERSION.SDK_INT >= 26) {
                    // Phones without amplitude control get a slightly longer pulse so it is felt at all
                    if (!v.hasAmplitudeControl()) { amp = android.os.VibrationEffect.DEFAULT_AMPLITUDE; ms += 6; }
                    v.vibrate(android.os.VibrationEffect.createOneShot(ms, amp), aa);
                } else {
                    v.vibrate(ms + 6);
                }
            } catch (Exception e) {
                viewHaptic();
            }
        }

        /** Last resort: the system's own keyboard-tap haptic on the WebView. */
        @SuppressWarnings("deprecation")
        private void viewHaptic() {
            a.runOnUiThread(() -> {
                View root = a.getWindow().getDecorView();
                root.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP,
                        android.view.HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING);
            });
        }
    }
}
