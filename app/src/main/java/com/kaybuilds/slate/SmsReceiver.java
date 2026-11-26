package com.kaybuilds.slate;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.util.Calendar;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** When a spend SMS arrives, shows what is left to spend today. Works from numbers the app saved; no network. */
public class SmsReceiver extends BroadcastReceiver {
    static final String PREFS = "slate";
    static final String CHANNEL = "left_today";
    private static final Object LOCK = new Object();
    private static final Pattern OBVIOUS = Pattern.compile("(?i)\\b(atm|cash withdrawal|cash wdl)\\b");

    private static final Pattern AMT = Pattern.compile("(?i)(?:INR|Rs\\.?|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)");
    private static final Pattern BAL_BEFORE = Pattern.compile("(?i)(bal|balance|limit|lmt|outstanding|due)[^a-z]*$");
    private static final Pattern OTP = Pattern.compile("(?i)\\b(otp|one[- ]time password|verification code|do not share|don't share|cvv)\\b");
    private static final Pattern DEBIT = Pattern.compile("(?i)\\b(debited|spent|debit|withdrawn|paid|deducted|purchase|sent|charged)\\b");
    private static final Pattern CREDIT = Pattern.compile("(?i)\\b(credited|received|deposited|refunded|refund|reversed|credit of)\\b");
    private static final Pattern NOT_DONE = Pattern.compile("(?i)\\b(will be|is due|are due|due on|due by|due date|statement|declined|failed|unsuccessful|requested|reminder|low balance|insufficient|pre-?approved|offer)\\b");
    private static final Pattern REF = Pattern.compile("(?i)(?:a/c|acct?\\.?|account|card)[^\\n]{0,14}?(?:[xX*]+|\\.{2,})\\s*-?\\d{3,6}");

    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            if (!"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!p.getBoolean("notify", false)) return;
            SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
            if (parts == null || parts.length == 0) return;
            StringBuilder sb = new StringBuilder();
            for (SmsMessage m : parts) { if (m != null && m.getDisplayMessageBody() != null) sb.append(m.getDisplayMessageBody()); }
            double amt = spendAmount(parts[0].getDisplayOriginatingAddress(), sb.toString());
            if (amt <= 0) return;
            // Accounts the person removed as "not mine": no prompt for their messages.
            for (String d : p.getString("mute", "").split("\n")) {
                if (d.length() >= 3 && Pattern.compile("(?:[xX*]|\\.\\.|\\s)" + Pattern.quote(d) + "\\b").matcher(sb).find()) return;
            }

            Calendar c = Calendar.getInstance();
            String month = String.format(Locale.ROOT, "%04d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1);
            int day = c.get(Calendar.YEAR) * 10000 + (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH);
            float spentMonth = month.equals(p.getString("month", "")) ? p.getFloat("spentMonth", 0) : 0;
            boolean sameDay = day == p.getInt("day", 0);
            float spentToday = sameDay && spentMonth > 0 ? p.getFloat("spentToday", 0) : 0;
            // yesterday / last week figures are only trusted on the day the app worked them out
            float yday = sameDay ? p.getFloat("yday", -1) : -1, wkAvg = sameDay ? p.getFloat("wkAvg", -1) : -1;
            spentMonth += amt;
            spentToday += amt;
            p.edit().putString("month", month).putInt("day", day).putFloat("spentMonth", spentMonth).putFloat("spentToday", spentToday).apply();

            String body = sb.toString();
            String low = body.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9@]+", " ");

            // Is this one of the fixed payments still waiting this month? Then it was already set aside.
            float reserve = p.getFloat("reserve", 0);
            String fixedName = null;
            StringBuilder rest = new StringBuilder();
            for (String line : p.getString("fixed", "").split("\n")) {
                String[] f = line.split("\t");
                if (fixedName == null && f.length == 3 && f[0].length() >= 3 && low.contains(f[0])) {
                    fixedName = f[1];
                    try { reserve = Math.max(reserve - Float.parseFloat(f[2]), 0); } catch (Exception ignored) { }
                } else if (line.length() > 0) {
                    rest.append(rest.length() > 0 ? "\n" : "").append(line);
                }
            }
            if (fixedName != null) p.edit().putFloat("reserve", reserve).putString("fixed", rest.toString()).apply();

            float budget = p.getFloat("budget", 0);
            String title = "₹" + money(amt) + (fixedName != null ? " paid · " + fixedName + " ✓" : " spent");
            String text = "₹" + money(spentToday) + " today" + versus(spentToday, yday, "yesterday") + versus(spentToday, wkAvg, "last week");
            if (budget > 0) {
                double leftMonth = budget - reserve - spentMonth;
                text += " · " + (leftMonth >= 0 ? "₹" + money(leftMonth) + " left this month" : "₹" + money(-leftMonth) + " over for the month");
            } else {
                text += " · ₹" + money(spentMonth) + " this month";
            }

            boolean known = fixedName != null || OBVIOUS.matcher(body).find();
            if (!known) { for (String w : p.getString("known", "").split("\n")) { if (w.length() >= 4 && low.contains(w)) { known = true; break; } } }

            NotificationManager nm = channel(ctx);
            int id = known ? 1 : (body + System.currentTimeMillis()).hashCode();
            Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            if (!known) { open.setAction("slate.open." + id); open.putExtra("openBody", body); }
            PendingIntent pi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder nb = new Notification.Builder(ctx, CHANNEL)
                    .setSmallIcon(icon(ctx))
                    .setContentTitle(known ? title : title + ". What was it?")
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(known ? text : text + "\n" + body.replaceAll("\\s+", " ").trim()))
                    .setContentIntent(pi).setAutoCancel(true).setShowWhen(true);
            if (!known) {
                int n = 0;
                for (String line : p.getString("top", "food\tFood\ngroceries\tGroceries\ntravel\tTravel").split("\n")) {
                    String[] t = line.split("\t");
                    if (t.length != 2 || n >= 3) continue;
                    Intent pick = new Intent(ctx, CatReceiver.class);
                    pick.setAction("slate.pick." + id + "." + t[0]);
                    pick.putExtra("body", body).putExtra("bucket", t[0]).putExtra("label", t[1]).putExtra("nid", id);
                    PendingIntent pp = PendingIntent.getBroadcast(ctx, id + 1 + n, pick, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    nb.addAction(new Notification.Action.Builder(Icon.createWithResource(ctx, icon(ctx)), t[1], pp).build());
                    n++;
                }
            }
            nm.notify(id, nb.build());
        } catch (Throwable ignored) { }
    }

    static int icon(Context ctx) {
        int id = ctx.getResources().getIdentifier("ic_stat", "drawable", ctx.getPackageName());
        return id != 0 ? id : android.R.drawable.ic_dialog_info;
    }

    static NotificationManager channel(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "After each spend", NotificationManager.IMPORTANCE_DEFAULT));
        return nm;
    }

    private static File pendingFile(Context ctx) { return new File(ctx.getFilesDir(), "pending.json"); }

    private static String read(File f) throws Exception {
        if (!f.exists()) return "[]";
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            String s = new String(out.toByteArray(), StandardCharsets.UTF_8);
            return s.isEmpty() ? "[]" : s;
        }
    }

    static void addPending(Context ctx, String body, String bucket) {
        synchronized (LOCK) {
            try {
                JSONArray arr = new JSONArray(read(pendingFile(ctx)));
                JSONObject o = new JSONObject();
                o.put("body", body);
                o.put("b", bucket);
                arr.put(o);
                try (FileOutputStream out = new FileOutputStream(pendingFile(ctx))) { out.write(arr.toString().getBytes(StandardCharsets.UTF_8)); }
            } catch (Exception ignored) { }
        }
    }

    static String takePending(Context ctx) {
        synchronized (LOCK) {
            try {
                File f = pendingFile(ctx);
                String s = read(f);
                if (f.exists()) f.delete();
                return s;
            } catch (Exception e) {
                return "[]";
            }
        }
    }

    private static String money(double v) {
        NumberFormat f = NumberFormat.getIntegerInstance(new Locale("en", "IN"));
        return f.format(Math.round(v));
    }

    /** " · ▲23% vs yesterday", or "" when there is nothing to compare with. */
    static String versus(double today, double base, String what) {
        if (base < 0) return "";
        if (base == 0) return today > 0 ? " · ▲ vs nothing " + what : "";
        long p = Math.round((today - base) / base * 100);
        return p == 0 ? " · same as " + what : " · " + (p > 0 ? "▲" : "▼") + Math.abs(p) + "% vs " + what;
    }

    /** Amount if this SMS reports money already spent, otherwise 0. */
    static double spendAmount(String sender, String body) {
        if (sender == null || body == null) return 0;
        boolean named = false;
        for (int i = 0; i < sender.length(); i++) { if (Character.isLetter(sender.charAt(i))) { named = true; break; } }
        if (!named) return 0;
        String flat = body.replaceAll("\\s+", " ").trim();
        if (OTP.matcher(flat).find() || NOT_DONE.matcher(flat).find()) return 0;
        Matcher d = DEBIT.matcher(flat), c = CREDIT.matcher(flat);
        if (!d.find()) return 0;
        if (c.find() && c.start() < d.start()) return 0;
        if (!REF.matcher(flat).find() && !flat.toLowerCase(Locale.ROOT).contains("bank")) return 0;
        Matcher a = AMT.matcher(flat);
        while (a.find()) {
            String before = flat.substring(Math.max(0, a.start() - 28), a.start());
            if (BAL_BEFORE.matcher(before).find()) continue;
            try { double v = Double.parseDouble(a.group(1).replace(",", "")); if (v > 0) return v; } catch (Exception ignored) { }
        }
        return 0;
    }
}
