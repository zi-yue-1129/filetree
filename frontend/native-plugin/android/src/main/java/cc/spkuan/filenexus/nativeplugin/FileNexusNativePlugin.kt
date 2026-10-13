package cc.spkuan.filenexus.nativeplugin

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import androidx.core.content.pm.PackageInfoCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.json.JSONException
import org.json.JSONObject

/**
 * Android implementation of the `FileNexusNative` Capacitor plugin
 * (API in `native-plugin/src/definitions.ts`, contract in docs/NATIVE_APPS.md §5).
 *
 * Long-running work lives in WorkManager workers and the share receiver so it
 * survives the WebView; this class translates JS calls and forwards
 * [NativeEvents] to JavaScript while loaded.
 */
@CapacitorPlugin(
    name = "FileNexusNative",
    permissions = [
        Permission(alias = FileNexusNativePlugin.ALIAS_PHOTOS, strings = [Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO]),
        Permission(alias = FileNexusNativePlugin.ALIAS_PHOTOS_PARTIAL, strings = [Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED]),
        Permission(alias = FileNexusNativePlugin.ALIAS_PHOTOS_LEGACY, strings = [Manifest.permission.READ_EXTERNAL_STORAGE]),
        Permission(alias = FileNexusNativePlugin.ALIAS_NOTIFICATIONS, strings = [Manifest.permission.POST_NOTIFICATIONS]),
    ],
)
class FileNexusNativePlugin : Plugin() {
    private val io: ExecutorService = Executors.newSingleThreadExecutor()
    private lateinit var settings: NativeSettings
    private val eventListener = NativeEvents.Listener { eventName, payload ->
        // Shared items must not be lost if the page has not subscribed yet.
        notifyListeners(eventName, payload, eventName == "sharedItems")
    }

    override fun load() {
        settings = NativeSettings(context)
        Notifications.ensureChannels(context)
        NativeEvents.register(eventListener)
        UploadQueue.kick(context)
        PhotoBackup.schedule(context)
    }

    override fun handleOnDestroy() {
        NativeEvents.unregister(eventListener)
        io.shutdown()
    }

    // ---------------------------------------------------------------- config

    /** `configure({serverUrl, deviceToken, deviceId?, deviceName?})`. */
    @PluginMethod
    fun configure(call: PluginCall) {
        val serverUrl = call.getString("serverUrl")?.trim()?.trimEnd('/')
        if (serverUrl.isNullOrEmpty() || !(serverUrl.startsWith("https://") || serverUrl.startsWith("http://"))) {
            call.reject("serverUrl must be an http(s) origin", "INVALID_ARGUMENT")
            return
        }
        val credentials = DeviceCredentials(
            serverUrl = serverUrl,
            deviceToken = call.getString("deviceToken")?.takeIf { it.isNotBlank() },
            deviceId = call.getString("deviceId")?.takeIf { it.isNotBlank() },
            deviceName = call.getString("deviceName")?.takeIf { it.isNotBlank() },
        )
        settings.saveCredentials(credentials)
        if (credentials.isConfigured) {
            UploadQueue.kick(context)
            PhotoBackup.schedule(context)
            Push.scheduleTokenSync(context)
        }
        call.resolve()
    }

    /** `getConfiguration()`. */
    @PluginMethod
    fun getConfiguration(call: PluginCall) {
        val credentials = settings.credentials()
        call.resolve(
            JSObject().apply {
                put("serverUrl", credentials.serverUrl)
                put("deviceToken", credentials.deviceToken)
                put("deviceId", credentials.deviceId)
                put("deviceName", credentials.deviceName)
            },
        )
    }

