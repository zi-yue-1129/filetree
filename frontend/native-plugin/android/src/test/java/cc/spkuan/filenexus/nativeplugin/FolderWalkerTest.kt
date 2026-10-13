package cc.spkuan.filenexus.nativeplugin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests of [FolderWalker], the provider-agnostic part of folder upload. */
class FolderWalkerTest {
    /** Build a directory entry. */
    private fun dir(id: String, name: String?): TreeEntry =
        TreeEntry(id, name, FolderWalker.DIRECTORY_MIME_TYPE, -1L, null, isVirtual = false)

    /** Build a regular file entry. */
    private fun file(id: String, name: String?, mime: String? = "text/plain", size: Long = 1L, modified: Long? = 7L): TreeEntry =
        TreeEntry(id, name, mime, size, modified, isVirtual = false)

    /** Nested files get `<root>/<sub>/<name>` paths, sorted, with metadata carried over. */
    @Test
    fun walkBuildsRelativePathsBelowTheRootName() {
        val tree = mapOf(
            "root" to listOf(file("f1", "b.txt"), dir("d1", "sub"), file("f0", "a.jpg", mime = "image/jpeg", size = 9L)),
            "d1" to listOf(dir("d2", "deeper"), file("f2", "c.txt", mime = null, modified = null)),
            "d2" to listOf(file("f3", "d.bin", size = -1L)),
        )

        val walk = FolderWalker.walk("root", "Photos") { tree.getValue(it) }

        assertEquals("Photos", walk.folderName)
        assertEquals(0, walk.skippedCount)
        assertEquals(
            listOf("Photos/a.jpg", "Photos/b.txt", "Photos/sub/c.txt", "Photos/sub/deeper/d.bin"),
            walk.files.map { it.relativePath },
        )
        assertEquals(listOf("f0", "f1", "f2", "f3"), walk.files.map { it.documentId })
        assertEquals(listOf("a.jpg", "b.txt", "c.txt", "d.bin"), walk.files.map { it.name })
        assertEquals("image/jpeg", walk.files[0].mimeType)
        assertEquals(9L, walk.files[0].size)
        assertEquals(7L, walk.files[0].lastModified)
        assertEquals("application/octet-stream", walk.files[2].mimeType)
        assertEquals(null, walk.files[2].lastModified)
    }

    /** Names the backend would reject (`""`, `.`, `..`, separators) are made safe; dotfiles stay. */
    @Test
    fun walkSanitizesSegmentsTheBackendWouldReject() {
        val tree = mapOf(
            "root" to listOf(dir("d1", ".."), file("f1", ".gitignore"), file("f2", "a/b\\c.txt"), file("f3", null)),
            "d1" to listOf(file("f4", ".")),
        )

        val walk = FolderWalker.walk("root", "  ") { tree.getValue(it) }

        assertEquals(FolderWalker.FALLBACK_FOLDER_NAME, walk.folderName)
        val paths = walk.files.map { it.relativePath }
        assertEquals(
            listOf("folder/.gitignore", "folder/a_b_c.txt", "folder/file", "folder/folder/file"),
            paths,
        )
        paths.forEach { path ->
            assertTrue(path.split('/').none { it.isEmpty() || it == "." || it == ".." })
        }
    }

    /** Virtual documents cannot be streamed and directory cycles are not re-entered; both are counted. */
    @Test
    fun walkCountsVirtualDocumentsAndCyclesAsSkipped() {
        val tree = mapOf(
            "root" to listOf(
                TreeEntry("v1", "Doc.gdoc", "application/vnd.google-apps.document", -1L, null, isVirtual = true),
                dir("d1", "loop"),
                file("f1", "ok.txt"),
            ),
            "d1" to listOf(dir("root", "back-to-root")),
        )

        val walk = FolderWalker.walk("root", "Drive") { tree.getValue(it) }

        assertEquals(listOf("Drive/ok.txt"), walk.files.map { it.relativePath })
        assertEquals(2, walk.skippedCount)
    }

    /** An empty folder yields no files rather than an error. */
    @Test
    fun walkOfEmptyFolderReturnsNoFiles() {
        val walk = FolderWalker.walk("root", "Empty") { emptyList() }

        assertTrue(walk.files.isEmpty())
        assertEquals(0, walk.skippedCount)
    }
}
