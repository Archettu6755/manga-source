import { COMIC_FIELDS, PAGE_SIZE, WEBSITE, imagePages, numericSerial, readData, requireComic, sessionCookies,
  type Comic, type ComicChapter } from "@archettu/komiic";
import { category, header, info, json, list, pageNumber, part, Transport,
  type SourceStore, type SourceConfig, type ComicItem, type ComicList, type Part, type Option } from "./runtime";

const FEEDS: [string, string][] = [["latest", "最近更新"], ["popular", "热门漫画"], ["all", "所有漫画"],
  ["newest", "最近上架"], ["completed", "已完结"], ["short", "短篇"], ["categories", "题材分类"],
  ["elements", "标签"], ["authors", "作者列表"], ["originals", "原作"], ["characters", "角色"],
  ["recommended-week", "本周推荐"], ["recommended-month", "本月推荐"], ["recommended-year", "年度推荐"], ["random", "随机发现"]];
const DIRECTORIES = ["categories", "elements", "authors", "originals", "characters"];
const CATALOG_PAGE_SIZE = 500;
const SORTS = ["default-入口默认", "DATE_UPDATED-更新时间", "DATE_CREATED-上架时间", "VIEWS-总观看数", "MONTH_VIEWS-本月观看数", "FAVORITE_COUNT-喜爱数"];
const rawChapter = (value: string) => value.startsWith("ep:") ? value.slice(3) : value;
interface Entry { id: string; name: string; group?: string; type?: string; nameZhTw?: string; comicCount: number }

