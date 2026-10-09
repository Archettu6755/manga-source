import {
  appHeaders, createDevice, DEFAULT_API, isCopyApi, loginBody, normalizeApi, readResults,
  WEBSITE, COPY_WEBSITES, copyWebsite, copyRegion, imageHeaders, readList, requireComic, orderedPages, parseComicList, parseCardList,
  parseTopics, parseThemes, parseHome, WEB_PAGE_SIZE, RECOMMEND_PAGE_SIZE, TOPIC_PAGE_SIZE,
  CHAPTER_PAGE_SIZE, PAGE_SIZE, RANK_PERIODS, REGIONS, STATUSES,
  type DeviceInfo, type Comic, type Details, type ApiList, type ApiChapter, type ApiPages, type BrowseTheme,
} from "@archettu/copymanga";
import { category, choice, choiceId, info, json, list, pageNumber, params, part, target, Transport,
  type SourceStore, type SourceConfig, type ComicItem, type ComicList, type Part, type Option } from "./runtime";

const FEEDS: [string, string][] = [["home", "首页推荐"], ["all", "发现／全部漫画"], ["topics", "专题"],
  ["themes", "题材"], ["ranks", "排行榜"], ["recommend", "漫画推荐"], ["newest", "全新上架"],
  ["latest", "最近更新"], ["popular", "热门漫画"], ["completed", "已完结"]];
