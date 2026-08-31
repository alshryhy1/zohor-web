package com.zohor.app.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

data class UserSession(
    val userId: String,
    val email: String,
    val accessToken: String,
    val emailVerified: Boolean,
)

@Serializable
data class Profile(
    val id: String,
    val username: String = "",
    val phone: String = "",
)

@Serializable
data class Moment(
    val id: String,
    @SerialName("media_url") val mediaUrl: String,
    val desc: String = "",
    val username: String = "",
    @SerialName("user_id") val userId: String = "",
)

@Serializable
data class MapPost(
    val id: String,
    @SerialName("media_url") val mediaUrl: String,
    val lat: Double,
    val lng: Double,
    @SerialName("expires_at") val expiresAt: String,
    val username: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class Conversation(
    val id: String,
    val type: String,
    val title: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class ChatMessage(
    val id: String,
    @SerialName("conversation_id") val conversationId: String,
    @SerialName("sender_id") val senderId: String,
    val body: String,
    @SerialName("created_at") val createdAt: String = "",
)

data class LiveBroadcast(
    val id: String,
    val channel: String,
    val hostName: String,
    val viewers: Int,
)
