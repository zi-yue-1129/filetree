package cc.spkuan.filenexus.nativeplugin

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Android implementation of the `FileNexusNative` Capacitor plugin.
 *
 * Skeleton: every method is declared so the JS bridge exposes the full API
 * from `src/definitions.ts`; methods reject with `unimplemented` until the
 * corresponding feature lands.
 */
@CapacitorPlugin(name = "FileNexusNative")
class FileNexusNativePlugin : Plugin() {
    /** Persist server URL and device credentials. */
    @PluginMethod
    fun configure(call: PluginCall) = call.unimplemented("configure is not implemented yet")

    /** Return persisted credentials. */
    @PluginMethod
    fun getConfiguration(call: PluginCall) = call.unimplemented("getConfiguration is not implemented yet")

    /** Return native version information. */
    @PluginMethod
    fun getNativeInfo(call: PluginCall) = call.unimplemented("getNativeInfo is not implemented yet")

    /** Open the system document picker. */
    @PluginMethod
    fun pickFiles(call: PluginCall) = call.unimplemented("pickFiles is not implemented yet")

    /** Queue background TUS uploads. */
    @PluginMethod
    fun enqueueUpload(call: PluginCall) = call.unimplemented("enqueueUpload is not implemented yet")

    /** List upload jobs. */
    @PluginMethod
    fun getUploads(call: PluginCall) = call.unimplemented("getUploads is not implemented yet")

    /** Cancel one upload job. */
    @PluginMethod
    fun cancelUpload(call: PluginCall) = call.unimplemented("cancelUpload is not implemented yet")

    /** Forget finished upload jobs. */
    @PluginMethod
    fun clearFinishedUploads(call: PluginCall) = call.unimplemented("clearFinishedUploads is not implemented yet")

    /** Return pending share-sheet items. */
    @PluginMethod
    fun getSharedItems(call: PluginCall) = call.unimplemented("getSharedItems is not implemented yet")

    /** Delete pending share-sheet items. */
    @PluginMethod
    fun clearSharedItems(call: PluginCall) = call.unimplemented("clearSharedItems is not implemented yet")

    /** Configure photo backup. */
    @PluginMethod
    fun setPhotoBackup(call: PluginCall) = call.unimplemented("setPhotoBackup is not implemented yet")

    /** Return photo backup status. */
    @PluginMethod
    fun getPhotoBackupStatus(call: PluginCall) = call.unimplemented("getPhotoBackupStatus is not implemented yet")

    /** Trigger a photo backup scan. */
    @PluginMethod
    fun runPhotoBackupNow(call: PluginCall) = call.unimplemented("runPhotoBackupNow is not implemented yet")

    /** Register for FCM push. */
    @PluginMethod
    fun registerPush(call: PluginCall) = call.unimplemented("registerPush is not implemented yet")

    /** Report whether APK installs are allowed. */
    @PluginMethod
    fun canInstallPackages(call: PluginCall) = call.unimplemented("canInstallPackages is not implemented yet")

    /** Open the "install unknown apps" settings. */
    @PluginMethod
    fun openInstallPermissionSettings(call: PluginCall) =
        call.unimplemented("openInstallPermissionSettings is not implemented yet")

    /** Download, verify and install an APK update. */
    @PluginMethod
    fun installApkUpdate(call: PluginCall) = call.unimplemented("installApkUpdate is not implemented yet")
}
