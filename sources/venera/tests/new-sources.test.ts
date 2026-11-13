import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import { fixture, response, type Call } from "./fixture";

function jmResponse(call: Call, data: unknown) {
  const stamp = call.headers.tokenparam.split(",")[0];
  const signature = createHash("md5").update(`${stamp}185Hcomic3PAPP7R`).digest("hex");
  assert.equal(call.headers.token, signature);
  const cipher = createCipheriv("aes-256-ecb", Buffer.from(signature), null);
  return response({ code: 200, data: Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]).toString("base64") });
}

test("JMComic uses the signed API, stores only its session, and restores uneven image strips", async () => {
  const { source, data, calls } = fixture("jmcomic", call => {
    assert.equal(new URL(call.url).origin, "https://www.cdnhjk.net");
    if (call.url.endsWith("/login")) {
      assert.equal(new URLSearchParams(call.body).get("password"), "fixture-password");
      assert.equal(call.headers.Cookie, undefined);
      return jmResponse(call, { uid: "1", s: "fixture-session" });
    }
    assert.equal(call.headers.Cookie, "AVS=fixture-session");
    if (/\/(?:search|categories\/filter)\?/.test(call.url)) return jmResponse(call, { content: [{ id: 240000, name: "Fixture" }], total: "81" });
    if (call.url.includes("/album?")) return jmResponse(call, { id: 240000, name: "Fixture", series: [{ id: 240001, sort: 2 }, { id: 240000, sort: 1 }] });
    return jmResponse(call, { id: 240000, images: ["00001.webp", "00002.gif"] });
  });
  await source.account!.login!("fixture", "fixture-password");
  assert.deepEqual([...data], [["session", "fixture-session"]]);
  const search = await source.search.load("测试 & 漫画", ["mv_w"], 2);
  assert.equal(search.maxPage, 2);
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get("search_query"), "测试 & 漫画");
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get("o"), "mv_w");
  assert.equal((await source.categoryComics.ranking!.load("mv_m", 2)).maxPage, 2);
  const rank = new URL(calls.at(-1)!.url);
  assert.equal(rank.pathname, "/categories/filter");
  assert.deepEqual(Object.fromEntries(rank.searchParams), { c: "0", page: "2", o: "mv_m" });
  const details = await source.comic.loadInfo("240000");
  assert.deepEqual(Object.keys(details.chapters), ["ep:240000", "ep:240001"]);
  const { images } = await source.comic.loadEp("240000", "ep:240000");
  const config = await source.comic.onImageLoad!(images[0], "240000", "ep:240000");
  const strips: number[][] = [];
  vm.runInNewContext(`${config.modifyImage}\nmodifyImage({width:1,height:23})`, {
    Image: { empty: () => ({ fillImageRangeAt: (_x: number, y: number, _source: unknown, _sx: number, sy: number, _w: number, height: number) => strips.push([y, sy, height]) }) },
  });
  assert.deepEqual(strips, [[0,18,5],[5,16,2],[7,14,2],[9,12,2],[11,10,2],[13,8,2],[15,6,2],[17,4,2],[19,2,2],[21,0,2]]);
  assert.equal(config.headers.Cookie, undefined);
  assert.equal((await source.comic.onImageLoad!(images[1], "240000", "ep:240000")).modifyImage, undefined);
  source.account!.logout();
  assert.equal(data.has("session"), false);
});

