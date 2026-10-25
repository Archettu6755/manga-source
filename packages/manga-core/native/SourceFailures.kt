package archettu.protocol.core

import java.io.IOException
import java.net.SocketTimeoutException

class SourceException(message: String) : IOException(message)

object SourceFailures {
    fun http(code: Int, service: String): IOException = SourceException(when (code) {
        401 -> "$service 登录已失效（HTTP 401），请重新登录。"
        402 -> "$service 阅读额度已用完（HTTP 402），请在官网核对额度或等待恢复。"
        429 -> "$service 请求过于频繁（HTTP 429），请等待后再试。"
        210, 403, 451 -> "$service 访问受限（HTTP $code），请在官网查看访问或账号提示。"
        else -> "$service 请求失败（HTTP $code），请稍后再试。"
    })
    fun connection(error: IOException, host: String): IOException {
        if (error is SourceException) return error
        val service = if (host == "marketing.aiacgn.com") "CopyManga 大陆参数服务（$host）" else host
        return IOException(if (error is SocketTimeoutException || error.message.orEmpty().contains("timeout", true))
            "$service 连接超时，请检查网络或稍后再试。" else "$service 连接中断或无法建立连接，请检查网络、DNS 和当前代理设置。", error)
    }
}
