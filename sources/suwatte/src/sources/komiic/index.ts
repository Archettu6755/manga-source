"use httpclient";

import {
  ContentRating, ContentStatus, ContentType, ReadingMode, UIPicker, UITextField, UIToggle,
  ItemListDestination, PageSectionStyle, PickerFilter, SearchFilter,
  type Chapter, type ChapterPage, type Content, type Delegate, type HomePage, type Item,
  type ItemListRequest, type PagedItemList, type PopulatedForm, type SearchRequest,
  type SourceInfo, type STTStore, type UIForm, type ItemPageResponse, type SortOptions,
} from "@suwatte/toolchain/types";
import { COMIC_FIELDS, PAGE_SIZE, WEBSITE, imagePages, numericSerial, readData, requireComic, sessionCookies,
  type Comic, type ComicChapter } from "@archettu/komiic";

declare const SecureStore: STTStore;

export default class Komiic implements Delegate {
  static info: SourceInfo = {
    id: "zh.komiic", name: "Komiic · Archettu", version: 2, website: WEBSITE,
    languages: ["zh-Hant"], rating: ContentRating.UNKNOWN, minSupportedAppVersion: "7.0.0",
  };
  private readonly api = new HttpClient({ timeout: 20_000, retries: 0, maxRedirects: 0,
    rateLimit: { permits: 1, period: 0.75 }, validateStatus: () => true });
  readonly client = new HttpClient({ timeout: 20_000, retries: 0, maxRedirects: 0, validateStatus: () => true });
  private refreshing?: Promise<void>;
  private categoriesCache?: { id: string; name: string; group: string; comicCount: number }[];
  private elementsCache?: { id: string; name: string; type: string; comicCount: number }[];