class CopyApi {
  readonly transport = new Transport(1500);
  private discovered?: string;
  private discoveredRegion?: string;
  constructor(private readonly source: SourceStore) {}
  region(): "0" | "1" { return copyRegion(this.source.loadSetting("region")); }
  website(): string { return copyWebsite(this.source.loadSetting("website")); }
  private webHeaders() { return { Referer: `${this.website()}/`,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15" }; }
  async refresh() {
    this.discovered = undefined;
    this.source.deleteData("discoveredApi");
    // Discover even when a manual address is configured, without changing that setting.
    await this.discover();
  }
  private headers(token = true) {
    let device = this.source.loadData("device") as DeviceInfo | undefined;
    if (!device) { device = createDevice(); this.source.saveData("device", device); }
    return appHeaders(device, token ? String(this.source.loadData("token") ?? "") : "", new Date(), this.region());
  }
  async base(): Promise<string> {
    const manual = this.source.loadSetting("api");
    if (manual) return normalizeApi(String(manual));
    const region = this.region();
    if (this.discovered && this.discoveredRegion === region) return this.discovered;
    const cached = this.source.loadData("discoveredApi") as { url?: string; at?: number; region?: string } | undefined;
    if (cached?.url && cached.region === region && isCopyApi(cached.url) && Date.now() - Number(cached.at) < 86_400_000) {
      this.discoveredRegion = region;
      return this.discovered = cached.url;
    }
    return this.discover();
  }
  private async discover(): Promise<string> {
    const region = this.region();
    let restricted = false;
    try {
      const response = await this.transport.request("GET", "https://api.copy-manga.com/api/v3/system/network2?platform=3", this.headers(false));
      restricted = [210, 401, 403, 429].includes(response.status);
      const body = json(response);
      restricted ||= [210, 401, 403, 429].includes(Number((body as { code?: number })?.code));
      const result = readResults<{ api?: string[][] }>(response.status, body);
      const host = result.api?.[0]?.[0];
      if (host && isCopyApi(normalizeApi(host))) {
        this.discovered = normalizeApi(host);
        this.discoveredRegion = region;
        this.source.saveData("discoveredApi", { url: this.discovered, at: Date.now(), region });
        return this.discovered;
      }
    } catch (error) { if (restricted) throw error; }
    this.discoveredRegion = region;
    return this.discovered = DEFAULT_API;
  }
  async get<T>(path: string, values: Record<string, string | number | boolean> = {}): Promise<T> {
    const response = await this.transport.request("GET", `${await this.base()}/api/v3/${path}?${params({ in_mainland: this.region() === "1", ...values })}`, this.headers());
    return readResults<T>(response.status, json(response));
  }
  async web(path: string, values: Record<string, string | number | boolean> = {}) {
    const query = params(values);
    const response = await this.transport.request("GET", `${this.website()}${path}${query ? `?${query}` : ""}`, this.webHeaders());
    if (response.status !== 200) throw new Error(`CopyManga 浏览页面暂时无法访问（HTTP ${response.status}）。`);
    return response.body;
  }
  async search(keyword: string, page: number) {
    const values = { q: keyword, q_type: "", limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    if (this.source.loadSetting("search") === "app") return this.get<ApiList<Comic>>("search/comic", values);
    const path = (await this.web("/search")).match(/const\s+countApi\s*=\s*["']([^"']+)["']/)?.[1];
    if (!path || !(path.startsWith("/api/") || path.startsWith(`${this.website()}/api/`))) throw new Error("CopyManga 网页搜索接口已变化，请更新源或切换 App 搜索。");
    const response = await this.transport.request("GET", `${path.startsWith("/") ? this.website() : ""}${path}?${params({ ...values, platform: 2 })}`, this.webHeaders());
    return readResults<ApiList<Comic>>(response.status, json(response));
  }
  async login(username: string, password: string) {
    const response = await this.transport.request("POST", `${await this.base()}/api/v3/login`,
      { ...this.headers(false), "Content-Type": "application/x-www-form-urlencoded" },
      params(loginBody(username, password, Math.floor(1000 + Math.random() * 9000))));
    const result = readResults<{ token: string }>(response.status, json(response));
    if (!result.token?.trim()) throw new Error("CopyManga 登录未返回有效令牌。");
    this.source.saveData("token", result.token);
    return true;
  }
}

export function createSource(source: SourceStore): SourceConfig {
  const api = new CopyApi(source);
  let themeCache: { at: number; website: string; value: BrowseTheme[] } | undefined;
  const themes = async () => {
    if (!themeCache || themeCache.website !== api.website() || Date.now() - themeCache.at > 3_600_000) themeCache = { at: Date.now(), website: api.website(), value: parseThemes(await api.web("/filter")) };
    return themeCache.value;
  };
  const item = (value: Comic): ComicItem => {
    const comic = requireComic(value);
    return { id: comic.path_word, title: comic.name, cover: comic.cover,
      subtitle: comic.author?.map(author => author.name).join("、"), tags: comic.theme?.map(tag => tag.name) };
  };
  async function browse(key: string, options: string[], page: number): Promise<ComicList> {
    pageNumber(page);
    if (key.startsWith("rank:")) {
      const [prefix, channel, period, extra] = key.split(":");
      if (prefix !== "rank" || extra || !["male", "female"].includes(channel) || !RANK_PERIODS.some(value => value.id === period)) throw new Error("不支持的排行榜。");
      if (page > 1) return list([], page, true);
      const result = parseCardList(await api.web("/rank", { type: channel, table: period }), 0, 50);
      return list(result.list.map(item), page, true);
    }
    if (key.startsWith("topic:")) {
      if (page > 1) return list([], page, true);
      return list(parseCardList(await api.web(`/topic/${encodeURIComponent(key.slice(6))}`), 0, 1).list.map(item), page, true);
    }
    if (key === "recommend" || key === "newest") {
      const offset = (page - 1) * RECOMMEND_PAGE_SIZE;
      const result = parseCardList(await api.web(`/${key}`, { limit: RECOMMEND_PAGE_SIZE, offset }), offset, RECOMMEND_PAGE_SIZE);
      return list(result.list.map(item), page, result.isLastPage);
    }
    if (!["all", "latest", "popular", "completed"].includes(key) && !key.startsWith("theme:")) throw new Error("不支持该漫画列表。");
    const sort = !options[0] || options[0] === "default" ? (key === "popular" ? "popular" : "datetime_updated") : options[0];
    if (!["datetime_updated", "popular"].includes(sort)) throw new Error("不支持的漫画排序。");
    const values: Record<string, string | number> = { ordering: `${options[1] === "asc" ? "" : "-"}${sort}`, limit: WEB_PAGE_SIZE, offset: (page - 1) * WEB_PAGE_SIZE };
    const theme = key.startsWith("theme:") ? key.slice(6) : options[4] ? choiceId(options[4]) : undefined;
    if (theme?.startsWith("empty:")) return list([], page, true, 0);
    if (theme && theme !== "all") values.theme = theme;
    if (options[2] && options[2] !== "all") values.region = options[2];
    if (key === "completed") values.status = "1";
    else if (options[3] && options[3] !== "all") values.status = options[3];
    const result = readList(parseComicList(await api.web("/comics", values), Number(values.offset)));
    return list(result.list.map(item), page, !result.list.length || result.offset + result.list.length >= result.total, result.total, WEB_PAGE_SIZE);
  }
  async function topics(): Promise<Part[]> {
    const parts: Part[] = [];
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      const offset = (page - 1) * TOPIC_PAGE_SIZE;
      const result = parseTopics(await api.web("/topic", { limit: TOPIC_PAGE_SIZE, offset }), offset);
      for (const topic of result.list) {
        if (seen.has(topic.id)) throw new Error("CopyManga 专题目录返回了重复分页。");
        seen.add(topic.id);
        parts.push(part(`topic:${topic.id}`, topic.title));
      }
      if (result.isLastPage) return parts;
      if (!result.list.length) throw new Error("CopyManga 专题目录未返回完整分页。");
    }
  }
  async function options(key: string): Promise<Option[]> {
    if (key.startsWith("rank:") || key.startsWith("topic:") || ["newest", "recommend"].includes(key)) return [];
    return [{ label: "排序", options: ["default-入口默认", "datetime_updated-更新时间", "popular-热度"] },
      { label: "方向", options: ["desc-降序", "asc-升序"] },
      { label: "地区", options: REGIONS.map(value => `${value.id || "all"}-${value.title}`) },
      { label: "状态", options: STATUSES.map(value => `${value.id || "all"}-${value.title}`) },
      { label: "题材", options: ["all-全部", ...(await themes()).map(value => choice(value.path_word, value.name))] }];
  }
  let lastDetails: { id: string; connection: string; at: number; value: Details } | undefined;
  async function details(id: string) {
    const connection = `${api.website()}|${api.region()}|${source.loadSetting("api") ?? ""}`;
    if (lastDetails?.id === id && lastDetails.connection === connection && Date.now() - lastDetails.at < 60_000) return lastDetails.value;
    const value = await api.get<Details>(`comic2/${encodeURIComponent(id)}`, { platform: 3 });
    requireComic(value.comic);
    if (!value.groups || typeof value.groups !== "object" || Array.isArray(value.groups)) throw new Error("CopyManga 缺少章节分组。");
    lastDetails = { id, connection, at: Date.now(), value };
    return value;
  }
  return {
    ...info("copymanga", "拷贝漫画"), version: "1.0.1",
    category: { ...category("拷贝漫画 · Archettu", FEEDS.filter(([key]) => !["home", "themes", "topics", "ranks"].includes(key))), enableRankingPage: true },
    explore: FEEDS.map(([key, title]) => ({ title: `拷贝漫画 · ${title}`, type: ["home", "themes", "topics", "ranks"].includes(key) ? "multiPartPage" : "multiPageComicList",
      load: async page => {
        if (key === "themes") return (await themes()).map(theme => part(`theme:${theme.path_word}`, `${theme.name}（${theme.count} 部）`));
        if (key === "topics") return topics();
        if (key === "ranks") return ["male", "female"].flatMap(channel => RANK_PERIODS.map(period => part(`rank:${channel}:${period.id}`, `${channel === "male" ? "男频" : "女频"} · ${period.title}`)));
        if (key === "home") return parseHome(await api.web("/")).flatMap(section => section.topics
          ? section.topics.map(topic => part(`topic:${topic.id}`, topic.title))
          : [{ title: section.title, comics: section.comics.map(item), ...(section.list ? { viewMore: target(section.list, section.title) } : {}) }]);
        return browse(key, [], page);
      } })),
    categoryComics: { load: (name, key, values, page) => browse(key ?? name, values, page), optionLoader: (name, key) => options(key ?? name),
      ranking: { options: ["male", "female"].flatMap(channel => RANK_PERIODS.map(period => `${channel}:${period.id}-${channel === "male" ? "男频" : "女频"} · ${period.title}`)),
        load: (key, page) => browse(`rank:${key}`, [], page) } },
    search: { load: async (keyword, values, page) => {
      pageNumber(page);
      if (!keyword.trim()) return browse("all", [], page);
      const result = readList(await api.search(keyword.trim(), page));
      return list(result.list.map(item), page, !result.list.length || (page - 1) * PAGE_SIZE + result.list.length >= result.total, result.total);
    } },
    comic: {
      loadInfo: async id => {
        const { comic, groups } = await details(id);
        const chapters: Record<string, string> = {};
        const seen = new Set<string>();
        const ordered = Object.values(groups).sort((a, b) => Number(b.path_word === "default") - Number(a.path_word === "default"));
        for (const group of ordered) {
          if (!group.path_word) throw new Error("CopyManga 章节分组格式已变化。");
          let offset = 0;
          while (true) {
            const result = readList(await api.get<ApiList<ApiChapter>>(`comic/${encodeURIComponent(id)}/group/${encodeURIComponent(group.path_word)}/chapters`, { limit: CHAPTER_PAGE_SIZE, offset }));
            if (result.offset !== offset || (!result.list.length && offset < result.total)) throw new Error("CopyManga 目录分页不完整。");
            let added = 0;
            for (const entry of result.list) {
              if (!entry.uuid || typeof entry.name !== "string") throw new Error("CopyManga 章节数据格式已变化。");
              if (seen.has(entry.uuid)) continue;
              seen.add(entry.uuid); added++;
              chapters[entry.uuid] = group.path_word === "default" ? entry.name : `${group.name}：${entry.name}`;
            }
            offset += result.list.length;
            if (offset >= result.total) break;
            if (!added) throw new Error("CopyManga 目录返回了重复分页。");
          }
        }
        if (!seen.size) throw new Error("CopyManga 未返回章节，请核对官网访问提示。");
        return { title: comic.name, cover: comic.cover, description: comic.brief, subtitle: comic.status?.display,
          tags: { 作者: comic.author?.map(author => author.name) ?? [], 题材: comic.theme?.map(theme => theme.name) ?? [] },
          chapters, url: `${api.website()}/comic/${encodeURIComponent(id)}` };
      },
      loadEp: async (id, chapter) => {
        if (!chapter) throw new Error("请选择章节。");
        return { images: orderedPages(await api.get<ApiPages>(`comic/${encodeURIComponent(id)}/chapter2/${encodeURIComponent(chapter)}`)).map(page => page.url) };
      },
      onImageLoad: () => ({ headers: imageHeaders(new Date(), api.region()) }), onThumbnailLoad: () => ({ headers: imageHeaders(new Date(), api.region()) }),
    },
    account: { login: (username, password) => api.login(username, password), logout: () => { source.deleteData("token"); lastDetails = undefined; }, registerWebsite: `${WEBSITE}/reg` },
    settings: {
      website: { title: "官网入口（浏览与网页搜索）", type: "select", default: "mainland", options: COPY_WEBSITES.map(entry => ({ value: entry.id, text: entry.title })) },
      region: { title: "资源线路（直连选大陆，代理可选海外）", type: "select", default: "1", options: [{ value: "1", text: "大陆线路" }, { value: "0", text: "海外线路" }] },
      api: { title: "API 域名（留空自动获取）", type: "input", default: "" },
      refreshApi: { title: "刷新自动 API（手动地址留空时生效）", type: "callback", buttonText: "重新获取", callback: async () => { lastDetails = undefined; themeCache = undefined; await api.refresh(); } },
      search: { title: "搜索接口", type: "select", default: "web", options: [{ value: "web", text: "网页搜索" }, { value: "app", text: "App 搜索" }] },
    },
  };
}
