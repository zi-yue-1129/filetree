package cc.spkuan.filenexus.nativeplugin

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import android.widget.Toast
import androidx.core.content.IntentCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.concurrent.thread

/**
 * Invisible target of the OS share sheet (`ACTION_SEND` / `ACTION_SEND_MULTIPLE`).
 *
 * Copies the shared content into app storage (temporary URI grants end with
 * this activity) and then either enqueues uploads right away when a device
 * token is configured, or stores the items and opens the app so the user can
 * sign in first (`getSharedItems` / `sharedItems`).
 */
class ShareReceiverActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sharedIntent = intent
        if (sharedIntent == null || (sharedIntent.action != Intent.ACTION_SEND && sharedIntent.action != Intent.ACTION_SEND_MULTIPLE)) {
            Log.e(TAG, "Unexpected intent for share receiver: $sharedIntent")
            finish()
            return
        }
        Toast.makeText(this, "正在準備分享的檔案…", Toast.LENGTH_SHORT).show()
        thread(name = "filenexus-share-copy") {
            val result = runCatching { copySharedContent(sharedIntent) }
            runOnUiThread { handleCopied(result) }
        }
    }

    private fun handleCopied(result: kotlin.Result<List<SharedFile>>) {
        val items = result.getOrElse { error ->
            Log.e(TAG, "Failed to read shared content", error)
            Toast.makeText(this, "無法讀取分享的檔案：${error.message}", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        if (items.isEmpty()) {
            Toast.makeText(this, "沒有可上傳的內容", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        val credentials = NativeSettings(this).credentials()
        if (credentials.isConfigured) {
            val jobIds = UploadQueue.enqueue(this, items.map { it.toNewUpload() }, null, "share", wifiOnly = false)
            NativeEvents.emit(
                "sharedItems",
                JSObject().apply {
                    put("items", JSArray())
                    put("enqueuedJobIds", JSArray(jobIds))
                },
            )
            Toast.makeText(this, "已加入上傳佇列（${items.size} 個檔案）", Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        SharedItemStore(this).add(items)
        NativeEvents.emit(
            "sharedItems",
            JSObject().apply {
                put("items", SharedItemStore.toJsArray(items))
                put("enqueuedJobIds", JSArray())
            },
        )
        Toast.makeText(this, "請先在 FileNexus 設定中登入此裝置", Toast.LENGTH_LONG).show()
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        if (launch == null) {
            Log.e(TAG, "No launcher activity found for $packageName")
        } else {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            launch.putExtra(EXTRA_OPEN_SHARED, true)
            startActivity(launch)
        }
        finish()
    }

    private fun copySharedContent(source: Intent): List<SharedFile> {
        val uris: List<Uri> = when (source.action) {
            Intent.ACTION_SEND_MULTIPLE ->
                IntentCompat.getParcelableArrayListExtra(source, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            else -> listOfNotNull(IntentCompat.getParcelableExtra(source, Intent.EXTRA_STREAM, Uri::class.java))
        }
        val store = SharedItemStore(this)
        val now = System.currentTimeMillis()
        if (uris.isEmpty()) {
            val text = source.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            if (text.isNullOrBlank()) return emptyList()
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(now))
            return listOf(writeText(store.rootDir, "分享文字-$stamp.txt", text, now))
        }
        return uris.map { uri -> copyUri(store.rootDir, uri, source.type, now) }
    }

    private fun copyUri(root: File, uri: Uri, fallbackType: String?, now: Long): SharedFile {
        val id = UUID.randomUUID().toString()
        val name = sanitizeName(displayName(uri) ?: uri.lastPathSegment ?: "shared-$id")
        val mimeType = contentResolver.getType(uri) ?: fallbackType?.takeUnless { it.contains('*') } ?: "application/octet-stream"
        val dir = File(root, id)
        if (!dir.mkdirs()) throw IOException("Cannot create ${dir.absolutePath}")
        val target = File(dir, name)
        val input = contentResolver.openInputStream(uri) ?: throw FileNotFoundException("No stream for $uri")
        input.use { stream -> target.outputStream().use { stream.copyTo(it) } }
        return SharedFile(id, target, name, mimeType, now)
    }

    private fun writeText(root: File, name: String, text: String, now: Long): SharedFile {
        val id = UUID.randomUUID().toString()
        val dir = File(root, id)
        if (!dir.mkdirs()) throw IOException("Cannot create ${dir.absolutePath}")
        val target = File(dir, name)
        target.writeText(text, Charsets.UTF_8)
        return SharedFile(id, target, name, "text/plain", now)
    }

    private fun displayName(uri: Uri): String? =
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && !cursor.isNull(index)) cursor.getString(index) else null
        }

    /** Constants. */
    companion object {
        private const val TAG = "FileNexusShare"

        /** Extra set on the launch intent when shared items wait for sign-in. */
        const val EXTRA_OPEN_SHARED: String = "cc.spkuan.filenexus.OPEN_SHARED"

        /**
         * Make a display name safe as a single path segment.
         *
         * @param raw Name from the content provider.
         * @return Name without path separators or control characters (max 200 chars).
         */
        fun sanitizeName(raw: String): String {
            val cleaned = raw.map { if (it == '/' || it == '\\' || it.isISOControl()) '_' else it }
                .joinToString("")
                .trim()
                .trimStart('.')
            return cleaned.ifEmpty { "shared-file" }.take(200)
        }
    }
}
