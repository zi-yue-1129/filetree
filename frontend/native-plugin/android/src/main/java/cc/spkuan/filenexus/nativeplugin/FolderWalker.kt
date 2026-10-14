package cc.spkuan.filenexus.nativeplugin

/**
 * One child row of a Storage Access Framework directory listing.
 *
 * @property documentId `DocumentsContract` document id (unique within the tree).
 * @property displayName Provider display name, `null` when the provider gave none.
 * @property mimeType Provider MIME type; [FolderWalker.DIRECTORY_MIME_TYPE] for directories.
 * @property size Size in bytes, `-1` when unknown.
 * @property lastModified Modification time in epoch ms, `null` when unknown.
 * @property isVirtual Whether the document has no byte stream (e.g. Google Docs).
 */
data class TreeEntry(
    val documentId: String,
    val displayName: String?,
    val mimeType: String?,
    val size: Long,
    val lastModified: Long?,
    val isVirtual: Boolean,
)

/**
 * A regular file found below the picked folder.
 *
 * @property documentId Document id used to build the content URI.
 * @property name Sanitized file name, sent as TUS `filename`.
 * @property relativePath `<folder>/<sub dirs>/<name>`, sent as TUS `relativePath`.
 * @property mimeType MIME type, `application/octet-stream` when unknown.
 * @property size Size in bytes, `-1` when unknown.
 * @property lastModified Modification time in epoch ms, or `null`.
 */
data class WalkedFile(
    val documentId: String,
    val name: String,
    val relativePath: String,
    val mimeType: String,
    val size: Long,
    val lastModified: Long?,
)

/**
 * Result of [FolderWalker.walk].
 *
 * @property folderName Sanitized name of the picked folder (first path segment).
 * @property files Uploadable files sorted by [WalkedFile.relativePath].
 * @property skippedCount Virtual documents and repeated directories left out.
 */
data class FolderWalk(
    val folderName: String,
    val files: List<WalkedFile>,
    val skippedCount: Int,
)

/**
 * Provider-agnostic recursive listing of a picked folder.
 *
 * Kept free of Android types so the path rules can be unit-tested on the JVM;
 * [FileNexusNativePlugin] supplies the `DocumentsContract` queries. Paths obey
 * the backend contract of `resolve_upload_folder` (no empty, `.` or `..`
 * segments, `/` as separator).
 */
object FolderWalker {
    /** `DocumentsContract.Document.MIME_TYPE_DIR`. */
    const val DIRECTORY_MIME_TYPE: String = "vnd.android.document/directory"

    /** Folder name used when the provider's name is unusable. */
    const val FALLBACK_FOLDER_NAME: String = "folder"

    /** File name used when the provider's name is unusable. */
    const val FALLBACK_FILE_NAME: String = "file"

    private const val DEFAULT_MIME_TYPE = "application/octet-stream"
    private const val MAX_SEGMENT_LENGTH = 200

    /**
     * List every regular file below a folder, depth first.
     *
     * @param rootDocumentId Document id of the picked folder.
     * @param rootName Display name of the picked folder.
     * @param listChildren Returns the children of a directory document id;
     * exceptions propagate to the caller.
     * @return Files with folder-relative paths and the number of skipped entries.
     */
    fun walk(rootDocumentId: String, rootName: String?, listChildren: (String) -> List<TreeEntry>): FolderWalk {
        val folderName = safeSegment(rootName, FALLBACK_FOLDER_NAME)
        val files = mutableListOf<WalkedFile>()
        var skipped = 0
        val visited = mutableSetOf(rootDocumentId)
        val pending = ArrayDeque<Pair<String, String>>()
        pending.addLast(rootDocumentId to folderName)
        while (pending.isNotEmpty()) {
            val (directoryId, directoryPath) = pending.removeLast()
            for (entry in listChildren(directoryId)) {
                if (entry.mimeType == DIRECTORY_MIME_TYPE) {
                    if (visited.add(entry.documentId)) {
                        pending.addLast(entry.documentId to "$directoryPath/${safeSegment(entry.displayName, FALLBACK_FOLDER_NAME)}")
                    } else {
                        skipped++
                    }
                } else if (entry.isVirtual) {
                    skipped++
                } else {
                    val name = safeSegment(entry.displayName, FALLBACK_FILE_NAME)
                    files += WalkedFile(
                        documentId = entry.documentId,
                        name = name,
                        relativePath = "$directoryPath/$name",
                        mimeType = entry.mimeType?.takeIf { it.isNotBlank() } ?: DEFAULT_MIME_TYPE,
                        size = entry.size,
                        lastModified = entry.lastModified,
                    )
                }
            }
        }
        return FolderWalk(folderName, files.sortedBy { it.relativePath }, skipped)
    }

    /**
     * Make a provider name safe as one path segment.
     *
     * Separators and control characters become `_`; names that would be empty,
     * `.` or `..` (rejected by the backend) become [fallback]. Leading dots are
     * kept so dotfiles upload under their real name.
     *
     * @param raw Provider display name.
     * @param fallback Replacement for unusable names.
     * @return A non-empty segment without `/` or `\`.
     */
    fun safeSegment(raw: String?, fallback: String): String {
        val cleaned = raw.orEmpty()
            .map { if (it == '/' || it == '\\' || it.isISOControl()) '_' else it }
            .joinToString("")
            .trim()
            .take(MAX_SEGMENT_LENGTH)
        return if (cleaned.isEmpty() || cleaned == "." || cleaned == "..") fallback else cleaned
    }
}
