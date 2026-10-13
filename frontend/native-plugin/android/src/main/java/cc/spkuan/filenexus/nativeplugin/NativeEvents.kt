package cc.spkuan.filenexus.nativeplugin

import com.getcapacitor.JSObject
import java.util.concurrent.CopyOnWriteArraySet

/**
 * In-process event bus from background components (workers, share receiver,
 * push service, APK downloader) to the plugin instance, which forwards events
 * to JavaScript while the WebView is alive.
 */
object NativeEvents {
    /** Receiver of `(eventName, payload)` pairs. */
    fun interface Listener {
        /**
         * Handle one event.
         *
         * @param eventName JS event name, e.g. `uploadProgress`.
         * @param payload Event payload.
         */
        fun onEvent(eventName: String, payload: JSObject)
    }

    private val listeners = CopyOnWriteArraySet<Listener>()

    /** Register a listener (the plugin, on load). */
    fun register(listener: Listener) {
        listeners.add(listener)
    }

    /** Unregister a listener (the plugin, on destroy). */
    fun unregister(listener: Listener) {
        listeners.remove(listener)
    }

    /** Whether a WebView is currently listening (used to decide on notifications). */
    val hasListeners: Boolean
        get() = listeners.isNotEmpty()

    /**
     * Deliver an event to every listener.
     *
     * @param eventName JS event name.
     * @param payload Event payload.
     */
    fun emit(eventName: String, payload: JSObject) {
        listeners.forEach { it.onEvent(eventName, payload) }
    }

    /**
     * Emit `uploadProgress` for a job.
     *
     * @param job Job snapshot.
     */
    fun emitUploadProgress(job: UploadJobRecord) {
        emit(
            "uploadProgress",
            JSObject().apply {
                put("jobId", job.jobId)
                put("bytesSent", job.bytesSent)
                put("bytesTotal", job.bytesTotal)
                put("state", job.state.wire)
                put("error", job.error)
            },
        )
    }
}
