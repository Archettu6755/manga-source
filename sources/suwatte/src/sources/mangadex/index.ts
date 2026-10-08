"use httpclient";

import {
  ContentRating, ContentStatus, ContentType, ReadingMode, UIPicker, UIToggle,
  ItemListDestination, PageSectionStyle, PickerFilter, SelectFilter, SearchFilter,
  type Chapter, type ChapterPage, type Content, type Delegate, type HomePage,
  type Item, type ItemListRequest, type PagedItemList, type PopulatedForm,
  type SearchRequest, type SourceInfo, type UIForm, type ItemPageResponse, type SortOptions,
} from "@suwatte/toolchain/types";
import {
  API, WEBSITE, CURATED_LISTS, chapterNumber, cover, localized, pageUrls, query, readCollection, readable, readReply, requireJapanese,
  type Collection, type Language, type Manga, type MangaChapter, type MangaTag, type Relationship,
} from "@archettu/mangadex";

const INCLUDES: [string, string][] = [["includes[]", "cover_art"], ["includes[]", "author"], ["includes[]", "artist"]];

export default class MangaDex implements Delegate {
  static info: SourceInfo = {
    id: "en.mangadex", name: "MangaDex（日漫）· Archettu", version: 2, website: WEBSITE,
    languages: ["en", "ja"], rating: ContentRating.UNKNOWN, minSupportedAppVersion: "7.0.0",
  };
  private readonly api = new HttpClient({ timeout: 20_000, retries: 0, rateLimit: { permits: 1, period: 0.5 }, validateStatus: () => true });
  readonly client = new HttpClient({ timeout: 20_000, retries: 0 });
  private lastManga?: { id: string; at: number; value: Manga };
  private cachedTags?: MangaTag[];
  private curatedCache?: { key: string; language: Language; at: number; mangas: Manga[] };

  getConfiguration() { return { useClientForImageRequests: true }; }
  private async language(): Promise<Language> { return await ObjectStore.string("mangadex.language") === "ja" ? "ja" : "en"; }
  private async get<T>(path: string, params: [string, string | number][] = []): Promise<T> {
    const response = await this.api.get(`${API}${path}${params.length ? `?${query(params)}` : ""}`);
    if (response.status !== 200) return readReply<T>(response.status, null);
    return readReply<T>(response.status, await response.json());
  }
  private rating(value?: string): ContentRating {
    return value === "safe" ? ContentRating.EVERYONE : value === "suggestive" ? ContentRating.SUGGESTIVE
      : value === "erotica" || value === "pornographic" ? ContentRating.MATURE : ContentRating.UNKNOWN;
  }
  async getHomePage(): Promise<HomePage> {
    return { feeds: [
      { id: "popular", title: "热门日漫", content: { list: { key: "popular" } } },
      { id: "latest", title: "最近更新", content: { list: { key: "latest" } } },
      { id: "all", title: "全部日漫", content: { list: { key: "all" } } },
      { id: "newest", title: "新上架", content: { list: { key: "newest" } } },
      { id: "popular-new", title: "本月热门新作", content: { list: { key: "popular-new" } } },
      { id: "top-rated", title: "评分排行", content: { list: { key: "top-rated" } } },
      { id: "tags", title: "分类／标签", content: { page: "tags" } },
      ...CURATED_LISTS.map(list => ({ id: list.id, title: list.title, content: { list: { key: list.id, disableSorting: true } } })),
    ] };
  }

