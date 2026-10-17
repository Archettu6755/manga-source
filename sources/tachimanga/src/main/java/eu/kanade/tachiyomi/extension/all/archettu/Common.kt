package eu.kanade.tachiyomi.extension.all.archettu

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.preference.EditTextPreference
import androidx.preference.ListPreference
import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.source.ConfigurableSource
import eu.kanade.tachiyomi.source.SourceFactory
import eu.kanade.tachiyomi.source.model.*
import eu.kanade.tachiyomi.source.online.HttpSource
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import rx.Observable
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import java.io.IOException

class ArchettuFactory : SourceFactory {
    override fun createSources() = listOf(CopyManga(), Komiic(), MangaDex())
}

fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
fun JSONObject.array(key: String): List<JSONObject> = optJSONArray(key)?.objects().orEmpty()
fun JSONObject.text(key: String, fallback: String = ""): String = if (isNull(key)) fallback else optString(key, fallback)
fun queryUrl(base: String, values: Map<String, Any> = emptyMap()): String = base.toHttpUrl().newBuilder().apply {
    values.forEach { (key, value) -> addQueryParameter(key, value.toString()) }
}.build().toString()
fun paged(items: List<SManga>, total: Int, offset: Int) = MangasPage(items, offset + items.size < total && items.isNotEmpty())

open class Choice(val key: String, label: String, val choices: List<Pair<String, String>>) :
    Filter.Select<String>(label, choices.map { it.second }.toTypedArray()) {
    val value get() = choices[state].first
}
fun FilterList.pick(key: String, fallback: String = "") = filterIsInstance<Choice>().find { it.key == key }?.value ?: fallback

abstract class PersonalSource : HttpSource(), ConfigurableSource {
    override val supportsLatest = true
    protected val prefs: SharedPreferences by lazy {
        Injekt.get<Application>().getSharedPreferences("source_$id", Context.MODE_PRIVATE)
    }
    protected fun get(url: String, requestHeaders: Headers = headers): String = request(Request.Builder().url(url).headers(requestHeaders).build())
    protected fun request(request: Request): String = client.newCall(request).execute().use {
        if (!it.isSuccessful) throw IOException("请求失败（HTTP ${it.code}）：${it.body?.string()?.take(180).orEmpty()}")
        it.body?.string() ?: throw IOException("服务器未返回内容。")
    }
    protected fun choice(screen: PreferenceScreen, key: String, title: String, values: List<Pair<String, String>>, default: String) {
        screen.addPreference(ListPreference(screen.context).apply {
            this.key = key; this.title = title; summary = "%s"
            entries = values.map { it.second }.toTypedArray(); entryValues = values.map { it.first }.toTypedArray()
            setDefaultValue(default)
        })
    }
    protected fun text(screen: PreferenceScreen, key: String, title: String, default: String = "", password: Boolean = false) {
        screen.addPreference(EditTextPreference(screen.context).apply {
            this.key = key; this.title = title; setDefaultValue(default)
            if (password) setOnBindEditTextListener { it.inputType = 129 }
        })
    }
    protected fun action(screen: PreferenceScreen, title: String, run: () -> String) {
        screen.addPreference(androidx.preference.SwitchPreferenceCompat(screen.context).apply {
            key = "action_${title.hashCode()}"
            this.title = title
            setDefaultValue(false)
            setOnPreferenceChangeListener { _, enabled ->
                if (enabled == true) Observable.fromCallable(run).subscribeOn(rx.schedulers.Schedulers.io()).subscribe(
                    { message -> android.os.Handler(android.os.Looper.getMainLooper()).post { android.widget.Toast.makeText(screen.context, message, 1).show() } },
                    { error -> android.os.Handler(android.os.Looper.getMainLooper()).post { android.widget.Toast.makeText(screen.context, error.message, 1).show() } })
                false
            }
        })
    }
    override fun popularMangaRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun popularMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()
    override fun latestUpdatesRequest(page: Int): Request = throw UnsupportedOperationException()
    override fun latestUpdatesParse(response: Response): MangasPage = throw UnsupportedOperationException()
    override fun searchMangaRequest(page: Int, query: String, filters: FilterList): Request = throw UnsupportedOperationException()
    override fun searchMangaParse(response: Response): MangasPage = throw UnsupportedOperationException()
    override fun mangaDetailsParse(response: Response): SManga = throw UnsupportedOperationException()
    override fun chapterListParse(response: Response): List<SChapter> = throw UnsupportedOperationException()
    override fun pageListParse(response: Response): List<Page> = throw UnsupportedOperationException()
    override fun imageUrlParse(response: Response): String = throw UnsupportedOperationException()
    override fun setupPreferenceScreen(screen: PreferenceScreen) {}
}
