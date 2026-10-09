import assert from "node:assert/strict";
import vm from "node:vm";
import { fetch, ProxyAgent } from "undici";
import type { SourceConfig, ComicList, Part, Response } from "../src/runtime";
const { bundle, sources }: { bundle(id: string): string; sources: string[] } = require("./bundle.cjs");

async function main() {
  const id = process.argv[2] ?? "copymanga";
  if (!sources.includes(id)) throw new Error(`可选源：${sources.join(", ")}`);
  const browseOnly = process.argv.includes("--browse-only");
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  let restricted: string | undefined, count = 0;
  let stage = "source loading";
  async function request(method: string, url: string, headers: Record<string, string>, body?: string): Promise<Response> {
    if (restricted) throw new Error(restricted);
    count++;
    if (count % 20 === 0) console.log(`Progress: ${count} metadata requests; ${stage}`);
    const result = await fetch(url, { method, headers, body, dispatcher, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const text = await result.text();
    if ([210, 401, 402, 403, 429].includes(result.status)) restricted = `Access restriction: HTTP ${result.status}; ${stage}`;
    try { const code = Number(JSON.parse(text)?.code); if ([210, 401, 403, 429].includes(code)) restricted = `Access restriction: API ${code}; ${stage}`; } catch { /* HTML browse pages are expected. */ }
    return { status: result.status, headers: Object.fromEntries(result.headers), body: text };
  }
  const data = new Map<string, unknown>();
  class ComicSource {
    loadData(key: string) { return data.get(key); }
    saveData(key: string, value: unknown) { data.set(key, value); }
    deleteData(key: string) { data.delete(key); }
    loadSetting() { return undefined; }
  }
  const context = vm.createContext({ ComicSource, Date, setTimeout,
    Network: { get: (url: string, headers: Record<string, string>) => request("GET", url, headers),
      post: (url: string, headers: Record<string, string>, body: string) => request("POST", url, headers, body), deleteCookies() {} } });
  try {
    const script = bundle(id);
    const className = script.split("\n")[0].split("class")[1].split("extends ComicSource")[0].trim();
    vm.runInContext(`(() => { ${script}\nthis.temp = new ${className}(); }).call()`, context, { timeout: 5000 });
    const source = context.temp as SourceConfig;
    let firstComic: string | undefined;
    for (const entry of source.explore) {
      stage = entry.title;
      const result = await entry.load(1);
      if (Array.isArray(result)) {
        const parts = result as Part[];
        console.log(`${stage}: ${parts.length} sections or directory entries`);
        const navigation = parts.find(part => part.viewMore);
        if (navigation?.viewMore) {
          stage = `${entry.title} → ${navigation.title}`;
          const target = navigation.viewMore.attributes;
          const comics = await source.categoryComics.load(target.category, target.param, [], 1);
          console.log(`${stage}: ${comics.comics.length} comics`);
          firstComic ??= comics.comics[0]?.id;
        }
        firstComic ??= parts.flatMap(part => part.comics)[0]?.id;
      } else {
        const comics = result as ComicList;
        assert.ok(Number.isInteger(comics.maxPage) && comics.maxPage >= 1);
        console.log(`${stage}: ${comics.comics.length} comics; page limit ${comics.maxPage}`);
        firstComic ??= comics.comics[0]?.id;
        if (entry.title.endsWith("全部漫画") || entry.title.endsWith("所有漫画") || entry.title.endsWith("全部日漫")) {
          stage = `${entry.title} page 2`;
          const second = await entry.load(2) as ComicList;
          console.log(`${stage}: ${second.comics.length} comics`);
        }
      }
    }
    if (!browseOnly) {
      stage = "search";
      const keyword = process.env.SOURCE_QUERY ?? (id === "mangadex" ? "Yotsuba" : "葬送的芙莉蓮");
      const search = await source.search.load(keyword, [], 1);
      console.log(`Search: ${search.comics.length} comics`);
      firstComic = process.env.SOURCE_COMIC ?? search.comics[0]?.id ?? firstComic;
      if (!firstComic) throw new Error("未找到用于读取检查的漫画。");
      stage = "comic details and complete chapter directory";
      const details = await source.comic.loadInfo(firstComic);
      console.log(`Details: ${details.title}; ${Object.keys(details.chapters).length} chapters`);
      const chapter = Object.keys(details.chapters)[0];
      if (!chapter) throw new Error("目录为空，未检查图片地址。");
      stage = "chapter image URLs";
      const pages = await source.comic.loadEp(firstComic, chapter);
      assert.ok(pages.images.length > 0);
      console.log(`Chapter: ${pages.images.length} image URLs; no images requested or saved`);
    }
    console.log(`Verified ${source.key}: ${count} metadata requests, no account login or manga downloads.`);
  } catch (error) {
    throw new Error(`Venera ${id} smoke stopped at ${stage}: ${error instanceof Error ? error.message : String(error)}`);
  } finally { await dispatcher?.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
