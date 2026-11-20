package com.kaybuilds.slate;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.util.Base64;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Thin native shell for Slate: shows the bundled UI and gives it SMS reading, private storage, share and export. */
public class MainActivity extends Activity {
    private static final int REQ_SMS = 1;
    private static final int REQ_NOTIFY = 2;
    private static final int REQ_RESTORE = 3;
    private static final String PERM_NOTIFY = "android.permission.POST_NOTIFICATIONS";
    private WebView web;
    private FrameLayout root;
    private boolean pageReady = false;
    private String pendingOpen;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int bg = night ? 0xFF0E1110 : 0xFFF6F5F1;
        web = new WebView(this);
        web.setBackgroundColor(bg);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient() {
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return true; // one local page; never navigate anywhere
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (pendingOpen != null) {
                    String b = pendingOpen;
                    pendingOpen = null;
                    web.evaluateJavascript("window.onNative('openSms', " + JSONObject.quote(b) + ")", null);
                }
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        // Android 15+ draws apps edge to edge: keep the page clear of the status bar, navigation bar and keyboard.
        root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                    android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
                    v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                    return WindowInsets.CONSUMED;
                }
            });
        }
        setContentView(root);
        chrome(bg, night);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    new OnBackInvokedCallback() { @Override public void onBackInvoked() { goBack(); } });
        }
        web.loadUrl("file:///android_asset/index.html");
        pendingOpen = getIntent() == null ? null : getIntent().getStringExtra("openBody");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String body = intent == null ? null : intent.getStringExtra("openBody");
        if (body == null) return;
        if (pageReady) js("window.onNative('openSms', " + JSONObject.quote(body) + ")");
        else pendingOpen = body;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pageReady) js("window.onNative && window.onNative('resume', null)");
    }

    /** Colours the area behind the status and navigation bars and picks light or dark bar icons. */
    @SuppressWarnings("deprecation")
    private void chrome(int color, boolean dark) {
        root.setBackgroundColor(color);
        web.setBackgroundColor(color);
        if (Build.VERSION.SDK_INT < 35) {          // older Android still paints the bars itself
            getWindow().setStatusBarColor(color);
            getWindow().setNavigationBarColor(color);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : light, light);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | 0x10));
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { goBack(); }   // Android 12 and older; newer versions use the callback registered in onCreate

    private void goBack() {
        if (!pageReady) { finish(); return; }
        web.evaluateJavascript("(window.handleBack ? window.handleBack() : false)", new android.webkit.ValueCallback<String>() {
            @Override public void onReceiveValue(String value) { if (!"true".equals(value)) finish(); }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_SMS) {
            boolean ok = checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
            js("window.onNative('perm', " + ok + ")");
        } else if (requestCode == REQ_NOTIFY) {
            js("window.onNative('notifyPerm', null)");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_RESTORE) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) { js("window.onNative('restore', null)"); return; }
        try (java.io.InputStream in = getContentResolver().openInputStream(data.getData())) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n, total = 0;
            while (in != null && (n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; if (total > 20 * 1024 * 1024) break; }
            js("window.onNative('restore', " + JSONObject.quote(new String(out.toByteArray(), StandardCharsets.UTF_8)) + ")");
        } catch (Exception e) {
            js("window.onNative('restore', '')");
        }
    }

    private void js(final String code) {
        runOnUiThread(new Runnable() { @Override public void run() { if (pageReady) web.evaluateJavascript(code, null); } });
    }

    private File dataFile() { return new File(getFilesDir(), "data.json"); }

    private class Bridge {
        /** Match the status and navigation bars to the chosen look. */
        @JavascriptInterface
        public void setChrome(final String hex, final boolean dark) {
            runOnUiThread(new Runnable() { @Override public void run() {
                try { chrome(android.graphics.Color.parseColor(hex), dark); } catch (Exception ignored) { }
            } });
        }

        /** A small physical tick: 0 = tap, 1 = success, 2 = warning. Uses the view's own haptics, so no extra permission. */
        @JavascriptInterface
        public void haptic(final int kind) {
            runOnUiThread(new Runnable() { @Override public void run() {
                int c = kind == 1 ? (Build.VERSION.SDK_INT >= 30 ? android.view.HapticFeedbackConstants.CONFIRM : android.view.HapticFeedbackConstants.VIRTUAL_KEY)
                        : kind == 2 ? (Build.VERSION.SDK_INT >= 30 ? android.view.HapticFeedbackConstants.REJECT : android.view.HapticFeedbackConstants.LONG_PRESS)
                        : android.view.HapticFeedbackConstants.CLOCK_TICK;
                web.performHapticFeedback(c);
            } });
        }

        /** Lets the person pick a Slate backup file; the contents come back through onNative('restore', text). */
        @JavascriptInterface
        public void pickBackup() {
            runOnUiThread(new Runnable() { @Override public void run() {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                try { startActivityForResult(i, REQ_RESTORE); } catch (Exception e) { js("window.onNative('restore', '')"); }
            } });
        }

        @JavascriptInterface
        public boolean hasSmsPermission() {
            return checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestSmsPermission() {
            runOnUiThread(new Runnable() { @Override public void run() { requestPermissions(new String[]{Manifest.permission.READ_SMS}, REQ_SMS); } });
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(new Runnable() { @Override public void run() {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null)));
            } });
        }

        @JavascriptInterface
        public boolean notifyReady() {
            if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) return false;
            if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(PERM_NOTIFY) != PackageManager.PERMISSION_GRANTED) return false;
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            return nm != null && nm.areNotificationsEnabled();
        }

        @JavascriptInterface
        public void requestNotifyPermissions() {
            runOnUiThread(new Runnable() { @Override public void run() {
                if (android.os.Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS, PERM_NOTIFY}, REQ_NOTIFY);
                else requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS}, REQ_NOTIFY);
            } });
        }

        /** The app's current numbers, so the spend notification can say what is left for today. */
        @JavascriptInterface
        public void setLive(String json) {
            try {
                JSONObject o = new JSONObject(json);
                SharedPreferences.Editor e = getSharedPreferences(SmsReceiver.PREFS, Context.MODE_PRIVATE).edit();
                e.putBoolean("notify", o.optBoolean("notify", false));
                e.putFloat("budget", (float) o.optDouble("budget", 0));
                e.putString("month", o.optString("month", ""));
                e.putInt("day", o.optInt("day", 0));
                e.putFloat("spentMonth", (float) o.optDouble("spentMonth", 0));
                e.putFloat("spentToday", (float) o.optDouble("spentToday", 0));
                e.putFloat("reserve", (float) o.optDouble("reserve", 0));
                e.putString("known", o.optString("known", ""));
                e.putString("fixed", o.optString("fixed", ""));
                e.putString("top", o.optString("top", ""));
                e.apply();
            } catch (Exception ignored) { }
        }

        /** Categories picked straight from a notification, waiting to be applied. */
        @JavascriptInterface
        public String takePending() {
            return SmsReceiver.takePending(MainActivity.this);
        }

        /** Inbox messages newer than sinceMs from named senders (banks never text from plain phone numbers). */
        @JavascriptInterface
        public String readSms(String sinceMs) {
            JSONArray arr = new JSONArray();
            long since = 0;
            try { since = Long.parseLong(sinceMs); } catch (Exception ignored) { }
            try (Cursor c = getContentResolver().query(Uri.parse("content://sms/inbox"),
                    new String[]{"_id", "address", "body", "date"}, "date > ?", new String[]{String.valueOf(since)}, "date ASC")) {
                if (c != null) {
                    while (c.moveToNext()) {
                        String addr = c.getString(1);
                        String body = c.getString(2);
                        if (addr == null || body == null) continue;
                        boolean named = false;
                        for (int i = 0; i < addr.length(); i++) { if (Character.isLetter(addr.charAt(i))) { named = true; break; } }
                        if (!named) continue;
                        JSONObject o = new JSONObject();
                        o.put("id", c.getLong(0));
                        o.put("a", addr);
                        o.put("b", body);
                        o.put("d", c.getLong(3));
                        arr.put(o);
                    }
                }
            } catch (Exception e) {
                return "[]";
            }
            return arr.toString();
        }

        @JavascriptInterface
        public String loadData() {
            File f = dataFile();
            if (!f.exists()) return "";
            try (FileInputStream in = new FileInputStream(f)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public synchronized void saveData(String json) {
            try {
                File tmp = new File(getFilesDir(), "data.json.tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                    out.getFD().sync();
                }
                if (!tmp.renameTo(dataFile())) {
                    try (FileOutputStream out = new FileOutputStream(dataFile())) { out.write(json.getBytes(StandardCharsets.UTF_8)); }
                }
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void shareText(final String text) {
            runOnUiThread(new Runnable() { @Override public void run() {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Share"));
            } });
        }

        private Uri store(String collection, String dir, String name, String mime, byte[] bytes) throws Exception {
            ContentValues v = new ContentValues();
            v.put("_display_name", name);
            v.put("mime_type", mime);
            v.put("relative_path", dir);
            Uri uri = getContentResolver().insert(Uri.parse(collection), v);
            if (uri == null) return null;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) return null;
                out.write(bytes);
            }
            return uri;
        }

        @JavascriptInterface
        public boolean saveToDownloads(String name, String mime, String content) {
            try {
                return store("content://media/external/downloads", Environment.DIRECTORY_DOWNLOADS, name, mime,
                        content.getBytes(StandardCharsets.UTF_8)) != null;
            } catch (Exception e) {
                return false;
            }
        }

        /** Saves a PNG (base64) to Pictures/Slate and opens the share sheet for it. */
        @JavascriptInterface
        public boolean shareImage(String name, String base64Png) {
            try {
                final Uri uri = store("content://media/external/images/media", Environment.DIRECTORY_PICTURES + "/Slate", name, "image/png",
                        Base64.decode(base64Png, Base64.DEFAULT));
                if (uri == null) return false;
                runOnUiThread(new Runnable() { @Override public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("image/png");
                        i.putExtra(Intent.EXTRA_STREAM, uri);
                        i.setClipData(ClipData.newRawUri("wrap", uri));
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(i, "Share your month"));
                    } catch (Exception ignored) { }
                } });
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }
}
