import assert from "node:assert/strict";
import test from "node:test";
import type { STTStore } from "@suwatte/toolchain/types";
import { sessionCookies } from "@archettu/komiic";
import Komiic from "../src/sources/komiic";
import { fixture } from "./fixture";
const comic = { id: "1", title: "漫画", status: "ONGOING", imageUrl: "https://public.komiic.com/cover.jpg" };

test("Komiic listing uses current GraphQL pagination and search slices all matches", async () => {
  const { source, calls } = fixture(Komiic, call => {
    const body = JSON.parse(String(call.body));
    return { body: { data: body.operationName === "commonQuery" ? { comics: Array(30).fill(comic) }
      : { searchComicsAndAuthors: { comics: Array.from({ length: 31 }, (_, index) => ({ ...comic, id: String(index) })) } } } };
  });
  assert.equal((await source.getItemList({ key: "popular" }, 2)).isLastPage, false);
  assert.deepEqual(JSON.parse(String(calls[0].body)).variables.pagination, { limit: 30, offset: 30, orderBy: "MONTH_VIEWS", status: "", asc: false });
  const search = await source.getSearchResults({ query: " 漫画 " }, 2);
  assert.deepEqual(search.items.map(item => item.id), ["30"]);
  assert.equal(search.total, 31);
  assert.equal(search.isLastPage, true);
});
test("Komiic sorts volumes and chapters and preserves API image order and context", async () => {
  const { source, rawSource } = fixture(Komiic, call => {
    const body = JSON.parse(String(call.body));
    return { body: { data: body.operationName === "imagesByChapterId" ? { imagesByChapterId: [{ kid: "z" }, { kid: "a" }] }
      : { chaptersByComicId: [{ id: "c2", serial: "2", type: "chapter", size: 20 }, { id: "b1", serial: "1", type: "book", size: 100 }, { id: "c1", serial: "1", type: "chapter", size: 15 }] } } };
  });
  const all = await source.getChapters("1");
  assert.deepEqual(all.map(chapter => chapter.id), ["b1", "c1", "c2"]);
  assert.equal(all[0].number, -1);
  assert.equal(all[0].volume, 1);
  await source.onFormSubmitted("settings", { chapters: "chapter" });
  assert.deepEqual((await source.getChapters("1")).map(chapter => chapter.id), ["c1", "c2"]);
  const pages = await source.getChapterPages("1", "c1");
  assert.deepEqual(pages.map(page => page.url), ["https://komiic.com/api/image/z", "https://komiic.com/api/image/a"]);
  // SDK 1.0.0's validator strips context even though ChapterPage declares it.
  assert.deepEqual((await rawSource.getChapterPages("1", "c1"))[0].context, { comicId: "1", chapterId: "c1" });
});
test("Komiic reports GraphQL errors and image quota without retrying", async () => {
  const { source, calls } = fixture(Komiic, call => call.url.includes("api/image") ? { status: 402 }
    : { body: { data: { comicById: comic }, errors: [{ message: "token is expired" }] } });
  await assert.rejects(() => source.getContent("1"), /token is expired/);
  await assert.rejects(() => source.client.head("https://komiic.com/api/image/a"), /额度/);
  assert.equal(calls.length, 2);
});
test("Komiic saves cookies securely, refreshes them, isolates images and logs out", async () => {
  const header = "komiic-access-token=access; Path=/; Expires=Wed, 09 Oct 2026 00:00:00 GMT, komiic-refresh-token=refresh; HttpOnly; Path=/";
  assert.equal(sessionCookies(header), "komiic-access-token=access; komiic-refresh-token=refresh");
  const { source, calls } = fixture(Komiic, call => ({ headers: { "set-cookie": call.url.endsWith("/auth/refresh") ? "komiic-access-token=new; Path=/" : header } }));
  await source.onFormSubmitted("settings", { email: "fixture@example.invalid", password: "test-only" });
  const secure = (globalThis as unknown as { SecureStore: STTStore }).SecureStore;
  assert.equal(await secure.string("komiic.cookies"), "komiic-access-token=access; komiic-refresh-token=refresh");
  assert.equal(await ObjectStore.get("komiic.cookies"), null);
  await ObjectStore.set("komiic.refreshedAt", 0);
  await source.client.head("https://komiic.com/api/image/a", { context: { comicId: "1", chapterId: "2" } });
  const image = calls.find(call => call.url.includes("api/image"))!;
  assert.equal(image.config?.headers?.Cookie, "komiic-access-token=new; komiic-refresh-token=refresh");
  assert.equal(image.config?.headers?.Referer, "https://komiic.com/comic/1/chapter/2/images/all");
  await source.client.head("https://public.komiic.com/cover.jpg");
  assert.equal(calls.at(-1)?.config?.headers?.Cookie, undefined);
  await source.clearAuthentication();
  assert.equal(await secure.string("komiic.cookies"), null);
  assert.equal(calls.filter(call => call.url.endsWith("/auth/refresh")).length, 1);
});
