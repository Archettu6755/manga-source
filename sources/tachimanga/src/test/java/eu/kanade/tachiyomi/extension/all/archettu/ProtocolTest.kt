package eu.kanade.tachiyomi.extension.all.archettu

import archettu.protocol.copymanga.CopyProtocol
import archettu.protocol.mangadex.MangaDexProtocol
import archettu.protocol.manhuagui.ManhuaguiProtocol
import archettu.protocol.zaimanhua.ZaimanhuaProtocol
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ProtocolTest {
    private val sites = JSONObject(javaClass.getResource("/sites.json")!!.readText())
    @Test fun copyRequestIdsAreRequiredOnlyForMainlandProtectedEndpoints() {
        for (path in listOf("comic2/test", "comic/test/group/default/chapters", "comic/test/chapter2/chapter")) {
            assertTrue(CopyProtocol.needsRequestId(path, "1")); assertFalse(CopyProtocol.needsRequestId(path, "0"))
        }
        assertFalse(CopyProtocol.needsRequestId("search/comic", "1"))
    }
    @Test fun manhuaguiUsesTheSameCompressedChaptersAndPageOrderAsJavaScript() {
        val data = sites.getJSONObject("manhuagui")
        assertEquals(data.getString("decompressed"), ManhuaguiProtocol.decompress(data.getString("compressed")))
        val regular = ManhuaguiProtocol.chapters(data.getString("detail"), "123", false)
        assertEquals(listOf("11", "22", "33"), regular.map { it.id })
        assertEquals(regular, ManhuaguiProtocol.chapters(data.getString("hiddenDetail"), "123", true))
        assertThrows(IOException::class.java) { ManhuaguiProtocol.chapters(data.getString("hiddenDetail"), "123", false) }
        assertEquals(data.getJSONArray("pages").let { array -> (0 until array.length()).map { array.getString(it) } }, ManhuaguiProtocol.pages(data.getString("packed")))
    }
    @Test fun zaimanhuaPreservesChapterGroupsPageOrderAndAccountRestrictions() {
        val data = sites.getJSONObject("zaimanhua")
        assertEquals("123", ZaimanhuaProtocol.id(data.getJSONObject("listItem")))
        assertEquals(listOf("11", "22", "33"), ZaimanhuaProtocol.chapters(data.getJSONObject("raw")).map { it.id })
        assertEquals(listOf("https://images.example/z.jpg", "https://images.example/a.jpg"), ZaimanhuaProtocol.pages(data.getJSONObject("pages")))
        assertThrows(IOException::class.java) { ZaimanhuaProtocol.pages(data.getJSONObject("pages").put("canRead", false)) }
    }
    @Test fun copySignatureMatchesTheSharedProtocol() {
        assertEquals("cb13a649c255e1eb386a35b8ee806404af85778d6ccc16f626eebf1d357c6eb0", CopyProtocol.copySignature("1700000000"))
    }
    @Test fun copyWebsiteLiteralsPreserveTitlesWhileConvertingPythonValues() {
        val value = CopyProtocol.copyLiteral("""[{'name':'None True 漫画', 'brief':None, 'enabled':True, 'hidden':False}]""").getJSONObject(0)
        assertEquals("None True 漫画", value.getString("name"))
        assertTrue(value.isNull("brief"))
        assertTrue(value.getBoolean("enabled"))
        assertFalse(value.getBoolean("hidden"))
    }
    @Test fun copyPagesUseServerOrderAndRejectTruncatedChapters() {
        val reply = JSONObject("""{"chapter":{"words":[1,0],"contents":[{"url":"https://images.example/2.jpg"},{"url":"https://images.example/1.jpg"}]}}""")
        assertEquals(listOf("https://images.example/1.jpg", "https://images.example/2.jpg"), CopyProtocol.copyPages(reply))
        reply.getJSONObject("chapter").getJSONArray("words").remove(1)
        assertThrows(IOException::class.java) { CopyProtocol.copyPages(reply) }
    }
    @Test fun mangaDexRejectsNonJapaneseOriginalsAndWrongChapterOwnership() {
        val manga = JSONObject("""{"attributes":{"originalLanguage":"ko"}}""")
        assertThrows(IOException::class.java) { MangaDexProtocol.requireJapanese(manga) }
        manga.getJSONObject("attributes").put("originalLanguage", "ja")
        assertSame(manga, MangaDexProtocol.requireJapanese(manga))
        val chapter = JSONObject("""{"attributes":{"translatedLanguage":"en","pages":2},"relationships":[{"type":"manga","id":"japanese"}]}""")
        assertTrue(MangaDexProtocol.readableChapter(chapter, "japanese", "en"))
        assertTrue(MangaDexProtocol.readableChapter(chapter, "japanese", "all"))
        assertFalse(MangaDexProtocol.readableChapter(chapter, "other", "en"))
        assertFalse(MangaDexProtocol.readableChapter(chapter, "japanese", "ko"))
        for (language in listOf("zh", "zh-hk", "en", "ja", "fr")) {
            chapter.getJSONObject("attributes").put("translatedLanguage", language)
            assertTrue(MangaDexProtocol.readableChapter(chapter, "japanese", "all"))
            assertTrue(MangaDexProtocol.readableChapter(chapter, "japanese", language))
            assertFalse(MangaDexProtocol.readableChapter(chapter, "other", "all"))
        }
        chapter.getJSONObject("attributes").put("externalUrl", "https://external.example/chapter")
        assertFalse(MangaDexProtocol.readableChapter(chapter, "japanese", "all"))
    }
}
