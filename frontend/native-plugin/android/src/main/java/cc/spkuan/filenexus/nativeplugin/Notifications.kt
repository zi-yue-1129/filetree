package cc.spkuan.filenexus.nativeplugin

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Notification channels and builders used by the plugin (user-facing text in zh-TW). */
object Notifications {
    /** Ongoing upload progress (low importance, silent). */
    const val CHANNEL_UPLOADS: String = "filenexus_uploads"
    /** Upload finished / failed results. */
    const val CHANNEL_RESULTS: String = "filenexus_upload_results"
    /** Remote push messages from the server. */
    const val CHANNEL_PUSH: String = "filenexus_push"
    /** App update download progress. */
    const val CHANNEL_UPDATES: String = "filenexus_updates"

    /** Foreground notification id of the "any network" upload queue. */
    const val ID_QUEUE_ANY: Int = 41001
    /** Foreground notification id of the Wi-Fi-only upload queue. */
    const val ID_QUEUE_WIFI: Int = 41002
    /** Summary notification id for finished uploads. */
    const val ID_RESULT: Int = 41003
    /** Notification id for failed uploads. */
    const val ID_FAILURE: Int = 41004
    /** Notification id for APK download progress. */
    const val ID_UPDATE: Int = 41005

    private const val TAG = "FileNexusNotify"

    /** Create all channels (idempotent). */
    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(CHANNEL_UPLOADS, "上傳進度", NotificationManager.IMPORTANCE_LOW),
                NotificationChannel(CHANNEL_RESULTS, "上傳結果", NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CHANNEL_PUSH, "新檔案通知", NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CHANNEL_UPDATES, "App 更新", NotificationManager.IMPORTANCE_LOW),
            ),
        )
    }

    /** PendingIntent that opens the app's launcher activity. */
    fun openAppIntent(context: Context): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * Build the ongoing upload progress notification.
     *
     * @param title Title line.
     * @param text Detail line.
     * @param bar Progress bar arguments, or `null` for an indeterminate bar
     * (preparing, size unknown).
     */
    fun progress(context: Context, title: String, text: String, bar: UploadProgress.Bar?): Notification {
        ensureChannels(context)
        return NotificationCompat.Builder(context, CHANNEL_UPLOADS)
            .setSmallIcon(R.drawable.ic_stat_filenexus)
            .setContentTitle(title)
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(openAppIntent(context))
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setProgress(bar?.max ?: 0, bar?.value ?: 0, bar?.indeterminate ?: true)
            .build()
    }

    /**
     * Post a one-off notification if the user allows notifications.
     *
     * @param channel Channel id.
     * @param id Notification id (same id replaces the previous one).
     * @param title Title line.
     * @param text Body.
     */
    fun post(context: Context, channel: String, id: Int, title: String, text: String) {
        ensureChannels(context)
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_filenexus)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        postBuilt(context, id, notification)
    }

    /**
     * Post an already built notification if permitted.
     *
     * @param id Notification id.
     * @param notification Notification to show.
     */
    fun postBuilt(context: Context, id: Int, notification: Notification) {
        val manager = NotificationManagerCompat.from(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            Log.i(TAG, "Notification $id not shown: POST_NOTIFICATIONS not granted")
            return
        }
        if (!manager.areNotificationsEnabled()) {
            Log.i(TAG, "Notification $id not shown: notifications disabled by the user")
            return
        }
        manager.notify(id, notification)
    }

    /** Cancel a notification. */
    fun cancel(context: Context, id: Int) {
        NotificationManagerCompat.from(context).cancel(id)
    }
}
