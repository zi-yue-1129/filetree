package cc.spkuan.filenexus.nativeplugin

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import okhttp3.Request

/** FileProvider subclass so its manifest entry does not clash with the app's own FileProvider. */
class UpdateFileProvider : FileProvider()

/** Raised when a downloaded APK does not match the published SHA-256. */
class ChecksumMismatchException(expected: String, actual: String) :
    IOException("SHA-256 mismatch: expected $expected, got $actual")

/** Download, verify and hand APK updates to the system installer. */
object ApkUpdater {
    /** Whether the user allowed this app to install packages ("install unknown apps"). */
    fun canInstall(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    /** Intent for the "install unknown apps" settings page of this app. */
    fun installPermissionIntent(context: Context): Intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        } else {
            Intent(Settings.ACTION_SECURITY_SETTINGS)
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * Download the APK (reusing a verified cached copy) and verify its hash.
     *
     * @param url HTTPS URL of the APK.
     * @param expectedSha256 Lowercase hex SHA-256.
     * @param version Version string used for the file name.
     * @param onProgress `(bytesDownloaded, bytesTotal)`; total is `-1` if unknown.
     * @return The verified APK file.
     * @throws ChecksumMismatchException when the hash differs (file is deleted).
     */
    fun download(
        context: Context,
        url: String,
        expectedSha256: String,
        version: String,
        onProgress: (Long, Long) -> Unit,
    ): File {
        val expected = expectedSha256.trim().lowercase()
        require(expected.matches(Regex("[0-9a-f]{64}"))) { "Invalid sha256: $expectedSha256" }
        val dir = File(context.cacheDir, "updates")
        if (!dir.exists() && !dir.mkdirs()) throw IOException("Cannot create ${dir.absolutePath}")
        val safeVersion = version.replace(Regex("[^0-9A-Za-z._-]"), "_")
        val target = File(dir, "FileNexus-$safeVersion.apk")
        if (target.exists() && sha256Of(target) == expected) {
            onProgress(target.length(), target.length())
            return target
        }
        dir.listFiles()?.forEach { stale ->
            if (!stale.delete()) throw IOException("Cannot delete stale update ${stale.absolutePath}")
        }
        val partial = File(dir, "${target.name}.part")
        val digest = MessageDigest.getInstance("SHA-256")
        val request = Request.Builder().url(url).get().build()
        Http.client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("APK download failed: HTTP ${response.code}")
            val body = response.body ?: throw IOException("APK download returned no body")
            val total = body.contentLength()
            var downloaded = 0L
            var lastReport = 0L
            body.byteStream().use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        digest.update(buffer, 0, n)
                        downloaded += n
                        val now = System.currentTimeMillis()
                        if (now - lastReport >= 250) {
                            lastReport = now
                            onProgress(downloaded, total)
                        }
                    }
                }
            }
            onProgress(downloaded, total)
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != expected) {
            if (!partial.delete()) throw IOException("Checksum mismatch and could not delete ${partial.absolutePath}")
            throw ChecksumMismatchException(expected, actual)
        }
        if (!partial.renameTo(target)) throw IOException("Cannot move APK to ${target.absolutePath}")
        return target
    }

    /**
     * Launch the system package installer for a verified APK.
     *
     * @param apk File returned by [download].
     */
    fun launchInstaller(context: Context, apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.filenexus.updates", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
