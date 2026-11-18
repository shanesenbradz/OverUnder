package com.bradz.calzone;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * In-place updates for the sideloaded APK, exposed to the page as window.BullpupUpdate.
 * The page reads docs/version.json, and when a newer build is out it calls install(url, sha256).
 * The APK is downloaded here, checked against its SHA-256, and handed to Android's PackageInstaller
 * as an update of this same package. Android shows its own "Update this app?" screen; because the
 * new APK is signed with the same release key, it replaces the app and keeps every game, save,
 * state and setting. Progress and errors go back to the page through window.bullpupUpdate(type, data).
 * The Google Play build never calls this: Play installs its updates itself.
 */
public class Updater {
    private final MainActivity a;
    private final String action;
    private volatile boolean busy;
    private BroadcastReceiver receiver;

    Updater(MainActivity a) {
        this.a = a;
        this.action = a.getPackageName() + ".UPDATE_STATUS";
    }

    @JavascriptInterface
    public String packageName() { return a.getPackageName(); }

    @JavascriptInterface
    @SuppressWarnings("deprecation")
    public int versionCode() {
        try {
            PackageInfo p = a.getPackageManager().getPackageInfo(a.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) p.getLongVersionCode() : p.versionCode;
        } catch (Exception e) { return 0; }
    }

    /** Android 8+ asks once per app before it may install updates. */
    @JavascriptInterface
    public boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || a.getPackageManager().canRequestPackageInstalls();
    }

    @JavascriptInterface
    public void allowInstalls() {
        a.runOnUiThread(() -> {
            try {
                a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
            } catch (Exception e) {
                try { a.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS)); } catch (Exception ignored) { }
            }
        });
    }

    @JavascriptInterface
    public void install(final String url, final String sha256) {
        if (busy) return;
        busy = true;
        new Thread(() -> {
            try {
                byte[] apk = download(url);
                if (sha256 != null && !sha256.isEmpty() && !sha256.equalsIgnoreCase(hash(apk))) {
                    throw new Exception("The download didn't match the published checksum. Try again.");
                }
                a.updateEvent("installing", "");
                commit(apk);
            } catch (Exception e) {
                busy = false;
                String m = e.getMessage();
                a.updateEvent("error", m == null || m.isEmpty() ? "The update could not be downloaded." : m);
            }
        }, "bullpup-update").start();
    }

    private byte[] download(String url) throws Exception {
        String at = url;
        // Follow redirects by hand: GitHub hands release files over to another host
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(at).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "BradsBullpup-Updater");
            c.setRequestProperty("Cache-Control", "no-cache");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) break;
                at = new URL(new URL(at), loc).toString();
                continue;
            }
            if (code != 200) { c.disconnect(); throw new Exception("GitHub answered " + code + ". Try again in a minute."); }
            int total = c.getContentLength();
            ByteArrayOutputStream out = new ByteArrayOutputStream(total > 0 ? total : 1 << 20);
            byte[] buf = new byte[32768];
            int n, got = 0, lastPct = -1;
            try (InputStream in = c.getInputStream()) {
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    got += n;
                    if (total > 0) {
                        int pct = (int) (got * 100L / total);
                        if (pct != lastPct) { lastPct = pct; a.updateEvent("progress", String.valueOf(pct)); }
                    }
                }
            } finally { c.disconnect(); }
            return out.toByteArray();
        }
        throw new Exception("Too many redirects.");
    }

    private static String hash(byte[] b) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(b);
        StringBuilder s = new StringBuilder();
        for (byte x : d) s.append(String.format("%02x", x & 0xff));
        return s.toString();
    }

    private void commit(byte[] apk) throws Exception {
        PackageInstaller pi = a.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        p.setAppPackageName(a.getPackageName());
        p.setSize(apk.length);
        int id = pi.createSession(p);
        PackageInstaller.Session s = pi.openSession(id);
        try (OutputStream os = s.openWrite("base.apk", 0, apk.length)) {
            os.write(apk);
            s.fsync(os);
        }
        listen();
        Intent i = new Intent(action).setPackage(a.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent pend = PendingIntent.getBroadcast(a, id, i, flags);
        s.commit(pend.getIntentSender());
        s.close();
    }

    private void listen() {
        if (receiver != null) return;
        receiver = new BroadcastReceiver() {
            @Override
            @SuppressWarnings("deprecation")
            public void onReceive(Context ctx, Intent i) {
                int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        try { a.startActivity(confirm); } catch (Exception e) { busy = false; a.updateEvent("error", "Android's installer could not be opened."); }
                    }
                    a.updateEvent("confirm", "");
                } else if (st == PackageInstaller.STATUS_SUCCESS) {
                    busy = false;
                    a.updateEvent("done", "");
                } else {
                    busy = false;
                    String m = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                    if (st == PackageInstaller.STATUS_FAILURE_ABORTED) m = "Update cancelled.";
                    else if (st == PackageInstaller.STATUS_FAILURE_CONFLICT || st == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE)
                        m = "Android refused the update (" + (m == null ? "signature or version conflict" : m) + ").";
                    else if (st == PackageInstaller.STATUS_FAILURE_STORAGE) m = "Not enough free space for the update.";
                    a.updateEvent("error", m == null ? "The update was not installed." : m);
                }
            }
        };
        IntentFilter f = new IntentFilter(action);
        if (Build.VERSION.SDK_INT >= 33) a.registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED);
        else a.registerReceiver(receiver, f);
    }

    void close() {
        if (receiver != null) { try { a.unregisterReceiver(receiver); } catch (Exception ignored) { } receiver = null; }
    }
}
