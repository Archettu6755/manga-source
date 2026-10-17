package eu.kanade.tachiyomi.extension.all.archettu

import archettu.protocol.copymanga.CopyProtocol
import android.util.Base64
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.source.model.*
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import rx.Observable
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

class CopyManga : PersonalSource() {
    override val id = 790675500000000001L
    override val name = "拷贝漫画 · 杕"
    override val lang = "zh"
    override val baseUrl get() = when (prefs.getString("website", "mainland")) {
        "global" -> "https://www.copy20.com"
        "legacy" -> "https://www.mangacopy.com"
        else -> "https://www.copy4000.com"
    }
    private val region get() = prefs.getString("region", "1") ?: "1"
    private var discovered: Pair<String, String>? = null
    private var cachedDetails: Triple<String, Long, JSONObject>? = null
    private var lastRequestAt = 0L
    private val entries = listOf("popular" to "热门漫画", "latest" to "最近更新", "home" to "首页推荐", "all" to "发现／全部漫画",
        "topics" to "专题", "themes" to "题材", "ranks" to "排行榜", "recommend" to "漫画推荐", "newest" to "全新上架", "completed" to "已完结")

    private fun publicHeaders() = Headers.Builder().set("User-Agent", "COPY/3.0.9").set("source", "copyApp")
        .set("referer", "com.copymanga.app-3.0.9").set("version", "3.0.9").set("platform", "3").set("region", region)
        .set("dt", SimpleDateFormat("yyyy.MM.dd", Locale.US).format(Date()))
    override fun headersBuilder() = publicHeaders()
    override fun imageRequest(page: Page): Request = Request.Builder().url(page.imageUrl!!).headers(publicHeaders().build()).build()
    private fun appHeaders(token: Boolean = true): Headers {
        val timestamp = (System.currentTimeMillis() / 1000).toString()
        val pseudoid = prefs.getString("pseudoid", null) ?: UUID.randomUUID().toString().replace("-", "").take(16).also {
            prefs.edit().putString("pseudoid", it).apply()
        }
        return publicHeaders().set("deviceinfo", "7654321V-1234").set("device", "AP1A.240505.005").set("pseudoid", pseudoid)
            .set("authorization", if (token) "Token ${prefs.getString("token", "")}".trimEnd() else "Token")
            .set("umstring", "b4c89ca4104ea9a97750314d791520ac")
            .set("x-auth-timestamp", timestamp).set("x-auth-signature", CopyProtocol.copySignature(timestamp)).build()
    }
    @Synchronized private fun pause() {
        val wait = 1500 - (System.currentTimeMillis() - lastRequestAt)
        if (wait > 0) Thread.sleep(wait)
        lastRequestAt = System.currentTimeMillis()
    }
    private fun apiBase(): String {
        val manual = prefs.getString("api", "").orEmpty().trim().removeSuffix("/")
        if (manual.isNotBlank()) {
            val url = if (manual.startsWith("https://")) manual else "https://$manual"
            if (!Regex("https://[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}").matches(url)) throw IOException("API 域名不能包含路径、端口或账号信息。")
            return url
        }
        discovered?.takeIf { it.first == region }?.let { return it.second }
        val saved = prefs.getString("discoveredApi", "").orEmpty()
        if (saved.isNotEmpty() && prefs.getString("discoveredRegion", "") == region && System.currentTimeMillis() - prefs.getLong("discoveredAt", 0) < 86_400_000) {
            discovered = region to saved; return saved
        }
        pause()
        val result = JSONObject(get("https://api.copy-manga.com/api/v3/system/network2?platform=3", appHeaders(false)))
        if (result.optInt("code") != 200) throw IOException("拷贝网络配置获取失败：${result.text("message")}")
        val host = result.getJSONObject("results").getJSONArray("api").getJSONArray(0).getString(0)
        if (!Regex("api\\.(copy[a-z0-9-]*|mangacopy|copymanga)\\.(com|online|net|org|site)").matches(host)) throw IOException("拷贝返回了无法识别的 API 域名。")
        val url = "https://$host"
        prefs.edit().putString("discoveredApi", url).putString("discoveredRegion", region).putLong("discoveredAt", System.currentTimeMillis()).apply()
        discovered = region to url
        return url
    }
    private fun api(path: String, values: Map<String, Any> = emptyMap()): JSONObject {
        val base = apiBase()
        val requestId = if (CopyProtocol.needsRequestId(path, region)) {
            pause()
            val result = results(JSONObject(get(CopyProtocol.REQUEST_ID_URL, publicHeaders().build())))
            val value = result.text("request_id")
            if (value.isBlank()) throw IOException("拷贝未返回大陆接口所需的 request_id，请稍后重试。")
            mapOf("request_id" to value)
        } else emptyMap()
        val url = queryUrl("$base/api/v3/$path", mapOf("in_mainland" to (region == "1")) + values + requestId)
        pause()
        return results(JSONObject(get(url, appHeaders())))
    }
    private fun results(body: JSONObject): JSONObject {
        if (body.optInt("code") != 200) throw IOException("拷贝请求失败（${body.optInt("code")}）：${body.text("message")}")
        return body.optJSONObject("results") ?: throw IOException("拷贝未返回数据，请核对官网访问提示和登录状态。")
    }
    private fun web(path: String, values: Map<String, Any> = emptyMap()): Document {
        pause()
        return Jsoup.parse(get(queryUrl("$baseUrl$path", values), Headers.Builder().set("User-Agent", "Mozilla/5.0").set("Referer", "$baseUrl/").build()), baseUrl)
    }
    private fun manga(value: JSONObject) = SManga.create().apply {
        url = "/comic/${value.getString("path_word")}"; title = value.getString("name"); thumbnail_url = value.text("cover")
        author = value.array("author").joinToString { it.text("name") }
    }
    private fun cards(doc: Document, selector: String = "main"): List<SManga> = doc.select("$selector a[href*=\"/comic/\"]").mapNotNull { link ->
        val path = Regex("/comic/([^/?#]+)").find(link.attr("href"))?.groupValues?.get(1) ?: return@mapNotNull null
        val scope = link.closest(".exemptComic_Item,.specialDetailItem,.ranking-all-box,.col-auto,.carousel-item,.comicRank-yi") ?: link.parent()
        val image = scope?.selectFirst("img")
        SManga.create().apply {
            url = "/comic/$path"; title = link.text().trim().ifEmpty { scope?.selectFirst(".twoLines,.edit-txt,.specialDetailItemHeaderContentName")?.text().orEmpty() }.ifEmpty { image?.attr("alt").orEmpty() }.ifEmpty { path }
            thumbnail_url = image?.let { it.attr("data-src").ifEmpty { it.attr("src") } }?.let { if (it.startsWith("//")) "https:$it" else it }
        }
    }.groupBy { it.url }.map { (_, items) -> items.maxBy { (if (it.thumbnail_url.isNullOrEmpty()) 0 else 1000) + it.title.length } }
    private fun webList(doc: Document, page: Int, size: Int): MangasPage {
        val box = doc.selectFirst(".exemptComic-box[list]") ?: throw IOException("拷贝网页未返回漫画列表，请检查访问提示。")
        return paged(CopyProtocol.copyLiteral(box.attr("list")).objects().map(::manga), box.attr("total").toInt(), (page - 1) * size)
    }
    private fun cardPage(doc: Document, page: Int): MangasPage {
        if (doc.selectFirst("main") == null) throw IOException("拷贝网页未返回浏览内容。")
        val totalPages = Regex("/(\\d+)").find(doc.select(".page-total").text())?.groupValues?.get(1)?.toInt() ?: 1
        return MangasPage(cards(doc), page < totalPages)
    }
    private fun saveDirectory(kind: String, items: List<Pair<String, String>>) {
        prefs.edit().putString("directory_$kind", JSONArray(items.map { JSONObject().put("id", it.first).put("title", it.second) }).toString()).apply()
    }
    private fun directoryOptions(kind: String): List<Pair<String, String>> = listOf("" to "选择条目（首次先搜索加载目录）") +
        JSONArray(prefs.getString("directory_$kind", "[]")).objects().map { it.getString("id") to it.getString("title") }
    private fun loadDirectory(kind: String): Nothing {
        val entries = mutableListOf<Pair<String, String>>()
        if (kind == "themes") {
            web("/filter").select("#all a[href^=/comics?theme=],#all a[disabled]").forEach { element ->
                val title = element.clone().apply { select("span").remove() }.text().trim()
                val key = Regex("[?&]theme=([^&#]+)").find(element.attr("href"))?.groupValues?.get(1) ?: "empty:$title"
                if (title.isNotEmpty()) entries.add(key to title)
            }
        } else {
            var page = 1
            do {
                val doc = web("/topic", mapOf("limit" to 6, "offset" to (page - 1) * 6))
                val batch = doc.select(".specialContent.comic").mapNotNull { box ->
                    val id = Regex("/topic/([^/?#]+)").find(box.selectFirst("a[href*=/topic/]")?.attr("href").orEmpty())?.groupValues?.get(1)
                    id?.let { it to box.select(".specialContentImageSpan").text().ifBlank { id } }
                }
                if (batch.isEmpty() || batch.all { item -> entries.any { it.first == item.first } }) break
                entries.addAll(batch)
                val total = Regex("/(\\d+)").find(doc.select(".page-total").text())?.groupValues?.get(1)?.toInt() ?: 1
                page++
            } while (page <= total)
        }
        saveDirectory(kind, entries.distinctBy { it.first })
        throw IOException("目录已加载（${entries.size} 项）。请重置筛选器，然后在${if (kind == "themes") "题材" else "专题"}下拉框中选择条目。")
    }
    override fun fetchPopularManga(page: Int) = Observable.fromCallable { browse("popular", page, FilterList()) }
    override fun fetchLatestUpdates(page: Int) = Observable.fromCallable { browse("latest", page, FilterList()) }
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList) = Observable.fromCallable {
        if (query.isNotBlank()) {
            val offset = (page - 1) * 30
            val value = if (prefs.getString("search", "web") == "app") api("search/comic", mapOf("q" to query, "q_type" to "", "limit" to 30, "offset" to offset))
            else {
                val html = web("/search").html()
                val path = Regex("const\\s+countApi\\s*=\\s*[\"']([^\"']+)[\"']").find(html)?.groupValues?.get(1) ?: throw IOException("网页搜索接口已变化，请切换 App 搜索。")
                val url = if (path.startsWith("/api/")) "$baseUrl$path" else if (path.startsWith("$baseUrl/api/")) path else throw IOException("搜索接口地址无效。")
                results(JSONObject(get(queryUrl(url, mapOf("q" to query, "q_type" to "", "platform" to 2, "limit" to 30, "offset" to offset)), Headers.Builder().set("User-Agent", "Mozilla/5.0").set("Referer", "$baseUrl/").build())))
            }
            paged(value.array("list").map(::manga), value.getInt("total"), offset)
        } else browse(filters.pick("entry", "popular"), page, filters)
    }
    private fun browse(entry: String, page: Int, filters: FilterList): MangasPage {
        if (entry == "home") return if (page == 1) cardPage(web("/"), 1).let { MangasPage(it.mangas, false) } else MangasPage(emptyList(), false)
        if (entry == "ranks") return if (page == 1) cardPage(web("/rank", mapOf("type" to filters.pick("audience", "male"), "table" to filters.pick("period", "day"))), 1).let { MangasPage(it.mangas, false) } else MangasPage(emptyList(), false)
        if (entry in listOf("recommend", "newest")) return cardPage(web("/$entry", mapOf("limit" to 60, "offset" to (page - 1) * 60)), page)
        if (entry == "topics") {
            val topic = filters.pick("topic")
            if (topic.isBlank()) loadDirectory("topics")
            return cardPage(web("/topic/$topic", mapOf("limit" to 50, "offset" to (page - 1) * 50)), page)
        }
        val theme = filters.pick("theme")
        if (entry == "themes" && theme.isBlank()) loadDirectory("themes")
        if (theme.startsWith("empty:")) return MangasPage(emptyList(), false)
        val values = mutableMapOf<String, Any>("limit" to 50, "offset" to (page - 1) * 50,
            "ordering" to filters.pick("sort").ifBlank { if (entry == "latest") "-datetime_updated" else "-popular" })
        if (theme.isNotEmpty()) values["theme"] = theme
        val status = if (entry == "completed") "1" else filters.pick("status")
        if (status.isNotEmpty()) values["status"] = status
        filters.pick("area").takeIf { it.isNotEmpty() }?.let { values["region"] = it }
        return webList(web("/comics", values), page, 50)
    }
    private fun details(manga: SManga): JSONObject {
        val key = "${manga.url}:$region:${prefs.getString("api", "")}:${prefs.getString("token", "")}"
        cachedDetails?.takeIf { it.first == key && System.currentTimeMillis() - it.second < 60_000 }?.let { return it.third }
        return api("comic2/${manga.url.substringAfterLast('/')}", mapOf("platform" to 3)).also { cachedDetails = Triple(key, System.currentTimeMillis(), it) }
    }
    override fun fetchMangaDetails(manga: SManga) = Observable.fromCallable {
        val value = details(manga).getJSONObject("comic")
        manga(value).apply {
            description = value.text("brief"); genre = value.array("theme").joinToString { it.text("name") }
            status = if (value.optJSONObject("status")?.optInt("value") == 1) SManga.COMPLETED else SManga.ONGOING; initialized = true
        }
    }
    override fun fetchChapterList(manga: SManga) = Observable.fromCallable {
        val comicId = manga.url.substringAfterLast('/')
        val groups = details(manga).getJSONObject("groups")
        val chapters = mutableListOf<SChapter>()
        for (key in groups.keys()) {
            val group = groups.getJSONObject(key)
            var offset = 0
            val seen = mutableSetOf<String>()
            while (true) {
                val data = api("comic/$comicId/group/${group.text("path_word", key)}/chapters", mapOf("limit" to 100, "offset" to offset))
                val batch = data.array("list")
                for (value in batch) {
                    if (!seen.add(value.getString("uuid"))) throw IOException("拷贝返回重复的章节分页。")
                    chapters.add(SChapter.create().apply {
                        url = "/comic/$comicId/chapter2/${value.getString("uuid")}"; name = "${group.text("name")} · ${value.getString("name")}".trim(' ', '·')
                        chapter_number = Regex("第\\s*(\\d+(?:\\.\\d+)?)\\s*[话話章回]").find(value.text("name"))?.groupValues?.get(1)?.toFloat() ?: -1f
                        date_upload = runCatching { SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).parse(value.text("datetime_created"))?.time ?: 0L }.getOrDefault(0)
                    })
                }
                offset += batch.size
                if (offset >= data.getInt("total")) break
                if (batch.isEmpty()) throw IOException("拷贝章节目录不完整。")
            }
        }
        if (chapters.isEmpty()) throw IOException("拷贝未返回章节，请检查官网访问提示。")
        chapters.reversed()
    }
    override fun fetchPageList(chapter: SChapter) = Observable.fromCallable {
        CopyProtocol.copyPages(api(chapter.url.removePrefix("/"))).mapIndexed { index, url -> Page(index, "", url) }
    }
    override fun getMangaUrl(manga: SManga) = "$baseUrl${manga.url}"
    override fun getChapterUrl(chapter: SChapter) = "$baseUrl${chapter.url.replace("/chapter2/", "/chapter/")}"
    override fun getFilterList() = FilterList(
        Choice("entry", "浏览入口", entries), Choice("theme", "题材", directoryOptions("themes")), Choice("topic", "专题", directoryOptions("topics")),
        Choice("audience", "榜单", listOf("male" to "男频", "female" to "女频")), Choice("period", "榜单周期", listOf("day" to "日榜", "week" to "周榜", "month" to "月榜", "total" to "总榜")),
        Choice("sort", "排序", listOf("" to "入口默认", "-popular" to "热度降序", "popular" to "热度升序", "-datetime_updated" to "更新降序", "datetime_updated" to "更新升序")),
        Choice("area", "地区", listOf("" to "全部", "0" to "日漫", "1" to "韩漫", "2" to "美漫")), Choice("status", "状态", listOf("" to "全部", "0" to "连载", "1" to "完结", "2" to "短篇")))
    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        choice(screen, "website", "官网入口", listOf("mainland" to "大陆入口（copy4000）", "global" to "通用入口（copy20）", "legacy" to "原入口（mangacopy）"), "mainland")
        choice(screen, "region", "资源线路", listOf("1" to "大陆线路", "0" to "海外线路"), "1")
        text(screen, "api", "API 域名（留空自动获取）")
        choice(screen, "search", "搜索接口", listOf("web" to "网页搜索", "app" to "App 搜索"), "web")
        text(screen, "username", "拷贝账号"); text(screen, "password", "密码（仅供提交登录）", password = true)
        action(screen, "登录／刷新登录") {
            val salt = (1000..9999).random()
            val body = FormBody.Builder().add("username", prefs.getString("username", "").orEmpty())
                .add("password", Base64.encodeToString("${prefs.getString("password", "")}-$salt".toByteArray(), Base64.NO_WRAP))
                .add("salt", salt.toString()).add("authorization", "Token ").build()
            try {
                val result = results(JSONObject(request(Request.Builder().url("${apiBase()}/api/v3/login").headers(appHeaders(false)).post(body).build())))
                prefs.edit().putString("token", result.getString("token")).apply(); cachedDetails = null
                "登录成功"
            } finally { prefs.edit().remove("password").apply() }
        }
        action(screen, "刷新自动 API") { prefs.edit().remove("discoveredApi").apply(); discovered = null; cachedDetails = null; "自动 API 缓存已清除，下次请求时重新获取。" }
        action(screen, "退出登录") { prefs.edit().remove("token").remove("password").apply(); cachedDetails = null; "已退出登录" }
    }
}
