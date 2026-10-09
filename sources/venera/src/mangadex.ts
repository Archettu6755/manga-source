import { API, WEBSITE, CURATED_LISTS, cover, localized, pageUrls, query, readCollection, readable, readReply, requireJapanese,
  type Collection, type Language, type Manga, type MangaChapter, type MangaTag, type Relationship } from "@archettu/mangadex";
import tagSnapshot from "./mangadex-tags.json";
import { category, choice, choiceId, info, json, list, pageNumber, part, Transport,
  type SourceStore, type SourceConfig, type ComicItem, type ComicList, type Option } from "./runtime";

const INCLUDES: [string, string][] = [["includes[]", "cover_art"], ["includes[]", "author"], ["includes[]", "artist"]];
const FEEDS: [string, string][] = [["popular", "热门日漫"], ["latest", "最近更新"], ["all", "全部日漫"],
  ["newest", "新上架"], ["popular-new", "本月热门新作"], ["top-rated", "评分排行"], ["tags", "分类／标签"],
  ...CURATED_LISTS.map(entry => [entry.id, entry.title] as [string, string])];
const SORTS = ["default-入口默认", "followedCount-收藏数", "latestUploadedChapter-章节更新", "createdAt-上架时间", "rating-评分", "title-名称", "relevance-搜索相关度"];
const BASE_OPTIONS: Option[] = [{ label: "排序", options: SORTS }, { label: "方向", options: ["desc-降序", "asc-升序"] },
  { label: "状态", options: ["all-全部", "ongoing-连载", "completed-完结", "hiatus-休载", "cancelled-已取消"] },
  { label: "内容分级", options: ["default-网站默认", "safe-全年龄", "suggestive-含暗示", "erotica-成人向", "pornographic-限制级"] },
  { label: "标签匹配", options: ["AND-同时满足", "OR-满足任一"] }];
