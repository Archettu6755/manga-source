import { ContentRating, ContentStatus, ContentType, ReadingMode, ItemListDestination, PageSectionStyle, PickerFilter, SearchFilter, UIPicker, UIToggle, UITextField,
  type Delegate, type HomePage, type Item, type ItemPageResponse, type ItemListRequest, type PagedItemList, type SearchRequest, type Content, type Chapter, type ChapterPage, type UIForm, type PopulatedForm, type STTStore, type SortOptions } from "@suwatte/toolchain/types";
import type { Site, Manga, Details, Request } from "@archettu/manga-core";
import { IMAGE_SERVERS } from "@archettu/manhuagui";

declare const SecureStore: STTStore;
export class CatalogSource implements Delegate {
  protected readonly site: Site;
  private readonly api;
  readonly client = new HttpClient({ timeout: 20_000, retries: 0 });
  private cached?: { id: string; at: number; value: Details };
  constructor(factory: (request: Request) => Site, interval: number) {
    this.api = new HttpClient({ timeout: 20_000, retries: 0, rateLimit: { permits: 1, period: interval }, validateStatus: () => true, maxRedirects: 0 });
    this.site = factory(async (url, headers, body) => {
      const response = body === undefined ? await this.api.get(url, { headers }) : await this.api.post(url, body, { headers });
      return { status: response.status, body: await response.text() };
    });
    this.client.interceptors.request.use(request => {
      for (const [key, value] of Object.entries(this.site.imageHeaders())) request.headers.set(key, value);
      return request;
    });
  }
  getConfiguration() { return { useClientForImageRequests: true }; }
  private item(manga: Manga): Item { return { id: manga.id, title: manga.title, coverImage: manga.cover || undefined,
    subtitle: manga.author, rating: ContentRating.UNKNOWN }; }
  async getHomePage(): Promise<HomePage> {
    return { feeds: this.site.feeds.map(feed => ({ id: feed.id, title: feed.title,
      content: feed.directory ? { page: feed.id } : { list: { key: feed.id } } })) };
  }
  async getItemPage(key: string, page: number): Promise<ItemPageResponse> {
    if (page > 1) return { sections: [], isLastPage: true };
    return { sections: (await this.site.directory(key)).map(section => ({ id: section.id, title: section.title,
      style: section.entries ? PageSectionStyle.TAG_GRID : PageSectionStyle.DEFAULT,
      items: section.entries?.length ? section.entries.map(entry => ({ id: entry.id, title: entry.title, rating: ContentRating.UNKNOWN,
        destination: ItemListDestination({ key: entry.id }, entry.title) })) : section.items?.length ? section.items.map(manga => this.item(manga)) : undefined })), isLastPage: true };
  }
  async getSortOptions(): Promise<SortOptions> { return { options: this.site.filters[0].options, disableOrdering: true }; }
  async getSearchFilters(): Promise<SearchFilter[]> {
    return this.site.filters.map(filter => SearchFilter(filter.id, filter.title, PickerFilter(filter.options.map(option => ({ ...option, id: option.id || "__all" })))));
  }
  private filters(request: SearchRequest): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.filters || {})) if (typeof value === "string") values[key] = value === "__all" ? "" : value;
    if (request.sort?.key) values[this.site.filters[0].id] = request.sort.key;
    return values;
  }
  private async listing(key: string, page: number, request: SearchRequest = {}): Promise<PagedItemList> {
    const result = request.query?.trim() ? await this.site.search(request.query.trim(), page, this.filters(request)) : await this.site.browse(key, page, this.filters(request));
    return { items: result.items.map(manga => this.item(manga)), total: result.total, isLastPage: result.last };
  }
  async getItemList(request: ItemListRequest, page: number): Promise<PagedItemList> { return this.listing(request.key || "all", page, { sort: request.sort }); }
  async getSearchResults(request: SearchRequest, page: number): Promise<PagedItemList> { return this.listing("all", page, request); }
  private async details(id: string) {
    if (!this.cached || this.cached.id !== id || Date.now() - this.cached.at > 60_000) this.cached = { id, at: Date.now(), value: await this.site.details(id) };
    return this.cached.value;
  }
  async getContent(id: string): Promise<Content> {
    const comic = await this.details(id);
    return { title: comic.title, coverImage: comic.cover || "", summary: comic.description,
      rating: comic.mature ? ContentRating.MATURE : ContentRating.UNKNOWN, contentType: ContentType.MANGA, readingMode: ReadingMode.PAGED_MANGA,
      status: comic.status === "completed" ? ContentStatus.COMPLETED : comic.status === "ongoing" ? ContentStatus.ONGOING : ContentStatus.UNKNOWN,
      credits: comic.author ? [{ name: comic.author, role: "作者" }] : undefined, genres: comic.tags?.length ? comic.tags.map(title => ({ id: title, title })) : undefined, webUrl: comic.url };
  }
  async getChapters(id: string): Promise<Chapter[]> {
    return (await this.details(id)).chapters.map((chapter, index) => ({ id: chapter.id, title: `${chapter.group}：${chapter.title}`,
      index, number: chapter.number, language: "zh-Hans", date: chapter.date ? new Date(chapter.date) : undefined }));
  }
  async getChapterPages(id: string, chapter: string): Promise<ChapterPage[]> { return (await this.site.pages(id, chapter)).map(url => ({ url })); }
  async getSettingsPage(): Promise<UIForm> {
    if (this.site.id === "manhuagui") return { sections: [{ header: "漫画柜", views: [
      UIToggle({ id: "adult", title: "确认网站成人提示", currentValue: await ObjectStore.string("manhuagui.adult") === "true" }),
      UIPicker({ id: "imageServer", title: "图片服务器", currentValue: await ObjectStore.string("manhuagui.imageServer") || IMAGE_SERVERS[0],
        options: IMAGE_SERVERS.map(id => ({ id, title: id.replace("https://", "") })) }),
    ] }] };
    const logged = Boolean(await SecureStore.string("zaimanhua.token"));
    return { sections: [{ header: logged ? "再漫画：已登录" : "再漫画：未登录", footer: "部分作品需要登录或达到网站要求的等级。密码仅用于本次登录。", views: [
      UITextField({ id: "username", title: "账号", currentValue: "" }), UITextField({ id: "password", title: "密码", currentValue: "", isSecure: true }),
      UIToggle({ id: "logout", title: "退出登录", currentValue: false }),
    ] }] };
  }
  async onFormSubmitted(_id: string, data: PopulatedForm): Promise<void> {
    if (this.site.id === "manhuagui") {
      if (data.adult !== undefined) await ObjectStore.set("manhuagui.adult", String(data.adult));
      if (typeof data.imageServer === "string" && IMAGE_SERVERS.includes(data.imageServer)) await ObjectStore.set("manhuagui.imageServer", data.imageServer);
    } else {
      const username = String(data.username || "").trim(), password = String(data.password || "");
      if (Boolean(username) !== Boolean(password)) throw new Error("请同时填写账号和密码。");
      if (data.logout && username) throw new Error("请分别执行登录与退出登录。");
      if (username) await this.site.login!(username, password);
      else if (data.logout) await this.site.logout!();
    }
    this.cached = undefined;
  }
  async clearAuthentication(): Promise<void> { await this.site.logout?.(); this.cached = undefined; }
}
