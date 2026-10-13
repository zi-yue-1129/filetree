package cc.spkuan.filenexus.nativeplugin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests of [UriGrantPolicy], which decides which persisted SAF read grants to release. */
class UriGrantPolicyTest {
    private val tree = "content://com.android.externalstorage.documents/tree/primary%3APhotos"
    private val treeChild = "$tree/document/primary%3APhotos%2Fa.jpg"
    private val otherTree = "content://com.android.externalstorage.documents/tree/primary%3APhotosOld"
    private val file = "content://com.android.providers.downloads.documents/document/msf%3A42"
    private val now = 10L * UriGrantPolicy.PICK_GRACE_MS

    /** Build a job reference. */
    private fun job(uri: String, isFinal: Boolean, createdAt: Long = now - 1_000L): GrantJobRef =
        GrantJobRef(uri = uri, isFinal = isFinal, createdAt = createdAt)

    /** A tree grant covers its own child documents only, not a sibling tree sharing a prefix. */
    @Test
    fun treeGrantCoversOnlyItsOwnChildren() {
        assertTrue(UriGrantPolicy.covers(tree, treeChild))
        assertTrue(UriGrantPolicy.covers(file, file))
        assertFalse(UriGrantPolicy.covers(tree, "$otherTree/document/x"))
        assertFalse(UriGrantPolicy.covers(file, "$file/document/x"))
    }

    /** Grants still needed by queued, running or retrying uploads are kept. */
    @Test
    fun keepsGrantsReferencedByUnfinishedJobs() {
        val release = UriGrantPolicy.grantsToRelease(
            persistedGrants = listOf(tree, file),
            jobs = listOf(job(treeChild, isFinal = false), job(file, isFinal = false)),
            pickedAt = emptyMap(),
            nowMillis = now,
        )

        assertEquals(emptyList<String>(), release)
    }

    /** Once every job using a grant is completed, failed or cancelled, the grant is released. */
    @Test
    fun releasesGrantsWhoseJobsAreAllFinal() {
        val release = UriGrantPolicy.grantsToRelease(
            persistedGrants = listOf(tree, file),
            jobs = listOf(job(treeChild, isFinal = true), job("$tree/document/b", isFinal = true), job(file, isFinal = true)),
            pickedAt = mapOf(tree to now - 5_000L, file to now - 5_000L),
            nowMillis = now,
        )

        assertEquals(listOf(tree, file), release)
    }

    /** A fresh pick not yet submitted (still in the UI's pending list) keeps its grant. */
    @Test
    fun keepsRecentlyPickedGrantsWithoutJobs() {
        val release = UriGrantPolicy.grantsToRelease(
            persistedGrants = listOf(tree),
            jobs = emptyList(),
            pickedAt = mapOf(tree to now - 60_000L),
            nowMillis = now,
        )

        assertEquals(emptyList<String>(), release)
    }

    /** Re-picking a folder whose earlier upload already finished protects the new pick. */
    @Test
    fun keepsGrantRepickedAfterItsLastUpload() {
        val release = UriGrantPolicy.grantsToRelease(
            persistedGrants = listOf(tree),
            jobs = listOf(job(treeChild, isFinal = true, createdAt = now - 10_000L)),
            pickedAt = mapOf(tree to now - 1_000L),
            nowMillis = now,
        )

        assertEquals(emptyList<String>(), release)
    }

    /** Startup sweep: stale picks never submitted and orphaned grants are released. */
    @Test
    fun releasesStaleUnusedAndUnknownGrants() {
        val release = UriGrantPolicy.grantsToRelease(
            persistedGrants = listOf(tree, otherTree, file),
            jobs = listOf(job("$otherTree/document/x", isFinal = false)),
            pickedAt = mapOf(tree to now - UriGrantPolicy.PICK_GRACE_MS - 1L),
            nowMillis = now,
        )

        assertEquals(listOf(tree, file), release)
    }

    /** Pick times are kept only for grants that remain persisted and are still in their grace period. */
    @Test
    fun prunePickTimesDropsReleasedAndExpiredEntries() {
        val pruned = UriGrantPolicy.prunePickTimes(
            pickedAt = mapOf(tree to now - 1_000L, file to now - 1_000L, otherTree to now - UriGrantPolicy.PICK_GRACE_MS),
            remainingGrants = setOf(tree, otherTree),
            nowMillis = now,
        )

        assertEquals(mapOf(tree to now - 1_000L), pruned)
    }
}
