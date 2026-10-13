package cc.spkuan.filenexus.nativeplugin

import java.io.IOException
import java.io.InputStream
import java.util.Base64
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink

/**
 * HTTP error from the TUS server.
 *
 * @property statusCode HTTP status code.
 */
class TusHttpException(val statusCode: Int, message: String) : IOException(message) {
    /** Whether retrying later may succeed (server/proxy trouble, throttling). */
    val isRetryable: Boolean
        get() = statusCode >= 500 || statusCode == 408 || statusCode == 429 || statusCode == 499
}

/** Thrown when the caller cancelled an in-flight upload. */
class TusCancelledException : IOException("Upload cancelled")

/**
 * Minimal TUS 1.0.0 client (creation + core PATCH + termination) for the
 * FileNexus backend at `/api/upload/tus`.
 *
 * Hand-rolled on OkHttp instead of tus-java-client because: the app already
 * ships OkHttp (Capgo updater) so this adds no dependency; we must rewrite the
 * `Location` header onto the configured server origin (the backend builds it
 * from `request.base_url`, which is `http://` or an internal host behind
 * Cloudflare/Docker proxies); and resume state lives in our own job store
 * rather than tus-java-client's URL store. The protocol subset is small and
 * covered by unit tests with MockWebServer.
 *
 * @param http Shared OkHttp client.
 * @param serverUrl Server origin, e.g. `https://files.example.com`.
 */
class TusClient(private val http: OkHttpClient, serverUrl: String) {
    private val serverOrigin: HttpUrl = serverUrl.trimEnd('/').toHttpUrl()

    /** Endpoint used to create uploads. */
    val creationUrl: String = serverOrigin.newBuilder().encodedPath("/api/upload/tus").build().toString()