export function createSource(source: SourceStore): SourceConfig {
  const transport = new Transport(750);
  let refreshing: Promise<void> | undefined;
  const headers = () => {
    const cookies = source.loadData("cookies"), token = source.loadData("token");
    return { Referer: `${WEBSITE}/`, "Content-Type": "application/json",
      ...(cookies ? { Cookie: String(cookies) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  };
  function saveSession(cookieHeader: string | null, token?: string) {
    const cookies = sessionCookies(cookieHeader);
    if (cookies) {
      const merged = new Map([...String(source.loadData("cookies") ?? "").split("; "), ...cookies.split("; ")]
        .filter(Boolean).map(cookie => { const at = cookie.indexOf("="); return [cookie.slice(0, at), cookie.slice(at + 1)] as const; }));
      source.saveData("cookies", [...merged].map(([key, value]) => `${key}=${value}`).join("; "));
    }
    if (token) source.saveData("token", token);
    if (cookies || token) source.saveData("refreshedAt", Date.now());
    return Boolean(cookies || token);
  }
  async function refresh() {
    if (!source.loadData("cookies") || Date.now() - Number(source.loadData("refreshedAt") ?? 0) < 30 * 60_000) return;
    if (!refreshing) refreshing = (async () => {
      const response = await transport.request("POST", `${WEBSITE}/auth/refresh`, headers(), "{}");
      if (response.status !== 200 && response.status !== 204) throw new Error(`Komiic 登录刷新失败（HTTP ${response.status}），请重新登录。`);
      saveSession(header(response, "set-cookie"));
      source.saveData("refreshedAt", Date.now());
    })();
    try { await refreshing; } finally { refreshing = undefined; }
  }
  async function query<T>(operationName: string, text: string, variables: Record<string, unknown>): Promise<T> {
    await refresh();
    const response = await transport.request("POST", `${WEBSITE}/api/query`, headers(), JSON.stringify({ operationName, query: text, variables }));
    return readData<T>(response.status, response.status === 200 ? json(response) : null);
  }
  const item = (value: Comic): ComicItem => {
    const comic = requireComic(value);
    return { id: comic.id, title: comic.title, cover: comic.imageUrl, subtitle: comic.authors?.map(author => author.name).join("、"),
      tags: comic.categories?.map(value => value.name), description: comic.description };
  };
  function comicList(comics: Comic[], page: number, complete = false): ComicList {
    if (!Array.isArray(comics)) throw new Error("Komiic 漫画列表格式已变化。");
    return list((complete ? comics.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : comics).map(item), page,
      complete ? page * PAGE_SIZE >= comics.length : comics.length < PAGE_SIZE, complete ? comics.length : undefined);
  }
  const directoryCache = new Map<string, { at: number; entries: Entry[]; limited: boolean }>();
  async function directory(key: string): Promise<Entry[]> {
    const cached = directoryCache.get(key);
    if (cached && Date.now() - cached.at < 600_000) return cached.entries;
    let entries: Entry[];
    let limited = false;
    if (key === "categories" || key === "elements") {
      const field = key === "categories" ? "allCategory" : "allElements";
      const data = await query<{ entries: Entry[] }>(field, `query ${field} { entries: ${field} { id name ${key === "categories" ? "group" : "type"} comicCount } }`, {});
      entries = data.entries;
      if (!Array.isArray(entries)) throw new Error("Komiic 分类数据格式已变化。");
    } else {
      entries = [];
      const seen = new Set<string>();
      const field = key === "authors" ? "authors" : key === "originals" ? "hOriginalComics" : key === "characters" ? "hCharacters" : "";
      if (!field) throw new Error("不支持的目录入口。");
      for (let offset = 0; ; ) {
        let data: { entries: Entry[] };
        try {
          data = await query("browseEntries",
            `query browseEntries($pagination: Pagination!, $contentType: ContentType!) { entries: ${field}(pagination: $pagination, contentType: $contentType) { id name ${key === "characters" ? "nameZhTw" : ""} comicCount } }`,
            { pagination: { limit: CATALOG_PAGE_SIZE, offset, orderBy: key === "authors" ? "DATE_UPDATED" : "VIEWS", status: "", asc: key === "authors" }, contentType: "REGULAR" });
        } catch (error) {
          if (entries.length && String(error).includes("Offset is too large")) { limited = true; break; }
          throw error;
        }
        if (!Array.isArray(data.entries)) throw new Error("Komiic 目录格式已变化。");
        let added = 0;
        for (const entry of data.entries) {
          if (!entry.id) throw new Error("Komiic 目录 ID 格式已变化。");
          if (seen.has(entry.id)) continue;
          seen.add(entry.id); entries.push(entry); added++;
        }
        offset += data.entries.length;
        if (data.entries.length < CATALOG_PAGE_SIZE) break;
        if (!added) throw new Error("Komiic 目录返回了重复分页。");
      }
    }
    directoryCache.set(key, { at: Date.now(), entries, limited });
    return entries;
  }
  async function browse(key: string, options: string[], page: number): Promise<ComicList> {
    pageNumber(page);
    const defaultOrder = key === "popular" ? "MONTH_VIEWS" : key === "newest" ? "DATE_CREATED" : "DATE_UPDATED";
    const orderBy = !options[0] || options[0] === "default" ? defaultOrder : options[0];
    if (!SORTS.some(sort => sort.split("-")[0] === orderBy)) throw new Error("不支持的漫画排序。");
    const status = key === "completed" ? "END" : key === "short" ? "SHORT" : options[2] && options[2] !== "all" ? options[2] : "";
    if (!["", "ONGOING", "END", "SHORT"].includes(status)) throw new Error("不支持的连载状态。");
    const pagination = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, orderBy, status, asc: options[1] === "asc" };
    if (key.startsWith("author:")) {
      const data = await query<{ comics: Comic[] }>("comicsByAuthor",
        `query comicsByAuthor($authorId: ID!) { comics: getComicsByAuthor(authorId: $authorId) { ${COMIC_FIELDS} } }`, { authorId: key.slice(7) });
      return comicList(data.comics, page, true);
    }
    if (key.startsWith("original:") || key.startsWith("character:")) {
      const original = key.startsWith("original:");
      const field = original ? "comicsByHOriginalComicId" : "comicsByHCharacterId";
      const argument = original ? "originalComicId" : "characterId";
      const data = await query<{ comics: { id: string }[] }>("comicsByReference",
        `query comicsByReference($referenceId: ID!, $contentType: ContentType!, $pagination: Pagination!) { comics: ${field}(${argument}: $referenceId, contentType: $contentType, pagination: $pagination) { id } }`,
        { referenceId: key.slice(key.indexOf(":") + 1), contentType: "REGULAR", pagination });
      if (!Array.isArray(data.comics)) throw new Error("Komiic 原作或角色列表格式已变化。");
      if (!data.comics.length) return list([], page, true);
      const details = await query<{ comics: Comic[] }>("comicByIds", `query comicByIds($comicIds: [ID]!) { comics: comicByIds(comicIds: $comicIds) { ${COMIC_FIELDS} } }`, { comicIds: data.comics.map(comic => comic.id) });
      if (!Array.isArray(details.comics)) throw new Error("Komiic 原作或角色信息格式已变化。");
      const lookup = new Map(details.comics.map(comic => [comic.id, comic]));
      return comicList(data.comics.map(comic => { const value = lookup.get(comic.id); if (!value) throw new Error("Komiic 未返回完整的漫画信息。"); return value; }), page);
    }
    let field = "comicByCategories", declaration = "$ids: [ID!]!, $pagination: Pagination!", argument = "categoryId: $ids, pagination: $pagination";
    let variables: Record<string, unknown> = { pagination, ids: key.startsWith("categories:") ? [key.slice(11)] : options[3] && options[3] !== "all" ? [options[3]] : [] };
    if (key === "latest" || key === "popular") {
      field = key === "latest" ? "recentUpdate" : "hotComics";
      declaration = "$pagination: Pagination!"; argument = "pagination: $pagination"; variables = { pagination };
    } else if (key.startsWith("elements:")) { field = "comicByElements"; argument = "elementIds: $ids, pagination: $pagination"; variables.ids = [key.slice(9)]; }
    else if (["recommended-week", "recommended-month", "recommended-year"].includes(key)) {
      field = "topRecommendedComics"; declaration = "$period: RecommendationPeriod!, $pagination: Pagination!, $contentType: ContentType";
      argument = "period: $period, pagination: $pagination, contentType: $contentType";
      variables = { pagination, period: key === "recommended-week" ? "WEEK" : key === "recommended-month" ? "MONTH" : "YEAR", contentType: "REGULAR" };
    } else if (key === "random") {
      field = "randomComics"; declaration = "$pagination: Pagination!, $contentType: ContentType";
      argument = "pagination: $pagination, contentType: $contentType"; variables = { pagination, contentType: "REGULAR" };
    } else if (!["all", "newest", "completed", "short"].includes(key) && !key.startsWith("categories:")) throw new Error("Komiic 不支持该漫画列表。");
    const data = await query<{ comics: Comic[] }>("browseComics", `query browseComics(${declaration}) { comics: ${field}(${argument}) { ${COMIC_FIELDS} } }`, variables);
    return comicList(data.comics, page);
  }
  async function options(): Promise<Option[]> {
    return [{ label: "排序", options: SORTS }, { label: "方向", options: ["desc-降序", "asc-升序"] },
      { label: "状态", options: ["all-全部", "ONGOING-连载", "END-完结", "SHORT-短篇"] },
      { label: "题材", options: ["all-全部", ...(await directory("categories")).map(entry => `${entry.id}-${entry.name}`)] }];
  }
  return {
    ...info("komiic", "Komiic"),
    category: category("Komiic · Archettu", FEEDS.filter(([key]) => !DIRECTORIES.includes(key))),
    explore: FEEDS.map(([key, title]) => ({ title: `Komiic · ${title}`, type: DIRECTORIES.includes(key) ? "multiPartPage" : "multiPageComicList",
      load: async page => {
        if (!DIRECTORIES.includes(key)) return browse(key, [], page);
        const prefix = key === "authors" ? "author" : key === "originals" ? "original" : key === "characters" ? "character" : key;
        const entries = await directory(key);
        const parts = entries.map(entry => part(`${prefix}:${entry.id}`, `${entry.nameZhTw || entry.name || entry.id}（${entry.comicCount} 部）`));
        if (directoryCache.get(key)?.limited) parts.push({ title: `网站限制了后续目录页（已显示 ${entries.length} 项）`, comics: [] });
        return parts;
      } })),
    categoryComics: { load: (name, key, values, page) => browse(key ?? name, values, page), optionLoader: () => options() },
    search: { load: async (keyword, values, page) => {
      pageNumber(page);
      if (!keyword.trim()) return browse("all", [], page);
      const data = await query<{ searchComicsAndAuthors: { comics: Comic[] } }>("searchComicsAndAuthors",
        `query searchComicsAndAuthors($keyword: String!) { searchComicsAndAuthors(keyword: $keyword) { comics { ${COMIC_FIELDS} } } }`, { keyword: keyword.trim() });
      return comicList(data.searchComicsAndAuthors?.comics, page, true);
    } },
    comic: {
      loadInfo: async id => {
        const data = await query<{ comicById: Comic; chaptersByComicId: ComicChapter[] }>("mangaQuery",
          `query mangaQuery($comicId: ID!) { comicById(comicId: $comicId) { ${COMIC_FIELDS} } chaptersByComicId(comicId: $comicId) { id serial type size dateCreated } }`, { comicId: id });
        const comic = requireComic(data.comicById);
        if (comic.id !== id || !Array.isArray(data.chaptersByComicId)) throw new Error("Komiic 作品或章节格式已变化。");
        const filter = source.loadSetting("chapters") ?? "all";
        if (!["all", "chapter", "book"].includes(String(filter))) throw new Error("不支持的章节类型。");
        const chapters: Record<string, string> = {};
        for (const chapter of data.chaptersByComicId.filter(chapter => filter === "all" || chapter.type === filter)
          .sort((a, b) => a.type.localeCompare(b.type) || numericSerial(a.serial) - numericSerial(b.serial))) {
          const key = `ep:${chapter.id}`;
          if (!chapter.id || typeof chapter.serial !== "string" || Object.prototype.hasOwnProperty.call(chapters, key)) throw new Error("Komiic 章节数据格式已变化。");
          chapters[key] = `第 ${chapter.serial} ${chapter.type === "book" ? "卷" : "话"} · ${chapter.size}P`;
        }
        return { title: comic.title, cover: comic.imageUrl, description: comic.description, subtitle: comic.status,
          tags: { 作者: comic.authors?.map(author => author.name) ?? [], 题材: comic.categories?.map(category => category.name) ?? [] },
          chapters, url: `${WEBSITE}/comic/${encodeURIComponent(id)}` };
      },
      loadEp: async (_id, chapter) => {
        if (!chapter) throw new Error("请选择章节。");
        const data = await query<{ imagesByChapterId: { kid: string }[] }>("imagesByChapterId",
          "query imagesByChapterId($chapterId: ID!) { imagesByChapterId(chapterId: $chapterId) { kid } }", { chapterId: rawChapter(chapter) });
        return { images: imagePages(data.imagesByChapterId) };
      },
      onImageLoad: async (url, id, chapter) => {
        if (!url.startsWith(`${WEBSITE}/api/image/`)) return { headers: { Referer: `${WEBSITE}/` } };
        await refresh();
        return { headers: { ...headers(), Referer: `${WEBSITE}/comic/${encodeURIComponent(id)}/chapter/${encodeURIComponent(rawChapter(chapter))}/images/all` } };
      },
      onThumbnailLoad: () => ({ headers: { Referer: `${WEBSITE}/` } }),
    },
    account: {
      login: async (email, password) => {
        const response = await transport.request("POST", `${WEBSITE}/api/login`, { Referer: `${WEBSITE}/`, "Content-Type": "application/json" }, JSON.stringify({ email, password }));
        if (response.status !== 200 && response.status !== 204) throw new Error(`Komiic 登录失败（HTTP ${response.status}）。`);
        let token: string | undefined;
        if (response.body.trim()) token = (json(response) as { token?: string }).token;
        const cookies = header(response, "set-cookie");
        if (!sessionCookies(cookies) && !token) throw new Error("Komiic 未返回有效登录会话。");
        source.deleteData("cookies"); source.deleteData("token");
        saveSession(cookies, token);
        return true;
      },
      logout: () => {
        source.deleteData("cookies"); source.deleteData("token"); source.deleteData("refreshedAt");
        Network.deleteCookies(WEBSITE);
      },
      registerWebsite: `${WEBSITE}/register`,
    },
    settings: { chapters: { title: "章节列表", type: "select", default: "all",
      options: [{ value: "all", text: "卷与章节" }, { value: "chapter", text: "仅章节" }, { value: "book", text: "仅卷" }] } },
  };
}
