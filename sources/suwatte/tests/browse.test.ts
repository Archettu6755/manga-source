import assert from "node:assert/strict";
import test from "node:test";
import CopyManga from "../src/sources/copymanga";
import Komiic from "../src/sources/komiic";
import MangaDex from "../src/sources/mangadex";
import { fixture } from "./fixture";
const comic = { id: "1", title: "漫画", imageUrl: "https://images.example/cover.jpg", status: "ONGOING" };
const manga = { id: "japanese", attributes: { originalLanguage: "ja", title: { en: "Manga" }, availableTranslatedLanguages: ["en"] }, relationships: [] };

test("CopyManga retains existing feeds, all browse entries and empty categories", async () => {
  const { source, rawSource } = fixture(CopyManga, () => ({ text: '<div id="all"><a href="/comics?theme=COLOR">彩色<span>(12)</span></a><a disabled>玄幻<span>(0)</span></a></div>' }));
  const home = await source.getHomePage();
  for (const id of ["latest", "popular", "home", "all", "topics", "themes", "ranks", "recommend", "newest", "completed"]) assert.ok(home.feeds.some(feed => feed.id === id));
  const ranks = await source.getItemPage("ranks", 1);
  assert.deepEqual(ranks.sections.map(section => section.title), ["男频", "女频"]);
  assert.equal(ranks.sections.reduce((sum, section) => sum + section.items!.length, 0), 8);
  const themes = await source.getItemPage("themes", 1);
  const empty = themes.sections[0].items!.find(item => item.title === "玄幻")!;
  assert.deepEqual(empty.destination, { list: { props: { key: "theme:empty:玄幻" }, title: "玄幻" } });
  assert.equal((await rawSource.getItemList({ key: "theme:empty:玄幻" }, 1)).total, 0);
});
test("CopyManga catalog filters and second-page offset reach the website unchanged", async () => {
  const { source, calls } = fixture(CopyManga, () => ({ text: '<main><div class="exemptComic-box" total="51" list="[{&quot;name&quot;:&quot;漫画&quot;,&quot;path_word&quot;:&quot;sample&quot;,&quot;cover&quot;:&quot;https://images.example/cover.jpg&quot;}]"></div></main>' }));
  const result = await source.getSearchResults({ filters: { theme: "COLOR", region: "1", status: "2" }, sort: { key: "popular", ascending: true } }, 2);
  assert.equal(result.isLastPage, true);
  assert.equal(result.total, 51);
  assert.deepEqual(calls[0].config?.params, { limit: 50, offset: 50, ordering: "popular", theme: "COLOR", region: "1", status: "2" });
});
test("CopyManga keeps each audience's rankings and all four periods in website order", async () => {
  const card = (id: string) => `<li class="ranking-all-box"><a href="/comic/${id}"><img data-src="https://images.example/${id}.jpg">${id}</a></li>`;
  const { source, rawSource, calls } = fixture(CopyManga, call => ({ text: `<main><ul class="ranking-all">${call.config?.params?.type === "male" ? card("a") + card("b") : card("b") + card("c")}</ul></main>` }));
  for (const period of ["day", "week", "month", "total"]) {
    assert.deepEqual((await source.getItemList({ key: `rank:male:${period}` }, 1)).items.map(item => item.id), ["a", "b"]);
    assert.deepEqual((await source.getItemList({ key: `rank:female:${period}` }, 1)).items.map(item => item.id), ["b", "c"]);
  }
  assert.deepEqual(calls.map(call => call.config?.params?.table), ["day", "day", "week", "week", "month", "month", "total", "total"]);
  assert.equal((await rawSource.getItemList({ key: "rank:male:month" }, 2)).items.length, 0);
});
test("Komiic preserves original feeds and routes category/status/sort to GraphQL", async () => {
  const { source, calls } = fixture(Komiic, () => ({ body: { data: { comics: [comic] } } }));
  const home = await source.getHomePage();
  for (const id of ["latest", "popular", "all", "categories", "elements", "authors", "originals", "characters", "recommended-month", "random"]) assert.ok(home.feeds.some(feed => feed.id === id));
  await source.getSearchResults({ filters: { category: "7", status: "END" }, sort: { key: "VIEWS", ascending: true } }, 2);
  const body = JSON.parse(String(calls[0].body));
  assert.match(body.query, /comicByCategories/);
  assert.deepEqual(body.variables.ids, ["7"]);
  assert.deepEqual(body.variables.pagination, { limit: 30, offset: 30, orderBy: "VIEWS", status: "END", asc: true });
});
test("Komiic authors navigate to their own works and recommendation periods stay distinct", async () => {
  const { source, calls } = fixture(Komiic, call => {
    const request = JSON.parse(String(call.body));
    return { body: { data: request.operationName === "browseEntries" ? { entries: [{ id: "author", name: "作者", comicCount: 1 }] } : { comics: [comic] } } };
  });
  const authors = await source.getItemList({ key: "authors" }, 1);
  assert.deepEqual(authors.items[0].destination, { list: { props: { key: "author:author" }, title: "作者" } });
  assert.equal((await source.getItemList({ key: "author:author" }, 1)).items[0].id, "1");
  await source.getItemList({ key: "recommended-year" }, 1);
  assert.equal(JSON.parse(String(calls.at(-1)!.body)).variables.period, "YEAR");
});
test("MangaDex new and curated entrances keep the original-language restriction", async () => {
  const { source, calls } = fixture(MangaDex, call => call.url.includes("/list/")
    ? { body: { result: "ok", data: { relationships: [{ id: "japanese", type: "manga" }, { id: "western", type: "manga" }] } } }
    : { body: { result: "ok", offset: 0, total: 2, data: [manga, { ...manga, id: "western", attributes: { ...manga.attributes, originalLanguage: "en" } }] } });
  assert.equal((await source.getItemList({ key: "seasonal" }, 1)).items.length, 1);
  assert.equal(new URL(calls[1].url).searchParams.get("originalLanguage[]"), "ja");
  const home = await source.getHomePage();
  for (const id of ["latest", "popular", "newest", "tags", "seasonal", "recommended", "selfpublished"]) assert.ok(home.feeds.some(feed => feed.id === id));
  await source.getItemList({ key: "newest" }, 1);
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get("order[createdAt]"), "desc");
});
test("MangaDex advanced filters are combined with the mandatory Japanese/English filters", async () => {
  const { source, calls } = fixture(MangaDex, () => ({ body: { result: "ok", offset: 0, total: 1, data: [manga] } }));
  await source.getSearchResults({ filters: { tags: { include: ["a", "b"], exclude: ["c"] }, tagsMode: "OR", status: "completed", rating: "safe" }, sort: { key: "rating", ascending: true } }, 1);
  const params = new URL(calls[0].url).searchParams;
  assert.deepEqual(params.getAll("includedTags[]"), ["a", "b"]);
  assert.deepEqual(params.getAll("excludedTags[]"), ["c"]);
  assert.equal(params.get("originalLanguage[]"), "ja");
  assert.equal(params.get("availableTranslatedLanguage[]"), "en");
  assert.equal(params.get("status[]"), "completed");
  assert.equal(params.get("order[rating]"), "asc");
});
