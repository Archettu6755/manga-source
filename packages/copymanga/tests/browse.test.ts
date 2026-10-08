import assert from "node:assert/strict";
import test from "node:test";
import { parseLiteral, parseComicList, parseTopics, parseThemes, parseCardList, parseHome } from "../src";

test("website literals preserve quoted titles, Unicode and booleans without evaluating code", () => {
  const value = parseLiteral("[{'name': 'None True False 漫画', 'title': 'It\\'s a book', 'author': None, 'flag': True}]") as Record<string, unknown>[];
  assert.equal(value[0].name, "None True False 漫画");
  assert.equal(value[0].title, "It's a book");
  assert.equal(value[0].author, null);
  assert.equal(value[0].flag, true);
  assert.throws(() => parseLiteral("[globalThis.injected=true]"), /格式/);
});
test("website catalog uses payload total and rejects absent payloads", () => {
  assert.deepEqual(parseComicList('<div class="exemptComic-box" total="101" list="[]"></div>', 50), { list: [], offset: 50, total: 101 });
  assert.throws(() => parseComicList("<main>Access denied</main>", 0), /未返回/);
});
test("all theme choices include empty website categories and preserve case-sensitive IDs", () => {
  const result = parseThemes('<div id="all"><a href="/comics?theme=COLOR">彩色<span>(12)</span></a><a disabled>玄幻<span>(0)</span></a></div>');
  assert.deepEqual(result, [{ name: "彩色", path_word: "COLOR", count: 12 }, { name: "玄幻", path_word: "empty:玄幻", count: 0 }]);
});
test("topic indexes use website pagination and route each collection separately", () => {
  const html = '<main><div class="specialContent comic"><a href="/topic/sample"><img data-src="https://images.example/topic.jpg"></a><span class="specialContentImageSpan">专题</span></div><ul class="page-all"><li class="page-total">/2</li></ul></main>';
  assert.equal(parseTopics(html, 0).isLastPage, false);
  assert.equal(parseTopics(html, 6).isLastPage, true);
  assert.equal(parseTopics(html, 0).list[0].id, "sample");
});
test("cards deduplicate image/title links and homepage sections retain their destinations", () => {
  const card = '<div class="exemptComic_Item"><a href="/comic/sample"><img data-src="https://images.example/cover.jpg"></a><p class="twoLines"><a href="/comic/sample">漫画</a></p></div>';
  const html = `<main><div class="correlationList">${card}</div></main>`;
  assert.equal(parseCardList(html, 0, 60).list.length, 1);
  assert.equal(parseCardList(html, 0, 60).list[0].name, "漫画");
  const home = `<main><div class="container"><h4 class="index-all-icon-left-txt">全新上架</h4><a class="index-all-icon-right-txt" href="/newest">更多</a>${card}</div><div class="container"><a href="/topic/featured"><div class="special"><h4 class="special-text-h4">精选专题</h4></div></a></div></main>`;
  const sections = parseHome(home);
  assert.equal(sections.find(section => section.title === "全新上架")?.list, "newest");
  assert.equal(sections.find(section => section.id === "home-topics")?.topics?.[0].id, "featured");
});
