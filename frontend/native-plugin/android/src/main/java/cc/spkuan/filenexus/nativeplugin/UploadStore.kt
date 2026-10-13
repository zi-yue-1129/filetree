package cc.spkuan.filenexus.nativeplugin

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.getcapacitor.JSObject

/** Upload job states; string values match `UploadState` in definitions.ts. */
enum class UploadState(val wire: String) {
    /** Waiting for constraints or a free slot. */
    QUEUED("queued"),
    /** Bytes are being sent. */
    UPLOADING("uploading"),
    /** Waiting for an automatic retry. */
    RETRYING("retrying"),
    /** Finished successfully. */
    COMPLETED("completed"),
    /** Gave up. */
    FAILED("failed"),
    /** Cancelled by the user. */
    CANCELLED("cancelled");

    /** Whether the job will not run again. */
    val isFinal: Boolean
        get() = this == COMPLETED || this == FAILED || this == CANCELLED

    /** Lookup by wire value. */
    companion object {
        /**
         * Parse a stored state.
         *
         * @throws IllegalArgumentException for unknown values (corrupt database).
         */
        fun fromWire(value: String): UploadState =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("Unknown upload state: $value")
    }
}

/**
 * One persisted upload job.
 *
 * @property jobId Stable id.
 * @property uri Source `content://` or `file://` URI.
 * @property name File name sent as TUS `filename`.
 * @property mimeType Sent as TUS `filetype`.
 * @property relativePath Optional TUS `relativePath`.
 * @property lastModified Optional TUS `lastModified` (epoch ms).
 * @property folderId Optional TUS `folder_id`.
 * @property source `app`, `share` or `backup`.
 * @property wifiOnly Run only on unmetered networks.
 * @property ownsFile Delete [uri] (an app-private copy) when the job is final.
 * @property state Current state.
 * @property bytesSent Bytes acknowledged by the server.
 * @property bytesTotal Total size, `-1` if unknown.
 * @property uploadUrl TUS upload URL once created (enables resume).
 * @property attempts Failed attempts so far.
 * @property error Last error.
 * @property createdAt Creation time (epoch ms).
 * @property updatedAt Last change (epoch ms).
 */
data class UploadJobRecord(
    val jobId: String,
    val uri: String,
    val name: String,
    val mimeType: String,
    val relativePath: String?,
    val lastModified: Long?,
    val folderId: String?,
    val source: String,
    val wifiOnly: Boolean,
    val ownsFile: Boolean,
    val state: UploadState,
    val bytesSent: Long,
    val bytesTotal: Long,
    val uploadUrl: String?,
    val attempts: Int,
    val error: String?,
    val createdAt: Long,
    val updatedAt: Long,
) {
    /** Serialize as the `UploadJob` interface of definitions.ts. */
    fun toJs(): JSObject = JSObject().apply {
        put("jobId", jobId)
        put("name", name)
        put("mimeType", mimeType)
        put("folderId", folderId)
        put("source", source)
        put("state", state.wire)
        put("bytesSent", bytesSent)
        put("bytesTotal", bytesTotal)
        put("error", error)
        put("createdAt", createdAt)
        put("updatedAt", updatedAt)
    }
}

/**
 * SQLite-backed store of upload jobs. Survives process death so WorkManager
 * runs can resume with the persisted TUS upload URL.
 */
