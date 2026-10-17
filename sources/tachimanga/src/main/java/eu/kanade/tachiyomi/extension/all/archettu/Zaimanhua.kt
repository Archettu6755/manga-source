package eu.kanade.tachiyomi.extension.all.archettu

import archettu.protocol.zaimanhua.ZaimanhuaProtocol
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.source.model.*
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import rx.Observable
import java.io.IOException
import java.security.MessageDigest

class Zaimanhua : CatalogSource("zaimanhua") {
    override val id = 790675500000000005L
    override val name = "再漫画 · 杕"
    override val lang = "zh"
    override val baseUrl = "https://manhua.zaimanhua.com"
    private val apiUrl = "https://v4api.zaimanhua.com/app/v1"
    private var lastRequest = 0L
    private var cached: Triple<String, Long, JSONObject>? = null
    override fun headersBuilder() = Headers.Builder().set("User-Agent", "Mozilla/5.0 (Linux; Android) Mobile").set("Referer", "$baseUrl/")
    private fun apiHeaders(platform: String) = headers.newBuilder().set("Platform", platform).apply {
        prefs.getString("token", "")?.takeIf(String::isNotBlank)?.let { set("Authorization", "Bearer $it") }
    }.build()
    @Synchronized private fun api(path: String, platform: String = "android", absolute: Boolean = false): Any {
        val wait = 500 - (System.currentTimeMillis() - lastRequest)
        if (wait > 0) Thread.sleep(wait)
        lastRequest = System.currentTimeMillis()
        return ZaimanhuaProtocol.data(get(if (absolute) path else "$apiUrl/$path", apiHeaders(platform)))
    }
    private fun manga(value: JSONObject) = SManga.create().apply {
        url = ZaimanhuaProtocol.id(value); title = value.text("title").ifEmpty { value.text("name") }; thumbnail_url = value.text("cover")
        author = ZaimanhuaProtocol.tags(value.opt("authors")).joinToString(); genre = ZaimanhuaProtocol.tags(value.opt("types")).joinToString()
        description = value.text("description")
        status = when { Regex("完[结結]").containsMatchIn(ZaimanhuaProtocol.tags(value.opt("status")).joinToString()) -> SManga.COMPLETED
            Regex("[连連][载載]").containsMatchIn(ZaimanhuaProtocol.tags(value.opt("status")).joinToString()) -> SManga.ONGOING; else -> SManga.UNKNOWN }
    }
    private fun listing(data: Any, page: Int): MangasPage {
        val rows = if (data is JSONArray) data else (data as JSONObject).optJSONArray("comicList") ?: data.optJSONArray("list") ?: throw IOException("再漫画列表格式已变化。")
        val total = if (data is JSONObject) data.optInt("totalNum", data.optInt("total", -1)) else -1
        return MangasPage(rows.objects().map(::manga), if (total < 0) rows.length() >= 20 else page * 20 < total)
    }
    private fun browse(key: String, page: Int, filters: FilterList): MangasPage {
        if (key == "home") {
            if (page > 1) return MangasPage(emptyList(), false)
            val home = (api("$baseUrl/api/v1/comic2/index", "pc", true) as JSONObject).getJSONObject("data")
            val selected = filters.pick("homeSection", "all")
            val fields = if (selected == "all") listOf("bannerList", "recList", "updateList", "weekRankList", "monthRankList") else listOf(selected)
            val items = fields.flatMap { field -> home.array(field).map { value ->
                if (value.has("obj_id")) value.put("id", value.get("obj_id"))
                if (value.text("authors").isEmpty()) value.put("authors", value.text("sub_title"))
                manga(value)
            } }
            return MangasPage(items.distinctBy { it.url }, false)
        }
        if (key == "web-categories") {
            val selected = filters.pick("webIndex")
            if (selected.isEmpty()) {
                val types = api("$baseUrl/api/v1/comic1/filter_type", "pc", true) as JSONObject
                val titles = mapOf("audience" to "读者群", "cate" to "作品形式", "firstLetter" to "首字母", "sortType" to "排序", "status" to "状态", "theme" to "题材", "zone" to "地区")
                val entries = types.keys().asSequence().flatMap { field -> types.array(field).asSequence().map { value ->
                    JSONObject().put("id", "$field:${value.text("val", value.text("id"))}").put("title", "${titles[field] ?: field} · ${value.text("name")}")
                } }.toList()
                prefs.edit().putString("webIndex", JSONArray(entries).toString()).apply()
                throw IOException("官网索引已加载（${entries.size} 项）。请重置筛选器，再选择“官网索引”中的条目。")
            }
            val (field, value) = selected.split(':', limit = 2)
            val url = queryUrl("$baseUrl/api/v1/comic1/filter", mapOf(field to value, "page" to page, "size" to 20))
            return listing(api(url, "pc", true), page)
        }
        if (key == "latest") return listing(api("comic/update/list/0/$page"), page)
        if (key == "popular" || key == "ranks" || key.startsWith("rank:")) {
            val pieces = key.split(':')
            val period = if (pieces.size > 1) pieces[1] else if (key == "popular") "3" else filters.pick("period", "0")
            val metric = pieces.getOrNull(2) ?: filters.pick("rank_type", "0")
            return listing(api("comic/rank/list?" + queryUrl("$apiUrl/comic/rank/list", mapOf("page" to page, "by_time" to period, "rank_type" to metric, "tag_id" to "0")).substringAfter('?')), page)
        }
        val values = mutableMapOf<String, Any>("status" to "0", "theme" to "0", "zone" to "0", "cate" to "0", "sortType" to "1")
        values.putAll(values(filters).filterKeys { it != "rank_type" })
        if (key == "completed" || key == "short") values["status"] = if (key == "completed") "2310" else "29205"
        return listing(api("comic/filter/list?" + queryUrl("$apiUrl/comic/filter/list", values + mapOf("page" to page, "size" to 20)).substringAfter('?')), page)
    }
    override fun fetchPopularManga(page: Int) = Observable.fromCallable { browse("popular", page, FilterList()) }
    override fun fetchLatestUpdates(page: Int) = Observable.fromCallable { browse("latest", page, FilterList()) }
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList) = Observable.fromCallable {
        if (query.isBlank()) browse(filters.pick("entry", "all"), page, filters) else listing(api("search/index?" + queryUrl("$apiUrl/search/index", mapOf("keyword" to query, "page" to page, "source" to "0", "sort" to "0", "size" to 20)).substringAfter('?')), page)
    }
    override fun getFilterList() = FilterList(Choice("entry", "浏览入口", entries() + listOf("rank:0" to "日排行", "rank:1" to "周排行", "rank:2" to "月排行", "rank:3" to "总排行")),
        Choice("period", "排行周期", listOf("0" to "日", "1" to "周", "2" to "月", "3" to "总")),
        Choice("homeSection", "首页栏目", listOf("all" to "全部栏目", "bannerList" to "焦点推荐", "recList" to "精品推荐", "updateList" to "最新更新", "weekRankList" to "周排行榜", "monthRankList" to "月排行榜")),
        Choice("webIndex", "官网索引（首次先选择对应入口加载）", listOf("" to "选择条目") + JSONArray(prefs.getString("webIndex", "[]")).objects().map { it.getString("id") to it.getString("title") }),
        *catalogFilters().toTypedArray())
    private fun details(id: String): JSONObject {
        cached?.takeIf { it.first == id && System.currentTimeMillis() - it.second < 60_000 }?.let { return it.third }
        val wrapper = api("comic/detail/$id?_v=2.2.5", "pc") as JSONObject
        var raw = wrapper.optJSONObject("data") ?: wrapper.optJSONObject("comicInfo") ?: throw IOException("再漫画未返回作品详情。")
        if (ZaimanhuaProtocol.id(raw) != id) throw IOException("再漫画返回了其他作品的数据。")
        if (raw.optInt("isHideChapter") == 1 && raw.optBoolean("canRead")) {
            val web = api("$baseUrl/api/v1/comic2/comic/detail?id=$id", "pc", true) as JSONObject
            (web.optJSONObject("data") ?: web.optJSONObject("comicInfo"))?.let { chapterData -> chapterData.keys().forEach { key -> raw.put(key, chapterData.get(key)) } }
        }
        if (raw.opt("canRead") == false) throw IOException("再漫画：当前账号无权读取此作品，请核对登录和账号等级。")
        cached = Triple(id, System.currentTimeMillis(), raw)
        return raw
    }
    override fun fetchMangaDetails(manga: SManga) = Observable.fromCallable { manga(details(manga.url)).apply { initialized = true } }
    override fun fetchChapterList(manga: SManga) = Observable.fromCallable {
        ZaimanhuaProtocol.chapters(details(manga.url)).reversed().map { value -> SChapter.create().apply {
            url = "${manga.url}/${value.id}"; name = value.title; scanlator = value.group; date_upload = value.date
        } }
    }
    override fun fetchPageList(chapter: SChapter) = Observable.fromCallable {
        val wrapper = api("comic/chapter/${chapter.url}?_v=2.2.5", "h5") as JSONObject
        ZaimanhuaProtocol.pages(wrapper.optJSONObject("data") ?: wrapper.optJSONObject("comicInfo") ?: JSONObject()).mapIndexed { index, url -> Page(index, imageUrl = url) }
    }
    override fun fetchImageUrl(page: Page) = Observable.just(page.imageUrl!!)
    override fun getMangaUrl(manga: SManga) = "https://m.zaimanhua.com/pages/comic/detail?id=${manga.url}"
    override fun getChapterUrl(chapter: SChapter): String { val parts = chapter.url.split('/'); return "https://m.zaimanhua.com/pages/comic/page?comic_id=${parts[0]}&chapter_id=${parts[1]}" }
    private fun login(): String {
        val username = prefs.getString("username", "").orEmpty(); val password = prefs.getString("password", "").orEmpty()
        if (username.isBlank() || password.isBlank()) throw IOException("请先填写再漫画账号和密码。")
        try {
            val md5 = MessageDigest.getInstance("MD5").digest(password.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
            val body = FormBody.Builder().add("username", username).add("passwd", md5).build()
            val data = ZaimanhuaProtocol.data(request(Request.Builder().url("https://account-api.zaimanhua.com/v1/login/passwd").headers(headers).post(body).build())) as JSONObject
            val token = (data.optJSONObject("user") ?: data.optJSONObject("userInfo"))?.text("token").orEmpty()
            if (token.isBlank()) throw IOException("再漫画未返回登录令牌。")
            prefs.edit().putString("token", token).apply(); cached = null
            return "再漫画登录成功"
        } finally { prefs.edit().remove("password").apply() }
    }
    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        text(screen, "username", "再漫画账号"); text(screen, "password", "密码（登录后清除）", password = true)
        action(screen, "登录再漫画", ::login)
        action(screen, "退出再漫画登录") { prefs.edit().remove("token").remove("password").apply(); cached = null; "已退出再漫画登录" }
    }
}
