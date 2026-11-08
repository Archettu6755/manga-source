import assert from "node:assert/strict";
import test from "node:test";
import { fixture, komiicComic, response } from "./fixture";
import type { ComicList } from "../src/runtime";

test("Komiic gets a signed ticket only when loading an image, coalesces concurrent calls and isolates credentials", async () => {
  const { source, calls } = fixture("komiic", call => {
    const request = JSON.parse(call.body!);
    if (request.operationName === "imagesByChapterId") return response({ data: { imagesByChapterId: [{ kid: "page" }] } });
    assert.equal(request.operationName, "getImageTicket");
    assert.equal(call.headers.Authorization, "Bearer fixture-account");
    return response({ data: { getImageTicket: { kid: "page", url: "https://public.komiic.com/page.jpg?signature=fixture", ticket: "fixture-ticket", expiresAt: new Date(Date.now() + 60_000).toISOString() } } });
  }, { website: "https://komiic.cc" }, { "cc.token": "fixture-account" });
  const { images } = await source.comic.loadEp("comic", "ep:chapter");
  assert.equal(calls.length, 1);
  const [a, b] = await Promise.all([source.comic.onImageLoad!(images[0], "comic", "ep:chapter"), source.comic.onImageLoad!(images[0], "comic", "ep:chapter")]);
  assert.equal(calls.length, 2);
  assert.equal(a.url, "https://public.komiic.com/page.jpg?signature=fixture");
  assert.equal(b.headers["X-Image-Ticket"], "fixture-ticket");
  assert.equal(a.headers.Cookie, undefined);
  assert.equal(a.headers.Authorization, undefined);
});

test("Komiic stops on a denied or invalid ticket without using the legacy image route", async () => {
  const image = "https://komiic.com/api/image/page";
  for (const [reply, match] of [
    [response({}, 402), /额度/],
    [response({ data: { getImageTicket: { kid: "page", url: "https://komiic.com.evil.invalid/image.jpg", ticket: "fixture", expiresAt: new Date(Date.now() + 60_000).toISOString() } } }), /无法验证/],
    [response({ data: { getImageTicket: { kid: "page", url: "https://public.komiic.com/image.jpg", ticket: "fixture", expiresAt: "2020-01-01T00:00:00Z" } } }), /过期/],
  ] as const) {
    const { source, calls } = fixture("komiic", () => reply);
    await assert.rejects(() => Promise.resolve(source.comic.onImageLoad!(image, "comic", "chapter")), match);
    assert.equal(calls.length, 1);
  }
});

test("Komiic logs the same account into both official entrances and reads the site's chapter position", async () => {
  const { source, calls, data, settings } = fixture("komiic", call => {
    if (call.url.endsWith("/api/login")) return response({ token: call.url.includes(".cc/") ? "fixture-cc" : "fixture-com" });
    assert.equal(call.headers.Authorization, "Bearer fixture-cc");
    const request = JSON.parse(call.body!);
    if (request.operationName === "readComicHistory") return response({ data: { readComicHistory: [{ comicId: "comic" }] } });
    if (request.operationName === "comicByIds") return response({ data: { comics: [komiicComic] } });
    if (request.operationName === "browseComics") {
      assert.equal(request.variables.contentType, "H_MANGA");
      assert.match(request.query, /randomComics.*adult: true/);
      return response({ data: { comics: [{ ...komiicComic, contentType: "H_MANGA" }] } });
    }
    return response({ data: { comicById: komiicComic, chaptersByComicId: [{ id: "c", serial: "1", type: "chapter", size: 10 }],
      history: { comicId: "comic", chapters: [{ chapterId: "c", page: 3, updatedAt: "2026-11-08T16:10:00Z" }] } } });
  });
  await source.account!.login!("fixture@example.invalid", "fixture-password");
  assert.deepEqual(calls.filter(call => call.method === "POST").map(call => call.url), ["https://komiic.com/api/login", "https://komiic.cc/api/login"]);
  assert.equal(data.get("token"), "fixture-com");
  assert.equal(data.get("cc.token"), "fixture-cc");
  assert.doesNotMatch(JSON.stringify([...data]), /fixture-password/);
  settings.website = "https://komiic.cc";
  const adult = await source.explore.find(entry => entry.title.endsWith("成人内容"))!.load(1) as ComicList;
  assert.equal(adult.comics[0].tags?.[0], "成人内容");
  const history = await source.explore.find(entry => entry.title.endsWith("官网续读"))!.load(1) as ComicList;
  assert.equal(history.comics[0].id, "comic");
  assert.match((await source.comic.loadInfo("comic")).chapters["ep:c"], /官网读到第 4 页/);
});
