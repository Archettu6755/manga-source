"use httpclient";

import {
  ContentRating, ContentStatus, ContentType, ReadingMode, UIPicker, UITextField, UIToggle,
  type Chapter, type ChapterPage, type Content, type Delegate, type HomePage, type Item,
  type ItemListRequest, type PagedItemList, type PopulatedForm, type SearchRequest,
  type SourceInfo, type STTStore, type UIForm,
} from "@suwatte/toolchain/types";
import { COMIC_FIELDS, PAGE_SIZE, WEBSITE, imagePages, numericSerial, readData, requireComic, sessionCookies,
  type Comic, type ComicChapter } from "@archettu/komiic";

declare const SecureStore: STTStore;

export default class Komiic implements Delegate {
  static info: SourceInfo = {
    id: "zh.komiic", name: "Komiic · Archettu", version: 1, website: WEBSITE,
    languages: ["zh-Hant"], rating: ContentRating.UNKNOWN, minSupportedAppVersion: "7.0.0",
  };
  private readonly api = new HttpClient({ timeout: 20_000, retries: 0, maxRedirects: 0,
    rateLimit: { permits: 1, period: 750 }, validateStatus: () => true });
  readonly client = new HttpClient({ timeout: 20_000, retries: 0, maxRedirects: 0, validateStatus: () => true });
  private refreshing?: Promise<void>;

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
    ] };
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
    const popular = request.key === "popular";
    const data = await this.query<{ comics: Comic[] }>("commonQuery",
      `query commonQuery($pagination: Pagination!) { comics: ${popular ? "hotComics" : "recentUpdate"}(pagination: $pagination) { ${COMIC_FIELDS} } }`,
      { pagination: { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, orderBy: popular ? "MONTH_VIEWS" : "DATE_UPDATED", status: "", asc: false } });
    if (!Array.isArray(data.comics)) throw new Error("Komiic 列表格式已变化。");
    return { items: data.comics.map(comic => this.item(comic)), isLastPage: data.comics.length < PAGE_SIZE };
  }
  async getSearchResults(request: SearchRequest, page: number): Promise<PagedItemList> {
    if (!request.query?.trim()) return this.getItemList({ key: "latest" }, page);
    if (!Number.isInteger(page) || page < 1) throw new Error("页码必须从 1 开始。");
    const data = await this.query<{ searchComicsAndAuthors: { comics: Comic[] } }>("searchComicsAndAuthors",
      `query searchComicsAndAuthors($keyword: String!) { searchComicsAndAuthors(keyword: $keyword) { comics { ${COMIC_FIELDS} } } }`,
      { keyword: request.query.trim() });
    const comics = data.searchComicsAndAuthors?.comics;
    if (!Array.isArray(comics)) throw new Error("Komiic 搜索格式已变化。");
    return { items: comics.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(comic => this.item(comic)),
      total: comics.length, isLastPage: page * PAGE_SIZE >= comics.length };
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
