import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { Zaimanhua, comic, parseDetails, imagePages, API, ACCOUNT_API } from "../src";
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../fixtures/sites.json"), "utf8")).zaimanhua;
const session = () => { let token = ""; return { get: async () => token, set: async (value: string) => { token = value; }, clear: async () => { token = ""; } }; };
test("Zaimanhua chooses the nonzero ID and retains grouped chapter and page order", () => {
  assert.equal(comic(fixture.listItem).id, "123");
  assert.deepEqual(parseDetails(fixture.raw, "123").chapters.map(ch => ch.id), ["11", "22", "33"]);
  assert.deepEqual(imagePages(fixture.pages), fixture.pages.page_url_hd);
  assert.throws(() => imagePages({ ...fixture.pages, canRead: false }), /无权/);
});
test("Zaimanhua keeps twelve rankings, all home sections and distinct website category IDs", async () => {
  const urls: string[] = [];
  const site = new Zaimanhua(async url => {
    urls.push(url);
    const data = url.endsWith("filter_type") ? fixture.webTypes : url.endsWith("/index") ? { data: fixture.home } : { comicList: [fixture.listItem], totalNum: 21 };
    return { status: 200, body: JSON.stringify({ errno: 0, data }) };
  }, session());
  assert.equal((await site.directory("ranks")).flatMap(section => section.entries).length, 12);
  assert.deepEqual((await site.directory("home")).map(section => section.id), ["bannerList", "recList", "updateList", "weekRankList", "monthRankList"]);
  assert.equal((await site.directory("web-categories"))[0].entries![1].id, "web-filter:theme:1");
  assert.equal((await site.browse("web-filter:theme:1", 1)).last, false);
  assert.match(urls.at(-1)!, /\/api\/v1\/comic1\/filter\?theme=1/);
  await site.browse("filter:theme:4", 2);
  assert.match(urls.at(-1)!, new RegExp(`^${API}/comic/filter/list`));
  assert.equal(new URL(urls.at(-1)!).searchParams.get("theme"), "4");
});
test("Zaimanhua login encodes credentials and keeps the token out of image headers", async () => {
  const calls: { url: string; headers?: Record<string, string>; body?: string }[] = [];
  const store = session();
  const site = new Zaimanhua(async (url, headers, body) => { calls.push({ url, headers, body });
    return { status: 200, body: JSON.stringify({ errno: 0, data: url.startsWith(ACCOUNT_API) ? { user: { token: "fixture-token" } } : { comicList: [], totalNum: 0 } }) };
  }, store);
  await site.login("用户+&", "password");
  assert.equal(new URLSearchParams(calls[0].body).get("username"), "用户+&");
  assert.equal(new URLSearchParams(calls[0].body).get("passwd"), "5f4dcc3b5aa765d61d8327deb882cf99");
  await site.browse("all", 1);
  assert.equal(calls[1].headers!.Authorization, "Bearer fixture-token");
  assert.equal("Authorization" in site.imageHeaders(), false);
  await site.logout(); assert.equal(await store.get(), "");
});
