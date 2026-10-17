package eu.kanade.tachiyomi.extension.all.archettu

import android.app.Application
import eu.kanade.tachiyomi.source.model.*
import org.json.JSONObject
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get

abstract class CatalogSource(private val catalogName: String) : PersonalSource() {
    protected val catalog: JSONObject by lazy { JSONObject(Injekt.get<Application>().assets.open("$catalogName-catalog.json").bufferedReader().use { it.readText() }) }
    protected val filterDefinitions get() = catalog.array("filters")
    protected fun catalogFilters() = filterDefinitions.map { filter -> Choice(filter.getString("id"), filter.getString("title"),
        filter.array("options").map { it.getString("id") to it.getString("title") }) }
    protected fun entries() = catalog.array("feeds").map { it.getString("id") to it.getString("title") }
    protected fun values(filters: FilterList): Map<String, String> = filters.filterIsInstance<Choice>().filter { it.key in filterDefinitions.map { value -> value.getString("id") } }
        .associate { it.key to it.value }
}
