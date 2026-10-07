"use httpclient";

import {
  ContentRating, ContentStatus, ContentType, ReadingMode, UIPicker, UITextField, UIToggle,
  type Chapter, type ChapterPage, type Content, type Delegate, type HomePage,
  type Item, type ItemListRequest, type PagedItemList, type PopulatedForm,
  type SearchRequest, type SourceInfo, type UIForm,
} from "@suwatte/toolchain/types";
import { CopyMangaApi } from "./api";
import {
  CHAPTER_PAGE_SIZE, PAGE_SIZE, WEBSITE, chapterNumber, imageHeaders, normalizeApi, orderedPages,
  readList, requireComic, type ApiChapter, type ApiList, type ApiPages, type Comic, type Details,
} from "@archettu/copymanga";

export default class CopyManga implements Delegate {
  static info: SourceInfo = {
    id: "zh.copymanga",
    name: "拷贝漫画 · Archettu",
    version: 2,
    website: WEBSITE,
    languages: ["zh-Hans", "zh-Hant"],
    rating: ContentRating.UNKNOWN,
    minSupportedAppVersion: "7.0.0",
  };

  private readonly api = new CopyMangaApi();
  readonly client = new HttpClient({ timeout: 20_000, retries: 0 });
  private lastDetails?: { id: string; at: number; value: Details };

  constructor() {
    this.client.interceptors.request.use(request => {
      for (const [name, value] of Object.entries(imageHeaders())) request.headers.set(name, value);
      return request;
    });
  }

  getConfiguration() {
    return { useClientForImageRequests: true };
  }

  async getHomePage(): Promise<HomePage> {
    return { feeds: [
      { id: "latest", title: "最近更新", content: { list: { key: "latest" } } },
      { id: "popular", title: "热门漫画", content: { list: { key: "popular" } } },
    ] };
  }

  private item(comic: Comic): Item {
    requireComic(comic);
    return {
      id: comic.path_word, title: comic.name, coverImage: comic.cover,
      subtitle: comic.author?.map(author => author.name).join("、"),
      rating: ContentRating.UNKNOWN,
      webUrl: `${WEBSITE}/comic/${encodeURIComponent(comic.path_word)}`,
    };
  }

  private paged(data: ApiList<Comic>, page: number): PagedItemList {
    readList(data);
    return { items: data.list.map(comic => this.item(comic)), total: data.total,
      isLastPage: !data.list.length || (page - 1) * PAGE_SIZE + data.list.length >= data.total };
  }

