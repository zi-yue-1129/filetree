package cc.spkuan.filenexus.nativeplugin

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import org.json.JSONObject

/**
 * Credentials persisted by `configure()`.
 *
 * @property serverUrl Server origin without trailing slash, e.g. `https://files.example.com`.
 * @property deviceToken Long-lived device token, `null` when signed out.
 * @property deviceId Device id from `POST /api/devices/register`.
 * @property deviceName Device name sent at registration.
 */
data class DeviceCredentials(
    val serverUrl: String?,
    val deviceToken: String?,
    val deviceId: String?,
    val deviceName: String?,
) {
    /** Whether background work may talk to the server. */
    val isConfigured: Boolean
        get() = !serverUrl.isNullOrBlank() && !deviceToken.isNullOrBlank()
}

/**
 * Photo backup settings and progress watermark.
 *
 * @property enabled Backup turned on by the user.
 * @property wifiOnly Upload only on unmetered networks.
 * @property includeVideos Also back up videos.
 * @property folderId Server folder from `POST /api/backup/folder`, once resolved.
 * @property lastRunAt Last completed scan (epoch ms) or `null`.
 * @property lastBackedUpAt Newest media `DATE_ADDED` already enqueued (epoch ms) or `null`.
 * @property sinceMillis Only media added at/after this time is backed up (enable time).
 * @property lastMediaId Highest MediaStore `_ID` already enqueued, `-1` initially.
 * @property enqueuedCount Media items enqueued since backup was enabled.
 * @property lastError Last scan error or `null`.
 */
data class PhotoBackupState(
    val enabled: Boolean,
    val wifiOnly: Boolean,
    val includeVideos: Boolean,
    val folderId: String?,
    val lastRunAt: Long?,
    val lastBackedUpAt: Long?,
    val sinceMillis: Long,
    val lastMediaId: Long,
    val enqueuedCount: Long,
    val lastError: String?,
)

/**
 * App-private persistent settings shared by the plugin, workers, the share
 * receiver and the push service (all of which may run without the WebView).
 *
 * Stored in a private [SharedPreferences] file; the device token is only as
 * protected as the app sandbox, which matches the session token the WebView
 * already keeps in `localStorage`.
 */
