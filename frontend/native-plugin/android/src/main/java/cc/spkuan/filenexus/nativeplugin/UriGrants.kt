package cc.spkuan.filenexus.nativeplugin

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.net.toUri

/**
 * What [UriGrantPolicy] needs to know about one upload job.
 *
 * @property uri Source URI of the job.
 * @property isFinal Whether the job is completed, failed or cancelled.
 * @property createdAt Enqueue time (epoch ms).
 */
data class GrantJobRef(
    val uri: String,
    val isFinal: Boolean,
    val createdAt: Long,
)

/**
 * Pure decision logic for persisted Storage Access Framework read grants.
 *
 * `pickFiles` persists one grant per document and `pickFolder` one per tree.
 * Android caps persisted grants per app (128, or 512 from Android 11), so a
 * grant is released once nothing needs it any more. A grant is needed while
 * an unfinished upload reads through it, or while a recent pick has not been
 * enqueued yet (it may still sit in the UI's pending list).
 *
 * Photo backup reads through MediaStore and the share sheet copies into app
 * storage, so neither holds a persisted grant this policy could release.
 */
object UriGrantPolicy {
    /** How long a picked-but-not-enqueued grant is kept (24 h). */
    const val PICK_GRACE_MS: Long = 24L * 60L * 60L * 1000L

    private val TREE_URI = Regex("^content://[^/]+/tree/[^/]+$")

    /**
     * Whether a persisted grant gives read access to a job's URI.
     *
     * @param grantUri Persisted grant URI (document or tree).
     * @param jobUri Upload source URI.
     * @return `true` for the same document, or a child document of a tree grant.
     */
    fun covers(grantUri: String, jobUri: String): Boolean =
        jobUri == grantUri || (TREE_URI.matches(grantUri) && jobUri.startsWith("$grantUri/document/"))

    /**
     * Select the grants that may be released.
     *
     * @param persistedGrants URIs of the app's persisted read grants.
     * @param jobs Every known upload job.
     * @param pickedAt Pick time (epoch ms) per grant URI recorded by the pickers.
     * @param nowMillis Current time (epoch ms).
     * @param graceMillis How long an unsubmitted pick stays protected.
     * @return Grants to release, in [persistedGrants] order.
     */
    fun grantsToRelease(
        persistedGrants: Collection<String>,
        jobs: Collection<GrantJobRef>,
        pickedAt: Map<String, Long>,
        nowMillis: Long,
        graceMillis: Long = PICK_GRACE_MS,
    ): List<String> = persistedGrants.filter { grant ->
        val covered = jobs.filter { covers(grant, it.uri) }
        val inUse = covered.any { !it.isFinal }
        val pick = pickedAt[grant]
        // A pick newer than the last enqueue through this grant is still pending in the UI.
        val pendingPick = pick != null && nowMillis - pick < graceMillis &&
            pick > (covered.maxOfOrNull { it.createdAt } ?: Long.MIN_VALUE)
        !inUse && !pendingPick
    }

    /**
     * Drop pick times that can no longer protect anything.
     *
     * @param pickedAt Current pick times.
     * @param remainingGrants Grants still persisted after releasing.
     * @param nowMillis Current time (epoch ms).
     * @param graceMillis Grace period, as in [grantsToRelease].
     * @return Entries for remaining grants still inside the grace period.
     */
    fun prunePickTimes(
        pickedAt: Map<String, Long>,
        remainingGrants: Set<String>,
        nowMillis: Long,
        graceMillis: Long = PICK_GRACE_MS,
    ): Map<String, Long> = pickedAt.filter { (uri, time) -> uri in remainingGrants && nowMillis - time < graceMillis }
}

/** Android glue applying [UriGrantPolicy] to the content resolver. */
object UriGrants {
    private const val TAG = "FileNexusUriGrants"

    /**
     * Persist read access to a picked document or tree and remember when it was picked.
     *
     * @param context Any context.
     * @param uri Document or tree URI returned by the picker.
     */
    @Synchronized
    fun persistPicked(context: Context, uri: Uri) {
        try {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: SecurityException) {
            // Provider does not offer persistable grants; the temporary grant
            // still covers uploads while this process lives.
            Log.e(TAG, "Could not persist read permission for $uri", e)
            return
        }
        val settings = NativeSettings(context)
        settings.savePickedGrants(settings.pickedGrants() + (uri.toString() to System.currentTimeMillis()))
    }

    /**
     * Release every persisted read grant no upload or pending pick needs.
     * Called at plugin load, when a queue run ends and after cancel/clear.
     *
     * @param context Any context.
     */
    @Synchronized
    fun releaseUnused(context: Context) {
        val resolver = context.contentResolver
        val persisted = resolver.persistedUriPermissions.filter { it.isReadPermission }.map { it.uri.toString() }
        val jobs = UploadStore.get(context).all().map { GrantJobRef(it.uri, it.state.isFinal, it.createdAt) }
        val settings = NativeSettings(context)
        val pickedAt = settings.pickedGrants()
        val now = System.currentTimeMillis()
        val released = mutableSetOf<String>()
        UriGrantPolicy.grantsToRelease(persisted, jobs, pickedAt, now).forEach { grant ->
            try {
                resolver.releasePersistableUriPermission(grant.toUri(), Intent.FLAG_GRANT_READ_URI_PERMISSION)
                released += grant
            } catch (e: SecurityException) {
                // The provider already revoked it; nothing left to release.
                Log.e(TAG, "Could not release read permission for $grant", e)
            }
        }
        if (released.isNotEmpty()) Log.i(TAG, "Released ${released.size} unused URI grant(s)")
        settings.savePickedGrants(UriGrantPolicy.prunePickTimes(pickedAt, persisted.toSet() - released, now))
    }
}
