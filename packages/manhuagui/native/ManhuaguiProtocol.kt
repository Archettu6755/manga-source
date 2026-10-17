package archettu.protocol.manhuagui

import org.json.JSONObject
import org.jsoup.Jsoup
import java.io.IOException

object ManhuaguiProtocol {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
    // Base64 decompression follows lz-string (MIT), Copyright (c) 2013 Pieroxy.
    fun decompress(text: String): String {
        if (text.isEmpty()) return ""
        var index = 1
        var value = ALPHABET.indexOf(text[0])
        var position = 32
        fun bits(count: Int): Int {
            var result = 0
            repeat(count) { shift ->
                if (value and position != 0) result = result or (1 shl shift)
                position = position shr 1
                if (position == 0) { position = 32; value = if (index < text.length) ALPHABET.indexOf(text[index++]) else { index++; 0 } }
            }
            return result
        }
        val first = when (bits(2)) { 0 -> bits(8).toChar().toString(); 1 -> bits(16).toChar().toString(); else -> return "" }
        val dictionary = mutableListOf("", "", "", first)
        var previous = first
        val result = StringBuilder(first)
        var width = 3
        var enlarge = 4
        while (index <= text.length + 1) {
            var code = bits(width)
            when (code) {
                0 -> { dictionary.add(bits(8).toChar().toString()); code = dictionary.lastIndex; enlarge-- }
                1 -> { dictionary.add(bits(16).toChar().toString()); code = dictionary.lastIndex; enlarge-- }
                2 -> return result.toString()
            }
            if (enlarge == 0) { enlarge = 1 shl width; width++ }
            val entry = dictionary.getOrNull(code) ?: if (code == dictionary.size) previous + previous[0] else throw IOException("漫画柜压缩数据无效。")
            result.append(entry)
            dictionary.add(previous + entry[0]); enlarge--
            previous = entry
            if (enlarge == 0) { enlarge = 1 shl width; width++ }
        }
        throw IOException("漫画柜压缩数据不完整。")
    }
    private fun literal(text: String): String {
        val out = StringBuilder()
        var i = 1
        while (i < text.length - 1) {
            var c = text[i++]
            if (c == '\\') {
                c = text[i++]
                when (c) {
                    'x', 'u' -> { val length = if (c == 'x') 2 else 4; out.append(text.substring(i, i + length).toInt(16).toChar()); i += length }
                    'n' -> out.append('\n'); 'r' -> out.append('\r'); 't' -> out.append('\t')
                    else -> out.append(c)
                }
            } else out.append(c)
        }
        return out.toString()
    }
    private fun unpack(html: String): String {
        if (Regex("SMH\\.imgData\\s*\\(").containsMatchIn(html)) return html
        val quoted = "(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')"
        val match = Regex("}\\s*\\(\\s*$quoted\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*$quoted", RegexOption.DOT_MATCHES_ALL).find(html)
            ?: throw IOException("漫画柜章节脚本格式已变化。")
        val payload = literal(match.groupValues[1])
        val radix = match.groupValues[2].toInt()
        val count = match.groupValues[3].toInt()
        val encoded = literal(match.groupValues[4])
        val tail = html.substring(match.range.last + 1)
        val words = (if (Regex("^\\s*\\.split\\(").containsMatchIn(tail)) encoded else decompress(encoded)).split('|')
        fun key(n: Int): String = (if (n < radix) "" else key(n / radix)) + (if (n % radix > 35) (n % radix + 29).toChar().toString() else (n % radix).toString(36))
        val table = (0 until count).associate { key(it) to (words.getOrNull(it)?.takeIf(String::isNotEmpty) ?: key(it)) }
        return Regex("\\b\\w+\\b").replace(payload) { table[it.value] ?: it.value }
    }
    fun pages(html: String, server: String = "https://i.hamreus.com"): List<String> {
        val code = unpack(html)
        val start = code.indexOf('{', code.indexOf("SMH.imgData").coerceAtLeast(0))
        var end = -1; var depth = 0; var quote = ' '; var i = start
        while (i >= 0 && i < code.length) {
            val c = code[i]
            if (quote != ' ') { if (c == '\\') i++ else if (c == quote) quote = ' ' }
            else when (c) { '\'', '"' -> quote = c; '{' -> depth++; '}' -> { depth--; if (depth == 0) { end = i + 1; break } } }
            i++
        }
        if (start < 0 || end < 0) throw IOException("漫画柜未返回图片数据。")
        val data = JSONObject(code.substring(start, end))
        val files = data.getJSONArray("files")
        if (files.length() == 0) throw IOException("漫画柜未返回章节图片。")
        val sl = data.getJSONObject("sl")
        return (0 until files.length()).map { "$server${data.getString("path")}${files.getString(it)}?e=${sl.get("e")}&m=${sl.getString("m")}" }
    }
    data class Chapter(val id: String, val title: String, val group: String)
    fun chapters(html: String, id: String, adult: Boolean): List<Chapter> {
        val document = Jsoup.parse(html)
        val hidden = document.selectFirst("#__VIEWSTATE")
        val doc = if (hidden != null) {
            if (!adult) throw IOException("漫画柜要求确认成人提示，请在源设置中确认后重新加载。")
            Jsoup.parse(decompress(hidden.`val`()))
        } else document
        val sections = doc.select("[id^=chapter-list-]").ifEmpty { doc.select(".chapter-list") }
        val result = mutableListOf<Chapter>()
        sections.forEach { section ->
            val group = section.previousElementSiblings().firstOrNull { it.tagName() in listOf("h4", "h3") }?.text() ?: "连载"
            val uls = section.select("ul")
            val links = (if (uls.isNotEmpty()) uls.reversed().flatMap { it.select("li > a") } else section.select("li > a")).reversed()
            links.forEach { a ->
                val match = Regex("/comic/(\\d+)/(\\d+)\\.html").matchEntire(a.attr("href"))
                if (match != null && match.groupValues[1] == id) result.add(Chapter(match.groupValues[2], a.attr("title").ifEmpty { a.select("span").text().ifEmpty { a.text() } }, group))
            }
        }
        return result.distinctBy { it.id }
    }
}
