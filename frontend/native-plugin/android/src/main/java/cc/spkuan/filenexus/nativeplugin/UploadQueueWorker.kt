package cc.spkuan.filenexus.nativeplugin

import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * WorkManager runner that drains one upload queue (any network or Wi-Fi only)
 * job by job, as a foreground service with a progress notification.
 *
 * Resumable across process death: each job's TUS URL is persisted, and the
 * next run asks the server for the offset (`HEAD`) before continuing.
 * Transient failures make the whole run return [Result.retry] so WorkManager
 * applies exponential backoff; a job fails permanently after [MAX_ATTEMPTS]
 * or on non-retryable HTTP errors (e.g. 401 revoked token).
 */
class UploadQueueWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val wifiOnly: Boolean = params.inputData.getBoolean(KEY_WIFI_ONLY, false)
    private val notificationId: Int = if (wifiOnly) Notifications.ID_QUEUE_WIFI else Notifications.ID_QUEUE_ANY
    private val store: UploadStore = UploadStore.get(context)

    /** Outcome of one job attempt. */
    private enum class Outcome { COMPLETED, FAILED, TRANSIENT, CANCELLED, STOPPED }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val credentials = NativeSettings(applicationContext).credentials()
        if (!credentials.isConfigured) {
            Log.i(TAG, "Upload queue paused: device is not signed in")
            return@withContext Result.success()
        }
        promoteToForeground(Notifications.progress(applicationContext, "準備上傳…", "", null))

        val handled = mutableSetOf<String>()
        val completedNames = mutableListOf<String>()
        val failures = mutableListOf<String>()
        var retryLater = false
        queue@ while (!isStopped) {
            val job = store.nextRunnable(wifiOnly, handled) ?: break
            handled.add(job.jobId)
            when (runJob(job, credentials)) {
                Outcome.COMPLETED -> completedNames.add(job.name)
                Outcome.FAILED -> failures.add(job.name)
                Outcome.TRANSIENT -> {
                    // Usually the network or server is down; back off for the
                    // whole queue instead of burning attempts on every job.
                    retryLater = true
                    break@queue
                }
                Outcome.CANCELLED -> Unit
                Outcome.STOPPED -> break@queue
            }
        }
        Notifications.cancel(applicationContext, notificationId)
        postSummary(completedNames, failures)
        if (isStopped || retryLater) Result.retry() else Result.success()
    }

    override suspend fun getForegroundInfo(): ForegroundInfo =
        foregroundInfo(Notifications.progress(applicationContext, "準備上傳…", "", null))

    private fun foregroundInfo(notification: android.app.Notification): ForegroundInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(notificationId, notification)
        }

    private suspend fun promoteToForeground(notification: android.app.Notification) {
        try {
            setForeground(foregroundInfo(notification))
        } catch (e: IllegalStateException) {
            // Android 12+ forbids starting a foreground service while the app is
            // in the background (e.g. a content-triggered photo backup). The run
            // still proceeds as a normal worker; WorkManager stops it after ~10
            // minutes and the next run resumes from the server offset.
            Log.e(TAG, "Could not promote upload worker to foreground; continuing in background", e)
        }
    }

    private fun runJob(initial: UploadJobRecord, credentials: DeviceCredentials): Outcome {
        val jobId = initial.jobId
        if (UploadQueue.cancelledJobIds.contains(jobId)) return Outcome.CANCELLED
        var job = store.update(jobId, state = UploadState.UPLOADING, clearError = true) ?: return Outcome.CANCELLED
        NativeEvents.emitUploadProgress(job)
        val queuePosition = "${store.all().count { it.state.isFinal.not() && it.wifiOnly == wifiOnly }} 個待上傳"
        var lastReport = 0L
        try {
            val size = if (job.bytesTotal >= 0) job.bytesTotal else resolveSize(job)
            if (size != job.bytesTotal) job = store.update(jobId, bytesTotal = size) ?: return Outcome.CANCELLED
            val tus = TusClient(Http.client, checkNotNull(credentials.serverUrl))
            var uploadUrl = job.uploadUrl
            var offset = uploadUrl?.let { tus.getOffset(it) }
            if (uploadUrl == null || offset == null) {
                uploadUrl = tus.create(size, metadataFor(job, credentials))
                store.update(jobId, uploadUrl = uploadUrl)
                // The backend may hand back an existing partial upload (same fingerprint).
                offset = tus.getOffset(uploadUrl) ?: 0L
            }
            val isCancelled = { UploadQueue.cancelledJobIds.contains(jobId) || isStopped }
            if (offset < size) {
                openSource(job).use { input ->
                    TusClient.skipFully(input, offset)
                    tus.upload(uploadUrl, offset, size, input, CHUNK_SIZE, { sent ->
                        val now = System.currentTimeMillis()
                        if (now - lastReport >= PROGRESS_INTERVAL_MS || sent == size) {
                            lastReport = now
                            reportProgress(jobId, sent, size, job.name, queuePosition)
                        }
                    }, isCancelled)
                }
            }
            val done = store.update(jobId, state = UploadState.COMPLETED, bytesSent = size, clearError = true)
                ?: return Outcome.CANCELLED
            NativeEvents.emitUploadProgress(done)
            UploadQueue.deleteOwnedFile(done)
            return Outcome.COMPLETED
        } catch (e: TusCancelledException) {
            if (UploadQueue.cancelledJobIds.contains(jobId)) {
                Log.i(TAG, "Upload $jobId cancelled by the user", e)
                return Outcome.CANCELLED
            }
            Log.i(TAG, "Upload $jobId paused because WorkManager stopped the run", e)
            store.update(jobId, state = UploadState.QUEUED)?.let(NativeEvents::emitUploadProgress)
            return Outcome.STOPPED
        } catch (e: TusHttpException) {
            if (e.statusCode == 404 || e.statusCode == 410) {
                // Server forgot the upload (expired); recreate it on the next attempt.
                Log.e(TAG, "Upload $jobId vanished on the server; will recreate", e)
                return transientFailure(jobId, e, clearUploadUrl = true)
            }
            if (e.isRetryable || e.statusCode == 409) return transientFailure(jobId, e, clearUploadUrl = false)
            return permanentFailure(jobId, e, describeHttpError(e))
        } catch (e: FileNotFoundException) {
            return permanentFailure(jobId, e, "找不到來源檔案：${e.message}")
        } catch (e: SecurityException) {
            return permanentFailure(jobId, e, "沒有讀取來源檔案的權限")
        } catch (e: IOException) {
            return transientFailure(jobId, e, clearUploadUrl = false)
        }
    }

    private fun reportProgress(jobId: String, sent: Long, size: Long, name: String, queueText: String) {
        store.update(jobId, bytesSent = sent)?.let(NativeEvents::emitUploadProgress)
        val percent = if (size > 0) ((sent * 100) / size).toInt() else null
        Notifications.postBuilt(
            applicationContext,
            notificationId,
            Notifications.progress(applicationContext, "正在上傳 $name", queueText, percent),
        )
    }

    private fun transientFailure(jobId: String, error: Exception, clearUploadUrl: Boolean): Outcome {
        val job = store.get(jobId) ?: return Outcome.CANCELLED
        val attempts = job.attempts + 1
        if (attempts >= MAX_ATTEMPTS) {
            return permanentFailure(jobId, error, "重試 $attempts 次後仍失敗：${error.message}")
        }
        Log.e(TAG, "Upload $jobId attempt $attempts failed; will retry with backoff", error)
        store.update(
            jobId,
            state = UploadState.RETRYING,
            attempts = attempts,
            error = error.message ?: error.javaClass.simpleName,
            clearUploadUrl = clearUploadUrl,
        )?.let(NativeEvents::emitUploadProgress)
        return Outcome.TRANSIENT
    }

    private fun permanentFailure(jobId: String, error: Exception, message: String): Outcome {
        Log.e(TAG, "Upload $jobId failed permanently: $message", error)
        val job = store.update(jobId, state = UploadState.FAILED, error = message) ?: return Outcome.CANCELLED
        NativeEvents.emitUploadProgress(job)
        UploadQueue.deleteOwnedFile(job)
        return Outcome.FAILED
    }

    private fun describeHttpError(e: TusHttpException): String = when (e.statusCode) {
        401, 403 -> "伺服器拒絕上傳（裝置可能已登出，請到設定重新登入）"
        413 -> "檔案太大，伺服器拒絕接收"
        else -> "伺服器錯誤 HTTP ${e.statusCode}"
    }

    private fun metadataFor(job: UploadJobRecord, credentials: DeviceCredentials): Map<String, String> =
        buildMap {
            put("filename", job.name)
            put("filetype", job.mimeType)
            put("token", checkNotNull(credentials.deviceToken))
            job.folderId?.let { put("folder_id", it) }
            job.relativePath?.takeIf { it.isNotBlank() }?.let { put("relativePath", it) }
            job.lastModified?.let { put("lastModified", it.toString()) }
        }

    private fun openSource(job: UploadJobRecord): InputStream {
        val uri = Uri.parse(job.uri)
        return if (uri.scheme == "file") {
            File(checkNotNull(uri.path) { "file URI without path: ${job.uri}" }).inputStream()
        } else {
            applicationContext.contentResolver.openInputStream(uri)
                ?: throw FileNotFoundException("Content provider returned no stream for ${job.uri}")
        }
    }

    private fun resolveSize(job: UploadJobRecord): Long {
        val uri = Uri.parse(job.uri)
        if (uri.scheme == "file") {
            val file = File(checkNotNull(uri.path))
            if (!file.exists()) throw FileNotFoundException(file.absolutePath)
            return file.length()
        }
        applicationContext.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index)
            }
        }
        applicationContext.contentResolver.openAssetFileDescriptor(uri, "r")?.use { descriptor ->
            if (descriptor.length >= 0) return descriptor.length
        }
        throw IOException("Cannot determine the size of ${job.name}; the server requires Upload-Length")
    }

    private fun postSummary(completed: List<String>, failures: List<String>) {
        if (completed.isNotEmpty()) {
            val text = if (completed.size == 1) completed.first() else "${completed.first()} 等 ${completed.size} 個檔案"
            Notifications.post(applicationContext, Notifications.CHANNEL_RESULTS, Notifications.ID_RESULT, "上傳完成", text)
        }
        if (failures.isNotEmpty()) {
            val text = if (failures.size == 1) failures.first() else "${failures.first()} 等 ${failures.size} 個檔案"
            Notifications.post(applicationContext, Notifications.CHANNEL_RESULTS, Notifications.ID_FAILURE, "上傳失敗", text)
        }
    }

    /** Input keys and tuning constants. */
    companion object {
        /** Work tag shared by both queue runners. */
        const val TAG: String = "FileNexusUploadWorker"
        /** Input key: which queue this runner drains. */
        const val KEY_WIFI_ONLY: String = "wifiOnly"
        /** Bytes per PATCH request. */
        const val CHUNK_SIZE: Int = 5 * 1024 * 1024
        /** Attempts before a job is marked failed. */
        const val MAX_ATTEMPTS: Int = 10
        private const val PROGRESS_INTERVAL_MS: Long = 500
    }
}
