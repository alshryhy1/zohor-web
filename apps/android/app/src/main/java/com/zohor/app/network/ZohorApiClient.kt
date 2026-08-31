package com.zohor.app.network

import com.zohor.app.model.Profile
import com.zohor.app.model.UserSession
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class ZohorApiClient(
    private val baseUrl: String,
    private val sessionProvider: suspend () -> UserSession?,
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun profile(): Profile {
        return request("/api/profile", "GET")
    }

    suspend fun updateProfile(phone: String, username: String? = null) {
        request<EmptyResponse, ProfileBody>("/api/profile", "POST", ProfileBody(phone, username))
    }

    suspend fun listConversations() {
        request<EmptyResponse, ChatAction>("/api/chat", "POST", ChatAction("list_conversations"))
    }

    private suspend inline fun <reified Response : Any> request(
        path: String,
        method: String,
    ): Response = request<Response, EmptyBody>(path, method, null)

    private suspend inline fun <reified Response : Any, reified Body : Any> request(
        path: String,
        method: String,
        body: Body?,
    ): Response {
        val session = sessionProvider() ?: throw ZohorApiException("missing_session", "Missing session")
        val builder = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .addHeader("Authorization", "Bearer ${session.accessToken}")

        if (body != null) {
            builder.method(method, json.encodeToString(body).toRequestBody(mediaType))
        } else {
            builder.method(method, null)
        }

        val response = httpClient.newCall(builder.build()).execute()
        val responseBody = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            val failure = runCatching { json.decodeFromString<ApiError>(responseBody) }.getOrNull()
            throw ZohorApiException(failure?.code ?: "server_error", failure?.message ?: "Request failed")
        }
        if (Response::class == EmptyResponse::class) return EmptyResponse as Response
        return json.decodeFromString(responseBody)
    }
}

class ZohorApiException(val code: String, override val message: String) : Exception(message)

@Serializable
private data class ApiError(val code: String? = null, val message: String? = null)

@Serializable
private data class ProfileBody(val phone: String, val username: String? = null)

@Serializable
private data class ChatAction(val action: String)

@Serializable
private data object EmptyBody

@Serializable
private data object EmptyResponse