  async getSearchResults(request: SearchRequest, page: number): Promise<PagedItemList> {
    const query = request.query?.trim();
    if (!query) return this.getItemList({ key: "latest" }, page);
    const params = { q: query, q_type: "", limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    const data = await ObjectStore.string("copymanga.search") === "app"
      ? await this.api.get<ApiList<Comic>>("search/comic", params)
      : await this.api.webSearch<ApiList<Comic>>(query, PAGE_SIZE, params.offset);
    return this.paged(data, page);
  }

  async getItemList(request: ItemListRequest, page: number): Promise<PagedItemList> {
    const data = await this.api.get<ApiList<Comic>>("comics", {
      ordering: request.key === "popular" ? "-popular" : "-datetime_updated",
      limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
    });
    return this.paged(data, page);
  }

  private async details(id: string): Promise<Details> {
    if (this.lastDetails?.id === id && Date.now() - this.lastDetails.at < 60_000) return this.lastDetails.value;
    const value = await this.api.get<Details>(`comic2/${encodeURIComponent(id)}`, { platform: 3 });
    requireComic(value.comic);
    if (!value.groups || typeof value.groups !== "object" || Array.isArray(value.groups)) {
      throw new Error("CopyManga 返回的漫画信息缺少章节分组，请更新源。");
    }
    this.lastDetails = { id, at: Date.now(), value };
    return value;
  }

  async getContent(contentId: string): Promise<Content> {
    const { comic } = await this.details(contentId);
    const display = comic.status?.display ?? "";
    return {
      title: comic.name, coverImage: comic.cover, summary: comic.brief,
      rating: ContentRating.UNKNOWN, contentType: ContentType.MANGA,
      readingMode: ReadingMode.PAGED_MANGA,
      status: /完[结結]/.test(display) ? ContentStatus.COMPLETED
        : /[连連][载載]/.test(display) ? ContentStatus.ONGOING : ContentStatus.UNKNOWN,
      credits: comic.author?.map(author => ({ name: author.name, role: "作者" })),
      genres: comic.theme?.map(theme => ({ id: theme.path_word, title: theme.name })),
      webUrl: `${WEBSITE}/comic/${encodeURIComponent(contentId)}`,
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const { groups } = await this.details(contentId);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const orderedGroups = Object.values(groups).sort((a, b) => Number(b.path_word === "default") - Number(a.path_word === "default"));
    for (const group of orderedGroups) {
      if (typeof group.path_word !== "string" || !group.path_word) throw new Error("CopyManga 章节分组格式已变化。");
      let offset = 0;
      while (true) {
        const data = readList(await this.api.get<ApiList<ApiChapter>>(
          `comic/${encodeURIComponent(contentId)}/group/${encodeURIComponent(group.path_word)}/chapters`,
          { limit: CHAPTER_PAGE_SIZE, offset },
        ));
        if (!data.list.length) {
          if (offset < data.total) throw new Error("CopyManga 章节列表未返回完整分页，请稍后重试。");
          break;
        }
        let added = 0;
        for (const entry of data.list) {
          if (typeof entry.uuid !== "string" || !entry.uuid || typeof entry.name !== "string") {
            throw new Error("CopyManga 章节信息格式已变化，请更新源。");
          }
          if (seen.has(entry.uuid)) continue;
          seen.add(entry.uuid);
          added++;
          const date = entry.datetime_created ? new Date(`${entry.datetime_created.slice(0, 10)}T00:00:00+08:00`) : undefined;
          chapters.push({
            id: entry.uuid, index: chapters.length, number: chapterNumber(entry.name),
            title: group.path_word === "default" ? entry.name : `${group.name}：${entry.name}`,
            language: "zh-Hant", date: date && Number.isFinite(date.getTime()) ? date : undefined,
            webUrl: `${WEBSITE}/comic/${encodeURIComponent(contentId)}/chapter/${encodeURIComponent(entry.uuid)}`,
            data: { group: group.path_word },
          });
        }
        offset += data.list.length;
        if (offset >= data.total) break;
        if (!added) throw new Error("CopyManga 返回了重复的章节分页，请稍后重试。");
      }
    }
    if (!chapters.length) throw new Error("CopyManga 未返回章节。作品可能暂时无章节，或访问受限；请在官网核对并稍后重试。");
    return chapters;
  }

  async getChapterPages(contentId: string, chapterId: string): Promise<ChapterPage[]> {
    return orderedPages(await this.api.get<ApiPages>(
      `comic/${encodeURIComponent(contentId)}/chapter2/${encodeURIComponent(chapterId)}`,
    ));
  }

  async getSettingsPage(): Promise<UIForm> {
    return { sections: [
      { header: "连接", footer: "API 留空时自动获取地址。修改地址不会清除登录或设备信息。", views: [
        UITextField({ id: "api", title: "API 域名", placeholder: "自动获取", currentValue: await ObjectStore.string("copymanga.api") ?? "" }),
        UIPicker({ id: "search", title: "搜索接口", currentValue: await ObjectStore.string("copymanga.search") ?? "web", options: [
          { id: "web", title: "网页搜索" }, { id: "app", title: "App 搜索" },
        ] }),
      ] },
      { header: await this.api.isLoggedIn() ? "账号：已保存登录" : "账号：未登录",
        footer: "填写账号和密码后提交即可登录。密码不会保存，令牌仅保存在设备安全存储中。", views: [
          UITextField({ id: "username", title: "CopyManga 账号", currentValue: "" }),
          UITextField({ id: "password", title: "密码", currentValue: "", isSecure: true }),
          UIToggle({ id: "logout", title: "退出登录", currentValue: false }),
        ] },
    ] };
  }

  async onFormSubmitted(_id: string, data: PopulatedForm): Promise<void> {
    const api = typeof data.api === "string" ? data.api.trim() : undefined;
    const normalized = api ? normalizeApi(api) : "";
    const username = typeof data.username === "string" ? data.username.trim() : "";
    const password = typeof data.password === "string" ? data.password : "";
    if (Boolean(username) !== Boolean(password)) throw new Error("请同时填写账号和密码。");
    if (data.logout && username) throw new Error("请分别执行登录与退出登录。");
    if (api !== undefined) await ObjectStore.set("copymanga.api", normalized);
    if (data.search === "web" || data.search === "app") await ObjectStore.set("copymanga.search", data.search);
    this.api.reset();
    this.lastDetails = undefined;
    if (data.logout) await this.api.logout();
    else if (username) await this.api.login(username, password);
  }

  async clearAuthentication(): Promise<void> {
    await this.api.logout();
    this.lastDetails = undefined;
  }
}
