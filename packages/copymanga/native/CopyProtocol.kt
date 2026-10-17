package archettu.protocol.copymanga

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object CopyProtocol {
    fun copyLiteral(text: String): JSONArray {
        val tokens = Regex(""""(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:None|True|False)\b""")
        return JSONArray(tokens.replace(text) {
            when (it.value) { "None" -> "null"; "True" -> "true"; "False" -> "false"; else -> it.value }
        })
    }
    fun copySignature(timestamp: String): String {
        val key = "3af08590311032efe0660550a0563a53".toByteArray(Charsets.UTF_8)
        return Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
            .doFinal(timestamp.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    fun copyPages(result: JSONObject): List<String> {
        val chapter = result.getJSONObject("chapter")
        val contents = chapter.getJSONArray("contents")
        val pages = (0 until contents.length()).map { contents.getJSONObject(it) }
        val words = chapter.getJSONArray("words")
        if (pages.isEmpty() || pages.size != words.length()) throw IOException("拷贝未返回完整的章节图片。")
        val ordered = pages.mapIndexed { index, page -> words.getInt(index) to page.getString("url") }
        if (ordered.any { it.first < 0 || !it.second.startsWith("https://") } || ordered.map { it.first }.distinct().size != pages.size) {
            throw IOException("拷贝图片顺序或地址无效。")
        }
        return ordered.sortedBy { it.first }.map { it.second }
    }
}
