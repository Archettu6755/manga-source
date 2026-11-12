"use httpclient";

import {
  ContentRating, ContentStatus, ContentType, ReadingMode, UIPicker, UITextField, UIToggle,
  ItemListDestination, PageSectionStyle, PickerFilter, SearchFilter,
  type Chapter, type ChapterPage, type Content, type Delegate, type HomePage, type Item,
  type ItemListRequest, type PagedItemList, type PopulatedForm, type SearchRequest,
  type SourceInfo, type STTStore, type UIForm, type ItemPageResponse, type SortOptions, type ProgressState,
} from "@suwatte/toolchain/types";
import { ADULT_TYPE, COMIC_FIELDS, HISTORY_QUERY, ImageTickets, PAGE_SIZE, POSITION_QUERY, PROGRESS_MUTATION, TICKET_QUERY, WEBSITE, WEBSITES,
  historyComics, historyPagination, imageKid, imagePages, komiicWebsite, komiicUrl, matureComic, numericSerial, otherWebsite,
  readData, readingPosition, requireComic, sessionCookies, type Comic, type ComicChapter, type ComicHistory } from "@archettu/komiic";

import { httpError, networkError } from "@archettu/manga-core";
declare const SecureStore: STTStore;
type Progress = { comicId: string; chapterId: string; fraction: number };

export default class Komiic implements Delegate {
  static info: SourceInfo = {
    id: "zh.komiic", name: "Komiic", version: 5, website: WEBSITE,
    languages: ["zh-Hant"], rating: ContentRating.UNKNOWN, minSupportedAppVersion: "7.0.0",
  };
  private readonly api = new HttpClient({ timeout: 20_000, retries: 0, maxRedirects: 0,
    rateLimit: { permits: 1, period: 0.75 }, validateStatus: () => true });
  readonly client = new HttpClient({ timeout: 20_000, retries: 0, maxRedirects: 0, validateStatus: () => true });
  private readonly refreshing = new Map<string, Promise<void>>();
  private readonly ticketCaches = new Map<string, ImageTickets>();
  private readonly pageCounts = new Map<string, number>();
  private readonly progressQueue = new Map<string, { next?: Progress }>();
  private readonly lastProgress = new Map<string, Map<string, number>>();
  private activeWebsite = WEBSITE;
  private categoriesCache?: { id: string; name: string; group: string; comicCount: number }[];
  private elementsCache?: { id: string; name: string; type: string; comicCount: number }[];

