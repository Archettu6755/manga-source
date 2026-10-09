"use httpclient";

import {
  ContentRating, ContentStatus, ContentType, ReadingMode, UIPicker, UITextField, UIToggle, PageSectionStyle, PickerFilter, SearchFilter, ItemListDestination,
  type Chapter, type ChapterPage, type Content, type Delegate, type HomePage,
  type Item, type ItemListRequest, type PagedItemList, type PopulatedForm,
  type SearchRequest, type SourceInfo, type UIForm, type ItemPageResponse, type SortOptions,
} from "@suwatte/toolchain/types";
import { CopyMangaApi } from "./api";
import {
  CHAPTER_PAGE_SIZE, PAGE_SIZE, WEBSITE, COPY_WEBSITES, chapterNumber, imageHeaders, normalizeApi, orderedPages,
  readList, requireComic, type ApiChapter, type ApiList, type ApiPages, type Comic, type Details,
  WEB_PAGE_SIZE, RECOMMEND_PAGE_SIZE, TOPIC_PAGE_SIZE, RANK_PERIODS, REGIONS, STATUSES,
  parseComicList, parseCardList, parseHome, parseThemes, parseTopics, type Topic, type BrowseTheme,
} from "@archettu/copymanga";

export default class CopyManga implements Delegate {
  static info: SourceInfo = {
    id: "zh.copymanga",
    name: "拷贝漫画 · Archettu",
    version: 4,
    website: WEBSITE,
    languages: ["zh-Hans", "zh-Hant"],
    rating: ContentRating.UNKNOWN,
    minSupportedAppVersion: "7.0.0",
  };

  private readonly api = new CopyMangaApi();
  readonly client = new HttpClient({ timeout: 20_000, retries: 0 });
  private lastDetails?: { id: string; at: number; value: Details };
  private cachedThemes?: { at: number; value: BrowseTheme[] };

  constructor() {
    this.client.interceptors.request.use(async request => {
      for (const [name, value] of Object.entries(imageHeaders(new Date(), await this.api.region()))) request.headers.set(name, value);
      return request;
    });
  }

  getConfiguration() {
    return { useClientForImageRequests: true };
  }

  async getHomePage(): Promise<HomePage> {
    return { feeds: [
      { id: "home", title: "首页推荐", content: { page: "home" } },
      { id: "all", title: "发现／全部漫画", content: { list: { key: "all" } } },
      { id: "topics", title: "专题", content: { list: { key: "topics", disableSorting: true } } },
      { id: "themes", title: "题材", content: { page: "themes" } },
      { id: "ranks", title: "排行榜", content: { page: "ranks" } },
      { id: "recommend", title: "漫画推荐", content: { list: { key: "recommend", disableSorting: true } } },
      { id: "newest", title: "全新上架", content: { list: { key: "newest", disableSorting: true } } },
      { id: "latest", title: "最近更新", content: { list: { key: "latest" } } },
      { id: "popular", title: "热门漫画", content: { list: { key: "popular" } } },
      { id: "completed", title: "已完结", content: { list: { key: "completed" } } },
    ] };
  }

  async getSortOptions(): Promise<SortOptions> {
    return { options: [{ id: "datetime_updated", title: "更新时间" }, { id: "popular", title: "热度" }] };
  }

  private async themes(): Promise<BrowseTheme[]> {
    if (this.cachedThemes && Date.now() - this.cachedThemes.at < 3_600_000) return this.cachedThemes.value;
    const value = parseThemes(await this.api.web("/filter"));
    this.cachedThemes = { at: Date.now(), value };
    return value;
  }

  async getSearchFilters(): Promise<SearchFilter[]> {
    return [SearchFilter("theme", "题材", PickerFilter([{ id: "all", title: "全部" }, ...(await this.themes()).map(tag => ({ id: tag.path_word, title: tag.name }))])),
      SearchFilter("region", "地区", PickerFilter(REGIONS.map(option => ({ ...option, id: option.id || "all" })))),
      SearchFilter("status", "状态", PickerFilter(STATUSES.map(option => ({ ...option, id: option.id || "all" }))))];
  }

