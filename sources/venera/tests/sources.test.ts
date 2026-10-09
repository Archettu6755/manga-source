import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { fixture, response, scriptFor, copyComic, komiicComic, japanese, chapter, collection } from "./fixture";
import type { ComicList, Part } from "../src/runtime";
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("scripts follow the original loader, register unique keys and preserve every explore entry", () => {
  for (const [id, count] of [["copymanga", 10], ["komiic", 15], ["mangadex", 10]] as const) {
    assert.match(scriptFor(id).split("\n")[0], /^class [a-z]+ extends ComicSource \{$/i);
    const { source, context } = fixture(id);
    assert.equal(source.key, `archettu_${id}`);
    assert.equal(source.version, id === "copymanga" ? "1.0.1" : "1.0.0");
    assert.equal(source.url, `https://archettu6755.github.io/manga-source/venera/${id}.js`);
    assert.equal(source.explore.length, count);
    assert.equal(new Set(source.explore.map(page => page.title)).size, count);
    assert.equal(typeof context.Buffer, "undefined");
    assert.equal(typeof context.document, "undefined");
    assert.equal(typeof context.URL, "undefined");
  }
});
test("CopyManga catalog sends filters, case-sensitive themes and second-page offset", async () => {
  const { source, calls } = fixture("copymanga", () => ({ body: `<main><div class="exemptComic-box" total="51" list='${JSON.stringify([copyComic])}'></div></main>` }));
  const result = await source.categoryComics.load("题材", "theme:COLOR", ["popular", "asc", "1", "2"], 2);
  assert.equal(result.maxPage, 2);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("offset"), "50");
  assert.equal(url.searchParams.get("ordering"), "popular");
  assert.equal(url.searchParams.get("theme"), "COLOR");
  assert.equal(url.searchParams.get("region"), "1");
  assert.equal(url.searchParams.get("status"), "2");
});
test("CopyManga retains empty themes and each audience's four rankings in website order", async () => {
  const card = (id: string) => `<li><a href="/comic/${id}"><img data-src="https://images.example/${id}.jpg">${id}</a></li>`;
  const { source, calls } = fixture("copymanga", call => call.url.includes("/filter")
    ? { body: '<div id="all"><a disabled>玄幻<span>(0)</span></a></div>' }
    : { body: `<main><ul class="ranking-all">${card("b")}${card("a")}</ul></main>` });
  const themes = await source.explore[3].load(1) as Part[];
  assert.equal(themes[0].viewMore!.attributes.param, "theme:empty:玄幻");
  assert.equal((await source.categoryComics.load("玄幻", "theme:empty:玄幻", [], 1)).comics.length, 0);
  const ranks = await source.explore[4].load(1) as Part[];
  assert.deepEqual(plain(ranks.map(part => part.viewMore!.attributes.param)), ["male", "female"].flatMap(channel => ["day", "week", "month", "total"].map(period => `rank:${channel}:${period}`)));
  for (const rank of ranks) {
    const comics = await source.categoryComics.load(rank.title, rank.viewMore!.attributes.param, [], 1);
    assert.deepEqual(plain(comics.comics.map(comic => comic.id)), ["b", "a"]);
    assert.equal(comics.maxPage, 1);
  }
  const previous = calls.length;
  assert.equal((await source.categoryComics.load("榜", "rank:male:day", [], 2)).comics.length, 0);
  assert.equal(calls.length, previous);
});
test("CopyManga topic directories follow all pages and navigate as categories", async () => {
  const { source, calls } = fixture("copymanga", call => {
    const second = new URL(call.url).searchParams.get("offset") === "6";
    return { body: `<main><div class="specialContent comic"><a href="/topic/${second ? "two" : "one"}"><img data-src="https://images.example/topic.jpg"></a><span class="specialContentImageSpan">专题</span></div><ul class="page-all"><li class="page-total">/2</li></ul></main>` };
  });
  const entries = await source.explore[2].load(1) as Part[];
  assert.equal(calls.length, 2);
  assert.deepEqual(plain(entries.map(entry => entry.viewMore!.attributes.param)), ["topic:one", "topic:two"]);
  assert.ok(entries.every(entry => entry.comics.length === 0));
});
test("CopyManga signed login encodes Unicode, keeps a stable device and clears only the session", async () => {
  const { source, calls, data } = fixture("copymanga", call => {
    const timestamp = call.headers["x-auth-timestamp"];
    assert.equal(call.headers["x-auth-signature"], createHmac("sha256", Buffer.from("M2FmMDg1OTAzMTEwMzJlZmUwNjYwNTUwYTA1NjNhNTM=", "base64")).update(timestamp).digest("hex"));
    return response({ code: 200, results: call.method === "POST" ? { token: "fixture-token" } : { comic: copyComic, groups: { default: { path_word: "default", name: "正篇" } } } });
  }, { api: "https://api.copy202601.com" });
  await source.account!.login("用户", "中文密码");
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("username"), "用户");
  assert.equal(Buffer.from(body.get("password")!, "base64").toString("utf8"), `中文密码-${body.get("salt")}`);
  const device = data.get("device");
  source.account!.logout();
  assert.equal(data.has("token"), false);
  assert.equal(data.get("device"), device);
  await source.account!.login("用户", "中文密码");
  assert.equal(calls[0].headers.pseudoid, calls[1].headers.pseudoid);
  assert.equal(data.has("password"), false);
});
test("CopyManga reads capped chapter pages, all groups and scrambled images", async () => {
  const { source, calls } = fixture("copymanga", call => {
    if (call.url.includes("chapter2")) return response({ code: 200, results: { chapter: { words: [1, 0], contents: [{ url: "https://images.example/2.jpg" }, { url: "https://images.example/1.jpg" }] } } });
    if (call.url.includes("/chapters")) {
      const extra = call.url.includes("/extra/");
      const offset = Number(new URL(call.url).searchParams.get("offset"));
      return response({ code: 200, results: { total: extra ? 1 : 2, offset, list: [{ uuid: extra ? "extra" : `c${offset}`, name: `第${offset + 1}话` }] } });
    }
    return response({ code: 200, results: { comic: copyComic, groups: { extra: { path_word: "extra", name: "番外" }, default: { path_word: "default", name: "正篇" } } } });
  }, { api: "https://api.copy202601.com" });
  const details = await source.comic.loadInfo("comic");
  assert.deepEqual(Object.keys(details.chapters), ["c0", "c1", "extra"]);
  assert.equal(details.chapters.extra, "番外：第1话");
  assert.deepEqual(plain((await source.comic.loadEp("comic", "c1")).images), ["https://images.example/1.jpg", "https://images.example/2.jpg"]);
  assert.equal(calls.filter(call => call.url.includes("/chapters")).length, 3);
});
test("CopyManga restricted requests stop without retrying or rotating devices", async () => {
  const { source, calls, data } = fixture("copymanga", () => response({ code: 210, message: "Restricted" }, 210), { api: "https://api.copy202601.com" });
  await assert.rejects(source.comic.loadEp("comic", "chapter"), /受限/);
  assert.equal(calls.length, 1);
  assert.ok(data.get("device"));
});

