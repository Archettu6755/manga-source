package archettu.protocol.komiic

import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale

object KomiicProtocol {
    const val DEFAULT_WEBSITE = "https://komiic.com"
    const val ADULT_TYPE = "H_MANGA"
    val websites = listOf(DEFAULT_WEBSITE, "https://komiic.cc")
    data class ImageTicket(val url: String, val ticket: String, val expiresAt: Long)
    private val imageHost = Regex("^https://(?:[a-z0-9-]+\\.)*komiic\\.(?:com|cc)/[^\\s#]+$", RegexOption.IGNORE_CASE)
    private val isoDate = Regex("^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d+))?(Z|[+-]\\d{2}:\\d{2})$")
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
    fun otherWebsite(value: String) = websites.first { it != website(value) }
    fun mature(contentType: String, sexualContent: Boolean, sexyLevel: Int) = contentType == ADULT_TYPE || sexualContent && sexyLevel >= 3
    fun date(value: String): Long? {
        val parts = isoDate.matchEntire(value)?.groupValues ?: return null
        val time = parts[1] + "." + parts[2].take(3).padEnd(3, '0') + if (parts[3] == "Z") "+0000" else parts[3].replace(":", "")
        return runCatching { SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US).apply { isLenient = false }.parse(time)?.time }.getOrNull()
    }
    fun ticket(kid: String, receivedKid: String, url: String, value: String, expiresAt: String, now: Long): ImageTicket {
        if (kid != receivedKid || !imageHost.matches(url) || value.isEmpty() || value.any { it.code !in 33..126 })
            throw IOException("Komiic 返回了无法验证的图片票据或图床地址。")
        val expiry = date(expiresAt)?.takeIf { it > now } ?: throw IOException("Komiic 返回了已过期或无效的图片票据，请重新打开章节。")
        return ImageTicket(url, value, expiry)
    }
    fun ticketUnsupported(message: String) = !message.contains("；") && Regex("^cannot query field [\"'`]?getImageTicket[\"'`]?\\s+on type", RegexOption.IGNORE_CASE).containsMatchIn(message)
}