  private topicItem(topic: Topic): Item {
    return { id: `topic:${topic.id}`, title: topic.title, coverImage: topic.cover, subtitle: topic.summary,
      rating: ContentRating.UNKNOWN, destination: ItemListDestination({ key: `topic:${topic.id}`, disableSorting: true }, topic.title) };
  }

  async getItemPage(key: string, page: number): Promise<ItemPageResponse> {
    if (page !== 1) return { sections: [], isLastPage: true };
    if (key === "home") {
      const sections = parseHome(await this.api.web("/"));
      return { sections: sections.map(section => ({ id: section.id, title: section.title,
        style: section.id === "banners" ? PageSectionStyle.BANNER : PageSectionStyle.DEFAULT,
        items: section.topics ? section.topics.map(topic => this.topicItem(topic)) : section.comics.map(comic => this.item(comic)),
        destination: section.list ? ItemListDestination({ key: section.list, disableSorting: ["recommend", "newest", "topics"].includes(section.list) }, section.title) : undefined })), isLastPage: true };
    }
    if (key === "themes") return { sections: [{ id: "themes", title: "全部题材", style: PageSectionStyle.TAG_GRID,
      items: (await this.themes()).map(theme => ({ id: `theme:${theme.path_word}`, title: theme.name, subtitle: `${theme.count} 部`, rating: ContentRating.UNKNOWN,
        destination: ItemListDestination({ key: `theme:${theme.path_word}` }, theme.name) })) }], isLastPage: true };
    if (key === "ranks") return { sections: [{ id: "male", title: "男频" }, { id: "female", title: "女频" }].map(channel => ({
      id: channel.id, title: channel.title, style: PageSectionStyle.TAG_GRID,
      items: RANK_PERIODS.map(period => ({ id: `rank:${channel.id}:${period.id}`, title: period.title, rating: ContentRating.UNKNOWN,
        destination: ItemListDestination({ key: `rank:${channel.id}:${period.id}`, disableSorting: true }, `${channel.title} · ${period.title}`) })) })), isLastPage: true };
    throw new Error("CopyManga 不支持该浏览入口，请刷新源列表。");
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
    if (!query) return this.browse(request, page);
    const params = { q: query, q_type: "", limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    const data = await ObjectStore.string("copymanga.search") === "app"
      ? await this.api.get<ApiList<Comic>>("search/comic", params)
      : await this.api.webSearch<ApiList<Comic>>(query, PAGE_SIZE, params.offset);
    return this.paged(data, page);
  }

  async getItemList(request: ItemListRequest, page: number): Promise<PagedItemList> {
    if (!Number.isInteger(page) || page < 1) throw new Error("页码必须从 1 开始。");
    const key = request.key ?? "all";
    if (key === "all" || key === "completed" || key.startsWith("theme:")) return this.browse({ sort: request.sort,
      filters: { theme: key.startsWith("theme:") ? key.slice(6) : "", status: key === "completed" ? "1" : "" } }, page);
    if (key === "topics") {
      const result = parseTopics(await this.api.web("/topic", { limit: TOPIC_PAGE_SIZE, offset: (page - 1) * TOPIC_PAGE_SIZE }), (page - 1) * TOPIC_PAGE_SIZE);
      return { items: result.list.map(topic => this.topicItem(topic)), isLastPage: result.isLastPage };
    }
    if (key.startsWith("topic:")) {
      if (page > 1) return { items: [], isLastPage: true };
      const result = parseCardList(await this.api.web(`/topic/${encodeURIComponent(key.slice(6))}`), 0, 1);
      return { items: result.list.map(comic => this.item(comic)), isLastPage: true };
    }
    if (key === "recommend" || key === "newest") {
      const offset = (page - 1) * RECOMMEND_PAGE_SIZE;
      const result = parseCardList(await this.api.web(`/${key}`, { limit: RECOMMEND_PAGE_SIZE, offset }), offset, RECOMMEND_PAGE_SIZE);
      return { items: result.list.map(comic => this.item(comic)), isLastPage: result.isLastPage };
    }
    if (key.startsWith("rank:")) {
      if (page > 1) return { items: [], isLastPage: true };
      const parts = key.split(":");
      const channel = parts[1];
      const period = parts[2];
      if (parts.length !== 3 || !["male", "female"].includes(channel) || !RANK_PERIODS.some(value => value.id === period)) throw new Error("不支持的排行榜频道或周期。");
      const result = parseCardList(await this.api.web("/rank", { type: channel, table: period }), 0, 50);
      return { items: result.list.map(comic => this.item(comic)), isLastPage: true };
    }
    if (key !== "latest" && key !== "popular") throw new Error("CopyManga 不支持该列表入口，请刷新源列表。");
    return this.browse({ sort: request.sort ?? { key: key === "popular" ? "popular" : "datetime_updated" } }, page);
  }

  private ordering(sort?: SearchRequest["sort"]): string {
    const key = sort?.key ?? "datetime_updated";
    if (key !== "datetime_updated" && key !== "popular") throw new Error("不支持的漫画排序。");
    return `${sort?.ascending ? "" : "-"}${key}`;
  }

  private async browse(request: SearchRequest, page: number): Promise<PagedItemList> {
    if (!Number.isInteger(page) || page < 1) throw new Error("页码必须从 1 开始。");
    const params: Record<string, string | number> = { ordering: this.ordering(request.sort), limit: WEB_PAGE_SIZE, offset: (page - 1) * WEB_PAGE_SIZE };
    for (const key of ["theme", "region", "status"] as const) {
      const value = request.filters?.[key];
      if (value !== undefined && typeof value !== "string") throw new Error("筛选项格式不正确。");
      if (key === "theme" && typeof value === "string" && value.startsWith("empty:")) return { items: [], total: 0, isLastPage: true };
      if (value && value !== "all") params[key] = value;
    }
    const data = readList(parseComicList(await this.api.web("/comics", params), Number(params.offset)));
    return { items: data.list.map(comic => this.item(comic)), total: data.total, isLastPage: !data.list.length || data.offset + data.list.length >= data.total };
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
      { header: "连接", footer: "大陆直连优先使用大陆入口与大陆线路；使用代理时可切换海外线路。官网入口用于浏览和网页搜索，API 域名用于详情和章节。", views: [
        UIPicker({ id: "website", title: "官网入口", currentValue: await ObjectStore.string("copymanga.website") ?? "mainland", options: COPY_WEBSITES.map(entry => ({ id: entry.id, title: entry.title })) }),
        UIPicker({ id: "region", title: "资源线路", currentValue: await ObjectStore.string("copymanga.region") ?? "1", options: [
          { id: "1", title: "大陆线路" }, { id: "0", title: "海外线路" },
        ] }),
        UITextField({ id: "api", title: "API 域名", placeholder: "自动获取", currentValue: await ObjectStore.string("copymanga.api") ?? "" }),
        UIToggle({ id: "refreshApi", title: "刷新自动 API（手动域名留空时生效）", currentValue: false }),
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
    if (COPY_WEBSITES.some(entry => entry.id === data.website)) await ObjectStore.set("copymanga.website", data.website);
    if (data.region === "0" || data.region === "1") await ObjectStore.set("copymanga.region", data.region);
    if (data.search === "web" || data.search === "app") await ObjectStore.set("copymanga.search", data.search);
    if (data.refreshApi || data.region !== undefined) await ObjectStore.remove("copymanga.discoveredApi");
    this.api.reset();
    this.lastDetails = undefined;
    this.cachedThemes = undefined;
    if (data.refreshApi) await this.api.refresh();
    if (data.logout) await this.api.logout();
    else if (username) await this.api.login(username, password);
  }

  async clearAuthentication(): Promise<void> {
    await this.api.logout();
    this.lastDetails = undefined;
  }
}
