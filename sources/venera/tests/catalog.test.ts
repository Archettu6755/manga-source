import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fixture, response } from "./fixture";
import { REQUEST_ID_URL } from "@archettu/copymanga";
import type { Part } from "../src/runtime";
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../fixtures/sites.json"), "utf8"));
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
test("Venera Manhuagui supports category navigation, grouped chapters and image unpacking", async () => {
  const { source } = fixture("manhuagui", call => ({ body: call.url.endsWith("22.html") ? data.manhuagui.packed : call.url.includes("/comic/") ? data.manhuagui.detail : data.manhuagui.list }));
  const categories = await source.explore.find(feed => feed.title.endsWith("漫画索引"))!.load(1) as Part[];
  assert.ok(categories.some(part => part.viewMore!.attributes.param === "filter:genre:maoxian"));
  assert.equal((await source.categoryComics.load("冒险", "filter:genre:maoxian", [], 1)).comics[0].id, "123");
  assert.deepEqual(Object.keys((await source.comic.loadInfo("123")).chapters), ["ep:11", "ep:22", "ep:33"]);
  assert.deepEqual(plain((await source.comic.loadEp("123", "ep:22")).images), data.manhuagui.pages);
});
test("Venera Zaimanhua preserves twelve rankings, dynamic website indexes and token logout", async () => {
  const { source, calls, data: store } = fixture("zaimanhua", call => response({ errno: 0, data: call.url.includes("/login/") ? { user: { token: "fixture-token" } }
    : call.url.includes("filter_type") ? data.zaimanhua.webTypes : call.url.includes("/comic/chapter/") ? { data: data.zaimanhua.pages }
    : call.url.includes("/comic/detail/") ? { data: data.zaimanhua.raw } : { comicList: [data.zaimanhua.listItem], totalNum: 1 } }));
  const ranks = await source.explore.find(feed => feed.title.endsWith("排行榜"))!.load(1) as Part[];
  assert.equal(ranks.length, 12);
  const categories = await source.explore.find(feed => feed.title.endsWith("官网分类／字母索引"))!.load(1) as Part[];
  assert.equal(categories.length, 4);
  await source.account!.login("测试", "password");
  assert.equal(store.get("token"), "fixture-token");
  assert.deepEqual(Object.keys((await source.comic.loadInfo("123")).chapters), ["ep:11", "ep:22", "ep:33"]);
  assert.deepEqual(plain((await source.comic.loadEp("123", "ep:22")).images), data.zaimanhua.pages.page_url_hd);
  assert.equal((await source.comic.onImageLoad!("https://images.example/page.jpg", "123", "22")).headers.Authorization, undefined);
  source.account!.logout();
  await source.categoryComics.load("全部漫画", "all", [], 1);
  assert.equal(calls.at(-1)!.headers.Authorization, undefined);
});
test("Venera CopyManga carries mainland request IDs and stops on restriction", async () => {
  const settings = { api: "https://api.copy202601.com", region: "1" };
  const { source, calls } = fixture("copymanga", call => response({ code: 200, results: call.url === REQUEST_ID_URL ? { request_id: "fixture-id" }
    : { chapter: { words: [0], contents: [{ url: "https://images.example/page.jpg" }] } } }), settings, { token: "fixture-token" });
  await source.comic.loadEp("comic", "chapter");
  assert.equal(new URL(calls[1].url).searchParams.get("request_id"), "fixture-id");
  for (const key of ["authorization", "pseudoid", "device", "deviceinfo"]) assert.equal(calls[0].headers[key], undefined);
  settings.region = "0";
  await source.comic.loadEp("comic", "chapter");
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[2].url).searchParams.has("request_id"), false);
  const blocked = fixture("copymanga", () => response({ code: 210, message: "请安装正版等待1小时" }, 210), settings);
  await assert.rejects(blocked.source.comic.loadEp("comic", "chapter"), /请安装正版等待1小时/);
  assert.equal(blocked.calls.length, 1);
});
