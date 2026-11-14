package com.kaybuilds.slate;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A category button was tapped on the "what was it?" notification: remember the answer for the app. */
public class CatReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            String body = intent.getStringExtra("body"), bucket = intent.getStringExtra("bucket"), label = intent.getStringExtra("label");
            int id = intent.getIntExtra("nid", 0);
            if (body == null || bucket == null) return;
            SmsReceiver.addPending(ctx, body, bucket);
            NotificationManager nm = SmsReceiver.channel(ctx);
            Notification n = new Notification.Builder(ctx, SmsReceiver.CHANNEL)
                    .setSmallIcon(SmsReceiver.icon(ctx))
                    .setContentTitle("Sorted as " + (label == null ? bucket : label) + " \u2713")
                    .setContentText("Slate will remember this next time")
                    .setTimeoutAfter(2500)
                    .build();
            nm.notify(id, n);
        } catch (Throwable ignored) { }
    }
}
