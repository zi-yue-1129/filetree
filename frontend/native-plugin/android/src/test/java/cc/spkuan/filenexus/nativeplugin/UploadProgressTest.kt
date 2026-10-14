package cc.spkuan.filenexus.nativeplugin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests of the pure notification progress math in [UploadProgress]. */
class UploadProgressTest {
    private val gib: Long = 1024L * 1024L * 1024L
    private val mib: Long = 1024L * 1024L

    /** While connecting (nothing sent yet) the bar animates instead of showing an empty track. */
    @Test
    fun barIsIndeterminateBeforeFirstByte() {
        val bar = UploadProgress.bar(sentBytes = 0L, totalBytes = 3L * gib)

        assertTrue(bar.indeterminate)
    }

    /** A few KB of a multi-GB video would round to an empty determinate bar; animate instead. */
    @Test
    fun barIsIndeterminateWhileProgressRoundsToZero() {
        val bar = UploadProgress.bar(sentBytes = 64L * 1024L, totalBytes = 3L * gib)

        assertTrue(bar.indeterminate)
    }

    /** Files above 2 GiB (Int.MAX_VALUE bytes) are scaled in Long math to a fine-grained bar. */
    @Test
    fun barScalesFilesLargerThanTwoGibWithoutOverflow() {
        val total = 5L * gib

        val half = UploadProgress.bar(sentBytes = total / 2, totalBytes = total)
        assertEquals(UploadProgress.BAR_MAX, half.max)
        assertEquals(UploadProgress.BAR_MAX / 2, half.value)
        assertFalse(half.indeterminate)

        // 0.5 % of 5 GiB must already move the bar (a 0..100 bar would still be empty).
        val small = UploadProgress.bar(sentBytes = total / 200, totalBytes = total)
        assertFalse(small.indeterminate)
        assertTrue("bar value ${small.value} should be > 0", small.value > 0)

        val almost = UploadProgress.bar(sentBytes = total - 1, totalBytes = total)
        assertTrue(almost.value < UploadProgress.BAR_MAX)

        assertEquals(UploadProgress.BAR_MAX, UploadProgress.bar(total, total).value)
    }

    /** A byte count beyond the total is clamped to a full bar. */
    @Test
    fun barClampsOvershoot() {
        val bar = UploadProgress.bar(sentBytes = 11L, totalBytes = 10L)

        assertEquals(UploadProgress.BAR_MAX, bar.value)
        assertFalse(bar.indeterminate)
    }

    /** Unknown size cannot be shown as a fraction. */
    @Test
    fun barIsIndeterminateWhenSizeUnknown() {
        assertTrue(UploadProgress.bar(sentBytes = 5L * mib, totalBytes = -1L).indeterminate)
    }

    /** The first update is always posted so the notification switches from "準備上傳…" at once. */
    @Test
    fun firstUpdateIsAlwaysPosted() {
        assertTrue(UploadProgress.shouldPost(nowMs = 100L, lastPostedAtMs = null, lastPostedBytes = 0L, sentBytes = 0L, totalBytes = gib))
    }

    /** Updates inside the throttle window are dropped (Android rate-limits notification updates). */
    @Test
    fun updatesInsideThrottleWindowAreDropped() {
        assertFalse(
            UploadProgress.shouldPost(
                nowMs = 10_000L + UploadProgress.MIN_POST_INTERVAL_MS - 1,
                lastPostedAtMs = 10_000L,
                lastPostedBytes = mib,
                sentBytes = 2L * mib,
                totalBytes = gib,
            ),
        )
    }

    /** After the throttle window, a changed byte count is posted. */
    @Test
    fun changedProgressAfterWindowIsPosted() {
        assertTrue(
            UploadProgress.shouldPost(
                nowMs = 10_000L + UploadProgress.MIN_POST_INTERVAL_MS,
                lastPostedAtMs = 10_000L,
                lastPostedBytes = mib,
                sentBytes = 2L * mib,
                totalBytes = gib,
            ),
        )
    }

    /** Re-posting an unchanged notification only burns the rate limit. */
    @Test
    fun unchangedProgressIsNotReposted() {
        assertFalse(
            UploadProgress.shouldPost(
                nowMs = 60_000L,
                lastPostedAtMs = 10_000L,
                lastPostedBytes = mib,
                sentBytes = mib,
                totalBytes = gib,
            ),
        )
    }

    /** Completion is shown even inside the throttle window. */
    @Test
    fun completionBypassesThrottle() {
        assertTrue(UploadProgress.shouldPost(nowMs = 10_001L, lastPostedAtMs = 10_000L, lastPostedBytes = mib, sentBytes = gib, totalBytes = gib))
    }

    /** A wall clock that jumped backwards must not freeze updates for the rest of the upload. */
    @Test
    fun clockGoingBackwardsDoesNotFreezeUpdates() {
        assertTrue(UploadProgress.shouldPost(nowMs = 5_000L, lastPostedAtMs = 10_000L, lastPostedBytes = mib, sentBytes = 2L * mib, totalBytes = gib))
    }

    /** Sizes use binary units with one rounded decimal. */
    @Test
    fun formatBytesUsesBinaryUnits() {
        assertEquals("0 B", UploadProgress.formatBytes(0L))
        assertEquals("1023 B", UploadProgress.formatBytes(1023L))
        assertEquals("1.0 KB", UploadProgress.formatBytes(1024L))
        assertEquals("12.3 MB", UploadProgress.formatBytes((12.3 * mib).toLong()))
        // Rounding up to 1024.0 KB promotes to the next unit instead.
        assertEquals("1.0 MB", UploadProgress.formatBytes(mib - 1))
        assertEquals("4.5 GB", UploadProgress.formatBytes(4L * gib + gib / 2))
    }

    /** Detail line shows sent / total, percent and the other queued jobs. */
    @Test
    fun detailTextShowsBytesPercentAndRemainingJobs() {
        val total = 1228L * mib
        val sent = 15L * mib

        assertEquals("15.0 MB / 1.2 GB（1%） · 還有 2 個待上傳", UploadProgress.detailText(sent, total, otherPendingJobs = 2))
    }

    /** Below 1 % the percent keeps one decimal so slow uploads visibly move. */
    @Test
    fun detailTextShowsFractionalPercentBelowOnePercent() {
        assertEquals("15.3 MB / 3.0 GB（0.4%）", UploadProgress.detailText((15.3 * mib).toLong() + 1, 3L * gib, otherPendingJobs = 0))
    }

    /** With an unknown size only the sent bytes are shown. */
    @Test
    fun detailTextWithUnknownSize() {
        assertEquals("已傳送 5.0 MB", UploadProgress.detailText(5L * mib, -1L, otherPendingJobs = 0))
    }
}