test("CopyManga mainland and overseas settings reach chapter requests and image headers", async () => {
  const settings = { api: "https://api.copy202601.com", region: "1" };
  const { source, calls } = fixture("copymanga", () => response({ code: 200, results: { chapter: { words: [0], contents: [{ url: "https://images.example/page.webp" }] } } }), settings);
  await source.comic.loadEp("comic", "chapter");
  assert.equal(new URL(calls[0].url).searchParams.get("in_mainland"), "true");
  assert.equal(calls[0].headers.region, "1");
  assert.equal((await source.comic.onImageLoad!("https://images.example/page.webp", "comic", "chapter")).headers.region, "1");
  settings.region = "0";
  await source.comic.loadEp("comic", "chapter");
  assert.equal(new URL(calls[1].url).searchParams.get("in_mainland"), "false");
  assert.equal(calls[1].headers.region, "0");
});
test("Komiic every comic entrance maps to its GraphQL field, period, status and sort", async () => {
  const { source, calls } = fixture("komiic", () => response({ data: { comics: [komiicComic] } }));
  const expected: Record<string, string> = { 最近更新: "recentUpdate", 热门漫画: "hotComics", 所有漫画: "comicByCategories", 最近上架: "comicByCategories",
    已完结: "comicByCategories", 短篇: "comicByCategories", 本周推荐: "topRecommendedComics", 本月推荐: "topRecommendedComics", 年度推荐: "topRecommendedComics", 随机发现: "randomComics" };
  for (const page of source.explore.filter(page => page.type === "multiPageComicList")) {
    await page.load(2);
    const request = JSON.parse(calls.at(-1)!.body!);
    const title = page.title.split(" · ")[1];
    assert.ok(request.query.includes(expected[title]));
    assert.equal(request.variables.pagination.offset, 30);
    if (title === "已完结") assert.equal(request.variables.pagination.status, "END");
    if (title === "短篇") assert.equal(request.variables.pagination.status, "SHORT");
    if (title === "最近上架") assert.equal(request.variables.pagination.orderBy, "DATE_CREATED");
  }
  assert.deepEqual(calls.filter(call => JSON.parse(call.body!).variables.period).map(call => JSON.parse(call.body!).variables.period), ["WEEK", "MONTH", "YEAR"]);
});
test("Komiic author directory follows pagination, caches entries and navigates to all works", async () => {
  const { source, calls } = fixture("komiic", call => {
    const request = JSON.parse(call.body!);
    if (request.operationName === "browseEntries") {
      const offset = request.variables.pagination.offset;
      assert.equal(request.variables.pagination.orderBy, "DATE_UPDATED");
      assert.equal(request.variables.pagination.asc, true);
      return response({ data: { entries: Array.from({ length: offset === 0 ? request.variables.pagination.limit : 1 }, (_, i) => ({ id: `${i + offset}`, name: `作者${i + offset}`, comicCount: 1 })) } });
    }
    return response({ data: { comics: Array.from({ length: 31 }, (_, i) => ({ ...komiicComic, id: String(i) })) } });
  });
  const entries = await source.explore[8].load(1) as Part[];
  assert.equal(entries.length, 501);
  assert.equal(entries[500].viewMore!.attributes.param, "author:500");
  assert.equal(entries[500].comics.length, 0);
  await source.explore[8].load(1);
  assert.equal(calls.length, 2);
  const result = await source.categoryComics.load("作者", "author:30", [], 2);
  assert.equal(result.comics[0].id, "30");
  assert.equal(result.maxPage, 2);
});
test("Komiic empty original/character/tag directories retain their entrances", async () => {
  const { source } = fixture("komiic", () => response({ data: { entries: [] } }));
  for (const index of [6, 7, 9, 10]) assert.deepEqual(plain(await source.explore[index].load(1)), []);
  assert.equal(source.explore.length, 15);
});
test("Komiic reference lists look up comic metadata and preserve relationship order", async () => {
  const { source } = fixture("komiic", call => response({ data: { comics: JSON.parse(call.body!).operationName === "comicByIds"
    ? [{ ...komiicComic, id: "2" }, { ...komiicComic, id: "1" }] : [{ id: "1" }, { id: "2" }] } }));
  const result = await source.categoryComics.load("原作", "original:123", [], 1);
  assert.deepEqual(plain(result.comics.map(comic => comic.id)), ["1", "2"]);
});
test("Komiic session cookies refresh once and remain confined to its own image host", async () => {
  const { source, calls, data } = fixture("komiic", call => call.url.endsWith("/auth/refresh")
    ? response({}, 204, { "Set-Cookie": ["komiic-access=new; Path=/", "komiic-refresh=refresh; Path=/"] })
    : response({ data: { comics: [komiicComic] } }), {}, { cookies: "komiic-access=old; komiic-refresh=refresh", refreshedAt: 0 });
  const [a, b] = await Promise.all([source.comic.onImageLoad!("https://komiic.com/api/image/kid", "comic", "chapter"), source.explore[0].load(1)]);
  assert.equal(calls.filter(call => call.url.endsWith("/auth/refresh")).length, 1);
  assert.equal(a.headers.Cookie, "komiic-access=new; komiic-refresh=refresh");
  assert.ok(a.headers.Referer.endsWith("/chapter/chapter/images/all"));
  const remote = await source.comic.onImageLoad!("https://komiic.com.evil.example/api/image/kid", "comic", "chapter");
  assert.equal(remote.headers.Cookie, undefined);
  assert.equal(remote.headers.Authorization, undefined);
  source.account!.logout();
  assert.equal(data.has("cookies"), false);
  assert.equal(data.has("token"), false);
});
test("Komiic chapter variants use stable IDs and image API order", async () => {
  const { source } = fixture("komiic", call => response({ data: JSON.parse(call.body!).operationName === "imagesByChapterId"
    ? { imagesByChapterId: [{ kid: "second" }, { kid: "first" }] }
    : { comicById: komiicComic, chaptersByComicId: [{ id: "c", serial: "1", type: "chapter", size: 2 }, { id: "b", serial: "1", type: "book", size: 2 }] } }));
  const details = await source.comic.loadInfo("comic");
  assert.deepEqual(Object.keys(details.chapters), ["ep:b", "ep:c"]);
  assert.deepEqual(plain((await source.comic.loadEp("comic", "c")).images), ["https://komiic.com/api/image/second", "https://komiic.com/api/image/first"]);
});
test("Komiic quota failures stop without retry", async () => {
  const { source, calls } = fixture("komiic", () => response({}, 402));
  await assert.rejects(source.comic.loadEp("comic", "chapter"), /额度/);
  assert.equal(calls.length, 1);
});
test("MangaDex every listing keeps Japanese originals and selected chapter language", async () => {
  const { source, calls, settings } = fixture("mangadex", call => response(collection([japanese,
    { ...japanese, id: "western", attributes: { ...japanese.attributes, originalLanguage: "en" } },
    { ...japanese, id: "korean", attributes: { ...japanese.attributes, originalLanguage: "ko" } }], 3, Number(new URL(call.url).searchParams.get("offset") ?? 0))));
  for (const index of [0, 1, 2, 3, 4, 5]) {
    const result = await source.explore[index].load(1) as ComicList;
    assert.deepEqual(plain(result.comics.map(comic => comic.id)), ["manga"]);
    const params = new URL(calls.at(-1)!.url).searchParams;
    assert.equal(params.get("originalLanguage[]"), "ja");
    assert.equal(params.get("availableTranslatedLanguage[]"), "en");
  }
  settings.language = "ja";
  await source.explore[0].load(2);
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get("availableTranslatedLanguage[]"), "ja");
  settings.language = "ko";
  await assert.rejects(source.explore[0].load(1), /仅支持/);
});
test("MangaDex advanced search encodes multiple tags, status and rating without dropping language restrictions", async () => {
  const { source, calls } = fixture("mangadex", () => response(collection([japanese])));
  const ids = ["391b0423-d847-456f-aff0-8b0cfc03066b", "423e2eae-a7a2-4a8b-ac03-a8351462d71d"];
  await source.search.load("漫画", ["rating", "asc", "completed", "safe", "OR", JSON.stringify(ids), JSON.stringify([ids[0]])], 1);
  const params = new URL(calls[0].url).searchParams;
  assert.deepEqual(params.getAll("includedTags[]"), ids);
  assert.deepEqual(params.getAll("excludedTags[]"), [ids[0]]);
  assert.equal(params.get("includedTagsMode"), "OR");
  assert.equal(params.get("status[]"), "completed");
  assert.equal(params.get("contentRating[]"), "safe");
  assert.equal(params.get("originalLanguage[]"), "ja");
  assert.equal(params.get("availableTranslatedLanguage[]"), "en");
});
test("native Venera option parsing preserves UUID tags and hyphenated CopyManga themes", async () => {
  const md = fixture("mangadex", () => response(collection([japanese])));
  const selected = md.source.search.optionList![5].options[0].split("-")[0];
  await md.source.search.load("Manga", ["default", "desc", "all", "default", "AND", JSON.stringify([selected])], 1);
  assert.match(new URL(md.calls[0].url).searchParams.get("includedTags[]")!, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const copy = fixture("copymanga", call => call.url.includes("/filter")
    ? { body: '<div id="all"><a href="/comics?theme=school-romance">校园恋爱<span>(1)</span></a></div>' }
    : { body: '<main><div class="exemptComic-box" total="0" list="[]"></div></main>' });
  const options = await copy.source.categoryComics.optionLoader!("漫画", "all");
  const theme = options[4].options[1].split("-")[0];
  await copy.source.categoryComics.load("漫画", "all", ["default", "desc", "all", "all", theme], 1);
  assert.equal(new URL(copy.calls.at(-1)!.url).searchParams.get("theme"), "school-romance");
});
test("CopyManga API discovery respects access restrictions without falling back to another host", async () => {
  const { source, calls } = fixture("copymanga", () => ({ status: 429, body: "Too many requests" }));
  await assert.rejects(source.comic.loadEp("comic", "chapter"), /HTTP 429/);
  assert.equal(calls.length, 1);
});
test("numeric Komiic chapter IDs preserve volume and serial order", async () => {
  const { source, calls } = fixture("komiic", call => response({ data: JSON.parse(call.body!).operationName === "imagesByChapterId"
    ? { imagesByChapterId: [{ kid: "image" }] }
    : { comicById: komiicComic, chaptersByComicId: [{ id: "2", serial: "2", type: "chapter", size: 1 }, { id: "99", serial: "1", type: "book", size: 1 }, { id: "50", serial: "1", type: "chapter", size: 1 }] } }));
  const details = await source.comic.loadInfo("comic");
  assert.deepEqual(Object.keys(details.chapters), ["ep:99", "ep:50", "ep:2"]);
  await source.comic.loadEp("comic", "ep:50");
  assert.equal(JSON.parse(calls.at(-1)!.body!).variables.chapterId, "50");
});
test("MangaDex curated lists filter origins, restore list order and retain empty lists", async () => {
  const { source, calls } = fixture("mangadex", call => response(call.url.includes("/list/")
    ? { result: "ok", data: { relationships: [{ id: "second", type: "manga" }, { id: "manga", type: "manga" }, { id: "western", type: "manga" }] } }
    : collection([japanese, { ...japanese, id: "western", attributes: { ...japanese.attributes, originalLanguage: "en" } }, { ...japanese, id: "second" }])));
  for (const index of [7, 8, 9]) {
    const result = await source.explore[index].load(1) as ComicList;
    assert.deepEqual(plain(result.comics.map(comic => comic.id)), ["second", "manga"]);
    assert.equal(new URL(calls.at(-1)!.url).searchParams.get("originalLanguage[]"), "ja");
  }
  const empty = fixture("mangadex", () => response({ result: "ok", data: { relationships: [] } }));
  assert.equal((await empty.source.explore[9].load(1) as ComicList).comics.length, 0);
  assert.equal(empty.source.explore.length, 10);
});
test("MangaDex detail, directory and images reject non-Japanese origins", async () => {
  const { source, calls } = fixture("mangadex", () => response({ result: "ok", data: { ...japanese, attributes: { ...japanese.attributes, originalLanguage: "en" } } }));
  await assert.rejects(source.comic.loadInfo("manga"), /仅收录/);
  await assert.rejects(source.comic.loadEp("manga", "chapter"), /仅收录/);
  assert.ok(calls.every(call => call.url.includes("/manga/manga?")));
});
test("MangaDex directory follows actual page size and excludes unreadable chapters", async () => {
  const { source, calls } = fixture("mangadex", call => {
    if (!call.url.includes("/feed")) return response({ result: "ok", data: japanese });
    const offset = Number(new URL(call.url).searchParams.get("offset"));
    return response(collection(offset === 0 ? [chapter] : [{ ...chapter, id: "external", attributes: { ...chapter.attributes, externalUrl: "https://example.com" } },
      { ...chapter, id: "ko", attributes: { ...chapter.attributes, translatedLanguage: "ko" } }], 3, offset));
  });
  const details = await source.comic.loadInfo("manga");
  assert.deepEqual(Object.keys(details.chapters), ["chapter"]);
  assert.deepEqual(calls.filter(call => call.url.includes("/feed")).map(call => new URL(call.url).searchParams.get("offset")), ["0", "1"]);
});
test("MangaDex images validate chapter ownership, language, page count and saver ordering", async () => {
  const { source, settings } = fixture("mangadex", call => response(call.url.includes("/chapter/") ? { result: "ok", data: chapter }
    : call.url.includes("/at-home/") ? { result: "ok", baseUrl: "https://images.example", chapter: { hash: "hash", data: ["2.jpg", "1.jpg"], dataSaver: ["2s.jpg", "1s.jpg"] } }
    : { result: "ok", data: japanese }));
  assert.deepEqual(plain((await source.comic.loadEp("manga", "chapter")).images), ["https://images.example/data/hash/2.jpg", "https://images.example/data/hash/1.jpg"]);
  settings.dataSaver = true;
  assert.deepEqual(plain((await source.comic.loadEp("manga", "chapter")).images), ["https://images.example/data-saver/hash/2s.jpg", "https://images.example/data-saver/hash/1s.jpg"]);
  settings.language = "ja";
  await assert.rejects(source.comic.loadEp("manga", "chapter"), /当前语言/);
});
test("MangaDex chapter truncation and HTTP 429 stop rather than returning partial data", async () => {
  const { source } = fixture("mangadex", call => response(call.url.includes("/feed") ? collection([], 1) : { result: "ok", data: japanese }));
  await assert.rejects(source.comic.loadInfo("manga"), /分页不完整/);
  const limited = fixture("mangadex", () => response({}, 429));
  await assert.rejects(limited.source.explore[0].load(1), /过于频繁/);
  assert.equal(limited.calls.length, 1);
});
test("Venera transport spaces consecutive calls in milliseconds for each source", async () => {
  for (const [id, interval] of [["copymanga", 1500], ["komiic", 750], ["mangadex", 500]] as const) {
    const f = fixture(id, call => id === "copymanga" ? { body: '<main><div class="exemptComic-box" total="0" list="[]"></div></main>' }
      : response(id === "komiic" ? { data: { comics: [] } } : collection([], 0, Number(new URL(call.url).searchParams.get("offset")))));
    const entry = f.source.explore.find(entry => entry.type === "multiPageComicList")!;
    await Promise.all([entry.load(1), entry.load(2), entry.load(3)]);
    assert.deepEqual(f.delays, [interval, interval]);
  }
});
test("MangaDex exposes the final ten records within the public 10,000-record limit", async () => {
  const { source, calls } = fixture("mangadex", call => response(collection([japanese], 20_000, Number(new URL(call.url).searchParams.get("offset")))));
  const result = await source.explore[2].load(334) as ComicList;
  assert.equal(result.maxPage, 334);
  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get("offset"), "9990");
  assert.equal(params.get("limit"), "10");
  await assert.rejects(source.explore[2].load(335), /分页范围/);
  assert.equal(calls.length, 1);
});
test("native default sort keeps each listing's intended order", async () => {
  const copy = fixture("copymanga", () => ({ body: '<main><div class="exemptComic-box" total="0" list="[]"></div></main>' }));
  await copy.source.categoryComics.load("热门", "popular", ["default"], 1);
  assert.equal(new URL(copy.calls[0].url).searchParams.get("ordering"), "-popular");
  const k = fixture("komiic", () => response({ data: { comics: [] } }));
  await k.source.categoryComics.load("热门", "popular", ["default"], 1);
  assert.equal(JSON.parse(k.calls[0].body!).variables.pagination.orderBy, "MONTH_VIEWS");
  await k.source.categoryComics.load("新上架", "newest", ["default"], 1);
  assert.equal(JSON.parse(k.calls[1].body!).variables.pagination.orderBy, "DATE_CREATED");
});
