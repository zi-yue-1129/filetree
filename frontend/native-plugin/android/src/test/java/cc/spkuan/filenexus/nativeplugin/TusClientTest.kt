package cc.spkuan.filenexus.nativeplugin

import java.io.ByteArrayInputStream
import java.util.Base64
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Protocol-level tests of [TusClient] against a scripted HTTP server. */
class TusClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: TusClient

    /** Start a fresh mock server and a client pointed at it. */
    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val http = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build()
        client = TusClient(http, server.url("/").toString())
    }

    /** Stop the mock server. */
    @After
    fun tearDown() {
        server.shutdown()
    }

    /** Creation sends length + base64 metadata and maps an internal Location onto the server origin. */
    @Test
    fun createRewritesInternalLocationOntoServerOrigin() {
        server.enqueue(
            MockResponse().setResponseCode(201)
                .setHeader("Location", "http://backend:5168/api/upload/tus/abc123"),
        )

        val url = client.create(42L, linkedMapOf("filename" to "照片.jpg", "token" to "t0k"))

        assertEquals(server.url("/api/upload/tus/abc123").toString(), url)
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/api/upload/tus", request.path)
        assertEquals("1.0.0", request.getHeader("Tus-Resumable"))
        assertEquals("42", request.getHeader("Upload-Length"))
        val encodedName = Base64.getEncoder().encodeToString("照片.jpg".toByteArray(Charsets.UTF_8))
        val encodedToken = Base64.getEncoder().encodeToString("t0k".toByteArray(Charsets.UTF_8))
        assertEquals("filename $encodedName,token $encodedToken", request.getHeader("Upload-Metadata"))
    }

    /** HEAD on a vanished upload returns null so the caller recreates it. */
    @Test
    fun getOffsetReturnsNullWhenUploadIsGone() {
        server.enqueue(MockResponse().setResponseCode(404))
        assertNull(client.getOffset(server.url("/api/upload/tus/gone").toString()))
    }

    /** Resuming from an offset sends the remaining bytes in chunk-sized PATCH requests. */
    @Test
    fun uploadResumesFromOffsetInChunks() {
        val payload = ByteArray(10) { it.toByte() }
        server.enqueue(MockResponse().setResponseCode(204).setHeader("Upload-Offset", "8"))
        server.enqueue(MockResponse().setResponseCode(204).setHeader("Upload-Offset", "10"))
        val source = ByteArrayInputStream(payload)
        TusClient.skipFully(source, 4)
        val progress = mutableListOf<Long>()

        val finalOffset = client.upload(
            uploadUrl = server.url("/api/upload/tus/abc").toString(),
            startOffset = 4,
            length = 10,
            source = source,
            chunkSize = 4,
            onProgress = { progress.add(it) },
            isCancelled = { false },
        )

        assertEquals(10L, finalOffset)
        val first = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("PATCH", first.method)
        assertEquals("4", first.getHeader("Upload-Offset"))
        assertEquals("application/offset+octet-stream", first.getHeader("Content-Type"))
        assertArrayEquals(payload.copyOfRange(4, 8), first.body.readByteArray())
        val second = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("8", second.getHeader("Upload-Offset"))
        assertArrayEquals(payload.copyOfRange(8, 10), second.body.readByteArray())
        assertEquals(10L, progress.last())
    }

    /** 5xx responses are retryable, 401 is not. */
    @Test
    fun httpErrorsClassifyRetryability() {
        assertTrue(TusHttpException(503, "x").isRetryable)
        assertTrue(!TusHttpException(401, "x").isRetryable)
    }
}
