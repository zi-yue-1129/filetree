package cc.spkuan.filenexus.nativeplugin

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.core.content.edit
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * A share-sheet file copied into app storage.
 *
 * @property id Unique id.
 * @property file App-private copy.
 * @property name Original display name.
 * @property mimeType MIME type.
 * @property receivedAt Receive time (epoch ms).
 */
data class SharedFile(
    val id: String,
    val file: File,
    val name: String,
    val mimeType: String,
    val receivedAt: Long,
) {
    /** `file://` URI of the copy. */
    val uri: String
        get() = Uri.fromFile(file).toString()

    /** Serialize as the `SharedItem` interface of definitions.ts. */
    fun toJs(): JSObject = JSObject().apply {
        put("id", id)
        put("uri", uri)
        put("name", name)
        put("mimeType", mimeType)
        put("size", file.length())
        put("receivedAt", receivedAt)
    }

    /** Convert to a queue entry that owns (deletes) the copy when done. */
    fun toNewUpload(): NewUpload = NewUpload(
        uri = uri,
        name = name,
        mimeType = mimeType,
        size = file.length(),
        relativePath = null,
        lastModified = receivedAt,
        ownsFile = true,
    )
}

/**
 * Pending share-sheet items kept while no device token is configured, so the
 * UI can ask the user to sign in and then upload them.
 */
class SharedItemStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Directory holding copies of shared files. */
    val rootDir: File = File(context.applicationContext.filesDir, "shared")

    /** All pending items (missing copies are dropped and logged). */
    @Synchronized
    fun all(): List<SharedFile> {
        val array = JSONArray(prefs.getString(KEY_ITEMS, "[]"))
        val items = (0 until array.length()).map { index ->
            val obj = array.getJSONObject(index)
            SharedFile(
                id = obj.getString("id"),
                file = File(obj.getString("path")),
                name = obj.getString("name"),
                mimeType = obj.getString("mimeType"),
                receivedAt = obj.getLong("receivedAt"),
            )
        }
        val (present, missing) = items.partition { it.file.exists() }
        if (missing.isNotEmpty()) {
            Log.e(TAG, "Dropping ${missing.size} shared items whose copies were deleted: ${missing.map { it.file }}")
            save(present)
        }
        return present
    }

    /** Append items. */
    @Synchronized
    fun add(items: List<SharedFile>) {
        save(all() + items)
    }

    /**
     * Remove items (and delete their copies).
     *
     * @param ids Ids to remove, or `null` for all.
     */
    @Synchronized
    fun remove(ids: Collection<String>?) {
        val (removed, kept) = all().partition { ids == null || it.id in ids }
        removed.forEach { item ->
            if (!item.file.delete()) Log.e(TAG, "Could not delete shared copy ${item.file}")
            val parent = item.file.parentFile
            if (parent != null && parent.list()?.isEmpty() == true && !parent.delete()) {
                Log.e(TAG, "Could not delete shared directory $parent")
            }
        }
        save(kept)
    }

    /**
     * Forget items without deleting their copies (they were handed to the upload queue).
     *
     * @param ids Ids to forget.
     */
    @Synchronized
    fun forget(ids: Collection<String>) {
        save(all().filterNot { it.id in ids })
    }

    private fun save(items: List<SharedFile>) {
        val array = JSONArray()
        items.forEach { item ->
            array.put(
                JSONObject()
                    .put("id", item.id)
                    .put("path", item.file.absolutePath)
                    .put("name", item.name)
                    .put("mimeType", item.mimeType)
                    .put("receivedAt", item.receivedAt),
            )
        }
        prefs.edit(commit = true) { putString(KEY_ITEMS, array.toString()) }
    }

    /** Helpers for building JS payloads. */
    companion object {
        private const val TAG = "FileNexusShared"
        private const val PREFS_NAME = "filenexus_shared"
        private const val KEY_ITEMS = "items"

        /** Serialize items as a JS array. */
        fun toJsArray(items: List<SharedFile>): JSArray = JSArray().apply { items.forEach { put(it.toJs()) } }
    }
}
