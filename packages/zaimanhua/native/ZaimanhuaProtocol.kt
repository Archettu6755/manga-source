package archettu.protocol.zaimanhua

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

object ZaimanhuaProtocol {
    fun data(body: String): Any {
        val value = JSONObject(body)
        if (value.optInt("errno") != 0) throw IOException("再漫画：${value.optString("errmsg")}")
        return value.opt("data")?.takeIf { it != JSONObject.NULL } ?: throw IOException("再漫画未返回数据。")
    }
    fun tags(value: Any?): List<String> = when (value) {
        is JSONArray -> (0 until value.length()).map { value.getJSONObject(it).let { tag -> tag.optString("tag_name").ifEmpty { tag.optString("tagName") } } }
        is String -> value.split('/').filter(String::isNotEmpty)
        else -> emptyList()
    }
    fun id(value: JSONObject): String = listOf(value.optString("comic_id"), value.optString("id")).firstOrNull { it.isNotEmpty() && it != "0" && it != "null" }
        ?: throw IOException("再漫画未返回作品 ID。")
    fun pages(data: JSONObject): List<String> {
        if (data.opt("canRead") == false) throw IOException("再漫画：当前账号无权读取此章节，请核对登录和账号等级。")
        val images = data.optJSONArray("page_url_hd")?.takeIf { it.length() > 0 } ?: data.optJSONArray("page_url")
        if (images == null || images.length() == 0) throw IOException("再漫画未返回章节图片，请核对登录和账号权限。")
        return (0 until images.length()).map { images.getString(it).let { url -> if (url.startsWith("//")) "https:$url" else url } }
    }
    data class Chapter(val id: String, val title: String, val group: String, val date: Long)
    fun chapters(raw: JSONObject): List<Chapter> {
        if (raw.opt("canRead") == false) throw IOException("再漫画：当前账号无权读取此作品，请核对登录和账号等级。")
        val groups = raw.optJSONArray("chapters") ?: raw.optJSONArray("chapterList") ?: JSONArray()
        return (0 until groups.length()).flatMap { index ->
            val group = groups.getJSONObject(index)
            val data = group.getJSONArray("data")
            (data.length() - 1 downTo 0).map { i ->
                val chapter = data.getJSONObject(i)
                val title = chapter.getString("chapter_title").replace(Regex("^(?:连载版?)?(\\d+(?:\\.\\d+)?)([话卷])?$")) { "第${it.groupValues[1]}${it.groupValues[2].ifEmpty { "话" }}" }
                val date = chapter.optLong("updatetime").takeIf { it > 0 } ?: if (chapter.optInt("chapter_id") == raw.optInt("last_update_chapter_id")) raw.optLong("last_updatetime") else 0
                Chapter(chapter.get("chapter_id").toString(), title, group.optString("title"), date * 1000)
            }
        }.also { if (it.isEmpty()) throw IOException("再漫画未返回章节，请在官网核对作品及账号权限。") }
    }
}
