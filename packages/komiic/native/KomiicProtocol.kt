package archettu.protocol.komiic

import java.io.IOException

object KomiicProtocol {
    const val DEFAULT_WEBSITE = "https://komiic.com"
    val websites = listOf(DEFAULT_WEBSITE, "https://komiic.cc")
    fun website(value: String?): String = when {
        value.isNullOrBlank() -> DEFAULT_WEBSITE
        value in websites -> value
        else -> throw IOException("请选择 Komiic 提供的访问入口。")
    }
    fun url(value: String, origin: String): String {
        val host = website(origin).removePrefix("https://")
        return Regex("^https://((?:[a-z0-9-]+\\.)*)komiic\\.(?:com|cc)(?=[/?#]|$)", RegexOption.IGNORE_CASE)
            .replace(value) { "https://${it.groupValues[1]}$host" }
    }
    fun isImage(value: String, origin: String) = value.startsWith("${website(origin)}/api/image/")
    fun isAccountRequest(value: String) = websites.any { value.startsWith("$it/api/") || value.startsWith("$it/auth/") }
}
