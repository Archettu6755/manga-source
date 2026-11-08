import assert from "node:assert/strict";
import test from "node:test";
import { ContentRating, type Content, type ProgressState, type STTStore } from "@suwatte/toolchain/types";
import Komiic from "../src/sources/komiic";
import { fixture } from "./fixture";

const comic = { id: "1", title: "Fixture", status: "ONGOING", imageUrl: "https://public.komiic.com/cover.jpg" };
const secure = () => (globalThis as unknown as { SecureStore: STTStore }).SecureStore;

test("Komiic offers its adult catalog by default and obtains a ticket when Suwatte requests an image", async () => {
  const signedUrl = "https://public.komiic.com/fixture.jpg?signature=fixture";
  const { source, calls } = fixture(Komiic, call => {
    if (call.url === signedUrl) return {};
    const request = JSON.parse(String(call.body));
    if (request.operationName === "browseComics") {
      assert.equal(request.variables.contentType, "H_MANGA");
      return { body: { data: { comics: [{ ...comic, contentType: "H_MANGA" }] } } };
    }
    if (request.operationName === "imagesByChapterId") return { body: { data: { imagesByChapterId: [{ kid: "kid" }] } } };
    assert.equal(request.operationName, "getImageTicket");
    return { body: { data: { getImageTicket: { kid: "kid", url: signedUrl, ticket: "fixture-ticket", expiresAt: new Date(Date.now() + 60_000).toISOString() } } } };
  });
  await secure().set("komiic.cc.token", "fixture-session");
  await source.onFormSubmitted("settings", { website: "https://komiic.cc" });
  assert.ok((await source.getHomePage()).feeds.some(feed => feed.id === "adult"));
  assert.equal((await source.getItemList({ key: "adult" }, 1)).items[0].rating, ContentRating.MATURE);
  const pages = await source.getChapterPages("1", "c");
  assert.equal(calls.length, 2);
  await source.client.get(pages[0].url!, { context: { comicId: "1", chapterId: "c" } });
  assert.equal(calls.length, 4);
  assert.equal(calls.at(-2)?.config?.headers?.Authorization, "Bearer fixture-session");
  assert.equal(calls.at(-1)?.url, signedUrl);
  assert.equal(calls.at(-1)?.config?.headers?.["X-Image-Ticket"], "fixture-ticket");
  assert.equal(calls.at(-1)?.config?.headers?.Authorization, undefined);
  assert.equal(calls.at(-1)?.config?.headers?.Cookie, undefined);
});

test("Suwatte logs in to both Komiic entrances and syncs the latest actual page position through the site", async () => {
  const { source, calls } = fixture(Komiic, call => {
    if (call.url.endsWith("/api/login")) return { body: { token: call.url.includes(".cc/") ? "fixture-cc" : "fixture-com" } };
    const request = JSON.parse(String(call.body));
    if (request.operationName === "imagesByChapterId") return { body: { data: { imagesByChapterId: Array.from({ length: 10 }, (_, i) => ({ kid: String(i) })) } } };
    if (request.operationName === "addReadComicHistoryV2") return { body: { data: { addReadComicHistoryV2: true } } };
    return { body: { data: { comicById: comic, chaptersByComicId: [{ id: "c", serial: "1", type: "chapter", size: 10 }],
      history: { comicId: "1", chapters: [{ chapterId: "c", page: 3, updatedAt: "2026-11-08T16:10:00Z" }] } } } };
  });
  await source.onFormSubmitted("settings", { email: "fixture@example.invalid", password: "fixture-password", syncBoth: true });
  assert.deepEqual(calls.map(call => call.url), ["https://komiic.com/api/login", "https://komiic.cc/api/login"]);
  assert.equal(await secure().string("komiic.token"), "fixture-com");
  assert.equal(await secure().string("komiic.cc.token"), "fixture-cc");
  assert.ok((await source.getHomePage()).feeds.some(feed => feed.id === "reading-history"));
  const content = await source.getContent("1") as Content & { progress: ProgressState };
  assert.equal(content.progress.currentState?.page, 3);
  await source.getChapterPages("1", "c");
  await Promise.all([source.onChapterProgress("1", "c", 0.4), source.onChapterProgress("1", "c", 0.7)]);
  const writes = calls.filter(call => call.body && JSON.parse(String(call.body)).operationName === "addReadComicHistoryV2");
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(String(writes[0].body)).variables, { comicId: "1", chapterId: "c", page: 6 });
});
