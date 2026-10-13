package cc.spkuan.filenexus.nativeplugin

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.getcapacitor.JSObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Photo library access level; wire values match `PhotoAccess` in definitions.ts. */
enum class PhotoAccess(val wire: String) {
    /** Full access. */
    GRANTED("granted"),
    /** Android 14+ "selected photos" access: only user-picked media is visible. */
    LIMITED("limited"),
    /** No access. */
    DENIED("denied"),
}

/** Scheduling and permission helpers for automatic photo/video backup. */
object PhotoBackup {
    private const val TAG = "FileNexusPhotoBackup"
    private const val WORK_PERIODIC = "filenexus-photo-backup-periodic"
    private const val WORK_TRIGGER = "filenexus-photo-backup-trigger"
    private const val WORK_NOW = "filenexus-photo-backup-now"

    /**
     * Current photo access, accounting for API-level differences.
     *
     * @param includeVideos Whether video access is also required for `granted`.
     */
    fun access(context: Context, includeVideos: Boolean): PhotoAccess {
        fun granted(permission: String): Boolean =
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
        return when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> {
                val full = granted(Manifest.permission.READ_MEDIA_IMAGES) &&
                    (!includeVideos || granted(Manifest.permission.READ_MEDIA_VIDEO))
                when {
                    full -> PhotoAccess.GRANTED
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
                        granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> PhotoAccess.LIMITED
                    else -> PhotoAccess.DENIED
                }
            }
            granted(Manifest.permission.READ_EXTERNAL_STORAGE) -> PhotoAccess.GRANTED
            else -> PhotoAccess.DENIED
        }
    }

    /** Status payload (`PhotoBackupStatus` in definitions.ts). */
    fun statusJs(context: Context): JSObject {
        val state = NativeSettings(context).photoBackup()
        val permission = access(context, state.includeVideos)
        return JSObject().apply {
            put("enabled", state.enabled)
            put("wifiOnly", state.wifiOnly)
            put("includeVideos", state.includeVideos)
            put("permission", permission.wire)
            put("folderId", state.folderId)
            put("lastRunAt", state.lastRunAt)
            put("lastBackedUpAt", state.lastBackedUpAt)
            put("enqueuedCount", state.enqueuedCount)
            put("lastError", state.lastError)
        }
    }

    /** Schedule (or cancel) the periodic scan and the MediaStore change trigger. */
    fun schedule(context: Context) {
        val workManager = WorkManager.getInstance(context)
        if (!NativeSettings(context).photoBackup().enabled) {
            workManager.cancelUniqueWork(WORK_PERIODIC)
            workManager.cancelUniqueWork(WORK_TRIGGER)
            return
        }
        val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        workManager.enqueueUniquePeriodicWork(
            WORK_PERIODIC,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<PhotoBackupWorker>(1, TimeUnit.HOURS).setConstraints(network).build(),
        )
        scheduleContentTrigger(context, ExistingWorkPolicy.KEEP)
    }

    /**
     * Arm a one-shot job that fires when MediaStore images/videos change
     * (JobScheduler content trigger, survives process death; acts as the
     * "content observer" without a running process). Re-armed by the
     * triggered run itself with [ExistingWorkPolicy.APPEND_OR_REPLACE] so the
     * running job is not cancelled; settings changes use [ExistingWorkPolicy.KEEP].
     *
     * @param policy How to treat an already scheduled trigger.
     */
    fun scheduleContentTrigger(context: Context, policy: ExistingWorkPolicy) {
        if (!NativeSettings(context).photoBackup().enabled) return
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
            .addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
            .setTriggerContentUpdateDelay(15, TimeUnit.SECONDS)
            .setTriggerContentMaxDelay(2, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_TRIGGER,
            policy,
            OneTimeWorkRequestBuilder<PhotoBackupWorker>()
                .setConstraints(constraints)
                .setInputData(androidx.work.workDataOf(PhotoBackupWorker.KEY_FROM_TRIGGER to true))
                .build(),
        )
    }

    /** Run a scan as soon as the network allows. */
    fun runNow(context: Context) {
        val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NOW,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<PhotoBackupWorker>().setConstraints(network).build(),
        )
        Log.i(TAG, "Manual photo backup scan scheduled")
    }
}

/**
 * Scans MediaStore for photos/videos added since backup was enabled and
 * enqueues them into the upload queue (folder `相簿備份/<device>`).
 *
 * Uses the MediaStore `_ID` (monotonic per volume) as the high-water mark, so
 * items are never enqueued twice; stops at the first still-pending item so it
 * is picked up once written completely.
 */
class PhotoBackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val settings = NativeSettings(applicationContext)
        val state = settings.photoBackup()
        val fromTrigger = inputData.getBoolean(KEY_FROM_TRIGGER, false)
        try {
            if (!state.enabled) return@withContext Result.success()
            val now = System.currentTimeMillis()
            val credentials = settings.credentials()
            if (!credentials.isConfigured) {
                settings.recordBackupRun(now, null, null, 0, "裝置尚未登入，無法備份")
                return@withContext Result.success()
            }
            val access = PhotoBackup.access(applicationContext, state.includeVideos)
            if (access == PhotoAccess.DENIED) {
                settings.recordBackupRun(now, null, null, 0, "沒有相簿讀取權限")
                return@withContext Result.success()
            }
            val folderId = state.folderId ?: ServerApi(credentials).backupFolder().also(settings::saveBackupFolderId)
            val scan = scan(state)
            if (scan.uploads.isNotEmpty()) {
                UploadQueue.enqueue(applicationContext, scan.uploads, folderId, "backup", state.wifiOnly)
            }
            val note = if (access == PhotoAccess.LIMITED) "僅能存取您選取的相片（部分存取權限）" else null
            settings.recordBackupRun(now, scan.lastMediaId, scan.newestAddedAt, scan.uploads.size, note)
            Log.i(TAG, "Photo backup scan enqueued ${scan.uploads.size} items (limited=${access == PhotoAccess.LIMITED})")
            Result.success()
        } catch (e: IOException) {
            Log.e(TAG, "Photo backup scan failed; will retry", e)
            settings.recordBackupRun(System.currentTimeMillis(), null, null, 0, "備份失敗：${e.message}")
            Result.retry()
        } catch (e: SecurityException) {
            Log.e(TAG, "Photo backup scan lost media permission", e)
            settings.recordBackupRun(System.currentTimeMillis(), null, null, 0, "沒有相簿讀取權限")
            Result.success()
        } finally {
            if (fromTrigger) PhotoBackup.scheduleContentTrigger(applicationContext, ExistingWorkPolicy.APPEND_OR_REPLACE)
        }
    }

    /** Result of one MediaStore scan. */
    private data class Scan(val uploads: List<NewUpload>, val lastMediaId: Long?, val newestAddedAt: Long?)

    private fun scan(state: PhotoBackupState): Scan {
        val collection = MediaStore.Files.getContentUri("external")
        val mediaTypes = buildList {
            add(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE)
            if (state.includeVideos) add(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO)
        }
        val projection = buildList {
            add(MediaStore.Files.FileColumns._ID)
            add(MediaStore.Files.FileColumns.MEDIA_TYPE)
            add(MediaStore.Files.FileColumns.DISPLAY_NAME)
            add(MediaStore.Files.FileColumns.MIME_TYPE)
            add(MediaStore.Files.FileColumns.SIZE)
            add(MediaStore.Files.FileColumns.DATE_ADDED)
            add(MediaStore.Files.FileColumns.DATE_MODIFIED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(MediaStore.MediaColumns.IS_PENDING)
        }.toTypedArray()
        val selection = "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (${mediaTypes.joinToString(",") { "?" }}) AND " +
            "${MediaStore.Files.FileColumns._ID} > ? AND ${MediaStore.Files.FileColumns.DATE_ADDED} >= ?"
        val args = (mediaTypes.map { it.toString() } + state.lastMediaId.toString() + (state.sinceMillis / 1000).toString())
            .toTypedArray()
        val uploads = mutableListOf<NewUpload>()
        var lastId: Long? = null
        var newest: Long? = null
        val cursor = applicationContext.contentResolver.query(
            collection, projection, selection, args, "${MediaStore.Files.FileColumns._ID} ASC",
        ) ?: throw IOException("MediaStore query returned no cursor")
        cursor.use {
            val idCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val typeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
            val nameCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
            val mimeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MIME_TYPE)
            val sizeCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
            val addedCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_ADDED)
            val modifiedCol = it.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED)
            val pendingCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) it.getColumnIndexOrThrow(MediaStore.MediaColumns.IS_PENDING) else -1
            while (it.moveToNext() && uploads.size < MAX_PER_SCAN) {
                if (pendingCol >= 0 && it.getInt(pendingCol) == 1) break
                val id = it.getLong(idCol)
                val isVideo = it.getInt(typeCol) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                val contentUri = ContentUris.withAppendedId(
                    if (isVideo) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id,
                )
                val addedAt = it.getLong(addedCol) * 1000
                uploads.add(
                    NewUpload(
                        uri = contentUri.toString(),
                        name = it.getString(nameCol) ?: "media-$id",
                        mimeType = it.getString(mimeCol) ?: if (isVideo) "video/*" else "image/*",
                        size = if (it.isNull(sizeCol)) -1 else it.getLong(sizeCol),
                        relativePath = null,
                        lastModified = it.getLong(modifiedCol) * 1000,
                        ownsFile = false,
                    ),
                )
                lastId = id
                newest = maxOf(newest ?: 0L, addedAt)
            }
        }
        return Scan(uploads, lastId, newest)
    }

    /** Input keys and limits. */
    companion object {
        private const val TAG = "FileNexusPhotoBackup"
        /** Input key: run was started by the MediaStore content trigger. */
        const val KEY_FROM_TRIGGER: String = "fromTrigger"
        private const val MAX_PER_SCAN = 500
    }
}
