package cc.spkuan.filenexus.nativeplugin

import java.util.Locale

/**
 * Pure progress math for the upload notification (no Android types, so it is
 * unit-tested on the JVM).
 *
 * The bar uses per-mille resolution computed in `Long` arithmetic, so files
 * larger than 2 GiB never overflow and a multi-GB video visibly moves after
 * 0.1 % instead of 1 %. While the fraction still rounds to zero (connecting,
 * or a slow uplink on a huge file) the bar is indeterminate: an empty
 * determinate track looks frozen, which is what users reported.
 */
object UploadProgress {
    /** Resolution of the notification progress bar (`setProgress` max): per-mille. */
    const val BAR_MAX: Int = 1000

    /** Minimum time between two notification updates (Android drops bursts above ~5/s). */
    const val MIN_POST_INTERVAL_MS: Long = 500

    private const val BYTES_PER_UNIT: Double = 1024.0
    private val UNITS: List<String> = listOf("B", "KB", "MB", "GB", "TB")

    /**
     * Arguments for `NotificationCompat.Builder.setProgress`.
     *
     * @property max Bar maximum.
     * @property value Bar position in `0..max`.
     * @property indeterminate Whether the bar animates instead of showing [value].
     */
    data class Bar(val max: Int, val value: Int, val indeterminate: Boolean)

    /**
     * Fraction sent in per-mille, clamped to `0..BAR_MAX`.
     *
     * @param sentBytes Bytes sent so far.
     * @param totalBytes File size in bytes; must be positive.
     * @return Per-mille in `0..BAR_MAX`.
     */
    private fun perMille(sentBytes: Long, totalBytes: Long): Int {
        require(totalBytes > 0) { "totalBytes must be positive, was $totalBytes" }
        val clampedSent = sentBytes.coerceIn(0L, totalBytes)
        if (clampedSent == totalBytes) return BAR_MAX
        // Long math: sent * 1000 only overflows for files above ~9 PB.
        return ((clampedSent * BAR_MAX) / totalBytes).toInt()
    }

    /**
     * Compute the progress bar for an upload.
     *
     * @param sentBytes Bytes sent so far (absolute, including a resumed offset).
     * @param totalBytes File size in bytes, or a value `<= 0` when unknown.
     * @return Bar arguments; indeterminate when the size is unknown or the
     * fraction still rounds to zero.
     */
    fun bar(sentBytes: Long, totalBytes: Long): Bar {
        if (totalBytes <= 0) return Bar(BAR_MAX, 0, indeterminate = true)
        val value = perMille(sentBytes, totalBytes)
        return Bar(BAR_MAX, value, indeterminate = value == 0)
    }

    /**
     * Decide whether a progress callback should refresh the notification.
     *
     * @param nowMs Current wall-clock time in milliseconds.
     * @param lastPostedAtMs When the notification was last refreshed, or `null` if never.
     * @param lastPostedBytes Byte count shown by the last refresh.
     * @param sentBytes Bytes sent now.
     * @param totalBytes File size in bytes.
     * @return `true` for the first update, for completion, and for a changed
     * byte count once [MIN_POST_INTERVAL_MS] has passed (or the clock went backwards).
     */
    fun shouldPost(nowMs: Long, lastPostedAtMs: Long?, lastPostedBytes: Long, sentBytes: Long, totalBytes: Long): Boolean {
        if (lastPostedAtMs == null) return true
        if (totalBytes > 0 && sentBytes >= totalBytes && lastPostedBytes < totalBytes) return true
        if (sentBytes == lastPostedBytes) return false
        val elapsed = nowMs - lastPostedAtMs
        return elapsed < 0 || elapsed >= MIN_POST_INTERVAL_MS
    }

    /**
     * Format a byte count for display with binary units and one decimal.
     *
     * @param bytes Byte count (non-negative).
     * @return Human-readable size, e.g. `12.3 MB`.
     */
    fun formatBytes(bytes: Long): String {
        require(bytes >= 0) { "bytes must be non-negative, was $bytes" }
        var value = bytes.toDouble()
        var unit = 0
        // Promote when one-decimal rounding would print 1024.0 of the current unit.
        while (value >= BYTES_PER_UNIT - 0.05 && unit < UNITS.lastIndex) {
            value /= BYTES_PER_UNIT
            unit++
        }
        return if (unit == 0) "$bytes B" else String.format(Locale.ROOT, "%.1f %s", value, UNITS[unit])
    }

    /**
     * Percent label: one decimal below 1 % (so slow uploads visibly move), integer above.
     *
     * @param perMille Fraction in `0..BAR_MAX`.
     * @return Label such as `0.4%` or `12%`.
     */
    private fun percentLabel(perMille: Int): String =
        if (perMille < 10) "0.$perMille%" else "${perMille / 10}%"

    /**
     * Detail line of the upload notification.
     *
     * @param sentBytes Bytes sent so far.
     * @param totalBytes File size in bytes, or `<= 0` when unknown.
     * @param otherPendingJobs Unfinished jobs in this queue besides the current one.
     * @return Text for `setContentText`, e.g. `15.0 MB / 1.2 GB（1%） · 還有 2 個待上傳`.
     */
    fun detailText(sentBytes: Long, totalBytes: Long, otherPendingJobs: Int): String {
        val sent = formatBytes(sentBytes.coerceAtLeast(0L))
        val progress = if (totalBytes > 0) {
            "$sent / ${formatBytes(totalBytes)}（${percentLabel(perMille(sentBytes, totalBytes))}）"
        } else {
            "已傳送 $sent"
        }
        return if (otherPendingJobs > 0) "$progress · 還有 $otherPendingJobs 個待上傳" else progress
    }
}
