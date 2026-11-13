import { Manhuagui, WEBSITE } from "@archettu/manhuagui";
import { createCatalog } from "./catalog";
import { comicLink, type SourceStore } from "./runtime";
export function createSource(source: SourceStore) {
  const config = createCatalog(source, request => new Manhuagui(request, async key => String(source.loadSetting(key) ?? "")), 1000, "2.0.0", () => ({
    link: comicLink([WEBSITE.slice(8), "manhuagui.com", "m.manhuagui.com"], path => /^\/comic\/(\d+)(?:[/?]|$)/.exec(path)?.[1]),
  }));
  config.category.enableRankingPage = true;
  const periods = ["day-日榜", "week-周榜", "month-月榜", "total-总榜"];
  config.categoryComics.ranking = {
    options: periods,
    load: (period, page) => config.categoryComics.load("排行榜", `rank:${periods.some(option => option.startsWith(`${period}-`)) ? period : "total"}`, [], page),
  };
  return config;
}
