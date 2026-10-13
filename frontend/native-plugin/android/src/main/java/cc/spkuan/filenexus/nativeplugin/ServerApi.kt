package cc.spkuan.filenexus.nativeplugin

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/** Process-wide OkHttp client (connection pool shared by all native HTTP). */
object Http {
    /** Shared client with conservative timeouts for mobile networks. */
    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}

/**
 * Non-2xx response from the FileNexus API.
 *
 * @property statusCode HTTP status code.
 */
class ServerApiException(val statusCode: Int, message: String) : IOException(message)

/**
 * Device-token authenticated calls to the FileNexus API (contract §3).
 *
 * @param credentials Configured credentials; must be [DeviceCredentials.isConfigured].
 */
class ServerApi(private val credentials: DeviceCredentials) {
    init {
        require(credentials.isConfigured) { "ServerApi requires a configured device token" }
    }

    private val origin: String = checkNotNull(credentials.serverUrl).trimEnd('/')
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    /**
     * `POST /api/backup/folder` — create or fetch `相簿備份/<device_name>`.
     *
     * @return The folder id.
     * @throws ServerApiException on HTTP errors.
     */
    fun backupFolder(): String {
        val deviceName = credentials.deviceName?.takeIf { it.isNotBlank() }
            ?: throw IOException("Device name is not configured; sign in again from Settings")
        val body = JSONObject().put("device_name", deviceName).toString()
        val response = execute("POST", "/api/backup/folder", body)
        val folderId = response.opt("folder_id")
            ?: throw IOException("Backup folder response has no folder_id: $response")
        return folderId.toString()
    }

    /**
     * `PATCH /api/devices/{id}` — store the FCM token on the server.
     *
     * @param pushToken FCM registration token.
     * @throws ServerApiException on HTTP errors.
     */
    fun updatePushToken(pushToken: String) {
        val deviceId = credentials.deviceId?.takeIf { it.isNotBlank() }
            ?: throw IOException("Device id is not configured; sign in again from Settings")
        val body = JSONObject().put("push_token", pushToken).toString()
        execute("PATCH", "/api/devices/$deviceId", body)
    }

    private fun execute(method: String, path: String, jsonBody: String): JSONObject {
        val request = Request.Builder()
            .url("$origin$path")
            .method(method, jsonBody.toRequestBody(jsonType))
            .header("Authorization", "Bearer ${credentials.deviceToken}")
            .header("Accept", "application/json")
            .build()
        Http.client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ServerApiException(response.code, "$method $path failed: HTTP ${response.code} $text")
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }
}
