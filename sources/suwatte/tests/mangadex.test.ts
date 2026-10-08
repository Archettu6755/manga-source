import assert from "node:assert/strict";
import test from "node:test";
import MangaDex from "../src/sources/mangadex";
import { fixture, type Call } from "./fixture";
const manga = { id: "m", attributes: { originalLanguage: "ja", title: { en: "Manga" }, availableTranslatedLanguages: ["en", "ja"] },
  relationships: [{ id: "cover", type: "cover_art", attributes: { fileName: "cover.jpg" } }] };
const chapter = { id: "c", attributes: { translatedLanguage: "en", chapter: "1.5", volume: "1", pages: 2, externalUrl: null }, relationships: [{ id: "m", type: "manga" }] };
function reply(data: unknown) { return { body: { result: "ok", data } }; }
function details(call: Call) { return new URL(call.url).pathname === "/manga/m"; }

test("MangaDex search sends both filters and rejects non-Japanese originals even if API ignores filters", async () => {
  const { source, calls } = fixture(MangaDex, () => ({ body: { result: "ok", data: [manga,
    { ...manga, id: "korean", attributes: { ...manga.attributes, originalLanguage: "ko" } },
    { ...manga, id: "western", attributes: { ...manga.attributes, originalLanguage: "en" } },
    { ...manga, id: "untranslated", attributes: { ...manga.attributes, availableTranslatedLanguages: ["ko"] } }], total: 31, offset: 0, limit: 30 } }));
  const result = await source.getSearchResults({ query: "Manga" }, 1);
  assert.deepEqual(result.items.map(item => item.id), ["m"]);
  assert.equal(result.isLastPage, false);
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get("originalLanguage[]"), "ja");
  assert.equal(params.get("availableTranslatedLanguage[]"), "en");
  assert.equal(params.get("title"), "Manga");
});
test("MangaDex filters chapters and paginates using the actual server page size", async () => {
  const { source, calls } = fixture(MangaDex, call => {
    if (details(call)) return reply(manga);
    const offset = Number(new URL(call.url).searchParams.get("offset"));
    return { body: { result: "ok", offset, total: 4, limit: 2, data: offset === 0 ? [chapter,
      { ...chapter, id: "ko", attributes: { ...chapter.attributes, translatedLanguage: "ko" } }]
      : [{ ...chapter, id: "external", attributes: { ...chapter.attributes, externalUrl: "https://publisher.example/" } },
        { ...chapter, id: "c2", attributes: { ...chapter.attributes, chapter: null } }] } };
  });
  const chapters = await source.getChapters("m");
  assert.deepEqual(chapters.map(entry => entry.id), ["c", "c2"]);
  assert.deepEqual(chapters.map(entry => entry.number), [1.5, -1]);
  assert.deepEqual(calls.filter(call => call.url.includes("/feed")).map(call => new URL(call.url).searchParams.get("offset")), ["0", "2"]);
});
test("MangaDex direct content and pages cannot bypass original-language, chapter-language or ownership filters", async () => {
  for (const originalLanguage of ["ko", "en"]) {
    const { source, calls } = fixture(MangaDex, () => reply({ ...manga, attributes: { ...manga.attributes, originalLanguage } }));
    await assert.rejects(() => source.getContent("m"), /原始语言/);
    await assert.rejects(() => source.getChapterPages("m", "c"), /原始语言/);
    assert.equal(calls.some(call => call.url.includes("at-home")), false);
  }
  for (const badChapter of [
    { ...chapter, attributes: { ...chapter.attributes, translatedLanguage: "ko" } },
    { ...chapter, relationships: [{ id: "other", type: "manga" }] },
    { ...chapter, attributes: { ...chapter.attributes, externalUrl: "https://publisher.example/" } },
  ]) {
    const { source, calls } = fixture(MangaDex, call => details(call) ? reply(manga) : reply(badChapter));
    await assert.rejects(() => source.getChapterPages("m", "c"), /刷新目录/);
    assert.equal(calls.length, 2);
  }
});
test("MangaDex resolves normal and data-saver images in server order and supports only en/ja", async () => {
  const { source } = fixture(MangaDex, call => details(call) ? reply(manga) : call.url.includes("/chapter/") ? reply(chapter)
    : { body: { result: "ok", baseUrl: "https://images.example", chapter: { hash: "hash", data: ["z.jpg", "a.jpg"], dataSaver: ["z-s.jpg", "a-s.jpg"] } } });
  assert.deepEqual((await source.getChapterPages("m", "c")).map(page => page.url), ["https://images.example/data/hash/z.jpg", "https://images.example/data/hash/a.jpg"]);
  await source.onFormSubmitted("settings", { dataSaver: true });
  assert.equal((await source.getChapterPages("m", "c"))[0].url, "https://images.example/data-saver/hash/z-s.jpg");
  await assert.rejects(() => source.onFormSubmitted("settings", { language: "ko" }), /英文或日语/);
  await source.onFormSubmitted("settings", { language: "ja" });
  await assert.rejects(() => source.getChapterPages("m", "c"), /当前所选语言/);
});
test("MangaDex fails on repeated or truncated feed pages and on rate limits", async () => {
  for (const truncated of [true, false]) {
    const { source, calls } = fixture(MangaDex, call => details(call) ? reply(manga) : { body: { result: "ok", offset: Number(new URL(call.url).searchParams.get("offset")), total: 2,
      data: Number(new URL(call.url).searchParams.get("offset")) > 0 && truncated ? [] : [chapter] } });
    await assert.rejects(() => source.getChapters("m"), truncated ? /完整分页/ : /重复/);
    assert.equal(calls.length, 3);
  }
  const { source, calls } = fixture(MangaDex, () => ({ status: 429 }));
  await assert.rejects(() => source.getContent("m"), /过于频繁/);
  assert.equal(calls.length, 1);
});

test("MangaDex rejects incomplete images and non-HTTPS image servers", async () => {
  for (const atHome of [
    { baseUrl: "https://images.example", chapter: { hash: "hash", data: ["one.jpg"], dataSaver: [] } },
    { baseUrl: "http://images.example", chapter: { hash: "hash", data: ["one.jpg", "two.jpg"], dataSaver: [] } },
  ]) {
    const { source } = fixture(MangaDex, call => details(call) ? reply(manga) : call.url.includes("/chapter/") ? reply(chapter)
      : { body: { result: "ok", ...atHome } });
    await assert.rejects(() => source.getChapterPages("m", "c"), /图片数量|图片服务器/);
  }
});
