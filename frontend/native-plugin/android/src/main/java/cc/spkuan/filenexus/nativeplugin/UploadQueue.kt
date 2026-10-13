package cc.spkuan.filenexus.nativeplugin

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * A file to add to the upload queue.
 *
 * @property uri Source URI (`content://` or `file://`).
 * @property name Server file name.
 * @property mimeType MIME type.
 * @property size Size in bytes, or `-1` to resolve later.
 * @property relativePath Optional folder-relative path.
 * @property lastModified Optional modification time (epoch ms).
 * @property ownsFile Whether [uri] is an app-private copy to delete when done.
 */
data class NewUpload(
    val uri: String,
    val name: String,
    val mimeType: String,
    val size: Long,
    val relativePath: String?,
    val lastModified: Long?,
    val ownsFile: Boolean,
)

/**
 * Facade over the persisted job store and the two WorkManager queue runners
 * (any network / unmetered only).
 */
object UploadQueue {
    private const val TAG = "FileNexusUploadQueue"
    private const val WORK_ANY = "filenexus-upload-queue-any"
    private const val WORK_WIFI = "filenexus-upload-queue-wifi"

    /** Job ids the user cancelled while the runner may be mid-upload. */
    val cancelledJobIds: MutableSet<String> = ConcurrentHashMap.newKeySet()

    private val background = Executors.newSingleThreadExecutor()

    /**
     * Persist new jobs and start the matching queue runner.
     *
     * @param files Files to upload.
     * @param folderId Destination folder id or `null` for the root.
     * @param source `app`, `share` or `backup`.
     * @param wifiOnly Restrict to unmetered networks.
     * @return Job ids in input order.
     */
    fun enqueue(context: Context, files: List<NewUpload>, folderId: String?, source: String, wifiOnly: Boolean): List<String> {
        val store = UploadStore.get(context)
        val now = System.currentTimeMillis()
        val ids = files.map { file ->
            val job = UploadJobRecord(
                jobId = UUID.randomUUID().toString(),
                uri = file.uri,
                name = file.name,
                mimeType = file.mimeType.ifBlank { "application/octet-stream" },
                relativePath = file.relativePath,
                lastModified = file.lastModified,
                folderId = folderId,
                source = source,
                wifiOnly = wifiOnly,
                ownsFile = file.ownsFile,
                state = UploadState.QUEUED,
                bytesSent = 0,
                bytesTotal = file.size,
                uploadUrl = null,
                attempts = 0,
                error = null,
                createdAt = now,
                updatedAt = now,
            )
            store.insert(job)
            NativeEvents.emitUploadProgress(job)
            job.jobId
        }
        kick(context)
        return ids
    }

    /**
     * Ensure a runner is scheduled for each queue that has runnable jobs.
     * Safe to call often; an existing runner is chained, not duplicated.
     */
    fun kick(context: Context) {
        val store = UploadStore.get(context)
        if (store.hasRunnable(wifiOnly = false)) schedule(context, wifiOnly = false)
        if (store.hasRunnable(wifiOnly = true)) schedule(context, wifiOnly = true)
    }

    private fun schedule(context: Context, wifiOnly: Boolean) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
            .build()
        val request = OneTimeWorkRequestBuilder<UploadQueueWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf(UploadQueueWorker.KEY_WIFI_ONLY to wifiOnly))
            .addTag(UploadQueueWorker.TAG)
            .build()
        // APPEND_OR_REPLACE: a runner already looping picks new jobs up itself;
        // the appended run covers the race where it was just finishing.
        WorkManager.getInstance(context).enqueueUniqueWork(
            if (wifiOnly) WORK_WIFI else WORK_ANY,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request,
        )
    }

    /**
     * Cancel a job: mark it cancelled, stop an in-flight transfer and
     * terminate the server-side upload in the background.
     *
     * @return `false` when the job does not exist.
     */
    fun cancel(context: Context, jobId: String): Boolean {
        val store = UploadStore.get(context)
        val job = store.get(jobId) ?: return false
        if (job.state.isFinal) return true
        cancelledJobIds.add(jobId)
        val updated = store.update(jobId, state = UploadState.CANCELLED, clearError = true) ?: return false
        NativeEvents.emitUploadProgress(updated)
        val credentials = NativeSettings(context).credentials()
        background.execute {
            val uploadUrl = job.uploadUrl
            if (uploadUrl != null && credentials.isConfigured) {
                try {
                    TusClient(Http.client, checkNotNull(credentials.serverUrl)).terminate(uploadUrl)
                } catch (e: java.io.IOException) {
                    // The server also expires stale uploads after a day; the
                    // job itself is already cancelled locally.
                    Log.e(TAG, "Failed to terminate cancelled upload $jobId on the server", e)
                }
            }
            deleteOwnedFile(job)
            UriGrants.releaseUnused(context)
        }
        return true
    }

    /** Drop finished jobs and their app-private copies. */
    fun clearFinished(context: Context) {
        val removed = UploadStore.get(context).deleteFinished()
        removed.forEach { cancelledJobIds.remove(it.jobId) }
        background.execute {
            removed.forEach(::deleteOwnedFile)
            UriGrants.releaseUnused(context)
        }
    }

    /**
     * Delete the app-private copy behind a job, if the job owns it.
     *
     * @param job Job whose source should be removed.
     */
    fun deleteOwnedFile(job: UploadJobRecord) {
        if (!job.ownsFile) return
        val path = Uri.parse(job.uri).path ?: return
        val file = File(path)
        if (file.exists() && !file.delete()) {
            Log.e(TAG, "Could not delete temporary upload copy ${file.absolutePath}")
        }
        val parent = file.parentFile
        if (parent != null && parent.list()?.isEmpty() == true && !parent.delete()) {
            Log.e(TAG, "Could not delete empty share directory ${parent.absolutePath}")
        }
    }
}