  async getSortOptions(): Promise<SortOptions> {
    return { options: [{ id: "followedCount", title: "收藏数" }, { id: "latestUploadedChapter", title: "章节更新" },
      { id: "createdAt", title: "上架时间" }, { id: "rating", title: "评分" }, { id: "title", title: "名称" }, { id: "relevance", title: "搜索相关度" }] };
  }
  private async tags(): Promise<MangaTag[]> {
    if (!this.cachedTags) {
      const { data } = await this.get<{ data: MangaTag[] }>("/manga/tag");
      if (!Array.isArray(data)) throw new Error("MangaDex 标签数据格式已变化。");
      this.cachedTags = data;
    }
    return this.cachedTags;
  }
  async getSearchFilters(): Promise<SearchFilter[]> {
    const tags = (await this.tags()).map(tag => ({ id: tag.id, title: localized(tag.attributes.name, "en") || tag.id }));
    return [
      SearchFilter("tags", "包含／排除标签", SelectFilter(tags, true)),
      SearchFilter("tagsMode", "包含标签的匹配方式", PickerFilter([{ id: "AND", title: "同时满足" }, { id: "OR", title: "满足任一" }])),
      SearchFilter("status", "连载状态", PickerFilter([{ id: "all", title: "全部" }, { id: "ongoing", title: "连载中" },
        { id: "completed", title: "已完结" }, { id: "hiatus", title: "休载" }, { id: "cancelled", title: "已取消" }])),
      SearchFilter("rating", "内容分级", PickerFilter([{ id: "default", title: "网站默认" }, { id: "safe", title: "全年龄" },
        { id: "suggestive", title: "含暗示" }, { id: "erotica", title: "成人向" }, { id: "pornographic", title: "限制级" }])),
    ];
  }
  async getItemPage(key: string, page: number): Promise<ItemPageResponse> {
    if (key !== "tags") throw new Error("MangaDex 不支持该浏览入口。");
    if (page > 1) return { sections: [], isLastPage: true };
    const groups = new Map<string, MangaTag[]>();
    for (const tag of await this.tags()) groups.set(tag.attributes.group, [...(groups.get(tag.attributes.group) ?? []), tag]);
    return { sections: [...groups].map(([group, tags]) => ({ id: group, title: group, style: PageSectionStyle.TAG_GRID,
      items: tags.map(tag => ({ id: `tag:${tag.id}`, title: localized(tag.attributes.name, "en") || tag.id, rating: ContentRating.UNKNOWN,
        destination: ItemListDestination({ key: `tag:${tag.id}` }, localized(tag.attributes.name, "en")) })) })), isLastPage: true };
  }
  private item(manga: Manga, language: Language): Item {
    requireJapanese(manga);
    return { id: manga.id, title: localized(manga.attributes.title, language) || manga.id,
      coverImage: cover(manga), rating: this.rating(manga.attributes.contentRating),
      webUrl: `${WEBSITE}/title/${encodeURIComponent(manga.id)}` };
  }
  private async listing(page: number, request: SearchRequest = {}, key = "popular"): Promise<PagedItemList> {
    if (!Number.isInteger(page) || page < 1 || page * 30 > 10_000) throw new Error("MangaDex 页码超出公开 API 的范围，请缩小搜索范围。");
    const language = await this.language();
    const offset = (page - 1) * 30;
    const title = request.query?.trim();
    const sort = request.sort?.key ?? (title ? "relevance" : key === "latest" ? "latestUploadedChapter" : key === "newest" ? "createdAt" : key === "top-rated" ? "rating" : "followedCount");
    if (!(await this.getSortOptions()).options.some(option => option.id === sort)) throw new Error("不支持的漫画排序。");
    const params: [string, string | number][] = [
      ...INCLUDES, ["originalLanguage[]", "ja"], ["availableTranslatedLanguage[]", language], ["hasAvailableChapters", "true"],
      ["limit", 30], ["offset", offset], [`order[${sort}]`, request.sort?.ascending ? "asc" : "desc"],
    ];
    if (title) params.push(["title", title]);
    if (key === "popular-new") params.push(["createdAtSince", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 19)]);
    if (key.startsWith("tag:")) params.push(["includedTags[]", key.slice(4)]);
    const filters = request.filters ?? {};
    if (filters.status && filters.status !== "all") {
      if (!["ongoing", "completed", "hiatus", "cancelled"].includes(String(filters.status))) throw new Error("不支持的连载状态。");
      params.push(["status[]", String(filters.status)]);
    }
    if (filters.rating && filters.rating !== "default") {
      if (!["safe", "suggestive", "erotica", "pornographic"].includes(String(filters.rating))) throw new Error("不支持的内容分级。");
      params.push(["contentRating[]", String(filters.rating)]);
    }
    if (filters.tagsMode) {
      if (filters.tagsMode !== "AND" && filters.tagsMode !== "OR") throw new Error("不支持的标签匹配方式。");
      params.push(["includedTagsMode", filters.tagsMode]);
    }
    if (filters.tags) {
      if (typeof filters.tags !== "object" || !Array.isArray(filters.tags.include) || !Array.isArray(filters.tags.exclude)) throw new Error("标签筛选格式不正确。");
      for (const id of filters.tags.include) params.push(["includedTags[]", id]);
      for (const id of filters.tags.exclude) params.push(["excludedTags[]", id]);
    }
    const data = readCollection(await this.get<Collection<Manga>>("/manga", params));
    if (data.offset !== offset) throw new Error("MangaDex 返回了错误的列表分页。");
    return { items: data.data.filter(manga => manga.attributes?.originalLanguage === "ja" &&
      manga.attributes.availableTranslatedLanguages?.includes(language)).map(manga => this.item(manga, language)),
      total: data.total, isLastPage: !data.data.length || offset + data.data.length >= data.total };
  }
  async getSearchResults(request: SearchRequest, page: number): Promise<PagedItemList> {
    return this.listing(page, request);
  }
  async getItemList(request: ItemListRequest, page: number): Promise<PagedItemList> {
    const key = request.key ?? "all";
    if (CURATED_LISTS.some(list => list.id === key)) return this.curated(key, page);
    if (!["all", "popular", "latest", "newest", "popular-new", "top-rated"].includes(key) && !key.startsWith("tag:")) throw new Error("MangaDex 不支持该列表入口。");
    return this.listing(page, { sort: request.sort }, key);
  }
  private async curated(key: string, page: number): Promise<PagedItemList> {
    if (!Number.isInteger(page) || page < 1) throw new Error("页码必须从 1 开始。");
    const language = await this.language();
    if (!this.curatedCache || this.curatedCache.key !== key || this.curatedCache.language !== language || Date.now() - this.curatedCache.at > 300_000) {
      const list = CURATED_LISTS.find(list => list.id === key)!;
      const { data } = await this.get<{ data: { relationships: Relationship[] } }>(`/list/${list.listId}`);
      if (!Array.isArray(data?.relationships)) throw new Error("MangaDex 官网书单格式已变化。");
      const ids = [...new Set(data.relationships.filter(entry => entry.type === "manga").map(entry => entry.id))];
      const mangas = new Map<string, Manga>();
      for (let offset = 0; offset < ids.length; offset += 100) {
        const result = readCollection(await this.get<Collection<Manga>>("/manga", [...INCLUDES, ["limit", 100],
          ["originalLanguage[]", "ja"], ["availableTranslatedLanguage[]", language], ["hasAvailableChapters", "true"],
          ...ids.slice(offset, offset + 100).map(id => ["ids[]", id] as [string, string])]));
        for (const manga of result.data) if (manga.attributes.originalLanguage === "ja" && manga.attributes.availableTranslatedLanguages?.includes(language)) mangas.set(manga.id, manga);
      }
      this.curatedCache = { key, language, at: Date.now(), mangas: ids.flatMap(id => mangas.has(id) ? [mangas.get(id)!] : []) };
    }
    const mangas = this.curatedCache.mangas;
    return { items: mangas.slice((page - 1) * 30, page * 30).map(manga => this.item(manga, language)), total: mangas.length, isLastPage: page * 30 >= mangas.length };
  }
  private async manga(id: string): Promise<Manga> {
    if (this.lastManga?.id === id && Date.now() - this.lastManga.at < 60_000) return this.lastManga.value;
    const { data } = await this.get<{ data: Manga }>(`/manga/${encodeURIComponent(id)}`, INCLUDES);
    const value = requireJapanese(data);
    if (value.id !== id) throw new Error("MangaDex 返回了不匹配的作品。");
    this.lastManga = { id, at: Date.now(), value };
    return value;
  }
  async getContent(contentId: string): Promise<Content> {
    const manga = await this.manga(contentId);
    const language = await this.language();
    const status = manga.attributes.status;
    return { title: localized(manga.attributes.title, language) || manga.id, coverImage: cover(manga) ?? `${WEBSITE}/favicon.ico`,
      summary: localized(manga.attributes.description, language), rating: this.rating(manga.attributes.contentRating),
      contentType: ContentType.MANGA, readingMode: ReadingMode.PAGED_MANGA,
      status: status === "completed" ? ContentStatus.COMPLETED : status === "ongoing" ? ContentStatus.ONGOING
        : status === "hiatus" ? ContentStatus.HIATUS : status === "cancelled" ? ContentStatus.CANCELLED : ContentStatus.UNKNOWN,
      credits: manga.relationships.filter(entry => (entry.type === "author" || entry.type === "artist") && entry.attributes?.name)
        .map(entry => ({ name: entry.attributes!.name!, role: entry.type === "author" ? "原作" : "作画" })),
      genres: manga.attributes.tags?.map(tag => ({ id: tag.id, title: localized(tag.attributes.name, language) || tag.id })),
      webUrl: `${WEBSITE}/title/${encodeURIComponent(contentId)}` };
  }
  async getChapters(contentId: string): Promise<Chapter[]> {
    await this.manga(contentId);
    const language = await this.language();
    const raw: MangaChapter[] = [];
    const seen = new Set<string>();
    let offset = 0;
    while (true) {
      if (offset >= 10_000) throw new Error("MangaDex 章节数超过公开 API 分页上限，目录未返回完整。");
      const data = readCollection(await this.get<Collection<MangaChapter>>(`/manga/${encodeURIComponent(contentId)}/feed`, [
        ["limit", 500], ["offset", offset], ["translatedLanguage[]", language], ["order[chapter]", "asc"], ["order[volume]", "asc"],
        ["order[publishAt]", "asc"], ["includes[]", "scanlation_group"], ["includeEmptyPages", 0], ["includeExternalUrl", 0],
        ["includeFuturePublishAt", 0], ["includeUnavailable", 0],
      ]));
      if (data.offset !== offset) throw new Error("MangaDex 返回了重复或错误的章节分页。");
      if (!data.data.length && offset < data.total) throw new Error("MangaDex 章节目录未返回完整分页。");
      for (const chapter of data.data) {
        if (!chapter.id || !chapter.attributes) throw new Error("MangaDex 章节格式已变化。");
        if (seen.has(chapter.id)) throw new Error("MangaDex 返回了重复的章节分页。");
        seen.add(chapter.id);
        if (readable(chapter, language)) raw.push(chapter);
      }
      offset += data.data.length;
      if (offset >= data.total) break;
    }
    return raw.map((chapter, index) => {
      const groups = chapter.relationships.filter(entry => entry.type === "scanlation_group").map(entry => entry.attributes?.name).filter(Boolean).join(" / ");
      const date = chapter.attributes.publishAt ? new Date(chapter.attributes.publishAt) : undefined;
      return { id: chapter.id, index, number: chapterNumber(chapter.attributes.chapter),
        volume: chapterNumber(chapter.attributes.volume) >= 0 ? chapterNumber(chapter.attributes.volume) : undefined,
        title: [chapter.attributes.title || (chapter.attributes.chapter ? `Chapter ${chapter.attributes.chapter}` : "One-shot"), groups].filter(Boolean).join(" · "),
        language, date: date && Number.isFinite(date.getTime()) ? date : undefined, webUrl: `${WEBSITE}/chapter/${encodeURIComponent(chapter.id)}` };
    });
  }
  async getChapterPages(contentId: string, chapterId: string): Promise<ChapterPage[]> {
    await this.manga(contentId);
    const language = await this.language();
    const { data: chapter } = await this.get<{ data: MangaChapter }>(`/chapter/${encodeURIComponent(chapterId)}`);
    if (chapter?.id !== chapterId || !readable(chapter, language) || !chapter.relationships?.some(entry => entry.type === "manga" && entry.id === contentId)) {
      throw new Error("此章节不属于该日漫、不是当前所选语言，或仅支持在外站阅读。请刷新目录。");
    }
    const reply = await this.get<Parameters<typeof pageUrls>[0]>(`/at-home/server/${encodeURIComponent(chapterId)}`);
    const saver = Boolean(await ObjectStore.get("mangadex.dataSaver"));
    const pages = pageUrls(reply, saver);
    if (pages.length !== chapter.attributes.pages) throw new Error("MangaDex 返回的图片数量与章节信息不一致，请稍后重试。");
    return pages.map(url => ({ url }));
  }
  async getSettingsPage(): Promise<UIForm> {
    return { sections: [{ header: "日漫阅读", footer: "仅收录原始语言为日语的作品。修改章节语言后请刷新目录。部分章节因授权限制仅在外站提供，本源不显示这类章节。", views: [
      UIPicker({ id: "language", title: "章节语言", currentValue: await this.language(), options: [{ id: "en", title: "英文译文" }, { id: "ja", title: "日语原文" }] }),
      UIToggle({ id: "dataSaver", title: "节省图片流量", currentValue: Boolean(await ObjectStore.get("mangadex.dataSaver")) }),
    ] }] };
  }
  async onFormSubmitted(_id: string, data: PopulatedForm): Promise<void> {
    if (data.language !== undefined && data.language !== "en" && data.language !== "ja") throw new Error("此源仅支持英文或日语章节。");
    if (typeof data.language === "string") await ObjectStore.set("mangadex.language", data.language);
    if (typeof data.dataSaver === "boolean") await ObjectStore.set("mangadex.dataSaver", data.dataSaver);
    this.lastManga = undefined;
    this.curatedCache = undefined;
  }
}
