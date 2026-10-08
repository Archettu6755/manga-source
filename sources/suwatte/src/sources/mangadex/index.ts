"use httpclient";

import {
  ContentRating, ContentStatus, ContentType, ReadingMode, UIPicker, UIToggle,
  type Chapter, type ChapterPage, type Content, type Delegate, type HomePage,
  type Item, type ItemListRequest, type PagedItemList, type PopulatedForm,
  type SearchRequest, type SourceInfo, type UIForm,
} from "@suwatte/toolchain/types";
import {
  API, WEBSITE, chapterNumber, cover, localized, pageUrls, query, readCollection, readable, readReply, requireJapanese,
  type Collection, type Language, type Manga, type MangaChapter,
} from "@archettu/mangadex";

const INCLUDES: [string, string][] = [["includes[]", "cover_art"], ["includes[]", "author"], ["includes[]", "artist"]];

export default class MangaDex implements Delegate {
  static info: SourceInfo = {
    id: "en.mangadex", name: "MangaDex（日漫）· Archettu", version: 1, website: WEBSITE,
    languages: ["en", "ja"], rating: ContentRating.UNKNOWN, minSupportedAppVersion: "7.0.0",
  };
  private readonly api = new HttpClient({ timeout: 20_000, retries: 0, rateLimit: { permits: 1, period: 500 }, validateStatus: () => true });
  readonly client = new HttpClient({ timeout: 20_000, retries: 0 });
  private lastManga?: { id: string; at: number; value: Manga };

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
    ] };
  }
  private item(manga: Manga, language: Language): Item {
    requireJapanese(manga);
    return { id: manga.id, title: localized(manga.attributes.title, language) || manga.id,
      coverImage: cover(manga), rating: this.rating(manga.attributes.contentRating),
      webUrl: `${WEBSITE}/title/${encodeURIComponent(manga.id)}` };
  }
  private async listing(page: number, title?: string, latest = false): Promise<PagedItemList> {
    if (!Number.isInteger(page) || page < 1 || page * 30 > 10_000) throw new Error("MangaDex 页码超出公开 API 的范围，请缩小搜索范围。");
    const language = await this.language();
    const offset = (page - 1) * 30;
    const params: [string, string | number][] = [
      ...INCLUDES, ["originalLanguage[]", "ja"], ["availableTranslatedLanguage[]", language], ["hasAvailableChapters", "true"],
      ["limit", 30], ["offset", offset], [title ? "order[relevance]" : latest ? "order[latestUploadedChapter]" : "order[followedCount]", "desc"],
    ];
    if (title) params.push(["title", title]);
    const data = readCollection(await this.get<Collection<Manga>>("/manga", params));
    if (data.offset !== offset) throw new Error("MangaDex 返回了错误的列表分页。");
    return { items: data.data.filter(manga => manga.attributes?.originalLanguage === "ja" &&
      manga.attributes.availableTranslatedLanguages?.includes(language)).map(manga => this.item(manga, language)),
      total: data.total, isLastPage: !data.data.length || offset + data.data.length >= data.total };
  }
  async getSearchResults(request: SearchRequest, page: number): Promise<PagedItemList> {
    return this.listing(page, request.query?.trim() || undefined);
  }
  async getItemList(request: ItemListRequest, page: number): Promise<PagedItemList> { return this.listing(page, undefined, request.key === "latest"); }
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
  }
}
