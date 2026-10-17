import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { Manhuagui, parseList, parseDetails, parsePages, FILTERS } from "../src";
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../fixtures/sites.json"), "utf8")).manhuagui;

test("Manhuagui parses catalog, search and ranking cards with their real pagination", () => {
  for (const html of [fixture.list, fixture.search, fixture.rank]) assert.equal(parseList(html, 1).items[0].id, "123");
  assert.equal(parseList(fixture.list, 1).last, false);
  assert.equal(parseList(fixture.search, 1).last, true);
  assert.equal(parseList(fixture.list, 1).items[0].cover, "https://images.example/cover.jpg");
});
test("Manhuagui preserves chapter groups and decodes compressed lists after confirmation", () => {
  const regular = parseDetails(fixture.detail, "123");
  assert.deepEqual(regular.chapters.map(ch => [ch.id, ch.group]), [["11", "连载"], ["22", "连载"], ["33", "单行本"]]);
  assert.throws(() => parseDetails(fixture.hiddenDetail, "123"), /成人提示/);
  assert.deepEqual(parseDetails(fixture.hiddenDetail, "123", true).chapters, regular.chapters);
  assert.equal(regular.status, "ongoing");
});
test("Manhuagui unpacks the compressed page data without executing remote JavaScript", () => {
  assert.deepEqual(parsePages(fixture.packed), fixture.pages);
  assert.equal(parsePages(fixture.packed, "https://cf.hamreus.com")[0], fixture.pages[0].replace("i.hamreus", "cf.hamreus"));
});
test("Manhuagui exposes every index family and sends combined filters and ranking periods", async () => {
  const urls: string[] = [];
  const site = new Manhuagui(async url => { urls.push(url); return { status: 200, body: url.includes("/rank/") ? fixture.rank : fixture.list }; });
  assert.deepEqual((await site.directory("categories")).map(section => section.id), FILTERS.slice(1).map(filter => filter.id));
  assert.equal((await site.directory("ranks"))[0].entries!.length, 4);
  await site.browse("all", 2, { region: "japan", genre: "maoxian", status: "wanjie", year: "2026", sort: "view" });
  assert.equal(urls[0], "https://www.manhuagui.com/list/japan_maoxian_2026_wanjie/view_p2.html");
  await site.browse("rank:week", 1);
  assert.equal(urls[1], "https://www.manhuagui.com/rank/week.html");
});