    /** `getNativeInfo()`. */
    @PluginMethod
    fun getNativeInfo(call: PluginCall) {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
        } else {
            // The int-flags overload is the only one available below API 33.
            context.packageManager.getPackageInfo(context.packageName, 0)
        }
        val versionCode = PackageInfoCompat.getLongVersionCode(info)
        call.resolve(
            JSObject().apply {
                put("platform", "android")
                put("versionName", info.versionName ?: "0.0.0")
                put("versionCode", versionCode)
                put("pushAvailable", Push.isAvailable(context))
            },
        )
    }

    // ---------------------------------------------------------------- picker

    /** `pickFiles({multiple?, mimeTypes?})`. */
    @PluginMethod
    fun pickFiles(call: PluginCall) {
        val mimeTypes = call.getArray("mimeTypes")?.toList<String>().orEmpty()
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeTypes.singleOrNull() ?: "*/*"
            if (mimeTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, call.getBoolean("multiple", true) ?: true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "pickFilesResult")
    }

    /** Activity result of [pickFiles]. */
    @ActivityCallback
    fun pickFilesResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) {
            Log.e(TAG, "pickFiles result arrived without a saved call")
            return
        }
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            call.reject("User cancelled the picker", "CANCELLED")
            return
        }
        val uris = buildList {
            val clip = data.clipData
            if (clip != null) for (i in 0 until clip.itemCount) add(clip.getItemAt(i).uri)
            else data.data?.let(::add)
        }
        val files = JSArray()
        uris.forEach { uri ->
            try {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (e: SecurityException) {
                // Provider does not offer persistable grants; the temporary grant
                // still covers uploads while this process lives.
                Log.e(TAG, "Could not persist read permission for $uri", e)
            }
            files.put(describeUri(uri))
        }
        call.resolve(JSObject().apply { put("files", files) })
    }

    private fun describeUri(uri: Uri): JSObject {
        var name: String? = null
        var size = -1L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex)
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
        return JSObject().apply {
            put("uri", uri.toString())
            put("name", ShareReceiverActivity.sanitizeName(name ?: uri.lastPathSegment ?: "file"))
            put("mimeType", context.contentResolver.getType(uri) ?: "application/octet-stream")
            put("size", size)
        }
    }

    /** `pickFolder()`: SAF tree picker, then a recursive listing on [io]. */
    @PluginMethod
    fun pickFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "pickFolderResult")
    }

    /** Activity result of [pickFolder]. */
    @ActivityCallback
    fun pickFolderResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) {
            Log.e(TAG, "pickFolder result arrived without a saved call")
            return
        }
        val treeUri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || treeUri == null) {
            call.reject("User cancelled the folder picker", "CANCELLED")
            return
        }
        try {
            // One grant on the tree covers every child document URI, so queued
            // uploads stay readable after the app process is killed.
            context.contentResolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: SecurityException) {
            // Same policy as pickFiles: the temporary grant still covers uploads
            // while this process lives.
            Log.e(TAG, "Could not persist read permission for $treeUri", e)
        }
        io.execute {
            try {
                call.resolve(listFolder(treeUri))
            } catch (e: IOException) {
                Log.e(TAG, "Listing picked folder $treeUri failed", e)
                call.reject("Could not read the folder: ${e.message}", "IO_ERROR", e)
            } catch (e: RuntimeException) {
                // SecurityException / IllegalArgumentException / IllegalStateException
                // from the provider; reported to the UI, never swallowed.
                Log.e(TAG, "Listing picked folder $treeUri failed", e)
                call.reject("Could not read the folder: ${e.message}", "IO_ERROR", e)
            }
        }
    }

    /**
     * Recursively list a SAF tree into the `PickFolderResult` shape.
     *
     * @throws IOException when the provider returns no cursor.
     */
    private fun listFolder(treeUri: Uri): JSObject {
        val rootId = DocumentsContract.getTreeDocumentId(treeUri)
        val rootName = queryDocuments(DocumentsContract.buildDocumentUriUsingTree(treeUri, rootId)).firstOrNull()?.displayName
        val walk = FolderWalker.walk(rootId, rootName) { parentId ->
            queryDocuments(DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId))
        }
        val files = JSArray()
        walk.files.forEach { file ->
            files.put(
                JSObject().apply {
                    put("uri", DocumentsContract.buildDocumentUriUsingTree(treeUri, file.documentId).toString())
                    put("name", file.name)
                    put("mimeType", file.mimeType)
                    put("size", file.size)
                    put("relativePath", file.relativePath)
                    file.lastModified?.let { put("lastModified", it) }
                },
            )
        }
        return JSObject().apply {
            put("folderName", walk.folderName)
            put("files", files)
            put("skippedCount", walk.skippedCount)
        }
    }

    /**
     * Query document rows (a single document or a directory's children).
     *
     * @throws IOException when the provider returns no cursor.
     */
    private fun queryDocuments(uri: Uri): List<TreeEntry> {
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_FLAGS,
        )
        val cursor = context.contentResolver.query(uri, projection, null, null, null)
            ?: throw IOException("Document provider returned no cursor for $uri")
        return cursor.use {
            buildList {
                while (it.moveToNext()) {
                    val flags = if (it.isNull(5)) 0 else it.getInt(5)
                    add(
                        TreeEntry(
                            documentId = it.getString(0),
                            displayName = if (it.isNull(1)) null else it.getString(1),
                            mimeType = if (it.isNull(2)) null else it.getString(2),
                            size = if (it.isNull(3)) -1L else it.getLong(3),
                            lastModified = if (it.isNull(4)) null else it.getLong(4).takeIf { modified -> modified > 0 },
                            isVirtual = (flags and DocumentsContract.Document.FLAG_VIRTUAL_DOCUMENT) != 0,
                        ),
                    )
                }
            }
        }
    }

    // ---------------------------------------------------------------- uploads

    /** `enqueueUpload({files, folderId?})`. */
    @PluginMethod
    fun enqueueUpload(call: PluginCall) {
        if (!settings.credentials().isConfigured) {
            call.reject("Device is not signed in; configure a device token first", "NOT_CONFIGURED")
            return
        }
        val rawFiles = try {
            call.getArray("files")?.toList<JSONObject>()
        } catch (e: JSONException) {
            call.reject("files must be an array of objects: ${e.message}", "INVALID_ARGUMENT", e)
            return
        }
        if (rawFiles.isNullOrEmpty()) {
            call.reject("files must be a non-empty array", "INVALID_ARGUMENT")
            return
        }
        val sharedRoot = SharedItemStore(context).rootDir.absolutePath
        val sharedIds = mutableListOf<String>()
        val uploads = try {
            rawFiles.map { obj ->
                val uri = obj.getString("uri")
                val path = Uri.parse(uri).path
                val owns = uri.startsWith("file://") && path != null && File(path).absolutePath.startsWith(sharedRoot)
                if (owns) path?.let { File(it).parentFile?.name }?.let(sharedIds::add)
                NewUpload(
                    uri = uri,
                    name = obj.getString("name"),
                    mimeType = obj.optString("mimeType", "application/octet-stream"),
                    size = if (obj.has("size")) obj.getLong("size") else -1L,
                    relativePath = obj.optString("relativePath").takeIf { it.isNotBlank() },
                    lastModified = if (obj.has("lastModified")) obj.getLong("lastModified") else null,
                    ownsFile = owns,
                )
            }
        } catch (e: JSONException) {
            call.reject("Invalid file entry: ${e.message}", "INVALID_ARGUMENT", e)
            return
        }
        // Shared copies now belong to the queue, which deletes them when done.
        if (sharedIds.isNotEmpty()) SharedItemStore(context).forget(sharedIds)
        val jobIds = UploadQueue.enqueue(context, uploads, call.getString("folderId"), "app", wifiOnly = false)
        call.resolve(JSObject().apply { put("jobIds", JSArray(jobIds)) })
    }

    /** `getUploads()`. */
    @PluginMethod
    fun getUploads(call: PluginCall) {
        val uploads = JSArray()
        UploadStore.get(context).all().forEach { uploads.put(it.toJs()) }
        call.resolve(JSObject().apply { put("uploads", uploads) })
    }

    /** `cancelUpload({jobId})`. */
    @PluginMethod
    fun cancelUpload(call: PluginCall) {
        val jobId = call.getString("jobId")
        if (jobId.isNullOrBlank()) {
            call.reject("jobId is required", "INVALID_ARGUMENT")
            return
        }
        if (!UploadQueue.cancel(context, jobId)) {
            call.reject("Upload job $jobId not found", "JOB_NOT_FOUND")
            return
        }
        call.resolve()
    }

    /** `clearFinishedUploads()`. */
    @PluginMethod
    fun clearFinishedUploads(call: PluginCall) {
        UploadQueue.clearFinished(context)
        call.resolve()
    }

    // ---------------------------------------------------------------- share

    /** `getSharedItems()`. */
    @PluginMethod
    fun getSharedItems(call: PluginCall) {
        call.resolve(JSObject().apply { put("items", SharedItemStore.toJsArray(SharedItemStore(context).all())) })
    }

    /** `clearSharedItems({ids?})`. */
    @PluginMethod
    fun clearSharedItems(call: PluginCall) {
        val ids = call.getArray("ids")?.toList<String>()
        SharedItemStore(context).remove(ids)
        call.resolve()
    }

    // ---------------------------------------------------------------- photo backup

    /** `setPhotoBackup({enabled, wifiOnly, includeVideos})`. */
    @PluginMethod
    fun setPhotoBackup(call: PluginCall) {
        val enabled = call.getBoolean("enabled")
        val wifiOnly = call.getBoolean("wifiOnly")
        val includeVideos = call.getBoolean("includeVideos")
        if (enabled == null || wifiOnly == null || includeVideos == null) {
            call.reject("enabled, wifiOnly and includeVideos are required", "INVALID_ARGUMENT")
            return
        }
        if (enabled && PhotoBackup.access(context, includeVideos) == PhotoAccess.DENIED) {
            requestPermissionForAliases(photoAliases(), call, "photoBackupPermissionCallback")
            return
        }
        applyPhotoBackup(call, enabled, wifiOnly, includeVideos)
    }

    /** Permission result for [setPhotoBackup]. */
    @PermissionCallback
    fun photoBackupPermissionCallback(call: PluginCall) {
        val includeVideos = call.getBoolean("includeVideos", true) ?: true
        val allowed = PhotoBackup.access(context, includeVideos) != PhotoAccess.DENIED
        if (!allowed) Log.i(TAG, "Photo permission denied; photo backup stays disabled")
        applyPhotoBackup(call, allowed, call.getBoolean("wifiOnly", true) ?: true, includeVideos)
    }

    private fun applyPhotoBackup(call: PluginCall, enabled: Boolean, wifiOnly: Boolean, includeVideos: Boolean) {
        settings.savePhotoBackupOptions(enabled, wifiOnly, includeVideos, System.currentTimeMillis())
        PhotoBackup.schedule(context)
        if (enabled) PhotoBackup.runNow(context)
        call.resolve(PhotoBackup.statusJs(context))
    }

    /** `getPhotoBackupStatus()`. */
    @PluginMethod
    fun getPhotoBackupStatus(call: PluginCall) {
        call.resolve(PhotoBackup.statusJs(context))
    }

    /** `runPhotoBackupNow()`. */
    @PluginMethod
    fun runPhotoBackupNow(call: PluginCall) {
        if (!settings.photoBackup().enabled) {
            call.reject("Photo backup is disabled", "INVALID_ARGUMENT")
            return
        }
        PhotoBackup.runNow(context)
        call.resolve()
    }

    // ---------------------------------------------------------------- push

    /** `registerPush()`. */
    @PluginMethod
    fun registerPush(call: PluginCall) {
        if (!Push.isAvailable(context)) {
            call.reject("Push is not configured in this build (no google-services.json)", "PUSH_NOT_CONFIGURED")
            return
        }
        Push.fetchToken(
            onSuccess = { token ->
                settings.pushToken = token
                Push.scheduleTokenSync(context)
                call.resolve(JSObject().apply { put("token", token) })
            },
            onError = { error ->
                Log.e(TAG, "FCM token request failed", error)
                call.reject("FCM token request failed: ${error.message}", "IO_ERROR", error)
            },
        )
    }

    // ---------------------------------------------------------------- self-update

    /** `canInstallPackages()`. */
    @PluginMethod
    fun canInstallPackages(call: PluginCall) {
        call.resolve(JSObject().apply { put("allowed", ApkUpdater.canInstall(context)) })
    }

    /** `openInstallPermissionSettings()`. */
    @PluginMethod
    fun openInstallPermissionSettings(call: PluginCall) {
        context.startActivity(ApkUpdater.installPermissionIntent(context))
        call.resolve()
    }

    /** `installApkUpdate({url, sha256, version})`. */
    @PluginMethod
    fun installApkUpdate(call: PluginCall) {
        val url = call.getString("url")
        val sha256 = call.getString("sha256")
        val version = call.getString("version")
        if (url.isNullOrBlank() || sha256.isNullOrBlank() || version.isNullOrBlank()) {
            call.reject("url, sha256 and version are required", "INVALID_ARGUMENT")
            return
        }
        if (!url.startsWith("https://")) {
            call.reject("APK updates must be downloaded over HTTPS", "INVALID_ARGUMENT")
            return
        }
        if (!ApkUpdater.canInstall(context)) {
            call.reject("Allow FileNexus to install unknown apps first", "INSTALL_PERMISSION_REQUIRED")
            return
        }
        io.execute {
            try {
                val apk = ApkUpdater.download(context, url, sha256, version) { downloaded, total ->
                    notifyListeners(
                        "apkDownloadProgress",
                        JSObject().apply {
                            put("bytesDownloaded", downloaded)
                            put("bytesTotal", total)
                        },
                    )
                }
                ApkUpdater.launchInstaller(context, apk)
                call.resolve()
            } catch (e: ChecksumMismatchException) {
                Log.e(TAG, "APK update rejected", e)
                call.reject(e.message, "CHECKSUM_MISMATCH", e)
            } catch (e: IOException) {
                Log.e(TAG, "APK update download failed", e)
                call.reject("APK download failed: ${e.message}", "IO_ERROR", e)
            } catch (e: IllegalArgumentException) {
                Log.e(TAG, "APK update arguments invalid", e)
                call.reject(e.message, "INVALID_ARGUMENT", e)
            }
        }
    }

    // ---------------------------------------------------------------- permissions

    /** `checkPermissions()` → `{photos, notifications}`. */
    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(permissionStatus())
    }

    /** `requestPermissions({permissions?})`. */
    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val requested = call.getArray("permissions")?.toList<String>() ?: listOf("photos", "notifications")
        val aliases = buildList {
            if ("photos" in requested) addAll(photoAliases())
            if ("notifications" in requested && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(ALIAS_NOTIFICATIONS)
        }
        if (aliases.isEmpty()) {
            call.resolve(permissionStatus())
            return
        }
        requestPermissionForAliases(aliases.toTypedArray(), call, "permissionsCallback")
    }

    /** Result of [requestPermissions]. */
    @PermissionCallback
    fun permissionsCallback(call: PluginCall) {
        call.resolve(permissionStatus())
    }

    private fun photoAliases(): Array<String> = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> arrayOf(ALIAS_PHOTOS, ALIAS_PHOTOS_PARTIAL)
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> arrayOf(ALIAS_PHOTOS)
        else -> arrayOf(ALIAS_PHOTOS_LEGACY)
    }

    private fun permissionStatus(): JSObject {
        val includeVideos = settings.photoBackup().includeVideos
        val photos = when (PhotoBackup.access(context, includeVideos)) {
            PhotoAccess.GRANTED -> "granted"
            PhotoAccess.LIMITED -> "limited"
            PhotoAccess.DENIED -> stateFor(photoAliases().first())
        }
        val notifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                "granted"
            } else {
                stateFor(ALIAS_NOTIFICATIONS)
            }
        } else {
            "granted"
        }
        return JSObject().apply {
            put("photos", photos)
            put("notifications", notifications)
        }
    }

    /** Map Capacitor's state (`prompt`, `prompt-with-rationale`, `denied`) for a non-granted alias. */
    private fun stateFor(alias: String): String = when (getPermissionState(alias)) {
        PermissionState.GRANTED -> "granted"
        PermissionState.DENIED -> "denied"
        PermissionState.PROMPT_WITH_RATIONALE -> "prompt-with-rationale"
        else -> "prompt"
    }

    /** Permission aliases and log tag. */
    companion object {
        private const val TAG = "FileNexusNative"
        /** Full photo/video access (Android 13+). */
        const val ALIAS_PHOTOS: String = "photos"
        /** Android 14+ partial ("selected photos") access. */
        const val ALIAS_PHOTOS_PARTIAL: String = "photosPartial"
        /** Storage read access (Android 12L and older). */
        const val ALIAS_PHOTOS_LEGACY: String = "photosLegacy"
        /** Notification posting (Android 13+). */
        const val ALIAS_NOTIFICATIONS: String = "notifications"
    }
}