class NativeSettings(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Read the stored credentials. */
    fun credentials(): DeviceCredentials = DeviceCredentials(
        serverUrl = prefs.getString(KEY_SERVER_URL, null),
        deviceToken = prefs.getString(KEY_DEVICE_TOKEN, null),
        deviceId = prefs.getString(KEY_DEVICE_ID, null),
        deviceName = prefs.getString(KEY_DEVICE_NAME, null),
    )

    /**
     * Persist credentials. A changed device or server invalidates the cached
     * backup folder because folders are per device and per server.
     *
     * @param credentials New credentials; null fields are removed.
     */
    fun saveCredentials(credentials: DeviceCredentials) {
        val previous = credentials()
        val folderInvalid = previous.serverUrl != credentials.serverUrl ||
            previous.deviceId != credentials.deviceId
        prefs.edit(commit = true) {
            putOrRemove(KEY_SERVER_URL, credentials.serverUrl?.trimEnd('/'))
            putOrRemove(KEY_DEVICE_TOKEN, credentials.deviceToken)
            putOrRemove(KEY_DEVICE_ID, credentials.deviceId)
            putOrRemove(KEY_DEVICE_NAME, credentials.deviceName)
            if (folderInvalid) remove(KEY_BACKUP_FOLDER_ID)
        }
    }

    /** Read photo backup settings and progress. */
    fun photoBackup(): PhotoBackupState = PhotoBackupState(
        enabled = prefs.getBoolean(KEY_BACKUP_ENABLED, false),
        wifiOnly = prefs.getBoolean(KEY_BACKUP_WIFI_ONLY, true),
        includeVideos = prefs.getBoolean(KEY_BACKUP_VIDEOS, true),
        folderId = prefs.getString(KEY_BACKUP_FOLDER_ID, null),
        lastRunAt = prefs.getLong(KEY_BACKUP_LAST_RUN, -1L).takeIf { it >= 0 },
        lastBackedUpAt = prefs.getLong(KEY_BACKUP_WATERMARK, -1L).takeIf { it >= 0 },
        sinceMillis = prefs.getLong(KEY_BACKUP_SINCE, 0L),
        lastMediaId = prefs.getLong(KEY_BACKUP_LAST_ID, -1L),
        enqueuedCount = prefs.getLong(KEY_BACKUP_COUNT, 0L),
        lastError = prefs.getString(KEY_BACKUP_ERROR, null),
    )

    /**
     * Update the user-facing photo backup options. Turning backup on starts
     * the window at [nowMillis] so only media added afterwards is uploaded
     * (contract §5: "upload new photos/videos").
     *
     * @param enabled Backup on/off.
     * @param wifiOnly Unmetered networks only.
     * @param includeVideos Include videos.
     * @param nowMillis Current time, used as the initial watermark.
     */
    fun savePhotoBackupOptions(enabled: Boolean, wifiOnly: Boolean, includeVideos: Boolean, nowMillis: Long) {
        val wasEnabled = prefs.getBoolean(KEY_BACKUP_ENABLED, false)
        prefs.edit(commit = true) {
            putBoolean(KEY_BACKUP_ENABLED, enabled)
            putBoolean(KEY_BACKUP_WIFI_ONLY, wifiOnly)
            putBoolean(KEY_BACKUP_VIDEOS, includeVideos)
            if (enabled && !wasEnabled) {
                putLong(KEY_BACKUP_SINCE, nowMillis)
                putLong(KEY_BACKUP_LAST_ID, -1L)
                remove(KEY_BACKUP_WATERMARK)
                putLong(KEY_BACKUP_COUNT, 0L)
                remove(KEY_BACKUP_ERROR)
            }
        }
    }

    /** Remember the resolved backup folder id. */
    fun saveBackupFolderId(folderId: String) {
        prefs.edit(commit = true) { putString(KEY_BACKUP_FOLDER_ID, folderId) }
    }

    /**
     * Record a finished backup scan.
     *
     * @param ranAt Scan time (epoch ms).
     * @param lastMediaId New highest enqueued `_ID`, or `null` to keep the old one.
     * @param watermark New newest-enqueued media time, or `null` to keep the old one.
     * @param newlyEnqueued Items enqueued by this scan.
     * @param error Error message, or `null` on success.
     */
    fun recordBackupRun(ranAt: Long, lastMediaId: Long?, watermark: Long?, newlyEnqueued: Int, error: String?) {
        val count = prefs.getLong(KEY_BACKUP_COUNT, 0L) + newlyEnqueued
        prefs.edit(commit = true) {
            putLong(KEY_BACKUP_LAST_RUN, ranAt)
            if (lastMediaId != null) putLong(KEY_BACKUP_LAST_ID, lastMediaId)
            if (watermark != null) putLong(KEY_BACKUP_WATERMARK, watermark)
            putLong(KEY_BACKUP_COUNT, count)
            putOrRemove(KEY_BACKUP_ERROR, error)
        }
    }

    /** Last FCM token handed to us by Firebase (synced to the server when configured). */
    var pushToken: String?
        get() = prefs.getString(KEY_PUSH_TOKEN, null)
        set(value) = prefs.edit(commit = true) { putOrRemove(KEY_PUSH_TOKEN, value) }

    /**
     * Pick time (epoch ms) per persisted SAF grant URI, see [UriGrants].
     *
     * @throws org.json.JSONException when the stored value is corrupt.
     */
    fun pickedGrants(): Map<String, Long> {
        val raw = prefs.getString(KEY_PICKED_GRANTS, null) ?: return emptyMap()
        val json = JSONObject(raw)
        return json.keys().asSequence().associateWith { json.getLong(it) }
    }

    /** Replace the stored pick times (see [pickedGrants]). */
    fun savePickedGrants(pickedAt: Map<String, Long>) {
        prefs.edit(commit = true) { putString(KEY_PICKED_GRANTS, JSONObject(pickedAt).toString()) }
    }

    private fun SharedPreferences.Editor.putOrRemove(key: String, value: String?) {
        if (value == null) remove(key) else putString(key, value)
    }

    private companion object {
        const val PREFS_NAME = "filenexus_native"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_DEVICE_TOKEN = "device_token"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_DEVICE_NAME = "device_name"
        const val KEY_BACKUP_ENABLED = "backup_enabled"
        const val KEY_BACKUP_WIFI_ONLY = "backup_wifi_only"
        const val KEY_BACKUP_VIDEOS = "backup_videos"
        const val KEY_BACKUP_FOLDER_ID = "backup_folder_id"
        const val KEY_BACKUP_LAST_RUN = "backup_last_run"
        const val KEY_BACKUP_WATERMARK = "backup_watermark"
        const val KEY_BACKUP_SINCE = "backup_since"
        const val KEY_BACKUP_LAST_ID = "backup_last_id"
        const val KEY_BACKUP_COUNT = "backup_count"
        const val KEY_BACKUP_ERROR = "backup_error"
        const val KEY_PUSH_TOKEN = "push_token"
        const val KEY_PICKED_GRANTS = "picked_uri_grants"
    }
}
