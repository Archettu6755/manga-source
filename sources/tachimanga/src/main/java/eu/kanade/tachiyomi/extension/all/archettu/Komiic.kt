package eu.kanade.tachiyomi.extension.all.archettu

import archettu.protocol.komiic.KomiicProtocol
import archettu.protocol.core.SourceFailures
import android.util.Base64
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.source.model.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import rx.Observable
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale

class Komiic : PersonalSource() {
    override val id = 790675500000000002L
    override val name = "Komiic · 杕"
    override val lang = "zh"
    override val baseUrl get() = KomiicProtocol.website(prefs.getString("website", null))
    private fun tokenKey(origin: String) = if (origin == KomiicProtocol.DEFAULT_WEBSITE) "token" else "token_komiic_cc"
    private fun directoryKey(kind: String) = if (baseUrl == KomiicProtocol.DEFAULT_WEBSITE) "directory_$kind" else "directory_cc_$kind"
    private val fields = "id title description status imageUrl authors { id name } categories { id name }"
    private val directories = listOf("categories", "elements", "authors", "originals", "characters")
    private val entries = listOf("popular" to "热门漫画", "latest" to "最近更新", "all" to "所有漫画", "newest" to "最近上架", "completed" to "已完结", "short" to "短篇",
        "categories" to "题材分类", "elements" to "标签", "authors" to "作者列表", "originals" to "原作", "characters" to "角色",
        "recommended-week" to "本周推荐", "recommended-month" to "本月推荐", "recommended-year" to "年度推荐", "random" to "随机发现")
    override fun headersBuilder() = Headers.Builder().set("Referer", "$baseUrl/").set("User-Agent", "Mozilla/5.0")
    private fun apiHeaders(origin: String): Headers = Headers.Builder().set("Referer", "$origin/").set("User-Agent", "Mozilla/5.0").apply {
        prefs.getString(tokenKey(origin), "")?.takeIf { it.isNotBlank() }?.let { set("Authorization", "Bearer $it") }
    }.build()
    override val client: OkHttpClient by lazy {
        val cookieStore = network.client.cookieJar
        network.client.newBuilder().retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false)
            .cookieJar(object : CookieJar {
                override fun loadForRequest(url: HttpUrl) = if (KomiicProtocol.isAccountRequest(url.toString())) cookieStore.loadForRequest(url) else emptyList()
                override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
                    if (KomiicProtocol.isAccountRequest(url.toString())) cookieStore.saveFromResponse(url, cookies)
                }
            }).addInterceptor { chain ->
            val response = chain.proceed(chain.request())
            if (!response.isSuccessful) { val code = response.code; response.close(); throw SourceFailures.http(code, "Komiic") }
            response
        }.build()
    }
    private fun refresh(origin: String) {
        val cookieToken = client.cookieJar.loadForRequest("$origin/api/query".toHttpUrl()).find { it.name == "komiic-access-token" }?.value
        val token = cookieToken ?: prefs.getString(tokenKey(origin), "")
        if (token.isNullOrBlank()) return
        val expiry = runCatching { JSONObject(String(Base64.decode(token.split('.')[1], Base64.URL_SAFE))).optLong("exp") }.getOrDefault(0)
        if (expiry == 0L || System.currentTimeMillis() + 60_000 < expiry * 1000) return
        val body = "".toRequestBody("application/json".toMediaType())
        val result = request(Request.Builder().url("$origin/auth/refresh").headers(apiHeaders(origin)).post(body).build())
        if (result.trim().startsWith("{")) JSONObject(result).text("token").takeIf { it.isNotBlank() }?.let { prefs.edit().putString(tokenKey(origin), it).apply() }
    }
    private fun query(operation: String, document: String, variables: JSONObject = JSONObject()): JSONObject {
        val origin = baseUrl
        refresh(origin)
        val body = JSONObject().put("operationName", operation).put("query", document).put("variables", variables).toString().toRequestBody("application/json".toMediaType())
        val reply = JSONObject(request(Request.Builder().url("$origin/api/query").headers(apiHeaders(origin)).post(body).build()))
        if (reply.array("errors").isNotEmpty()) throw IOException(reply.array("errors").joinToString("；") { it.text("message") })
        return reply.optJSONObject("data") ?: throw IOException("Komiic 未返回数据。")
    }
    private fun manga(value: JSONObject) = SManga.create().apply {
        url = "/comic/${value.getString("id")}"; title = value.getString("title"); thumbnail_url = KomiicProtocol.url(value.getString("imageUrl"), baseUrl)
        author = value.array("authors").joinToString { it.text("name") }; genre = value.array("categories").joinToString { it.text("name") }
        description = value.text("description"); status = when (value.text("status")) { "END" -> SManga.COMPLETED; "ONGOING" -> SManga.ONGOING; else -> SManga.UNKNOWN }
    }
    override fun fetchPopularManga(page: Int) = Observable.fromCallable { browse("popular", page, FilterList()) }
    override fun fetchLatestUpdates(page: Int) = Observable.fromCallable { browse("latest", page, FilterList()) }
    override fun fetchSearchManga(page: Int, query: String, filters: FilterList) = Observable.fromCallable {
        if (query.isNotBlank()) {
            val data = this.query("searchComicsAndAuthors", "query searchComicsAndAuthors(\$keyword: String!) { searchComicsAndAuthors(keyword: \$keyword) { comics { $fields } } }", JSONObject().put("keyword", query))
            val items = data.getJSONObject("searchComicsAndAuthors").array("comics").map(::manga)
            val offset = (page - 1) * 30
            paged(items.drop(offset).take(30), items.size, offset)
        } else browse(filters.pick("entry", "popular"), page, filters)
    }
    private fun directoryOptions(kind: String) = listOf("" to "选择条目（首次先搜索加载目录）") +
        JSONArray(prefs.getString(directoryKey(kind), "[]")).objects().map { it.getString("id") to it.getString("name") }
    private fun loadDirectory(kind: String): Nothing {
        val items = mutableListOf<JSONObject>()
        var limited = false
        if (kind == "categories" || kind == "elements") {
            val field = if (kind == "categories") "allCategory" else "allElements"
            items.addAll(query("directory", "query directory { entries: $field { id name } }").array("entries"))
        } else {
            val field = when (kind) { "authors" -> "authors"; "originals" -> "hOriginalComics"; else -> "hCharacters" }
            var offset = 0
            val seen = mutableSetOf<String>()
            while (true) {
                val pagination = JSONObject().put("limit", 100).put("offset", offset).put("orderBy", if (kind == "authors") "DATE_UPDATED" else "VIEWS").put("status", "").put("asc", kind == "authors")
                val batch = try { query("directory", "query directory(\$pagination: Pagination!, \$contentType: ContentType!) { entries: $field(pagination: \$pagination, contentType: \$contentType) { id name ${if (kind == "characters") "nameZhTw" else ""} } }", JSONObject().put("pagination", pagination).put("contentType", "REGULAR")).array("entries") }
                catch (error: IOException) { if (items.isNotEmpty() && error.message.orEmpty().contains("Offset is too large")) { limited = true; break } else throw error }
                if (batch.isEmpty()) break
                for (entry in batch) { if (!seen.add(entry.getString("id"))) throw IOException("Komiic 返回重复的目录分页。"); items.add(entry) }
                offset += batch.size
                if (batch.size < 100) break
            }
        }
        val choices = items.map { JSONObject().put("id", it.getString("id")).put("name", it.text("nameZhTw").ifEmpty { it.text("name") }) }
        prefs.edit().putString(directoryKey(kind), JSONArray(choices).toString()).apply()
        throw IOException("目录已加载（${items.size} 项${if (limited) "，网站限制了后续页" else ""}）。请重置筛选器，再选择对应目录条目。")
    }
    private fun browse(entry: String, page: Int, filters: FilterList): MangasPage {
        val offset = (page - 1) * 30
        val order = filters.pick("sort").ifBlank { when (entry) { "popular" -> "MONTH_VIEWS"; "newest" -> "DATE_CREATED"; else -> "DATE_UPDATED" } }
        val status = when (entry) { "completed" -> "END"; "short" -> "SHORT"; else -> filters.pick("status") }
        val pagination = JSONObject().put("limit", 30).put("offset", offset).put("orderBy", order).put("status", status).put("asc", filters.pick("direction") == "asc")
        if (entry in directories) {
            val selected = filters.pick(entry)
            if (selected.isBlank()) loadDirectory(entry)
            if (entry == "authors") {
                val all = query("byAuthor", "query byAuthor(\$authorId: ID!) { comics: getComicsByAuthor(authorId: \$authorId) { $fields } }", JSONObject().put("authorId", selected)).array("comics")
                return paged(all.drop(offset).take(30).map(::manga), all.size, offset)
            }
            if (entry == "originals" || entry == "characters") {
                val field = if (entry == "originals") "comicsByHOriginalComicId" else "comicsByHCharacterId"
                val arg = if (entry == "originals") "originalComicId" else "characterId"
                val ids = query("byReference", "query byReference(\$id: ID!, \$contentType: ContentType!, \$pagination: Pagination!) { comics: $field($arg: \$id, contentType: \$contentType, pagination: \$pagination) { id } }", JSONObject().put("id", selected).put("contentType", "REGULAR").put("pagination", pagination)).array("comics").map { it.getString("id") }
                if (ids.isEmpty()) return MangasPage(emptyList(), false)
                val values = query("comicByIds", "query comicByIds(\$ids: [ID]!) { comics: comicByIds(comicIds: \$ids) { $fields } }", JSONObject().put("ids", JSONArray(ids))).array("comics").associateBy { it.getString("id") }
                return MangasPage(ids.map { manga(values[it] ?: throw IOException("Komiic 未返回完整的作品信息。")) }, ids.size == 30)
            }
        }
        var field = "comicByCategories"
        var declaration = "\$ids: [ID!]!, \$pagination: Pagination!"
        var arguments = "categoryId: \$ids, pagination: \$pagination"
        var variables = JSONObject().put("pagination", pagination).put("ids", JSONArray(if (filters.pick("categories").isBlank()) emptyList<String>() else listOf(filters.pick("categories"))))
        when {
            entry == "latest" || entry == "popular" -> { field = if (entry == "latest") "recentUpdate" else "hotComics"; declaration = "\$pagination: Pagination!"; arguments = "pagination: \$pagination"; variables = JSONObject().put("pagination", pagination) }
            entry == "elements" -> { field = "comicByElements"; arguments = "elementIds: \$ids, pagination: \$pagination"; variables.put("ids", JSONArray(listOf(filters.pick("elements")))) }
            entry.startsWith("recommended-") -> { field = "topRecommendedComics"; declaration = "\$period: RecommendationPeriod!, \$pagination: Pagination!, \$contentType: ContentType"; arguments = "period: \$period, pagination: \$pagination, contentType: \$contentType"; variables = JSONObject().put("pagination", pagination).put("contentType", "REGULAR").put("period", entry.substringAfter('-').uppercase()) }
            entry == "random" -> { field = "randomComics"; declaration = "\$pagination: Pagination!, \$contentType: ContentType"; arguments = "pagination: \$pagination, contentType: \$contentType"; variables = JSONObject().put("pagination", pagination).put("contentType", "REGULAR") }
        }
        val items = query("browse", "query browse($declaration) { comics: $field($arguments) { $fields } }", variables).array("comics")
        return MangasPage(items.map(::manga), items.size == 30)
    }
    override fun fetchMangaDetails(manga: SManga) = Observable.fromCallable {
        val value = query("comicById", "query comicById(\$comicId: ID!) { comicById(comicId: \$comicId) { $fields } }", JSONObject().put("comicId", manga.url.substringAfterLast('/'))).getJSONObject("comicById")
        manga(value).apply { initialized = true }
    }
    override fun fetchChapterList(manga: SManga) = Observable.fromCallable {
        val entries = query("chaptersByComicId", "query chaptersByComicId(\$comicId: ID!) { chaptersByComicId(comicId: \$comicId) { id serial type size dateCreated } }", JSONObject().put("comicId", manga.url.substringAfterLast('/'))).array("chaptersByComicId")
        val mode = prefs.getString("chapters", "all")
        entries.filter { mode == "all" || it.text("type") == mode }.sortedWith(compareBy<JSONObject> { it.text("type") }.thenBy { it.text("serial").toDoubleOrNull() ?: -1.0 }).map { value ->
            SChapter.create().apply {
                url = "${manga.url}/chapter/${value.getString("id")}"; name = "第 ${value.text("serial")} ${if (value.text("type") == "book") "卷" else "话"} · ${value.optInt("size")}P"
                chapter_number = value.text("serial").toFloatOrNull() ?: -1f
                date_upload = runCatching { SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).parse(value.text("dateCreated"))?.time ?: 0L }.getOrDefault(0)
            }
        }.reversed()
    }
    override fun fetchPageList(chapter: SChapter) = Observable.fromCallable {
        val images = query("imagesByChapterId", "query imagesByChapterId(\$chapterId: ID!) { imagesByChapterId(chapterId: \$chapterId) { kid } }", JSONObject().put("chapterId", chapter.url.substringAfterLast('/'))).array("imagesByChapterId")
        if (images.isEmpty()) throw IOException("Komiic 未返回章节图片。")
        images.mapIndexed { index, value -> Page(index, "$baseUrl${chapter.url}/images/all", "$baseUrl/api/image/${value.getString("kid")}") }
    }
    override fun imageRequest(page: Page): Request {
        val origin = baseUrl
        val url = KomiicProtocol.url(page.imageUrl!!, origin)
        val authenticated = KomiicProtocol.isImage(url, origin)
        if (authenticated) refresh(origin)
        val requestHeaders = if (authenticated) apiHeaders(origin) else Headers.Builder().set("Referer", "$origin/").build()
        return Request.Builder().url(url).headers(requestHeaders.newBuilder().set("Referer", KomiicProtocol.url(page.url, origin)).build()).build()
    }
    override fun getMangaUrl(manga: SManga) = "$baseUrl${manga.url}"
    override fun getChapterUrl(chapter: SChapter) = "$baseUrl${chapter.url}/images/all"
    override fun getFilterList() = FilterList(*(listOf(Choice("entry", "浏览入口", entries)) +
        directories.map { kind -> Choice(kind, entries.find { it.first == kind }!!.second, directoryOptions(kind)) } + listOf(
            Choice("sort", "排序", listOf("" to "入口默认", "DATE_UPDATED" to "更新时间", "DATE_CREATED" to "上架时间", "MONTH_VIEWS" to "月阅读量", "VIEWS" to "阅读量")),
            Choice("direction", "方向", listOf("desc" to "降序", "asc" to "升序")),
            Choice("status", "状态", listOf("" to "全部", "ONGOING" to "连载", "END" to "完结", "SHORT" to "短篇")))).toTypedArray())
    override fun setupPreferenceScreen(screen: PreferenceScreen) {
        choice(screen, "website", "访问入口（两个入口分别登录）", listOf("https://komiic.com" to "komiic.com（原入口）", "https://komiic.cc" to "komiic.cc（大陆入口）"), KomiicProtocol.DEFAULT_WEBSITE)
        choice(screen, "chapters", "章节列表", listOf("all" to "卷与章节", "chapter" to "仅章节", "book" to "仅卷"), "all")
        text(screen, "email", "Komiic 邮箱"); text(screen, "password", "密码（仅供提交登录）", password = true)
        action(screen, "登录／刷新登录") {
            val origin = baseUrl
            try {
                val body = JSONObject().put("email", prefs.getString("email", "")).put("password", prefs.getString("password", "")).toString().toRequestBody("application/json".toMediaType())
                val result = request(Request.Builder().url("$origin/api/login").headers(Headers.Builder().set("Referer", "$origin/").build()).post(body).build())
                if (result.trim().startsWith("{")) JSONObject(result).text("token").takeIf { it.isNotBlank() }?.let { prefs.edit().putString(tokenKey(origin), it).apply() }
                val cookies = client.cookieJar.loadForRequest("$origin/api/query".toHttpUrl())
                if (prefs.getString(tokenKey(origin), "").isNullOrBlank() && cookies.none { it.name.startsWith("komiic-") }) throw IOException("Komiic 未返回登录会话。")
                "登录成功"
            } finally { prefs.edit().remove("password").apply() }
        }
        action(screen, "退出登录") {
            val origin = baseUrl
            prefs.edit().remove(tokenKey(origin)).remove("password").apply()
            val url = "$origin/auth/logout".toHttpUrl()
            val expired = client.cookieJar.loadForRequest(url).map { cookie ->
                Cookie.Builder().name(cookie.name).value("").domain(cookie.domain).path(cookie.path).expiresAt(0).build()
            }
            client.cookieJar.saveFromResponse(url, expired)
            "已退出登录"
        }
    }
}
