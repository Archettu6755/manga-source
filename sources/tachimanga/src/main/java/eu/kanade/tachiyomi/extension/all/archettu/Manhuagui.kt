package eu.kanade.tachiyomi.extension.all.archettu

import archettu.protocol.manhuagui.ManhuaguiProtocol
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.source.model.*
import okhttp3.Headers
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import rx.Observable
import java.io.IOException

class Manhuagui : CatalogSource("manhuagui") {
    override val id = 790675500000000004L
    override val name = "漫画柜 · 杕"
    override val lang = "zh"
    override val baseUrl = "https://www.manhuagui.com"
    private var lastRequest = 0L
    private var cached: Triple<String, Long, Document>? = null
    override fun headersBuilder() = Headers.Builder().set("Referer", "$baseUrl/").set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
    @Synchronized private fun html(path: String): Document {
        val delay = 1000 - (System.currentTimeMillis() - lastRequest)
        if (delay > 0) Thread.sleep(delay)
        lastRequest = System.currentTimeMillis()
        val h = headers.newBuilder().apply { if (prefs.getBoolean("adult", false)) set("Cookie", "isAdult=1") }.build()
        return Jsoup.parse(get("$baseUrl$path", h), baseUrl)
    }
    private fun manga(element: Element): SManga? {
        val a = element.selectFirst(".book-detail dt a[href],.ell a[href]") ?: element.selectFirst("a[href^=/comic/]") ?: return null
        val path = Regex("/comic/\\d+/?").matchEntire(a.attr("href"))?.value ?: return null
        return SManga.create().apply {
            url = path; title = a.attr("title").ifEmpty { a.text() }
            thumbnail_url = element.selectFirst("img")?.let { it.absUrl(if (it.hasAttr("data-src")) "data-src" else "src") }
        }
    }
    private fun listing(doc: Document): MangasPage {
        val selector = if (doc.selectFirst(".book-result") != null) ".book-result > ul > li" else if (doc.selectFirst("td.rank-title") != null) "td.rank-title" else "#contList > li"
        if (doc.selectFirst(".book-result,#contList,td.rank-title,.result-count") == null) throw IOException("漫画柜未返回漫画列表，请先在网站核对访问提示。")
        return MangasPage(doc.select(selector).mapNotNull(::manga), doc.selectFirst("span.current + a,.pager a.next") != null)
    }
    private fun browse(key: String, page: Int, filters: FilterList): MangasPage {
        if (key == "home") {
            if (page > 1) return MangasPage(emptyList(), false)
            val doc = html("/")
            val titles = doc.select("#cmt-tab li").map { it.text() }
            prefs.edit().putString("homeSections", org.json.JSONArray(titles).toString()).apply()
            val selected = filters.pick("homeSection", "all")
            val selector = if (selected == "updates") ".update-cont li" else if (selected == "all") ".update-cont li,#cmt-cont ul.cover-list > li" else "#cmt-cont ul.cover-list:nth-of-type(${selected.toInt() + 1}) > li"
            return MangasPage(doc.select(selector).mapNotNull(::manga).distinctBy { it.url }, false)
        }
        val values = values(filters).toMutableMap()
        if (key == "completed" || key == "ongoing") values["status"] = if (key == "completed") "wanjie" else "lianzai"
        val parts = filterDefinitions.drop(1).map { values[it.getString("id")].orEmpty() }.filter(String::isNotEmpty).joinToString("_")
        if (key == "ranks" || key.startsWith("rank:")) {
            if (page > 1) return MangasPage(emptyList(), false)
            val period = if (key.startsWith("rank:")) key.substringAfter(':') else filters.pick("period", "day")
            val suffix = if (period == "day") "" else period
            val path = if (parts.isNotEmpty()) parts + (if (suffix.isNotEmpty()) "_$suffix" else "") + ".html" else if (suffix.isNotEmpty()) "$suffix.html" else ""
            return listing(html("/rank/$path"))
        }
        val sort = if (filters.pick("sort") != "default" && filters.pick("sort").isNotEmpty()) filters.pick("sort") else when (key) { "popular" -> "view"; "all", "newest", "categories" -> "index"; "top-rated" -> "rate"; else -> "update" }
        return listing(html("/list/${if (parts.isNotEmpty()) "$parts/" else ""}${sort}_p$page.html"))
    }
    override fun fetchPopularManga(page: Int) = Observable.fromCallable { browse("popular", page, FilterList()) }
    override fun fetchLatestUpdates(page: Int) = Observable.fromCallable { browse("latest", page, FilterList()) }
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList) = Observable.fromCallable {
        if (query.isBlank()) browse(filters.pick("entry", "all"), page, filters) else {
            val sort = when (filters.pick("sort")) { "view" -> "_o1"; "index" -> "_o2"; "rate" -> "_o3"; else -> "" }
            val keyword = java.net.URLEncoder.encode(query, "UTF-8").replace("+", "%20")
            listing(html("/s/${keyword}${sort}_p$page.html"))
        }
    }
    override fun getFilterList() = FilterList(Choice("entry", "浏览入口", entries() + listOf("rank:day" to "日排行", "rank:week" to "周排行", "rank:month" to "月排行", "rank:total" to "总排行")),
        Choice("period", "排行周期", listOf("day" to "日", "week" to "周", "month" to "月", "total" to "总")),
        Choice("homeSection", "首页栏目（打开首页后可重置筛选器更新栏目）", listOf("all" to "全部栏目", "updates" to "热门漫画最新更新") + org.json.JSONArray(prefs.getString("homeSections", "[]")).let { rows -> (0 until rows.length()).map { it.toString() to rows.getString(it) } }),
        Choice("sort", "排序", listOf("default" to "入口默认") + filterDefinitions[0].array("options").map { it.getString("id") to it.getString("title") }), *catalogFilters().drop(1).toTypedArray())
    private fun details(manga: SManga): Document {
        cached?.takeIf { it.first == manga.url && System.currentTimeMillis() - it.second < 60_000 }?.let { return it.third }
        return html(manga.url).also { cached = Triple(manga.url, System.currentTimeMillis(), it) }
    }
    override fun fetchMangaDetails(manga: SManga) = Observable.fromCallable {
        val doc = details(manga)
        SManga.create().apply {
            url = manga.url; title = doc.select(".book-title h1").text()
            if (title.isBlank()) throw IOException("漫画柜未返回作品详情。")
            thumbnail_url = doc.selectFirst(".hcover img")?.absUrl("src"); description = doc.select("#intro-all").text()
            author = doc.select("a[href*=/author/]").map { it.text() }.distinct().joinToString()
            genre = doc.select(".detail-list a[href*=/list/]").map { it.text() }.distinct().joinToString()
            status = if (Regex("完[结結]").containsMatchIn(doc.select("li.status").text())) SManga.COMPLETED else SManga.ONGOING
        }
    }
    override fun fetchChapterList(manga: SManga) = Observable.fromCallable {
        val comicId = Regex("/comic/(\\d+)").find(manga.url)!!.groupValues[1]
        ManhuaguiProtocol.chapters(details(manga).outerHtml(), comicId, prefs.getBoolean("adult", false)).reversed().map { value ->
            SChapter.create().apply { url = "/comic/$comicId/${value.id}.html"; name = value.title; scanlator = value.group }
        }
    }
    override fun fetchPageList(chapter: SChapter) = Observable.fromCallable {
        ManhuaguiProtocol.pages(html(chapter.url).outerHtml(), prefs.getString("imageServer", "https://i.hamreus.com")!!).mapIndexed { index, url -> Page(index, imageUrl = url) }
    }
    override fun fetchImageUrl(page: Page) = Observable.just(page.imageUrl!!)
    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        screen.addPreference(androidx.preference.SwitchPreferenceCompat(screen.context).apply {
            key = "adult"; title = "确认网站成人提示"; setDefaultValue(false)
            setOnPreferenceChangeListener { _, _ -> cached = null; true }
        })
        choice(screen, "imageServer", "图片服务器", listOf("i", "cf", "us").map { "https://$it.hamreus.com" to "$it.hamreus.com" }, "https://i.hamreus.com")
    }
}
