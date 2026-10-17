import type { Site, Request, Manga } from "@archettu/manga-core";
import { category, choice, choiceId, info, list, part, Transport, type SourceStore, type SourceConfig, type ComicItem } from "./runtime";

export function createCatalog(source: SourceStore, factory: (request: Request) => Site, interval: number): SourceConfig {
  const transport = new Transport(interval);
  const site = factory((url, headers = {}, body) => transport.request(body === undefined ? "GET" : "POST", url, headers, body));
  const item = (value: Manga): ComicItem => ({ id: value.id, title: value.title, cover: value.cover || "", subtitle: value.author,
    description: value.description, tags: value.tags });
  const values = (options: string[]) => Object.fromEntries(options.flatMap((value, index) => value === "__default" || !site.filters[index] ? [] : [[site.filters[index].id, choiceId(value)]]));
  const browse = async (key: string, options: string[], page: number) => {
    const result = await site.browse(key, page, values(options));
    return list(result.items.map(item), page, result.last, result.total, 20);
  };
  return {
    ...info(site.id, site.name),
    category: category(`${site.name} · Archettu`, site.feeds.filter(feed => !feed.directory).map(feed => [feed.id, feed.title])),
    explore: site.feeds.map(feed => ({ title: `${site.name} · ${feed.title}`, type: feed.directory ? "multiPartPage" : "multiPageComicList",
      load: async page => {
        if (!feed.directory) return browse(feed.id, [], page);
        const sections = await site.directory(feed.id);
        return sections.flatMap(section => section.entries ? section.entries.map(entry => part(entry.id, `${section.title} · ${entry.title}`))
          : [{ title: section.title, comics: (section.items || []).map(item) }]);
      } })),
    categoryComics: { load: (name, key, options, page) => browse(key || name, options, page),
      optionLoader: async () => site.filters.map((filter, index) => ({ label: filter.title,
        options: [...(index === 0 ? ["__default-入口默认"] : []), ...filter.options.map(option => choice(option.id, option.title))] })) },
    search: { load: async (keyword, options, page) => {
      if (!keyword.trim()) return browse("all", options, page);
      const result = await site.search(keyword.trim(), page, values(options));
      return list(result.items.map(item), page, result.last, result.total, 20);
    } },
    comic: {
      loadInfo: async id => {
        const comic = await site.details(id);
        return { title: comic.title, cover: comic.cover || "", description: comic.description, url: comic.url,
          tags: { 作者: comic.author ? [comic.author] : [], 类型: comic.tags || [], 状态: [comic.status === "ongoing" ? "连载中" : comic.status === "completed" ? "已完结" : "未知"] },
          chapters: Object.fromEntries(comic.chapters.map(chapter => [`ep:${chapter.id}`, `${chapter.group}：${chapter.title}`])) };
      },
      loadEp: async (id, chapter) => {
        if (!chapter) throw new Error("请选择章节。");
        return { images: await site.pages(id, chapter.replace(/^ep:/, "")) };
      },
      onImageLoad: () => ({ headers: site.imageHeaders() }), onThumbnailLoad: () => ({ headers: site.imageHeaders() }),
    },
    ...(site.login ? { account: { login: async (username: string, password: string) => { await site.login!(username, password); return true; },
      logout: () => { source.deleteData("token"); Network.deleteCookies(site.website); }, registerWebsite: "https://www.zaimanhua.com" } } : {}),
    ...(site.id === "manhuagui" ? { settings: {
      adult: { title: "确认网站成人提示", type: "switch" as const, default: false },
      imageServer: { title: "图片服务器", type: "select" as const, default: "https://i.hamreus.com", options: ["i", "cf", "us"].map(name => ({ value: `https://${name}.hamreus.com`, text: `${name}.hamreus.com` })) },
    } } : {}),
  };
}
