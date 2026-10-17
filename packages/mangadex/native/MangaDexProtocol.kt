package archettu.protocol.mangadex

import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

object MangaDexProtocol {
    fun requireJapanese(manga: JSONObject): JSONObject {
        if (manga.getJSONObject("attributes").getString("originalLanguage") != "ja") throw IOException("此源只收录原始语言为日语的作品。")
        return manga
    }
    fun readableChapter(chapter: JSONObject, mangaId: String, language: String): Boolean {
        val attributes = chapter.getJSONObject("attributes")
        val published = attributes.optString("publishAt").takeIf { !attributes.isNull("publishAt") && it.isNotBlank() }?.let {
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(it)?.time
        } ?: 0L
        val relationships = chapter.getJSONArray("relationships")
        return attributes.optString("translatedLanguage") == language && language in listOf("en", "ja") &&
            (attributes.isNull("externalUrl") || attributes.optString("externalUrl").isBlank()) && attributes.optInt("pages") > 0 &&
            !attributes.optBoolean("isUnavailable") && published <= System.currentTimeMillis() &&
            (0 until relationships.length()).any { relationships.getJSONObject(it).let { relation -> relation.optString("type") == "manga" && relation.optString("id") == mangaId } }
    }
}
