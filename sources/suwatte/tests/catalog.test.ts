import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { STTStore } from "@suwatte/toolchain/emulator";
import { fixture } from "./fixture";
import Manhuagui from "../src/sources/manhuagui";
import Zaimanhua from "../src/sources/zaimanhua";
import CopyManga from "../src/sources/copymanga";
import { REQUEST_ID_URL } from "@archettu/copymanga";
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../fixtures/sites.json"), "utf8"));

test("Suwatte Manhuagui exposes all feeds, parses grouped chapters and unpacks page URLs", async () => {
  const { source } = fixture(Manhuagui, call => ({ text: call.url.endsWith("22.html") ? data.manhuagui.packed : call.url.includes("/comic/") ? data.manhuagui.detail : data.manhuagui.list }));
  assert.equal((await source.getHomePage()).feeds.length, 10);
  assert.equal((await source.getItemPage("categories", 1)).sections.length, 6);
  assert.equal((await source.getContent("123")).title, "测试作品");
  assert.deepEqual((await source.getChapters("123")).map(ch => ch.id), ["11", "22", "33"]);
  assert.deepEqual((await source.getChapterPages("123", "22")).map(page => page.url), data.manhuagui.pages);
  assert.equal((await source.getSearchResults({ query: "测试" }, 1)).items[0].id, "123");
  await source.getSettingsPage();
});
test("Suwatte Zaimanhua keeps all ranking and website index entries and isolates login", async () => {
  const { source, calls } = fixture(Zaimanhua, call => {
    const value = call.url.includes("/login/") ? { user: { token: "fixture-token" } } : call.url.includes("filter_type") ? data.zaimanhua.webTypes
      : call.url.includes("/comic/chapter/") ? { data: data.zaimanhua.pages } : call.url.includes("/comic/detail/") ? { data: data.zaimanhua.raw } : { comicList: [data.zaimanhua.listItem], totalNum: 1 };
    return { text: JSON.stringify({ errno: 0, data: value }) };
  });
  assert.equal((await source.getHomePage()).feeds.length, 9);
  assert.equal((await source.getItemPage("ranks", 1)).sections.flatMap(section => section.items).length, 12);
  assert.equal((await source.getItemPage("web-categories", 1)).sections[0].items!.length, 2);
  await source.onFormSubmitted("settings", { username: "测试", password: "password" });
  const secure = (globalThis as unknown as { SecureStore: STTStore }).SecureStore;
  assert.equal(await secure.string("zaimanhua.token"), "fixture-token");
  assert.equal(await ObjectStore.string("zaimanhua.token"), null);
  assert.equal((await source.getContent("123")).title, "测试作品");
  assert.deepEqual((await source.getChapterPages("123", "22")).map(page => page.url), data.zaimanhua.pages.page_url_hd);
  await source.client.head("https://images.example/cover.jpg");
  assert.equal(calls.at(-1)!.config?.headers?.Authorization, undefined);
  await source.clearAuthentication();
  assert.equal(await secure.string("zaimanhua.token"), null);
});
test("Suwatte CopyManga gets a fresh mainland request ID without leaking the account or device", async () => {
  let count = 0;
  const { source, calls } = fixture(CopyManga, call => ({ body: { code: 200, results: call.url === REQUEST_ID_URL ? { request_id: `id-${++count}` }
    : { chapter: { words: [0], contents: [{ url: "https://images.example/page.jpg" }] } } } }));
  await ObjectStore.set("copymanga.api", "https://api.copy202601.com");
  const secure = (globalThis as unknown as { SecureStore: STTStore }).SecureStore;
  await secure.set("copymanga.token", "fixture-token");
  await source.getChapterPages("comic", "chapter");
  await source.getChapterPages("comic", "chapter");
  assert.deepEqual(calls.filter(call => call.url.includes("chapter2")).map(call => call.config?.params?.request_id), ["id-1", "id-2"]);
  const headers = calls[0].config!.headers!;
  for (const key of ["authorization", "pseudoid", "device", "deviceinfo"]) assert.equal(headers[key], undefined);
  await ObjectStore.set("copymanga.region", "0");
  await source.getChapterPages("comic", "chapter");
  assert.equal(count, 2);
  assert.equal(calls.at(-1)!.config?.params?.request_id, undefined);
});
test("Suwatte stops if the request-ID service is restricted", async () => {
  const { source, calls } = fixture(CopyManga, () => ({ status: 210, body: { code: 210, message: "请安装正版等待1小时" } }));
  await ObjectStore.set("copymanga.api", "https://api.copy202601.com");
  await assert.rejects(source.getChapterPages("comic", "chapter"), /请安装正版等待1小时/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, REQUEST_ID_URL);
});
test("Suwatte does not fall back to another API when discovery is denied", async () => {
  const { source, calls } = fixture(CopyManga, () => ({ status: 403 }));
  await assert.rejects(source.getChapterPages("comic", "chapter"), /403/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /system\/network2/);
});
