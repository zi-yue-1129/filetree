package cc.spkuan.filenexus.nativeplugin

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.getcapacitor.JSObject
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Firebase Cloud Messaging glue. Push is optional: builds without `google-services.json` report it unavailable. */
object Push {
    private const val TAG = "FileNexusPush"
    private const val WORK_SYNC = "filenexus-push-token-sync"

    /** Whether Firebase was initialised (i.e. the app was built with `google-services.json`). */
    fun isAvailable(context: Context): Boolean = FirebaseApp.getApps(context).isNotEmpty()

    /**
     * Fetch the FCM token asynchronously.
     *
     * @param onSuccess Receives the token.
     * @param onError Receives the failure.
     */
    fun fetchToken(onSuccess: (String) -> Unit, onError: (Exception) -> Unit) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                onError(task.exception ?: IllegalStateException("FCM token request failed without an exception"))
                return@addOnCompleteListener
            }
            val token: String? = task.result
            if (token.isNullOrBlank()) onError(IllegalStateException("FCM returned an empty token")) else onSuccess(token)
        }
    }

    /** Schedule `PATCH /api/devices/{id}` with the stored token (when signed in). */
    fun scheduleTokenSync(context: Context) {
        val settings = NativeSettings(context)
        if (settings.pushToken == null || !settings.credentials().isConfigured) {
            Log.i(TAG, "Push token sync skipped: no token or device not signed in")
            return
        }
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_SYNC,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<PushTokenSyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
    }
}

/** Uploads the current FCM token to the server, retrying with backoff. */
class PushTokenSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val settings = NativeSettings(applicationContext)
        val token = settings.pushToken
        val credentials = settings.credentials()
        if (token == null || !credentials.isConfigured) return@withContext Result.success()
        try {
            ServerApi(credentials).updatePushToken(token)
            Log.i(TAG, "Push token synced to the server")
            Result.success()
        } catch (e: ServerApiException) {
            Log.e(TAG, "Server rejected the push token (HTTP ${e.statusCode})", e)
            if (e.statusCode >= 500) Result.retry() else Result.failure()
        } catch (e: IOException) {
            Log.e(TAG, "Push token sync failed; will retry", e)
            Result.retry()
        }
    }

    private companion object {
        const val TAG = "FileNexusPush"
    }
}

/** Receives FCM tokens and messages (declared in the plugin manifest). */
class FileNexusMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        NativeSettings(this).pushToken = token
        Push.scheduleTokenSync(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val type = data["type"] ?: "unknown"
        val count = data["count"]?.toIntOrNull()
        // Messages with a notification payload are shown by the system while the
        // app is in the background; this callback runs in the foreground (or for
        // data-only messages), so show it ourselves and notify the WebView.
        val title = message.notification?.title ?: "FileNexus"
        val body = message.notification?.body ?: when (type) {
            "files_added" -> if (count != null) "有 $count 個新檔案上傳到您的帳號" else "有新檔案上傳到您的帳號"
            else -> "您有新的通知"
        }
        Notifications.post(this, Notifications.CHANNEL_PUSH, message.messageId?.hashCode() ?: type.hashCode(), title, body)
        NativeEvents.emit(
            "pushReceived",
            JSObject().apply {
                put("type", type)
                put("data", JSObject().apply { data.forEach { (key, value) -> put(key, value) } })
            },
        )
    }
}
