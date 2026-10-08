import emulate from "@suwatte/toolchain/emulator";
import { validateDelegateMethodResult } from "@suwatte/toolchain/validate";
import CopyManga from "../src/sources/copymanga";
import Komiic from "../src/sources/komiic";
import MangaDex from "../src/sources/mangadex";

async function main() {
  const name = process.argv[2];
  if (!["copymanga", "komiic", "mangadex"].includes(name)) throw new Error("请选择 copymanga、komiic 或 mangadex。");
  const source = name === "copymanga" ? emulate<CopyManga>(CopyManga, { resetStores: true })
    : name === "komiic" ? emulate<Komiic>(Komiic, { resetStores: true }) : emulate<MangaDex>(MangaDex, { resetStores: true });
  const home = await source.getHomePage();
  validateDelegateMethodResult("getHomePage", home, name);
  console.log(JSON.stringify({ source: name, feeds: home.feeds.map(feed => feed.title) }));
  const visited = new Set<string>();
  const samples: { key: string }[] = [];
  for (const feed of home.feeds) {
    if (feed.content.page) {
      const result = await source.getItemPage(feed.content.page, 1);
      validateDelegateMethodResult("getItemPage", result, name);
      console.log(JSON.stringify({ source: name, key: feed.content.page, sections: result.sections.length, items: result.sections.reduce((sum, section) => sum + (section.items?.length ?? 0), 0) }));
      for (const section of result.sections) {
        const destination = section.items?.find(item => item.destination && "list" in item.destination)?.destination;
        if (destination && "list" in destination && destination.list.props.key) samples.push({ key: destination.list.props.key });
      }
    } else if (feed.content.list?.key) samples.push({ key: feed.content.list.key });
  }
  for (const request of samples) {
    if (visited.has(request.key)) continue;
    visited.add(request.key);
    const result = await source.getItemList(request, 1);
    // SDK 1.0.0 requires non-empty lists; sites can legitimately return no matches.
    if (result.items.length) validateDelegateMethodResult("getItemList", result, name);
    console.log(JSON.stringify({ source: name, key: request.key, count: result.items.length, total: result.total, isLastPage: result.isLastPage }));
    if (!result.isLastPage && (request.key === "all" || request.key === "topics" || request.key === "newest")) {
      const next = await source.getItemList(request, 2);
      if (next.items.length) validateDelegateMethodResult("getItemList", next, name);
      if (result.items.length && next.items.length && next.items.every(item => result.items.some(previous => previous.id === item.id))) throw new Error(`${request.key} 返回了重复分页。`);
      console.log(JSON.stringify({ source: name, key: request.key, page: 2, count: next.items.length }));
    }
    const destination = result.items[0]?.destination;
    if (destination && "list" in destination && destination.list.props.key) {
      const next = await source.getItemList(destination.list.props, 1);
      if (next.items.length) validateDelegateMethodResult("getItemList", next, name);
      console.log(JSON.stringify({ source: name, key: destination.list.props.key, count: next.items.length }));
    }
  }
  const filters = await source.getSearchFilters();
  validateDelegateMethodResult("getSearchFilters", filters, name);
  console.log(JSON.stringify({ source: name, filterChoices: filters.map(filter => filter.title), passed: true }));
}
const keepAlive = setInterval(() => {}, 1_000);
void main().catch(error => { console.error(error.message); process.exitCode = 2; }).finally(() => clearInterval(keepAlive));
