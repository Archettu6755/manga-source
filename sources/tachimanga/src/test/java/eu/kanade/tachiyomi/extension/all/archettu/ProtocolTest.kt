package eu.kanade.tachiyomi.extension.all.archettu

import archettu.protocol.copymanga.CopyProtocol
import archettu.protocol.mangadex.MangaDexProtocol
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ProtocolTest {
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