  constructor() {
    this.client.interceptors.request.use(async request => {
      const website = await this.website();
      request.url = komiicUrl(request.url, website);
      request.headers.delete("Cookie");
      request.headers.delete("Authorization");
      request.headers.delete("X-Image-Ticket");
      request.cookies = [];
      const kid = imageKid(request.url, website);
      if (kid) {
        const cache = this.tickets(website);
        const ticket = request.method === "GET" ? await cache.get(kid, async () =>
          (await this.query<{ getImageTicket: unknown }>("getImageTicket", TICKET_QUERY, { kid }, website)).getImageTicket) : null;
        if (this.ticketCaches.get(website) !== cache) throw new Error("Komiic 登录状态已变化，请重新打开章节。");
        if (ticket) {
          request.url = ticket.url;
          request.headers.set("X-Image-Ticket", ticket.ticket);
        } else {
          await this.refreshSession(website);
          for (const [name, value] of Object.entries(await this.headers(website))) request.headers.set(name, value);
        }
        const comic = request.context?.comicId;
        const chapter = request.context?.chapterId;
        if (typeof comic === "string" && typeof chapter === "string") {
          request.headers.set("Referer", this.chapterUrl(comic, chapter, website));
        } else request.headers.set("Referer", `${website}/`);
      } else request.headers.set("Referer", `${website}/`);
      return request;
    });
    this.client.interceptors.response.use(response => {
      if (response.status < 200 || response.status >= 300) throw httpError(response.status, "Komiic 图片");
      return response;
    });
  }
  getConfiguration() { return { useClientForImageRequests: true }; }
  private async website(): Promise<string> {
    const website = komiicWebsite(await ObjectStore.string("komiic.website"));
    if (website !== this.activeWebsite) {
      this.activeWebsite = website;
      this.categoriesCache = undefined;
      this.elementsCache = undefined;
    }
    return website;
  }
  private sessionKey(website: string, key: string): string {
    return `${website === WEBSITE ? "komiic" : "komiic.cc"}.${key}`;
  }
  private tickets(website: string): ImageTickets {
    if (!this.ticketCaches.has(website)) this.ticketCaches.set(website, new ImageTickets());
    return this.ticketCaches.get(website)!;
  }
  private async signedIn(website: string): Promise<boolean> {
    const headers = await this.headers(website);
    return Boolean(headers.Authorization || headers.Cookie);
  }
  private async post(url: string, body: string, headers: Record<string, string>) {
    try { return await this.api.post(url, body, { headers }); }
    catch (error) { throw networkError(error, url); }
  }
  async getHomePage(): Promise<HomePage> {
    const website = await this.website();
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
      { id: "adult", title: "成人内容", content: { list: { key: "adult", disableSorting: true } } },
      ...(await this.signedIn(website) ? [{ id: "reading-history", title: "官网续读", content: { list: { key: "reading-history", disableSorting: true } } }] : []),
    ] };
  }
  async getSortOptions(): Promise<SortOptions> {
    return { options: [{ id: "DATE_UPDATED", title: "更新时间" }, { id: "DATE_CREATED", title: "上架时间" },
      { id: "VIEWS", title: "总观看数" }, { id: "MONTH_VIEWS", title: "本月观看数" }, { id: "FAVORITE_COUNT", title: "喜爱数" }] };
  }
  private async categories() {
    await this.website();
    if (!this.categoriesCache) {
      const data = await this.query<{ allCategory: NonNullable<Komiic["categoriesCache"]> }>("allCategory", "query allCategory { allCategory { id name group comicCount } }", {});
      if (!Array.isArray(data.allCategory)) throw new Error("Komiic 分类格式已变化。");
      this.categoriesCache = data.allCategory;
    }
    return this.categoriesCache;
  }
  private async elements() {
    await this.website();
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
  private async headers(website: string): Promise<Record<string, string>> {
    const cookies = await SecureStore.string(this.sessionKey(website, "cookies"));
    const token = await SecureStore.string(this.sessionKey(website, "token"));
    return { Referer: `${website}/`, "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }
  private async saveSession(website: string, cookieHeader: string | null, token?: string): Promise<boolean> {
    const cookies = sessionCookies(cookieHeader);
    if (cookies) {
      const previous = await SecureStore.string(this.sessionKey(website, "cookies")) ?? "";
      const merged = new Map([...previous.split("; "), ...cookies.split("; ")].filter(Boolean).map(cookie => {
        const separator = cookie.indexOf("=");
        return [cookie.slice(0, separator), cookie.slice(separator + 1)] as const;
      }));
      await SecureStore.set(this.sessionKey(website, "cookies"), Array.from(merged, ([key, value]) => `${key}=${value}`).join("; "));
    }
    if (token) await SecureStore.set(this.sessionKey(website, "token"), token);
    if (cookies || token) await ObjectStore.set(this.sessionKey(website, "refreshedAt"), Date.now());
    return Boolean(cookies || token);
  }
  private async refreshSession(website: string): Promise<void> {
    if (!await SecureStore.string(this.sessionKey(website, "cookies"))) return;
    const at = await ObjectStore.number(this.sessionKey(website, "refreshedAt")) ?? 0;
    if (Date.now() - at < 30 * 60_000) return;
    const session = this.tickets(website);
    if (!this.refreshing.has(website)) this.refreshing.set(website, (async () => {
      const response = await this.post(`${website}/auth/refresh`, "{}", await this.headers(website));
      if (this.ticketCaches.get(website) !== session) return;
      if (response.status !== 200 && response.status !== 204) throw httpError(response.status, "Komiic 登录刷新");
      await this.saveSession(website, response.headers.get("set-cookie"));
      await ObjectStore.set(this.sessionKey(website, "refreshedAt"), Date.now());
    })());
    const pending = this.refreshing.get(website);
    try { await pending; } finally { if (this.refreshing.get(website) === pending) this.refreshing.delete(website); }
  }
  private async query<T>(operationName: string, query: string, variables: Record<string, unknown>, origin?: string, session?: ImageTickets): Promise<T> {
    const website = origin ?? await this.website();
    await this.refreshSession(website);
    const headers = await this.headers(website);
    if (session && this.ticketCaches.get(website) !== session) throw new Error("Komiic 登录状态已变化，请重新打开作品。");
    const response = await this.post(`${website}/api/query`, JSON.stringify({ operationName, query, variables }), headers);
    if (response.status !== 200) return readData<T>(response.status, null);
    return readData<T>(response.status, await response.json());
  }
  private item(value: Comic): Item {
    const comic = requireComic(value);
    return { id: comic.id, title: comic.title, coverImage: komiicUrl(comic.imageUrl, this.activeWebsite), rating: matureComic(comic) ? ContentRating.MATURE : ContentRating.UNKNOWN,
      subtitle: comic.authors?.map(author => author.name).join("、"), webUrl: `${this.activeWebsite}/comic/${encodeURIComponent(comic.id)}` };
  }
  async getItemList(request: ItemListRequest, page: number): Promise<PagedItemList> {
    if (!Number.isInteger(page) || page < 1) throw new Error("页码必须从 1 开始。");
    const key = request.key ?? "all";
    if (key === "reading-history") return this.readHistory(page);
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
      variables = { pagination, period: key === "recommended-year" ? "YEAR" : key === "recommended-month" ? "MONTH" : "WEEK", contentType: "REGULAR" };
    } else if (key === "random" || key === "adult") {
      if (key === "adult" && page > 1) return { items: [], isLastPage: true };
      field = "randomComics"; declaration = "$pagination: Pagination!, $contentType: ContentType";
      argumentsText = "pagination: $pagination, contentType: $contentType";
      variables = { pagination, contentType: key === "adult" ? ADULT_TYPE : "REGULAR" };
      if (key === "adult") { argumentsText += ", adult: true"; variables.pagination = { ...pagination, orderBy: "ID" }; }
    } else if (!["all", "newest", "completed", "short"].includes(key) && !key.startsWith("categories:")) throw new Error("Komiic 不支持该列表入口。");
    const data = await this.query<{ comics: Comic[] }>("browseComics", `query browseComics(${declaration}) { comics: ${field}(${argumentsText}) { ${COMIC_FIELDS} } }`, variables);
    const result = this.comicList(data.comics, page);
    return key === "adult" ? { ...result, isLastPage: true } : result;
  }
  private comicList(comics: Comic[], page: number, complete = false): PagedItemList {
    if (!Array.isArray(comics)) throw new Error("Komiic 漫画列表格式已变化。");
    return { items: (complete ? comics.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : comics).map(comic => this.item(comic)),
      total: complete ? comics.length : undefined, isLastPage: complete ? page * PAGE_SIZE >= comics.length : comics.length < PAGE_SIZE };
  }
  private async readHistory(page: number): Promise<PagedItemList> {
    const website = await this.website();
    if (!await this.signedIn(website)) throw new Error("请登录 Komiic 后查看官网续读记录。");
    const pagination = historyPagination(page);
    const { readComicHistory: history } = await this.query<{ readComicHistory: ComicHistory[] }>("readComicHistory", HISTORY_QUERY, { pagination }, website);
    if (!Array.isArray(history)) throw new Error("Komiic 官网续读记录格式已变化。");
    if (!history.length) return { items: [], isLastPage: true };
    const { comics } = await this.query<{ comics: Comic[] }>("comicByIds", `query comicByIds($comicIds: [ID]!) { comics: comicByIds(comicIds: $comicIds) { ${COMIC_FIELDS} } }`, { comicIds: history.map(entry => entry.comicId) }, website);
    return { items: historyComics(history, comics).map(comic => this.item(comic)), isLastPage: history.length < pagination.limit };
  }
  async getContent(contentId: string): Promise<Content> {
    const website = await this.website();
    const signedIn = await this.signedIn(website);
    const historyFields = signedIn ? "history: readComicHistoryById(comicId: $comicId) { comicId lastDate chapters { chapterId page updatedAt } } chaptersByComicId(comicId: $comicId) { id serial type size }" : "";
    const data = await this.query<{ comicById: Comic; history?: ComicHistory; chaptersByComicId?: ComicChapter[] }>("mangaQuery",
      `query mangaQuery($comicId: ID!) { comicById(comicId: $comicId) { ${COMIC_FIELDS} } ${historyFields} }`, { comicId: contentId }, website);
    const comic = requireComic(data.comicById);
    const position = readingPosition(data.history);
    const chapter = data.chaptersByComicId?.find(value => value.id === position?.chapterId);
    const progress = position && chapter && chapter.size > 0 ? { currentState: {
      chapterId: chapter.id, number: chapter.type === "book" ? -1 : numericSerial(chapter.serial),
      volume: chapter.type === "book" ? numericSerial(chapter.serial) : undefined,
      page: Math.min(chapter.size - 1, position.page), progress: Math.min(1, (position.page + 1) / chapter.size), readDate: new Date(position.timestamp),
    } } : undefined;
    if (Array.isArray(data.history?.chapters)) for (const entry of data.history.chapters) {
      if (entry?.chapterId && Number.isInteger(entry.page) && entry.page >= 0) this.rememberProgress(website, entry.chapterId, entry.page);
    }
    const result: Content & { progress?: ProgressState } = { title: comic.title, coverImage: komiicUrl(comic.imageUrl, website), summary: comic.description, progress,
      rating: matureComic(comic) ? ContentRating.MATURE : ContentRating.UNKNOWN, contentType: ContentType.MANGA, readingMode: ReadingMode.PAGED_MANGA,
      status: comic.status === "END" ? ContentStatus.COMPLETED : comic.status === "ONGOING" ? ContentStatus.ONGOING : ContentStatus.UNKNOWN,
      credits: comic.authors?.map(author => ({ name: author.name, role: "作者" })),
      genres: comic.categories?.map(category => ({ id: category.id, title: category.name })),
      webUrl: `${website}/comic/${encodeURIComponent(contentId)}` };
    return result;
  }
  private chapterUrl(contentId: string, chapterId: string, website = this.activeWebsite): string {
    return `${website}/comic/${encodeURIComponent(contentId)}/chapter/${encodeURIComponent(chapterId)}/images/all`;
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
    const website = await this.website();
    return (await this.chapterImages(chapterId, website)).map(url => ({ url, context: { comicId: contentId, chapterId } }));
  }
  private async chapterImages(chapterId: string, website: string): Promise<string[]> {
    const data = await this.query<{ imagesByChapterId: { kid: string }[] }>("imagesByChapterId",
      "query imagesByChapterId($chapterId: ID!) { imagesByChapterId(chapterId: $chapterId) { kid } }", { chapterId }, website);
    const pages = imagePages(data.imagesByChapterId, website);
    if (this.pageCounts.size >= 128) this.pageCounts.delete(this.pageCounts.keys().next().value!);
    this.pageCounts.set(`${website}|${chapterId}`, pages.length);
    return pages;
  }
  private rememberProgress(website: string, chapterId: string, page: number) {
    if (!this.lastProgress.has(website)) this.lastProgress.set(website, new Map());
    const pages = this.lastProgress.get(website)!;
    if (!pages.has(chapterId) && pages.size >= 128) pages.delete(pages.keys().next().value!);
    pages.set(chapterId, Math.max(page, pages.get(chapterId) ?? -1));
  }
  async onChapterProgress(comicId: string, chapterId: string, fraction: number): Promise<void> {
    if (!comicId || !chapterId || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return;
    const website = await this.website();
    if (!await this.signedIn(website)) return;
    const session = this.tickets(website);
    const next = { comicId, chapterId, fraction };
    const queued = this.progressQueue.get(website);
    if (queued) { queued.next = next; return; }
    const job: { next?: Progress } = { next };
    this.progressQueue.set(website, job);
    try {
      while (job.next) {
        await new Promise<void>(resolve => setTimeout(resolve, 1_000));
        if (this.progressQueue.get(website) !== job || !await this.signedIn(website)) return;
        const update = job.next;
        job.next = undefined;
        const size = this.pageCounts.get(`${website}|${update.chapterId}`) ?? (await this.chapterImages(update.chapterId, website)).length;
        const page = Math.min(size - 1, Math.max(0, Math.ceil(update.fraction * size) - 1));
        if (this.progressQueue.get(website) !== job) return;
        if (!this.lastProgress.get(website)?.has(update.chapterId)) {
          const { readComicHistoryById: history } = await this.query<{ readComicHistoryById?: ComicHistory }>("readComicHistoryById", POSITION_QUERY, { comicId: update.comicId }, website);
          if (this.progressQueue.get(website) !== job) return;
          const recorded = history?.chapters?.find(entry => entry?.chapterId === update.chapterId)?.page;
          this.rememberProgress(website, update.chapterId, Number.isInteger(recorded) ? recorded! : -1);
        }
        if (this.progressQueue.get(website) !== job || page <= (this.lastProgress.get(website)?.get(update.chapterId) ?? -1)) continue;
        const result = await this.query<{ addReadComicHistoryV2: boolean }>("addReadComicHistoryV2", PROGRESS_MUTATION, { comicId: update.comicId, chapterId: update.chapterId, page }, website, session);
        if (result.addReadComicHistoryV2 === false) throw new Error("Komiic 未保存此次阅读进度。");
        if (this.progressQueue.get(website) === job) this.rememberProgress(website, update.chapterId, page);
      }
    } finally { if (this.progressQueue.get(website) === job) this.progressQueue.delete(website); }
  }
  async getSettingsPage(): Promise<UIForm> {
    const website = await this.website();
    const loggedIn = Boolean(await SecureStore.string(this.sessionKey(website, "cookies")) || await SecureStore.string(this.sessionKey(website, "token")));
    return { sections: [
      { header: "连接", footer: "大陆网络可选 komiic.cc。两个入口分别保存登录会话，切换后请刷新目录。", views: [
        UIPicker({ id: "website", title: "访问入口", currentValue: website, options: WEBSITES })
      ] },
      { header: "目录", views: [UIPicker({ id: "chapters", title: "章节列表", currentValue: await ObjectStore.string("komiic.chapters") ?? "all",
        options: [{ id: "all", title: "卷与章节" }, { id: "chapter", title: "仅章节" }, { id: "book", title: "仅卷" }] })] },
      { header: loggedIn ? "账号：已保存登录" : "账号：未登录", footer: "登录后阅读位置同步到 Komiic 官网。成人内容的年龄确认请在官网完成。", views: [
        UITextField({ id: "email", title: "邮箱", currentValue: "" }), UITextField({ id: "password", title: "密码", currentValue: "", isSecure: true }),
        UIToggle({ id: "syncBoth", title: "同时登录两个官方入口", currentValue: true }),
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
    if (data.website !== undefined) await ObjectStore.set("komiic.website", komiicWebsite(data.website));
    const website = await this.website();
    if (email) {
      await this.login(website, email, password);
      if (data.syncBoth === true) {
        const other = otherWebsite(website);
        await this.removeSession(other);
        try { await this.login(other, email, password); }
        catch (error) { throw new Error(`当前入口已登录，${other.slice(8)} 登录未完成：${(error as Error).message}`); }
      }
    } else if (data.logout) await this.clearAuthentication();
    if (typeof data.chapters === "string") await ObjectStore.set("komiic.chapters", data.chapters);
  }
  private async login(website: string, email: string, password: string): Promise<void> {
    const response = await this.post(`${website}/api/login`, JSON.stringify({ email, password }),
      { Referer: `${website}/`, "Content-Type": "application/json" });
    if (response.status !== 200 && response.status !== 204) throw httpError(response.status, "Komiic 登录");
    let body: { token?: string } = {};
    try { body = await response.json(); } catch { /* Login can return only cookies. */ }
    const cookieHeader = response.headers.get("set-cookie");
    if (!sessionCookies(cookieHeader) && !body?.token) throw new Error("Komiic 未返回可保存的登录会话。");
    await this.removeSession(website);
    await this.saveSession(website, cookieHeader, body?.token);
  }
  private async removeSession(website: string): Promise<void> {
    this.ticketCaches.delete(website);
    this.refreshing.delete(website);
    this.progressQueue.delete(website);
    this.lastProgress.delete(website);
    await SecureStore.remove(this.sessionKey(website, "cookies"));
    await SecureStore.remove(this.sessionKey(website, "token"));
    await ObjectStore.remove(this.sessionKey(website, "refreshedAt"));
  }
  async clearAuthentication(): Promise<void> {
    const website = await this.website();
    try {
      const response = await this.post(`${website}/auth/logout`, "{}", await this.headers(website));
      if (response.status !== 200 && response.status !== 204) throw new Error(`Komiic 退出登录失败（HTTP ${response.status}）。`);
    } finally {
      await this.removeSession(website);
    }
  }
}