function selected(value: string | undefined): string[] {
  if (!value || value === "all") return [];
  if (value.startsWith("[")) {
    const values: unknown = JSON.parse(value);
    if (!Array.isArray(values) || !values.every(value => typeof value === "string")) throw new Error("标签筛选格式不正确。");
    return values;
  }
  return [value];
}
export function createSource(source: SourceStore): SourceConfig {
  const transport = new Transport(500);
  let lastManga: { id: string; at: number; value: Manga } | undefined;
  let cachedTags: MangaTag[] | undefined;
  const curatedCache = new Map<string, { at: number; mangas: Manga[] }>();
  function language(): Language {
    const value = source.loadSetting("language") ?? "en";
    if (value !== "en" && value !== "ja") throw new Error("此源仅支持英文或日语章节。");
    return value;
  }
  async function get<T>(path: string, values: [string, string | number][] = []): Promise<T> {
    const response = await transport.request("GET", `${API}${path}${values.length ? `?${query(values)}` : ""}`);
    return readReply<T>(response.status, response.status === 200 ? json(response) : null);
  }
  const item = (manga: Manga): ComicItem => {
    requireJapanese(manga);
    return { id: manga.id, title: localized(manga.attributes.title, language()) || manga.id, cover: cover(manga) ?? `${WEBSITE}/favicon.ico`,
      description: localized(manga.attributes.description, language()), tags: manga.attributes.tags?.map(tag => localized(tag.attributes.name, language())) };
  };
  async function tags() {
    if (!cachedTags) {
      const data = await get<{ data: MangaTag[] }>("/manga/tag");
      if (!Array.isArray(data.data)) throw new Error("MangaDex 标签数据格式已变化。");
      cachedTags = data.data;
    }
    return cachedTags;
  }
  function allowed(manga: Manga) { return manga.attributes?.originalLanguage === "ja" && manga.attributes.availableTranslatedLanguages?.includes(language()); }
  async function listing(key: string, options: string[], page: number, keyword = ""): Promise<ComicList> {
    pageNumber(page);
    const offset = (page - 1) * 30;
    if (offset >= 10_000) throw new Error("MangaDex 超出公开 API 分页范围，请缩小搜索范围。");
    const limit = Math.min(30, 10_000 - offset);
    const defaultSort = keyword ? "relevance" : key === "latest" ? "latestUploadedChapter" : key === "newest" ? "createdAt" : key === "top-rated" ? "rating" : "followedCount";
    const sort = !options[0] || options[0] === "default" ? defaultSort : options[0];
    if (!SORTS.some(value => value.split("-")[0] === sort)) throw new Error("不支持的漫画排序。");
    const values: [string, string | number][] = [...INCLUDES, ["originalLanguage[]", "ja"], ["availableTranslatedLanguage[]", language()],
      ["hasAvailableChapters", "true"], ["limit", limit], ["offset", offset], [`order[${sort}]`, options[1] === "asc" ? "asc" : "desc"]];
    if (keyword) values.push(["title", keyword]);
    if (key === "popular-new") values.push(["createdAtSince", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 19)]);
    if (key.startsWith("tag:")) values.push(["includedTags[]", key.slice(4)]);
    if (options[2] && options[2] !== "all") {
      if (!["ongoing", "completed", "hiatus", "cancelled"].includes(options[2])) throw new Error("不支持的连载状态。");
      values.push(["status[]", options[2]]);
    }
    if (options[3] && options[3] !== "default") {
      if (!["safe", "suggestive", "erotica", "pornographic"].includes(options[3])) throw new Error("不支持的内容分级。");
      values.push(["contentRating[]", options[3]]);
    }
    if (options[4]) {
      if (options[4] !== "AND" && options[4] !== "OR") throw new Error("不支持的标签匹配方式。");
      values.push(["includedTagsMode", options[4]]);
    }
    for (const [option, name] of [[options[5], "includedTags[]"], [options[6], "excludedTags[]"]]) {
      for (const value of selected(option)) {
        const id = choiceId(value);
        if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("标签 ID 格式不正确。");
        values.push([name!, id]);
      }
    }
    const result = readCollection(await get<Collection<Manga>>("/manga", values));
    if (result.offset !== offset) throw new Error("MangaDex 返回了错误的列表分页。");
    return list(result.data.filter(allowed).map(item), page, !result.data.length || offset + result.data.length >= result.total, Math.min(result.total, 10_000));
  }
  async function curated(key: string, page: number) {
    pageNumber(page);
    const cacheKey = `${key}:${language()}`;
    let cached = curatedCache.get(cacheKey);
    if (!cached || Date.now() - cached.at > 300_000) {
      const definition = CURATED_LISTS.find(entry => entry.id === key)!;
      const response = await get<{ data: { relationships: Relationship[] } }>(`/list/${definition.listId}`);
      if (!Array.isArray(response.data?.relationships)) throw new Error("MangaDex 书单数据格式已变化。");
      const ids = [...new Set(response.data.relationships.filter(entry => entry.type === "manga").map(entry => entry.id))];
      const found = new Map<string, Manga>();
      for (let offset = 0; offset < ids.length; offset += 100) {
        const result = readCollection(await get<Collection<Manga>>("/manga", [...INCLUDES, ["limit", 100],
          ["originalLanguage[]", "ja"], ["availableTranslatedLanguage[]", language()], ["hasAvailableChapters", "true"],
          ...ids.slice(offset, offset + 100).map(id => ["ids[]", id] as [string, string])]));
        for (const manga of result.data) if (allowed(manga)) found.set(manga.id, manga);
      }
      cached = { at: Date.now(), mangas: ids.flatMap(id => found.has(id) ? [found.get(id)!] : []) };
      curatedCache.set(cacheKey, cached);
    }
    return list(cached.mangas.slice((page - 1) * 30, page * 30).map(item), page, page * 30 >= cached.mangas.length, cached.mangas.length);
  }
  const browse = (key: string, options: string[], page: number) => {
    if (CURATED_LISTS.some(entry => entry.id === key)) return curated(key, page);
    if (!["popular", "latest", "all", "newest", "popular-new", "top-rated"].includes(key) && !key.startsWith("tag:")) throw new Error("不支持该漫画列表。");
    return listing(key, options, page);
  };
  async function manga(id: string) {
    if (lastManga?.id === id && Date.now() - lastManga.at < 60_000) return lastManga.value;
    const response = await get<{ data: Manga }>(`/manga/${encodeURIComponent(id)}`, INCLUDES);
    const value = requireJapanese(response.data);
    if (value.id !== id) throw new Error("MangaDex 返回了不匹配的作品。");
    lastManga = { id, at: Date.now(), value };
    return value;
  }
  async function chapters(id: string): Promise<Record<string, string>> {
    const chapters: Record<string, string> = {};
    const seen = new Set<string>();
    let offset = 0;
    while (true) {
      if (offset >= 10_000) throw new Error("MangaDex 章节数超过公开 API 上限，目录不完整。");
      const result = readCollection(await get<Collection<MangaChapter>>(`/manga/${encodeURIComponent(id)}/feed`, [
        ["limit", Math.min(500, 10_000 - offset)], ["offset", offset], ["translatedLanguage[]", language()], ["order[chapter]", "asc"], ["order[volume]", "asc"],
        ["order[publishAt]", "asc"], ["includes[]", "scanlation_group"], ["includeEmptyPages", 0], ["includeExternalUrl", 0],
        ["includeFuturePublishAt", 0], ["includeUnavailable", 0],
      ]));
      if (result.offset !== offset || (!result.data.length && offset < result.total)) throw new Error("MangaDex 章节分页不完整。");
      for (const chapter of result.data) {
        if (!chapter.id || !chapter.attributes || seen.has(chapter.id)) throw new Error("MangaDex 章节数据无效或重复。");
        seen.add(chapter.id);
        if (!readable(chapter, language())) continue;
        const a = chapter.attributes;
        const group = chapter.relationships?.filter(entry => entry.type === "scanlation_group").map(entry => entry.attributes?.name).filter(Boolean).join(" / ");
        chapters[chapter.id] = [a.volume ? `Vol. ${a.volume}` : "", a.chapter ? `Ch. ${a.chapter}` : "One-shot", a.title, group].filter(Boolean).join(" · ");
      }
      offset += result.data.length;
      if (offset >= result.total) return chapters;
    }
  }
  return {
    ...info("mangadex", "MangaDex（日漫）"), category: category("MangaDex（日漫）· Archettu", FEEDS.filter(([key]) => key !== "tags")),
    explore: FEEDS.map(([key, title]) => ({ title: `MangaDex · ${title}`, type: key === "tags" ? "multiPartPage" : "multiPageComicList",
      load: async page => key === "tags" ? (await tags()).map(tag => part(`tag:${tag.id}`, `${tag.attributes.group} · ${localized(tag.attributes.name, language())}`)) : browse(key, [], page) })),
    categoryComics: { load: (name, key, values, page) => browse(key ?? name, values, page), optionLoader: async (_name, key) => {
      if (CURATED_LISTS.some(entry => entry.id === key)) return [];
      const options = (await tags()).map(tag => choice(tag.id, localized(tag.attributes.name, language())));
      return [...BASE_OPTIONS, { label: "包含标签", options: ["all-不限", ...options] }, { label: "排除标签", options: ["all-不限", ...options] }];
    } },
    search: { load: (keyword, values, page) => listing("all", values, page, keyword.trim()),
      optionList: [...BASE_OPTIONS,
        { label: "包含标签", type: "multi-select", options: tagSnapshot.map(tag => choice(tag.id, tag.name)) },
        { label: "排除标签", type: "multi-select", options: tagSnapshot.map(tag => choice(tag.id, tag.name)) }] },
    comic: {
      loadInfo: async id => {
        const value = await manga(id);
        return { title: localized(value.attributes.title, language()) || id, cover: cover(value) ?? `${WEBSITE}/favicon.ico`,
          description: localized(value.attributes.description, language()), subtitle: value.attributes.status,
          tags: { 作者: value.relationships.filter(entry => (entry.type === "author" || entry.type === "artist") && entry.attributes?.name).map(entry => entry.attributes!.name!),
            题材: value.attributes.tags?.map(tag => localized(tag.attributes.name, language())) ?? [], 原始语言: ["日语"] },
          chapters: await chapters(id), url: `${WEBSITE}/title/${encodeURIComponent(id)}` };
      },
      loadEp: async (id, chapterId) => {
        if (!chapterId) throw new Error("请选择章节。");
        await manga(id);
        const { data: chapter } = await get<{ data: MangaChapter }>(`/chapter/${encodeURIComponent(chapterId)}`);
        if (chapter?.id !== chapterId || !readable(chapter, language()) || !chapter.relationships?.some(entry => entry.type === "manga" && entry.id === id)) throw new Error("章节不属于该日漫、不是当前语言或仅在外站提供，请刷新目录。");
        const reply = await get<Parameters<typeof pageUrls>[0]>(`/at-home/server/${encodeURIComponent(chapterId)}`);
        const images = pageUrls(reply, Boolean(source.loadSetting("dataSaver")));
        if (images.length !== chapter.attributes.pages) throw new Error("MangaDex 图片数量与章节信息不一致。");
        return { images };
      },
    },
    settings: {
      language: { title: "章节语言", type: "select", default: "en", options: [{ value: "en", text: "英文译文" }, { value: "ja", text: "日语原文" }] },
      dataSaver: { title: "节省图片流量", type: "switch", default: false },
    },
  };
}