    /**
     * Create an upload (`POST`).
     *
     * @param length Total size in bytes.
     * @param metadata `Upload-Metadata` key/values (values are base64-encoded here).
     * @return Absolute upload URL on the configured server origin.
     * @throws TusHttpException on a non-2xx response.
     */
    fun create(length: Long, metadata: Map<String, String>): String {
        val request = Request.Builder()
            .url(creationUrl)
            .post(ByteArray(0).toRequestBody(null))
            .header("Tus-Resumable", TUS_VERSION)
            .header("Upload-Length", length.toString())
            .header("Upload-Metadata", encodeMetadata(metadata))
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw TusHttpException(response.code, "TUS create failed: HTTP ${response.code} ${response.body?.string().orEmpty()}")
            }
            val location = response.header("Location")
                ?: throw IOException("TUS create response has no Location header")
            return normalizeLocation(location)
        }
    }

    /**
     * Query the server offset (`HEAD`).
     *
     * @param uploadUrl URL returned by [create].
     * @return Bytes already stored, or `null` when the upload no longer exists (404/410).
     * @throws TusHttpException on other non-2xx responses.
     */
    fun getOffset(uploadUrl: String): Long? {
        val request = Request.Builder()
            .url(uploadUrl)
            .head()
            .header("Tus-Resumable", TUS_VERSION)
            .build()
        http.newCall(request).execute().use { response ->
            if (response.code == 404 || response.code == 410) return null
            if (!response.isSuccessful) {
                throw TusHttpException(response.code, "TUS HEAD failed: HTTP ${response.code}")
            }
            return response.header("Upload-Offset")?.toLongOrNull()
                ?: throw IOException("TUS HEAD response has no valid Upload-Offset")
        }
    }

    /**
     * Upload the remaining bytes with sequential `PATCH` requests.
     *
     * @param uploadUrl URL returned by [create].
     * @param startOffset Offset reported by the server; [source] must be positioned there.
     * @param length Total size in bytes.
     * @param source Stream positioned at [startOffset].
     * @param chunkSize Maximum bytes per PATCH request.
     * @param onProgress Called with the absolute number of bytes sent so far.
     * @param isCancelled Polled between buffers; when it returns `true` the upload stops.
     * @return Final offset (equals [length] on success).
     * @throws TusCancelledException when [isCancelled] returned `true`.
     * @throws TusHttpException on a non-2xx response.
     */
    fun upload(
        uploadUrl: String,
        startOffset: Long,
        length: Long,
        source: InputStream,
        chunkSize: Int,
        onProgress: (Long) -> Unit,
        isCancelled: () -> Boolean,
    ): Long {
        require(chunkSize > 0) { "chunkSize must be positive" }
        var offset = startOffset
        val buffer = ByteArray(chunkSize)
        while (offset < length) {
            if (isCancelled()) throw TusCancelledException()
            val wanted = minOf(chunkSize.toLong(), length - offset).toInt()
            val read = readFully(source, buffer, wanted)
            if (read != wanted) {
                throw IOException("Source ended early: expected $wanted bytes at offset $offset, got $read")
            }
            val chunkStart = offset
            val body = ProgressRequestBody(buffer, read, OFFSET_MEDIA_TYPE, isCancelled) { sentInChunk ->
                onProgress(chunkStart + sentInChunk)
            }
            val request = Request.Builder()
                .url(uploadUrl)
                .patch(body)
                .header("Tus-Resumable", TUS_VERSION)
                .header("Upload-Offset", offset.toString())
                .build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw TusHttpException(response.code, "TUS PATCH failed at $offset: HTTP ${response.code} ${response.body?.string().orEmpty()}")
                }
                val newOffset = response.header("Upload-Offset")?.toLongOrNull()
                    ?: throw IOException("TUS PATCH response has no valid Upload-Offset")
                if (newOffset != offset + read) {
                    throw IOException("TUS offset mismatch: expected ${offset + read}, server has $newOffset")
                }
                offset = newOffset
            }
            onProgress(offset)
        }
        return offset
    }

    /**
     * Terminate an upload on the server (`DELETE`). A missing upload counts as terminated.
     *
     * @param uploadUrl URL returned by [create].
     * @throws TusHttpException on other non-2xx responses.
     */
    fun terminate(uploadUrl: String) {
        val request = Request.Builder()
            .url(uploadUrl)
            .delete()
            .header("Tus-Resumable", TUS_VERSION)
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful && response.code != 404 && response.code != 410) {
                throw TusHttpException(response.code, "TUS DELETE failed: HTTP ${response.code}")
            }
        }
    }

    /**
     * Map a `Location` header onto the configured server origin.
     *
     * @param location Absolute or relative URL from the server.
     * @return Absolute URL whose scheme/host/port are the configured origin
     * when it points at the TUS endpoint, otherwise the resolved URL.
     */
    fun normalizeLocation(location: String): String {
        val resolved = serverOrigin.resolve(location)
            ?: throw IOException("Invalid TUS Location header: $location")
        if (!resolved.encodedPath.startsWith("/api/upload/tus/")) return resolved.toString()
        return resolved.newBuilder()
            .scheme(serverOrigin.scheme)
            .host(serverOrigin.host)
            .port(serverOrigin.port)
            .build()
            .toString()
    }

    /** OkHttp body that reports progress while streaming a byte range. */
    private class ProgressRequestBody(
        private val data: ByteArray,
        private val count: Int,
        private val mediaType: MediaType,
        private val isCancelled: () -> Boolean,
        private val onProgress: (Long) -> Unit,
    ) : RequestBody() {
        override fun contentType(): MediaType = mediaType

        override fun contentLength(): Long = count.toLong()

        override fun writeTo(sink: BufferedSink) {
            var written = 0
            while (written < count) {
                if (isCancelled()) throw TusCancelledException()
                val segment = minOf(PROGRESS_SEGMENT, count - written)
                sink.write(data, written, segment)
                sink.flush()
                written += segment
                onProgress(written.toLong())
            }
        }
    }

    /** Constants and helpers. */
    companion object {
        /** Protocol version sent in `Tus-Resumable`. */
        const val TUS_VERSION: String = "1.0.0"
        private const val PROGRESS_SEGMENT: Int = 64 * 1024
        private val OFFSET_MEDIA_TYPE: MediaType = "application/offset+octet-stream".toMediaType()

        /**
         * Encode TUS `Upload-Metadata` (`key base64(value)` pairs, comma-separated).
         *
         * @param metadata Keys must not contain spaces or commas.
         * @return Header value.
         */
        fun encodeMetadata(metadata: Map<String, String>): String =
            metadata.entries.joinToString(",") { (key, value) ->
                require(key.isNotEmpty() && key.none { it == ' ' || it == ',' }) { "Invalid TUS metadata key: $key" }
                "$key ${Base64.getEncoder().encodeToString(value.toByteArray(Charsets.UTF_8))}"
            }

        /**
         * Read exactly [wanted] bytes unless the stream ends.
         *
         * @return Bytes actually read.
         */
        fun readFully(source: InputStream, buffer: ByteArray, wanted: Int): Int {
            var total = 0
            while (total < wanted) {
                val n = source.read(buffer, total, wanted - total)
                if (n < 0) break
                total += n
            }
            return total
        }

        /**
         * Skip exactly [count] bytes.
         *
         * @throws IOException when the stream ends first.
         */
        fun skipFully(source: InputStream, count: Long) {
            var remaining = count
            val scratch = ByteArray(64 * 1024)
            while (remaining > 0) {
                val skipped = source.skip(remaining)
                if (skipped > 0) {
                    remaining -= skipped
                    continue
                }
                // skip() may return 0 without EOF; fall back to reading.
                val n = source.read(scratch, 0, minOf(scratch.size.toLong(), remaining).toInt())
                if (n < 0) throw IOException("Stream ended while skipping to offset $count")
                remaining -= n
            }
        }
    }
}
