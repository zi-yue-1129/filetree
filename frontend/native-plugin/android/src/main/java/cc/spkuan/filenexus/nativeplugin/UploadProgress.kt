package cc.spkuan.filenexus.nativeplugin

/**
 * Pure progress math for the upload notification (no Android types, so it is
 * unit-tested on the JVM).
 *
 * NOTE: first revision is a straight port of the logic previously inlined in
 * [UploadQueueWorker.reportProgress]; it is replaced in the next commit.
 */
object UploadProgress {
    /** Resolution of the notification progress bar (`setProgress` max). */
    const val BAR_MAX: Int = 100

    /** Minimum time between two notification updates. */
    const val MIN_POST_INTERVAL_MS: Long = 500

    /**
     * Arguments for `NotificationCompat.Builder.setProgress`.
     *
     * @property max Bar maximum.
     * @property value Bar position in `0..max`.
     * @property indeterminate Whether the bar animates instead of showing [value].
     */
    data class Bar(val max: Int, val value: Int, val indeterminate: Boolean)

    /**
     * Compute the progress bar for an upload.
     *
     * @param sentBytes Bytes sent so far (absolute, including a resumed offset).
     * @param totalBytes File size in bytes, or a value `<= 0` when unknown.
     * @return Bar arguments.
     */
    fun bar(sentBytes: Long, totalBytes: Long): Bar {
        val percent = if (totalBytes > 0) ((sentBytes * 100) / totalBytes).toInt() else null
        return Bar(BAR_MAX, percent ?: 0, percent == null)
    }

    /**
     * Decide whether a progress callback should refresh the notification.
     *
     * @param nowMs Current wall-clock time in milliseconds.
     * @param lastPostedAtMs When the notification was last refreshed, or `null` if never.
     * @param lastPostedBytes Byte count shown by the last refresh.
     * @param sentBytes Bytes sent now.
     * @param totalBytes File size in bytes.
     * @return `true` when the notification should be re-posted.
     */
    fun shouldPost(nowMs: Long, lastPostedAtMs: Long?, lastPostedBytes: Long, sentBytes: Long, totalBytes: Long): Boolean =
        nowMs - (lastPostedAtMs ?: 0L) >= MIN_POST_INTERVAL_MS || sentBytes == totalBytes

    /**
     * Format a byte count for display.
     *
     * @param bytes Byte count.
     * @return Human-readable size.
     */
    fun formatBytes(bytes: Long): String = "$bytes B"

    /**
     * Detail line of the upload notification.
     *
     * @param sentBytes Bytes sent so far.
     * @param totalBytes File size in bytes, or `<= 0` when unknown.
     * @param otherPendingJobs Unfinished jobs in this queue besides the current one.
     * @return Text for `setContentText`.
     */
    fun detailText(sentBytes: Long, totalBytes: Long, otherPendingJobs: Int): String =
        "${otherPendingJobs + 1} 個待上傳"
}
