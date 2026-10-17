package eu.kanade.tachiyomi.extension.all.archettu

import archettu.protocol.mangadex.MangaDexProtocol
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.source.model.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import rx.Observable
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class MangaDex : PersonalSource() {
    override val id = 790675500000000003L
    override val name = "MangaDex（日漫）· 杕"
    override val lang = "en"
    override val baseUrl = "https://mangadex.org"
    private val apiUrl = "https://api.mangadex.org"
    private val language get() = prefs.getString("language", "en").let { if (it == "ja") "ja" else "en" }
    private val entries = listOf("popular" to "热门日漫", "latest" to "最近更新", "all" to "全部日漫", "newest" to "新上架", "popular-new" to "本月热门新作",
        "top-rated" to "评分排行", "tags" to "分类／标签", "seasonal" to "当季漫画", "recommended" to "官网推荐", "selfpublished" to "自主出版")
    private var cachedManga: Triple<String, Long, JSONObject>? = null
    private var lastAt = 0L
    @Synchronized private fun api(path: String, values: List<Pair<String, String>> = emptyList()): JSONObject {
        val wait = 500 - (System.currentTimeMillis() - lastAt)
        if (wait > 0) Thread.sleep(wait)
        lastAt = System.currentTimeMillis()
        val url = "$apiUrl$path".toHttpUrl().newBuilder().apply { values.forEach { addQueryParameter(it.first, it.second) } }.build()
        val reply = JSONObject(get(url.toString()))
        if (reply.text("result") != "ok") throw IOException("MangaDex：${reply.optJSONArray("errors") ?: "接口错误"}")
        return reply
    }
    private fun localized(value: JSONObject?): String {
        if (value == null) return ""
        return value.text(language).ifEmpty { value.text("en") }.ifEmpty { value.text("ja") }.ifEmpty { value.keys().asSequence().map { value.text(it) }.firstOrNull { it.isNotEmpty() }.orEmpty() }
    }
    private fun allowed(value: JSONObject): Boolean = value.getJSONObject("attributes").let { attributes ->
        attributes.text("originalLanguage") == "ja" && (attributes.optJSONArray("availableTranslatedLanguages")?.let { array -> (0 until array.length()).map { array.optString(it) } } ?: emptyList()).contains(language)
    }
    private fun manga(value: JSONObject): SManga {
        MangaDexProtocol.requireJapanese(value)
        val attributes = value.getJSONObject("attributes")
        return SManga.create().apply {
            val mangaId = value.getString("id")
            url = "/title/$mangaId"; title = localized(attributes.optJSONObject("title")).ifBlank { mangaId }
            val relationships = value.array("relationships")
            val cover = relationships.find { it.text("type") == "cover_art" }?.optJSONObject("attributes")?.text("fileName")
            thumbnail_url = if (cover.isNullOrBlank()) "$baseUrl/favicon.ico" else "https://uploads.mangadex.org/covers/$mangaId/$cover.256.jpg"
            author = relationships.filter { it.text("type") == "author" }.joinToString { it.optJSONObject("attributes")?.text("name").orEmpty() }
            artist = relationships.filter { it.text("type") == "artist" }.joinToString { it.optJSONObject("attributes")?.text("name").orEmpty() }
            genre = attributes.array("tags").joinToString { localized(it.getJSONObject("attributes").optJSONObject("name")) }
            description = localized(attributes.optJSONObject("description"))
            status = when (attributes.text("status")) { "ongoing" -> SManga.ONGOING; "completed" -> SManga.COMPLETED; "hiatus" -> SManga.ON_HIATUS; "cancelled" -> SManga.CANCELLED; else -> SManga.UNKNOWN }
        }
    }
    private fun details(id: String): JSONObject {
        cachedManga?.takeIf { it.first == id && System.currentTimeMillis() - it.second < 60_000 }?.let { return it.third }
        return MangaDexProtocol.requireJapanese(api("/manga/$id", listOf("includes[]" to "cover_art", "includes[]" to "author", "includes[]" to "artist")).getJSONObject("data"))
            .also { cachedManga = Triple(id, System.currentTimeMillis(), it) }
    }
    override fun fetchPopularManga(page: Int) = Observable.fromCallable { listing("popular", page, "", FilterList()) }
    override fun fetchLatestUpdates(page: Int) = Observable.fromCallable { listing("latest", page, "", FilterList()) }
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList) = Observable.fromCallable {
        listing(filters.pick("entry", "popular"), page, query, filters)
    }
    private fun listing(entry: String, page: Int, keyword: String, filters: FilterList): MangasPage {
        if (keyword.isBlank() && entry in listOf("seasonal", "recommended", "selfpublished")) return curated(entry, page)
        val offset = (page - 1) * 30
        if (offset >= 10_000) throw IOException("MangaDex 超出公开 API 的 10,000 条分页范围，请缩小筛选范围。")
        val sort = filters.pick("sort").ifBlank { if (keyword.isNotBlank()) "relevance" else when (entry) { "latest" -> "latestUploadedChapter"; "newest" -> "createdAt"; "top-rated" -> "rating"; else -> "followedCount" } }
        val values = mutableListOf("originalLanguage[]" to "ja", "availableTranslatedLanguage[]" to language, "hasAvailableChapters" to "true", "limit" to minOf(30, 10_000 - offset).toString(), "offset" to offset.toString(),
            "order[$sort]" to filters.pick("direction", "desc"), "includes[]" to "cover_art", "includes[]" to "author", "includes[]" to "artist")
        if (keyword.isNotBlank()) values.add("title" to keyword)
        if (entry == "popular-new") values.add("createdAtSince" to SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(System.currentTimeMillis() - 30L * 86_400_000)))
        filters.pick("status").takeIf { it.isNotBlank() }?.let { values.add("status[]" to it) }
        filters.pick("rating").takeIf { it.isNotBlank() }?.let { values.add("contentRating[]" to it) }
        val selectedTags = filters.filterIsInstance<Filter.Group<*>>().flatMap { it.state }.filterIsInstance<TagChoice>()
        val tags = selectedTags.filter { it.isIncluded() }
        selectedTags.filter { it.isExcluded() }.forEach { values.add("excludedTags[]" to it.id) }
        tags.forEach { values.add("includedTags[]" to it.id) }
        values.add("includedTagsMode" to filters.pick("tagMode", "AND"))
        val reply = api("/manga", values)
        val batch = reply.array("data")
        return MangasPage(batch.filter(::allowed).map(::manga), batch.isNotEmpty() && offset + batch.size < minOf(reply.getInt("total"), 10_000))
    }
    private fun curated(entry: String, page: Int): MangasPage {
        val listId = when (entry) { "seasonal" -> "68ab4f4e-6f01-4898-9038-c5eee066be27"; "recommended" -> "805ba886-dd99-4aa4-b460-4bd7c7b71352"; else -> "f66ebc10-ef89-46d1-be96-bb704559e04a" }
        val ids = api("/list/$listId").getJSONObject("data").array("relationships").filter { it.text("type") == "manga" }.map { it.getString("id") }.distinct()
        val found = mutableMapOf<String, JSONObject>()
        for (chunk in ids.chunked(100)) {
            api("/manga", chunk.map { "ids[]" to it } + listOf("limit" to "100", "includes[]" to "cover_art", "includes[]" to "author", "includes[]" to "artist")).array("data").forEach { found[it.getString("id")] = it }
        }
        val all = ids.map { found[it] ?: throw IOException("MangaDex 未返回完整的书单作品。") }.filter(::allowed).map(::manga)
        val offset = (page - 1) * 30
        return paged(all.drop(offset).take(30), all.size, offset)
    }
    override fun fetchMangaDetails(manga: SManga) = Observable.fromCallable { manga(details(manga.url.substringAfterLast('/'))).apply { initialized = true } }
    override fun fetchChapterList(manga: SManga) = Observable.fromCallable {
        val id = manga.url.substringAfterLast('/')
        details(id)
        val chapters = mutableListOf<SChapter>()
        val seen = mutableSetOf<String>()
        var offset = 0
        while (true) {
            val data = api("/manga/$id/feed", listOf("translatedLanguage[]" to language, "includeExternal" to "0", "limit" to "500", "offset" to offset.toString(), "order[volume]" to "asc", "order[chapter]" to "asc", "includes[]" to "scanlation_group"))
            val batch = data.array("data")
            for (value in batch) {
                if (!seen.add(value.getString("id"))) throw IOException("MangaDex 返回重复的章节分页。")
                if (!MangaDexProtocol.readableChapter(value, id, language)) continue
                val attr = value.getJSONObject("attributes")
                val published = runCatching { SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(attr.text("publishAt"))?.time ?: 0L }.getOrDefault(0)
                if (published > System.currentTimeMillis() || attr.optBoolean("isUnavailable")) continue
                chapters.add(SChapter.create().apply {
                    url = "/chapter/${value.getString("id")}?manga=$id"
                    name = listOf(attr.text("volume").takeIf { it.isNotBlank() }?.let { "Vol.$it" }.orEmpty(), attr.text("chapter").takeIf { it.isNotBlank() }?.let { "Ch.$it" }.orEmpty(), attr.text("title")).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "未编号章节" }
                    chapter_number = attr.text("chapter").toFloatOrNull() ?: -1f; date_upload = published
                    scanlator = value.array("relationships").filter { it.text("type") == "scanlation_group" }.joinToString { it.optJSONObject("attributes")?.text("name").orEmpty() }
                })
            }
            offset += batch.size
            if (offset >= data.getInt("total")) break
            if (batch.isEmpty() || offset >= 10_000) throw IOException("MangaDex 章节目录超出可访问分页范围，未返回完整目录。")
        }
        chapters.reversed()
    }
    override fun fetchPageList(chapter: SChapter) = Observable.fromCallable {
        val chapterId = chapter.url.substringAfter("/chapter/").substringBefore('?')
        val mangaId = chapter.url.substringAfter("?manga=", "")
        if (mangaId.isBlank()) throw IOException("请刷新漫画目录后重试。")
        details(mangaId)
        val value = api("/chapter/$chapterId").getJSONObject("data")
        if (!MangaDexProtocol.readableChapter(value, mangaId, language)) throw IOException("章节语言、所属作品或访问状态不符合此源设置。")
        val reply = api("/at-home/server/$chapterId")
        val data = reply.getJSONObject("chapter")
        val saver = prefs.getString("quality", "normal") == "saver"
        val files = data.getJSONArray(if (saver) "dataSaver" else "data")
        val server = reply.getString("baseUrl")
        if (!server.startsWith("https://") || files.length() == 0 || files.length() != value.getJSONObject("attributes").getInt("pages")) throw IOException("MangaDex 返回了不完整的章节图片。")
        (0 until files.length()).map { Page(it, "", "$server/${if (saver) "data-saver" else "data"}/${data.getString("hash")}/${files.getString(it)}") }
    }
    override fun getMangaUrl(manga: SManga) = "$baseUrl${manga.url}"
    override fun getChapterUrl(chapter: SChapter) = "$baseUrl${chapter.url.substringBefore('?')}"
    private class TagChoice(val id: String, label: String) : Filter.TriState(label)
    override fun getFilterList() = FilterList(
        Choice("entry", "浏览入口", entries), Choice("sort", "排序", listOf("" to "入口默认", "followedCount" to "收藏数", "latestUploadedChapter" to "章节更新", "createdAt" to "上架时间", "rating" to "评分", "title" to "名称", "relevance" to "搜索相关度")),
        Choice("direction", "方向", listOf("desc" to "降序", "asc" to "升序")), Choice("status", "状态", listOf("" to "全部", "ongoing" to "连载", "completed" to "完结", "hiatus" to "休载", "cancelled" to "已取消")),
        Choice("rating", "内容分级", listOf("" to "网站默认", "safe" to "全年龄", "suggestive" to "含暗示", "erotica" to "成人向", "pornographic" to "限制级")),
        Choice("tagMode", "标签匹配", listOf("AND" to "同时满足", "OR" to "满足任一")),
        object : Filter.Group<TagChoice>("标签（包含／排除）", GeneratedTags.values.map { TagChoice(it.first, it.second) }) {}
    )
    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        choice(screen, "language", "章节语言", listOf("en" to "英文译文", "ja" to "日语原文"), "en")
        choice(screen, "quality", "图片质量", listOf("normal" to "原图", "saver" to "节省流量"), "normal")
    }
}