test("E-Hentai follows the site's cursor and gallery page numbers, resolving images only when requested", async () => {
  const { source, calls } = fixture("ehentai", call => {
    if (call.method === "POST") {
      assert.equal(call.url, "https://api.e-hentai.org/api.php");
      assert.deepEqual(JSON.parse(call.body!), { method: "gdata", gidlist: [[23, "0123456789"]], namespace: 1 });
      return response({ gmetadata: [{ gid: 23, token: "0123456789", title: "Fixture", filecount: 3, tags: ["language:japanese"] }] });
    }
    const url = new URL(call.url);
    assert.equal(url.origin, "https://e-hentai.org");
    if (url.pathname.startsWith("/s/")) return { body: '<img id="img" src="https://fixture.hath.network/page.jpg">' };
    if (url.pathname.startsWith("/g/")) {
      const links = url.searchParams.has("p") ? '<a href="/s/0000000003/23-3"></a>'
        : '<a href="/s/0000000002/23-2"></a><a href="/s/0000000001/23-1"></a><a href="/s/0000000099/99-1"></a>';
      return { body: `<div id="gdt">${links}</div>` };
    }
    return { body: `<table class="itg"><tr><td><a href="/g/23/0123456789/"><div class="glink">Fixture</div></a></td></tr></table>${url.searchParams.has("next") ? "" : '<a id="unext" href="/?f_search=test&amp;next=23"></a>'}` };
  });
  assert.equal((await source.search.load("test", [], 1)).maxPage, 2);
  assert.equal((await source.search.load("test", [], 2)).comics[0].id, "23-0123456789");
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get("next"), "23");
  const details = await source.comic.loadInfo("23-0123456789");
  assert.equal(details.tags.language[0], "japanese");
  const { images } = await source.comic.loadEp("23-0123456789", "ep:gallery");
  assert.deepEqual([...images].map(url => url.split("-").at(-1)), ["1", "2", "3"]);
  assert.equal(calls.filter(call => new URL(call.url).pathname.startsWith("/s/")).length, 0);
  const image = await source.comic.onImageLoad!(images[0], "23-0123456789", "ep:gallery");
  assert.equal(image.url, "https://fixture.hath.network/page.jpg");
  assert.equal(image.headers.Cookie, undefined);
  await assert.rejects(() => Promise.resolve(source.comic.onImageLoad!("https://evil.invalid/s/0000000001/23-1", "23-0123456789", "ep:gallery")), /当前画廊/);
});

test("E-Hentai sends category, language and minimum rating filters without reusing another search's cursor", async () => {
  const { source, calls } = fixture("ehentai", call => {
    const url = new URL(call.url);
    return { body: '<table class="itg"><tr><td><a href="/g/23/0123456789/"><div class="glink">Fixture</div></a></td></tr></table>' +
      (!url.searchParams.has("next") ? `<a id="unext" href="/?${url.searchParams.toString().replace(/&/g, "&amp;")}&amp;next=23"></a>` : "") };
  });
  const options = ['["2","2"]', "4", "japanese"];
  assert.equal((await source.search.load("test", options, 1)).maxPage, 2);
  const query = new URL(calls.at(-1)!.url).searchParams;
  assert.equal(query.get("f_cats"), "1019");
  assert.equal(query.get("f_srdd"), "4");
  assert.equal(query.get("f_search"), "test language:japanese");
  await assert.rejects(() => source.search.load("test", ["[\"1\"]"], 2), /第一页/);
  await source.search.load("test", options, 2);
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get("next"), "23");
  await source.search.load("test", ["2", "4", "japanese"], 1);
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get("f_cats"), "1019");
  await source.explore[1].load(1);
  assert.equal(new URL(calls.at(-1)!.url).pathname, "/popular");
});

test("New Venera sources stop on restrictions and E-Hentai only transfers its own forum session", async () => {
  for (const id of ["jmcomic", "ehentai"]) {
    const { source, calls } = fixture(id, () => response({}, 403));
    await assert.rejects(() => source.search.load("fixture", [], 1), /访问受限/);
    assert.equal(calls.length, 1);
  }
  const { source, cookieJar } = fixture("ehentai");
  cookieJar.set("https://forums.e-hentai.org", [{ name: "ipb_member_id", value: "1" }, { name: "ipb_pass_hash", value: "fixture" }, { name: "unrelated", value: "fixture" }]);
  await source.account!.loginWithWebview!.onLoginSuccess!();
  assert.deepEqual(Array.from(cookieJar.get("https://e-hentai.org")!, cookie => cookie.name), ["ipb_member_id", "ipb_pass_hash"]);
  assert.ok(cookieJar.get("https://e-hentai.org")!.every(cookie => cookie.secure && cookie.domain === ".e-hentai.org"));
  source.account!.logout();
  assert.equal(cookieJar.size, 0);
});
