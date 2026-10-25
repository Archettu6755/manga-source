import assert from "node:assert/strict";
import test from "node:test";
import type { STTStore } from "@suwatte/toolchain/types";
import { komiicWebsite, komiicUrl } from "@archettu/komiic";
import Komiic from "../src/sources/komiic";
import { fixture } from "./fixture";

const mainland = "https://komiic.cc";
const comic = { id: "1", title: "漫画", status: "ONGOING", imageUrl: "https://public.komiic.com/cover.jpg" };
const secure = () => (globalThis as unknown as { SecureStore: STTStore }).SecureStore;

test("Komiic accepts only its two entrances and rewrites covers without rewriting unrelated hosts", () => {
  assert.equal(komiicWebsite(undefined), "https://komiic.com");
  assert.equal(komiicWebsite(mainland), mainland);
  for (const url of ["http://komiic.cc", "https://komiic.cc.evil.invalid", "https://evil.invalid", "https://komiic.cc/"]) assert.throws(() => komiicWebsite(url), /入口/);
  assert.equal(komiicUrl("https://public.komiic.com/cover.jpg?key=fixture", mainland), "https://public.komiic.cc/cover.jpg?key=fixture");
  assert.equal(komiicUrl("https://komiic.com.evil.invalid/api/image/a", mainland), "https://komiic.com.evil.invalid/api/image/a");
  assert.equal(komiicUrl("https://notkomiic.com/api/image/a", mainland), "https://notkomiic.com/api/image/a");
});

test("Suwatte Komiic mainland setting routes metadata, covers, pages and Referer while preserving IDs", async () => {
  const { source, rawSource, calls } = fixture(Komiic, call => {
    const op = call.body ? JSON.parse(String(call.body)).operationName : "";
    return { body: { data: op === "imagesByChapterId" ? { imagesByChapterId: [{ kid: "page" }] } : { comicById: comic } } };
  });
  await source.onFormSubmitted("settings", { website: mainland });
  const form = await source.getSettingsPage();
  assert.match(JSON.stringify(form), /komiic\.com/);
  assert.match(JSON.stringify(form), /komiic\.cc/);
  const details = await source.getContent("1");
  assert.equal(details.coverImage, "https://public.komiic.cc/cover.jpg");
  assert.equal(details.webUrl, "https://komiic.cc/comic/1");
  const page = (await rawSource.getChapterPages("1", "2"))[0];
  assert.equal(page.url, "https://komiic.cc/api/image/page");
  await source.client.head(page.url!, { context: page.context });
  assert.equal(calls.at(-1)?.config?.headers?.Referer, "https://komiic.cc/comic/1/chapter/2/images/all");
  assert.ok(calls.every(call => call.url.startsWith(mainland + "/")));
  assert.equal(Komiic.info.id, "zh.komiic");
});

test("Suwatte keeps legacy com sessions separate from cc login, image requests and logout", async () => {
  const { source, calls } = fixture(Komiic, call => call.url.endsWith("/api/login") ? { headers: { "set-cookie": "komiic-access-token=cc-session; Path=/" } } : {});
  await secure().set("komiic.cookies", "komiic-access-token=com-session");
  await ObjectStore.set("komiic.refreshedAt", Date.now());
  await source.onFormSubmitted("settings", { website: mainland });
  assert.match(JSON.stringify(await source.getSettingsPage()), /账号：未登录/);
  await source.client.head("https://komiic.com/api/image/a");
  assert.equal(calls.at(-1)?.url, "https://komiic.cc/api/image/a");
  assert.equal(calls.at(-1)?.config?.headers?.Cookie, undefined);
  await source.onFormSubmitted("settings", { email: "fixture@example.invalid", password: "fixture-only" });
  assert.match(JSON.stringify(await source.getSettingsPage()), /账号：已保存登录/);
  await source.client.head("https://komiic.cc/api/image/a");
  assert.equal(calls.at(-1)?.config?.headers?.Cookie, "komiic-access-token=cc-session");
  await source.client.head("https://public.komiic.com/cover.jpg");
  assert.equal(calls.at(-1)?.url, "https://public.komiic.cc/cover.jpg");
  assert.equal(calls.at(-1)?.config?.headers?.Cookie, undefined);
  await source.client.head("https://komiic.cc.evil.invalid/api/image/a");
  assert.equal(calls.at(-1)?.config?.headers?.Cookie, undefined);
  await source.clearAuthentication();
  assert.equal(await secure().string("komiic.cc.cookies"), null);
  assert.equal(await secure().string("komiic.cookies"), "komiic-access-token=com-session");
  await source.onFormSubmitted("settings", { website: "https://komiic.com" });
  await source.client.head("https://komiic.com/api/image/a");
  assert.equal(calls.at(-1)?.config?.headers?.Cookie, "komiic-access-token=com-session");
});

test("A pending cc session refresh cannot overwrite com credentials when the entrance changes", async () => {
  let finish!: (reply: { headers: Record<string, string> }) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const { source, calls } = fixture(Komiic, call => {
    if (call.url.endsWith("/auth/refresh")) return new Promise(resolve => { finish = resolve; started(); });
    return { body: { data: { comicById: comic } } };
  });
  await secure().set("komiic.cookies", "komiic-access-token=com-session");
  await secure().set("komiic.cc.cookies", "komiic-access-token=cc-old");
  await source.onFormSubmitted("settings", { website: mainland });
  const pending = source.getContent("1");
  await ready;
  await source.onFormSubmitted("settings", { website: "https://komiic.com" });
  finish({ headers: { "set-cookie": "komiic-access-token=cc-new; Path=/" } });
  await pending;
  assert.equal(await secure().string("komiic.cookies"), "komiic-access-token=com-session");
  assert.equal(await secure().string("komiic.cc.cookies"), "komiic-access-token=cc-new");
  assert.ok(calls.every(call => call.url.startsWith(mainland + "/")));
  assert.equal(calls.at(-1)?.config?.headers?.Cookie, "komiic-access-token=cc-new");
});

test("Komiic mainland restrictions never trigger a request to the other entrance", async () => {
  const { source, calls } = fixture(Komiic, () => ({ status: 403 }));
  await source.onFormSubmitted("settings", { website: mainland });
  await assert.rejects(() => source.getContent("1"), /访问受限/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://komiic.cc/api/query");
  await assert.rejects(() => source.onFormSubmitted("settings", { website: "https://evil.invalid" }), /入口/);
  assert.equal(calls.length, 1);
});
