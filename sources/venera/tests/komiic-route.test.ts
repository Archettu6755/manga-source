import assert from "node:assert/strict";
import test from "node:test";
import { fixture, komiicComic, response } from "./fixture";
const mainland = "https://komiic.cc";
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("Venera Komiic cc routes metadata, covers, page URLs and native registration to the selected entrance", async () => {
  const { source, calls } = fixture("komiic", call => {
    const body = JSON.parse(call.body!);
    return response({ data: body.operationName === "imagesByChapterId" ? { imagesByChapterId: [{ kid: "p" }] } : {
      comicById: { ...komiicComic, imageUrl: "https://public.komiic.com/cover.jpg" }, chaptersByComicId: [{ id: "c", type: "chapter", serial: "1", size: 2 }],
    } });
  }, { website: mainland });
  const comic = await source.comic.loadInfo("comic");
  assert.equal(comic.url, "https://komiic.cc/comic/comic");
  assert.equal(comic.cover, "https://public.komiic.cc/cover.jpg");
  assert.deepEqual(plain((await source.comic.loadEp("comic", "ep:c")).images), ["https://komiic.cc/api/image/p"]);
  assert.equal(source.account!.registerWebsite, "https://komiic.cc/register");
  assert.ok(calls.every(call => call.url === "https://komiic.cc/api/query" && call.headers.Referer === "https://komiic.cc/"));
  assert.equal(source.key, "archettu_komiic");
});

test("Venera maintains independent cc credentials, image headers and logout while preserving legacy com data", async () => {
  const { source, data, settings, calls } = fixture("komiic", call => response({}, 200, call.url.endsWith("/api/login") ? { "set-cookie": "komiic-access-token=cc-session; Path=/" } : {}),
    { website: mainland }, { cookies: "komiic-access-token=com-session", token: "com-token", refreshedAt: Date.now() });
  const before = await source.comic.onImageLoad!("https://komiic.cc/api/image/p", "comic", "ep:c");
  assert.equal(before.headers.Cookie, undefined);
  await source.account!.login("fixture@example.invalid", "fixture-only");
  const image = await source.comic.onImageLoad!("https://komiic.cc/api/image/p", "comic", "ep:c");
  assert.equal(image.headers.Cookie, "komiic-access-token=cc-session");
  assert.equal(image.headers.Referer, "https://komiic.cc/comic/comic/chapter/c/images/all");
  for (const url of ["https://public.komiic.cc/cover.jpg", "https://komiic.com/api/image/p", "https://komiic.cc.evil.invalid/api/image/p"]) {
    const other = await source.comic.onImageLoad!(url, "comic", "ep:c");
    assert.equal(other.headers.Cookie, undefined); assert.equal(other.headers.Authorization, undefined);
  }
  source.account!.logout();
  assert.equal(data.get("cc.cookies"), undefined);
  assert.equal(data.get("cookies"), "komiic-access-token=com-session");
  assert.equal(calls.at(-1)!.url, mainland);
  settings.website = "https://komiic.com";
  const legacy = await source.comic.onImageLoad!("https://komiic.com/api/image/p", "comic", "ep:c");
  assert.equal(legacy.headers.Authorization, "Bearer com-token");
});

test("Venera scopes pending refresh responses and directory caches to their original entrance", async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  let start!: () => void;
  const ready = new Promise<void>(resolve => { start = resolve; });
  const { source, data, settings, calls } = fixture("komiic", async call => {
    if (call.url.endsWith("/auth/refresh")) return new Promise(resolve => { finish = resolve; start(); });
    return response({ data: { comics: [komiicComic] } });
  }, { website: mainland }, { "cc.cookies": "komiic-access-token=old", "cc.refreshedAt": 0, cookies: "komiic-access-token=com-session" });
  const pending = source.explore[0].load(1);
  await ready;
  settings.website = "https://komiic.com";
  finish(response({}, 200, { "set-cookie": "komiic-access-token=cc-new; Path=/" }));
  await pending;
  assert.equal(data.get("cookies"), "komiic-access-token=com-session");
  assert.equal(data.get("cc.cookies"), "komiic-access-token=cc-new");
  assert.ok(calls.every(call => call.url.startsWith(mainland + "/")));
  const cached = fixture("komiic", () => response({ data: { entries: [] } }));
  const categories = cached.source.explore.find(entry => entry.title.endsWith("题材分类"))!;
  await categories.load(1); await categories.load(1);
  assert.equal(cached.calls.length, 1);
  cached.settings.website = mainland;
  await categories.load(1);
  assert.equal(cached.calls.length, 2);
  assert.equal(cached.calls[1].url, "https://komiic.cc/api/query");
});

test("Venera cc access restrictions and invalid domains fail without mirror retries", async () => {
  const { source, calls } = fixture("komiic", () => response({}, 403), { website: mainland });
  await assert.rejects(() => source.comic.loadInfo("comic"), /访问受限/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://komiic.cc/api/query");
  const invalid = fixture("komiic", undefined, { website: "https://evil.invalid" });
  await assert.rejects(() => invalid.source.comic.loadInfo("comic"), /入口/);
  assert.equal(invalid.calls.length, 0);
});