  constructor() {
    this.client.interceptors.request.use(async request => {
      if (request.url.startsWith(`${WEBSITE}/api/image/`)) {
        await this.refreshSession();
        for (const [name, value] of Object.entries(await this.headers())) request.headers.set(name, value);
        const comic = request.context?.comicId;
        const chapter = request.context?.chapterId;
        if (typeof comic === "string" && typeof chapter === "string") {
          request.headers.set("Referer", this.chapterUrl(comic, chapter));
        }
      } else request.headers.set("Referer", `${WEBSITE}/`);
      return request;
    });
    this.client.interceptors.response.use(response => {
      if (response.status === 402) throw new Error("Komiic 今日图片阅读额度已用完，请登录或等待额度恢复。");
      if (response.status === 401) throw new Error("Komiic 登录已失效，请重新登录。");
      return response;
    });
  }
  getConfiguration() { return { useClientForImageRequests: true }; }
  async getHomePage(): Promise<HomePage> {
    return { feeds: [
      { id: "latest", title: "最近更新", content: { list: { key: "latest" } } },
      { id: "popular", title: "热门漫画", content: { list: { key: "popular" } } },
      { id: "all", title: "所有漫画", content: { list: { key: "all" } } },
      { id: "newest", title: "最近上架", content: { list: { key: "newest" } } },
      { id: "completed", title: "已完结", content: { list: { key: "completed" } } },
      { id: "short", title: "短篇", content: { list: { key: "short" } } },
      { id: "categories", title: "题材分类", content: { page: "categories" } },
      { id: "elements", title: "标签", content: { page: "elements" } },
      { id: "authors", title: "作者列表", content: { list: { key: "authors", disableSorting: true } } },
      { id: "originals", title: "原作", content: { list: { key: "originals", disableSorting: true } } },
      { id: "characters", title: "角色", content: { list: { key: "characters", disableSorting: true } } },
      { id: "recommended-week", title: "本周推荐", content: { list: { key: "recommended-week" } } },
      { id: "recommended-month", title: "本月推荐", content: { list: { key: "recommended-month" } } },
      { id: "recommended-year", title: "年度推荐", content: { list: { key: "recommended-year" } } },
      { id: "random", title: "随机发现", content: { list: { key: "random", disableSorting: true } } },
    ] };
  }
  async getSortOptions(): Promise<SortOptions> {
    return { options: [{ id: "DATE_UPDATED", title: "更新时间" }, { id: "DATE_CREATED", title: "上架时间" },
      { id: "VIEWS", title: "总观看数" }, { id: "MONTH_VIEWS", title: "本月观看数" }, { id: "FAVORITE_COUNT", title: "喜爱数" }] };
  }
  private async categories() {
    if (!this.categoriesCache) {
      const data = await this.query<{ allCategory: NonNullable<Komiic["categoriesCache"]> }>("allCategory", "query allCategory { allCategory { id name group comicCount } }", {});
      if (!Array.isArray(data.allCategory)) throw new Error("Komiic 分类格式已变化。");
      this.categoriesCache = data.allCategory;
    }
    return this.categoriesCache;
  }
  private async elements() {
    if (!this.elementsCache) {
      const data = await this.query<{ allElements: NonNullable<Komiic["elementsCache"]> }>("allElements", "query allElements { allElements { id name type comicCount } }", {});
      if (!Array.isArray(data.allElements)) throw new Error("Komiic 标签格式已变化。");
      this.elementsCache = data.allElements;
    }
    return this.elementsCache;
  }
  async getSearchFilters(): Promise<SearchFilter[]> {
    return [SearchFilter("category", "题材", PickerFilter([{ id: "all", title: "全部" }, ...(await this.categories()).map(category => ({ id: category.id, title: category.name }))])),
      SearchFilter("status", "状态", PickerFilter([{ id: "all", title: "全部" }, { id: "ONGOING", title: "连载" }, { id: "END", title: "完结" }, { id: "SHORT", title: "短篇" }]))];
  }
  async getItemPage(key: string, page: number): Promise<ItemPageResponse> {
    if (page > 1) return { sections: [], isLastPage: true };
    if (key !== "categories" && key !== "elements") throw new Error("Komiic 不支持该浏览入口。");
    const entries = key === "categories" ? await this.categories() : await this.elements();
    const groups = new Map<string, (typeof entries)[number][]>();
    for (const entry of entries) {
      const group = "group" in entry ? entry.group : entry.type;
      groups.set(group, [...(groups.get(group) ?? []), entry]);
    }
    return { sections: [...groups].map(([group, entries]) => ({ id: group || key, title: group || (key === "categories" ? "全部题材" : "全部标签"), style: PageSectionStyle.TAG_GRID,
      items: entries.map(entry => ({ id: `${key}:${entry.id}`, title: entry.name, subtitle: `${entry.comicCount} 部`, rating: ContentRating.UNKNOWN,
        destination: ItemListDestination({ key: `${key}:${entry.id}` }, entry.name) })) })), isLastPage: true };
  }
  private async headers(): Promise<Record<string, string>> {
    const cookies = await SecureStore.string("komiic.cookies");
    const token = await SecureStore.string("komiic.token");
    return { Referer: `${WEBSITE}/`, "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }
  private async saveSession(cookieHeader: string | null, token?: string): Promise<boolean> {
    const cookies = sessionCookies(cookieHeader);
    if (cookies) {
      const previous = await SecureStore.string("komiic.cookies") ?? "";
      const merged = new Map([...previous.split("; "), ...cookies.split("; ")].filter(Boolean).map(cookie => {
        const separator = cookie.indexOf("=");
        return [cookie.slice(0, separator), cookie.slice(separator + 1)] as const;
      }));
      await SecureStore.set("komiic.cookies", Array.from(merged, ([key, value]) => `${key}=${value}`).join("; "));
    }
    if (token) await SecureStore.set("komiic.token", token);
    if (cookies || token) await ObjectStore.set("komiic.refreshedAt", Date.now());
    return Boolean(cookies || token);
  }
  private async refreshSession(): Promise<void> {
    if (!await SecureStore.string("komiic.cookies")) return;
    const at = await ObjectStore.number("komiic.refreshedAt") ?? 0;
    if (Date.now() - at < 30 * 60_000) return;
    if (!this.refreshing) this.refreshing = (async () => {
      const response = await this.api.post(`${WEBSITE}/auth/refresh`, "{}", { headers: await this.headers() });
      if (response.status !== 200 && response.status !== 204) throw new Error(`Komiic 登录刷新失败（HTTP ${response.status}），请重新登录。`);
      await this.saveSession(response.headers.get("set-cookie"));
      await ObjectStore.set("komiic.refreshedAt", Date.now());
    })();
    try { await this.refreshing; } finally { this.refreshing = undefined; }
  }
  private async query<T>(operationName: string, query: string, variables: Record<string, unknown>): Promise<T> {
    await this.refreshSession();
    const response = await this.api.post(`${WEBSITE}/api/query`, JSON.stringify({ operationName, query, variables }), { headers: await this.headers() });
    if (response.status !== 200) return readData<T>(response.status, null);
    return readData<T>(response.status, await response.json());
  }
  private item(value: Comic): Item {
    const comic = requireComic(value);
    return { id: comic.id, title: comic.title, coverImage: comic.imageUrl, rating: ContentRating.UNKNOWN,
      subtitle: comic.authors?.map(author => author.name).join("、"), webUrl: `${WEBSITE}/comic/${encodeURIComponent(comic.id)}` };
  }
  async getItemList(request: ItemListRequest, page: number): Promise<PagedItemList> {
    if (!Number.isInteger(page) || page < 1) throw new Error("页码必须从 1 开始。");
    const key = request.key ?? "all";
    if (key !== "latest" && key !== "popular") return this.browse(key, page, request.sort);
    const popular = request.key === "popular";
    const data = await this.query<{ comics: Comic[] }>("commonQuery",
      `query commonQuery($pagination: Pagination!) { comics: ${popular ? "hotComics" : "recentUpdate"}(pagination: $pagination) { ${COMIC_FIELDS} } }`,
      { pagination: { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, orderBy: request.sort?.key ?? (popular ? "MONTH_VIEWS" : "DATE_UPDATED"), status: "", asc: request.sort?.ascending ?? false } });
    if (!Array.isArray(data.comics)) throw new Error("Komiic 列表格式已变化。");
    return { items: data.comics.map(comic => this.item(comic)), isLastPage: data.comics.length < PAGE_SIZE };
  }
  async getSearchResults(request: SearchRequest, page: number): Promise<PagedItemList> {
    if (!request.query?.trim()) return this.browse("all", page, request.sort, request.filters);
    if (!Number.isInteger(page) || page < 1) throw new Error("页码必须从 1 开始。");
    const data = await this.query<{ searchComicsAndAuthors: { comics: Comic[] } }>("searchComicsAndAuthors",
      `query searchComicsAndAuthors($keyword: String!) { searchComicsAndAuthors(keyword: $keyword) { comics { ${COMIC_FIELDS} } } }`,
      { keyword: request.query.trim() });
    const comics = data.searchComicsAndAuthors?.comics;
    if (!Array.isArray(comics)) throw new Error("Komiic 搜索格式已变化。");
    return { items: comics.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(comic => this.item(comic)),
      total: comics.length, isLastPage: page * PAGE_SIZE >= comics.length };
  }
  private async browse(key: string, page: number, sort?: SearchRequest["sort"], filters?: SearchRequest["filters"]): Promise<PagedItemList> {
    if (!Number.isInteger(page) || page < 1) throw new Error("页码必须从 1 开始。");
    const orderBy = sort?.key ?? (key === "newest" ? "DATE_CREATED" : "DATE_UPDATED");
    if (!(await this.getSortOptions()).options.some(option => option.id === orderBy)) throw new Error("不支持的漫画排序。");
    const status = key === "completed" ? "END" : key === "short" ? "SHORT" : filters?.status === "all" ? "" : filters?.status ?? "";
    if (typeof status !== "string" || !["", "ONGOING", "END", "SHORT"].includes(status)) throw new Error("不支持的连载状态。");
    const pagination = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, orderBy, status, asc: sort?.ascending ?? false };
    if (key === "authors" || key === "originals" || key === "characters") {
      const authors = key === "authors";
      const field = authors ? "authors" : key === "originals" ? "hOriginalComics" : "hCharacters";
      const fields = authors ? "id name comicCount" : key === "originals" ? "id name coverUrl comicCount" : "id name nameZhTw comicCount";
      const data = await this.query<{ entries: { id: string; name: string; nameZhTw?: string; coverUrl?: string; comicCount: number }[] }>("browseEntries",
        `query browseEntries($pagination: Pagination!, $contentType: ContentType!) { entries: ${field}(pagination: $pagination, contentType: $contentType) { ${fields} } }`,
        { pagination: { ...pagination, orderBy: "VIEWS" }, contentType: "REGULAR" });
      if (!Array.isArray(data.entries)) throw new Error("Komiic 浏览列表格式已变化。");
      const prefix = authors ? "author" : key === "originals" ? "original" : "character";
      return { items: data.entries.map(entry => ({ id: `${prefix}:${entry.id}`, title: entry.nameZhTw || entry.name,
        coverImage: entry.coverUrl, subtitle: `${entry.comicCount} 部`, rating: ContentRating.UNKNOWN,
        destination: ItemListDestination({ key: `${prefix}:${entry.id}` }, entry.nameZhTw || entry.name) })), isLastPage: data.entries.length < PAGE_SIZE };
    }
    if (key.startsWith("author:")) {
      const data = await this.query<{ comics: Comic[] }>("comicsByAuthor",
        `query comicsByAuthor($authorId: ID!) { comics: getComicsByAuthor(authorId: $authorId) { ${COMIC_FIELDS} } }`, { authorId: key.slice(7) });
      return this.comicList(data.comics, page, true);
    }
    if (key.startsWith("original:") || key.startsWith("character:")) {
      const original = key.startsWith("original:");
      const field = original ? "comicsByHOriginalComicId" : "comicsByHCharacterId";
      const argument = original ? "originalComicId" : "characterId";
      const data = await this.query<{ comics: { id: string }[] }>("comicsByReference",
        `query comicsByReference($referenceId: ID!, $contentType: ContentType!, $pagination: Pagination!) { comics: ${field}(${argument}: $referenceId, contentType: $contentType, pagination: $pagination) { id } }`,
        { referenceId: key.slice(key.indexOf(":") + 1), contentType: "REGULAR", pagination });
      if (!Array.isArray(data.comics)) throw new Error("Komiic 原作或角色漫画列表格式已变化。");
      if (!data.comics.length) return { items: [], isLastPage: true };
      const details = await this.query<{ comics: Comic[] }>("comicByIds", `query comicByIds($comicIds: [ID]!) { comics: comicByIds(comicIds: $comicIds) { ${COMIC_FIELDS} } }`, { comicIds: data.comics.map(comic => comic.id) });
      const lookup = new Map(details.comics.map(comic => [comic.id, comic]));
      const comics = data.comics.map(comic => { const value = lookup.get(comic.id); if (!value) throw new Error("Komiic 未返回完整的原作或角色漫画信息。"); return value; });
      return this.comicList(comics, page);
    }
    let field = "comicByCategories";
    let declaration = "$ids: [ID!]!, $pagination: Pagination!";
    let argumentsText = "categoryId: $ids, pagination: $pagination";
    let variables: Record<string, unknown> = { pagination, ids: key.startsWith("categories:") ? [key.slice(11)] : filters?.category && filters.category !== "all" ? [filters.category] : [] };
    if (key.startsWith("elements:")) { field = "comicByElements"; argumentsText = "elementIds: $ids, pagination: $pagination"; variables.ids = [key.slice(9)]; }
    else if (["recommended-week", "recommended-month", "recommended-year"].includes(key)) {
      field = "topRecommendedComics"; declaration = "$period: RecommendationPeriod!, $pagination: Pagination!, $contentType: ContentType";
      argumentsText = "period: $period, pagination: $pagination, contentType: $contentType";
      variables = { pagination, period: key === "recommended-week" ? "WEEK" : key === "recommended-month" ? "MONTH" : "YEAR", contentType: "REGULAR" };
    } else if (key === "random") {
      field = "randomComics"; declaration = "$pagination: Pagination!, $contentType: ContentType";
      argumentsText = "pagination: $pagination, contentType: $contentType"; variables = { pagination, contentType: "REGULAR" };
    } else if (!["all", "newest", "completed", "short"].includes(key) && !key.startsWith("categories:")) throw new Error("Komiic 不支持该列表入口。");
    const data = await this.query<{ comics: Comic[] }>("browseComics", `query browseComics(${declaration}) { comics: ${field}(${argumentsText}) { ${COMIC_FIELDS} } }`, variables);
    return this.comicList(data.comics, page);
  }
  private comicList(comics: Comic[], page: number, complete = false): PagedItemList {
    if (!Array.isArray(comics)) throw new Error("Komiic 漫画列表格式已变化。");
    return { items: (complete ? comics.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : comics).map(comic => this.item(comic)),
      total: complete ? comics.length : undefined, isLastPage: complete ? page * PAGE_SIZE >= comics.length : comics.length < PAGE_SIZE };
  }
  async getContent(contentId: string): Promise<Content> {
    const data = await this.query<{ comicById: Comic }>("mangaQuery",
      `query mangaQuery($comicId: ID!) { comicById(comicId: $comicId) { ${COMIC_FIELDS} } }`, { comicId: contentId });
    const comic = requireComic(data.comicById);
    return { title: comic.title, coverImage: comic.imageUrl, summary: comic.description,
      rating: ContentRating.UNKNOWN, contentType: ContentType.MANGA, readingMode: ReadingMode.PAGED_MANGA,
      status: comic.status === "END" ? ContentStatus.COMPLETED : comic.status === "ONGOING" ? ContentStatus.ONGOING : ContentStatus.UNKNOWN,
      credits: comic.authors?.map(author => ({ name: author.name, role: "作者" })),
      genres: comic.categories?.map(category => ({ id: category.id, title: category.name })),
      webUrl: `${WEBSITE}/comic/${encodeURIComponent(contentId)}` };
  }
  private chapterUrl(contentId: string, chapterId: string): string {
    return `${WEBSITE}/comic/${encodeURIComponent(contentId)}/chapter/${encodeURIComponent(chapterId)}/images/all`;
  }
  async getChapters(contentId: string): Promise<Chapter[]> {
    const data = await this.query<{ chaptersByComicId: ComicChapter[] }>("mangaQuery",
      "query mangaQuery($comicId: ID!) { chaptersByComicId(comicId: $comicId) { id serial type size dateCreated } }", { comicId: contentId });
    if (!Array.isArray(data.chaptersByComicId)) throw new Error("Komiic 章节格式已变化。");
    const filter = await ObjectStore.string("komiic.chapters") ?? "all";
    return data.chaptersByComicId.filter(chapter => filter === "all" || chapter.type === filter)
      .sort((a, b) => a.type.localeCompare(b.type) || numericSerial(a.serial) - numericSerial(b.serial))
      .map((chapter, index) => {
        if (!chapter.id || typeof chapter.serial !== "string") throw new Error("Komiic 章节格式已变化。");
        const date = chapter.dateCreated ? new Date(chapter.dateCreated) : undefined;
        return { id: chapter.id, index, number: chapter.type === "book" ? -1 : numericSerial(chapter.serial),
          volume: chapter.type === "book" && numericSerial(chapter.serial) >= 0 ? numericSerial(chapter.serial) : undefined,
          title: `第 ${chapter.serial} ${chapter.type === "book" ? "卷" : "话"} · ${chapter.size}P`, language: "zh-Hant",
          date: date && Number.isFinite(date.getTime()) ? date : undefined, webUrl: this.chapterUrl(contentId, chapter.id) };
      });
  }
  async getChapterPages(contentId: string, chapterId: string): Promise<ChapterPage[]> {
    const data = await this.query<{ imagesByChapterId: { kid: string }[] }>("imagesByChapterId",
      "query imagesByChapterId($chapterId: ID!) { imagesByChapterId(chapterId: $chapterId) { kid } }", { chapterId });
    return imagePages(data.imagesByChapterId).map(url => ({ url, context: { comicId: contentId, chapterId } }));
  }
  async getSettingsPage(): Promise<UIForm> {
    const loggedIn = Boolean(await SecureStore.string("komiic.cookies") || await SecureStore.string("komiic.token"));
    return { sections: [
      { header: "目录", views: [UIPicker({ id: "chapters", title: "章节列表", currentValue: await ObjectStore.string("komiic.chapters") ?? "all",
        options: [{ id: "all", title: "卷与章节" }, { id: "chapter", title: "仅章节" }, { id: "book", title: "仅卷" }] })] },
      { header: loggedIn ? "账号：已保存登录" : "账号：未登录", footer: "图片额度由 Komiic 决定。密码不会保存；登录会话仅存于设备安全存储。", views: [
        UITextField({ id: "email", title: "邮箱", currentValue: "" }), UITextField({ id: "password", title: "密码", currentValue: "", isSecure: true }),
        UIToggle({ id: "logout", title: "退出登录", currentValue: false }),
      ] },
    ] };
  }
  async onFormSubmitted(_id: string, data: PopulatedForm): Promise<void> {
    const email = typeof data.email === "string" ? data.email.trim() : "";
    const password = typeof data.password === "string" ? data.password : "";
    if (Boolean(email) !== Boolean(password)) throw new Error("请同时填写邮箱和密码。");
    if (data.logout && email) throw new Error("请分别执行登录与退出登录。");
    if (data.chapters !== undefined && !["all", "chapter", "book"].includes(String(data.chapters))) throw new Error("不支持的章节类型。");
    if (email) {
      const response = await this.api.post(`${WEBSITE}/api/login`, JSON.stringify({ email, password }),
        { headers: { Referer: `${WEBSITE}/`, "Content-Type": "application/json" } });
      if (response.status !== 200 && response.status !== 204) throw new Error(`Komiic 登录失败（HTTP ${response.status}），请检查邮箱和密码。`);
      let body: { token?: string } = {};
      try { body = await response.json(); } catch { /* Current login can return only cookies. */ }
      await SecureStore.remove("komiic.cookies");
      await SecureStore.remove("komiic.token");
      if (!await this.saveSession(response.headers.get("set-cookie"), body?.token)) throw new Error("Komiic 未返回可保存的登录会话，请更新源。");
    } else if (data.logout) await this.clearAuthentication();
    if (typeof data.chapters === "string") await ObjectStore.set("komiic.chapters", data.chapters);
  }
  async clearAuthentication(): Promise<void> {
    try {
      const response = await this.api.post(`${WEBSITE}/auth/logout`, "{}", { headers: await this.headers() });
      if (response.status !== 200 && response.status !== 204) throw new Error(`Komiic 退出登录失败（HTTP ${response.status}）。`);
    } finally {
      await SecureStore.remove("komiic.cookies");
      await SecureStore.remove("komiic.token");
      await ObjectStore.remove("komiic.refreshedAt");
    }
  }
}