class UploadStore private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE jobs (
                job_id TEXT PRIMARY KEY,
                uri TEXT NOT NULL,
                name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                relative_path TEXT,
                last_modified INTEGER,
                folder_id TEXT,
                source TEXT NOT NULL,
                wifi_only INTEGER NOT NULL,
                owns_file INTEGER NOT NULL,
                state TEXT NOT NULL,
                bytes_sent INTEGER NOT NULL,
                bytes_total INTEGER NOT NULL,
                upload_url TEXT,
                attempts INTEGER NOT NULL,
                error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX jobs_state ON jobs(state, created_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw IllegalStateException("No migration from upload store v$oldVersion to v$newVersion")
    }

    /** Insert a new job. */
    @Synchronized
    fun insert(job: UploadJobRecord) {
        val values = ContentValues().apply {
            put("job_id", job.jobId)
            put("uri", job.uri)
            put("name", job.name)
            put("mime_type", job.mimeType)
            put("relative_path", job.relativePath)
            put("last_modified", job.lastModified)
            put("folder_id", job.folderId)
            put("source", job.source)
            put("wifi_only", if (job.wifiOnly) 1 else 0)
            put("owns_file", if (job.ownsFile) 1 else 0)
            put("state", job.state.wire)
            put("bytes_sent", job.bytesSent)
            put("bytes_total", job.bytesTotal)
            put("upload_url", job.uploadUrl)
            put("attempts", job.attempts)
            put("error", job.error)
            put("created_at", job.createdAt)
            put("updated_at", job.updatedAt)
        }
        writableDatabase.insertOrThrow("jobs", null, values)
    }

    /** Fetch one job or `null`. */
    @Synchronized
    fun get(jobId: String): UploadJobRecord? =
        query("job_id = ?", arrayOf(jobId)).firstOrNull()

    /** All jobs, newest first. */
    @Synchronized
    fun all(): List<UploadJobRecord> = query(null, null, "created_at DESC")

    /**
     * Oldest runnable job for a queue.
     *
     * @param wifiOnly Which queue (unmetered-only or any network).
     * @param skip Job ids already handled in this run.
     */
    @Synchronized
    fun nextRunnable(wifiOnly: Boolean, skip: Set<String>): UploadJobRecord? =
        query(
            "state IN ('queued','uploading','retrying') AND wifi_only = ?",
            arrayOf(if (wifiOnly) "1" else "0"),
            "created_at ASC",
        ).firstOrNull { it.jobId !in skip }

    /** Whether any non-final job exists in the given queue. */
    @Synchronized
    fun hasRunnable(wifiOnly: Boolean): Boolean = nextRunnable(wifiOnly, emptySet()) != null

    /**
     * Update mutable fields of a job.
     *
     * @return The updated record, or `null` if the job vanished.
     */
    @Synchronized
    fun update(
        jobId: String,
        state: UploadState? = null,
        bytesSent: Long? = null,
        bytesTotal: Long? = null,
        uploadUrl: String? = null,
        clearUploadUrl: Boolean = false,
        attempts: Int? = null,
        error: String? = null,
        clearError: Boolean = false,
    ): UploadJobRecord? {
        val values = ContentValues().apply {
            state?.let { put("state", it.wire) }
            bytesSent?.let { put("bytes_sent", it) }
            bytesTotal?.let { put("bytes_total", it) }
            if (clearUploadUrl) putNull("upload_url") else uploadUrl?.let { put("upload_url", it) }
            attempts?.let { put("attempts", it) }
            if (clearError) putNull("error") else error?.let { put("error", it) }
            put("updated_at", System.currentTimeMillis())
        }
        writableDatabase.update("jobs", values, "job_id = ?", arrayOf(jobId))
        return get(jobId)
    }

    /** Delete final jobs and return them (so owned files can be removed). */
    @Synchronized
    fun deleteFinished(): List<UploadJobRecord> {
        val finished = query("state IN ('completed','failed','cancelled')", null)
        writableDatabase.delete("jobs", "state IN ('completed','failed','cancelled')", null)
        return finished
    }

    private fun query(selection: String?, args: Array<String>?, orderBy: String? = null): List<UploadJobRecord> =
        readableDatabase.query("jobs", null, selection, args, null, null, orderBy).use { cursor ->
            buildList { while (cursor.moveToNext()) add(cursor.toRecord()) }
        }

    private fun Cursor.toRecord(): UploadJobRecord = UploadJobRecord(
        jobId = getString(getColumnIndexOrThrow("job_id")),
        uri = getString(getColumnIndexOrThrow("uri")),
        name = getString(getColumnIndexOrThrow("name")),
        mimeType = getString(getColumnIndexOrThrow("mime_type")),
        relativePath = nullableString("relative_path"),
        lastModified = nullableLong("last_modified"),
        folderId = nullableString("folder_id"),
        source = getString(getColumnIndexOrThrow("source")),
        wifiOnly = getInt(getColumnIndexOrThrow("wifi_only")) == 1,
        ownsFile = getInt(getColumnIndexOrThrow("owns_file")) == 1,
        state = UploadState.fromWire(getString(getColumnIndexOrThrow("state"))),
        bytesSent = getLong(getColumnIndexOrThrow("bytes_sent")),
        bytesTotal = getLong(getColumnIndexOrThrow("bytes_total")),
        uploadUrl = nullableString("upload_url"),
        attempts = getInt(getColumnIndexOrThrow("attempts")),
        error = nullableString("error"),
        createdAt = getLong(getColumnIndexOrThrow("created_at")),
        updatedAt = getLong(getColumnIndexOrThrow("updated_at")),
    )

    private fun Cursor.nullableString(column: String): String? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getString(index)
    }

    private fun Cursor.nullableLong(column: String): Long? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getLong(index)
    }

    /** Process-wide singleton accessor. */
    companion object {
        private const val DB_NAME = "filenexus_uploads.db"
        private const val DB_VERSION = 1

        @Volatile
        private var instance: UploadStore? = null

        /** Get the shared store. */
        fun get(context: Context): UploadStore =
            instance ?: synchronized(this) {
                instance ?: UploadStore(context).also { instance = it }
            }
    }
}
