import MD5 from "crypto-js/md5";
import { options, query, status, chapterNumber, numericId, type Site, type Filter, type Manga, type MangaList, type Details, type Request, type Section, type Session } from "@archettu/manga-core";

export const WEBSITE = "https://manhua.zaimanhua.com";
export const API = "https://v4api.zaimanhua.com/app/v1";
export const ACCOUNT_API = "https://account-api.zaimanhua.com/v1";
export const THEMES = options([["0", "全部"], ["4", "冒险"], ["5", "欢乐向"], ["6", "格斗"], ["7", "科幻"], ["8", "爱情"], ["9", "侦探"], ["10", "竞技"], ["11", "魔法"], ["12", "神鬼"], ["13", "校园"], ["14", "惊悚"], ["16", "其他"], ["17", "四格"], ["3242", "亲情"], ["3243", "百合"], ["3244", "秀吉"], ["3245", "悬疑"], ["3246", "纯爱"], ["3248", "热血"], ["3249", "泛爱"], ["3250", "历史"], ["3251", "战争"], ["3252", "萌系"], ["3253", "宅系"], ["3254", "治愈"], ["3255", "励志"], ["3324", "武侠"], ["3325", "机战"], ["3326", "音乐舞蹈"], ["3327", "美食"], ["3328", "职场"], ["3365", "西方魔幻"], ["4459", "高清单行"], ["4518", "TS"], ["5077", "东方"], ["5806", "魔幻"], ["5848", "奇幻"], ["6219", "节操"], ["6316", "轻小说"], ["6437", "颜艺"], ["7568", "搞笑"], ["7900", "仙侠"], ["13627", "舰娘"], ["17192", "动画"], ["18522", "AA"], ["23323", "福瑞"], ["23388", "生存"], ["30788", "日常"], ["31137", "画集"]]);
export const FILTERS: Filter[] = [
  { id: "sortType", title: "排序", options: options([["1", "最近更新"], ["2", "人气排序"]]) },
  { id: "theme", title: "题材", options: THEMES },
  { id: "status", title: "状态", options: options([["0", "全部"], ["2309", "连载中"], ["2310", "已完结"], ["29205", "短篇"]]) },
  { id: "cate", title: "读者群", options: options([["0", "全部"], ["3262", "少年漫画"], ["3263", "少女漫画"], ["3264", "青年漫画"], ["13626", "女青漫画"]]) },
  { id: "zone", title: "地区", options: options([["0", "全部"], ["2304", "日本"], ["2305", "韩国"], ["2306", "欧美"], ["2307", "港台"], ["2308", "内地"], ["8435", "其他"]]) },
  { id: "rank_type", title: "排行指标", options: options([["0", "人气"], ["1", "吐槽"], ["2", "订阅"]]) },
];
export const FEEDS = [{ id: "home", title: "官网首页推荐", directory: true }, { id: "latest", title: "最近更新" }, { id: "popular", title: "热门漫画" }, { id: "all", title: "全部漫画" },
  { id: "completed", title: "已完结" }, { id: "short", title: "短篇" }, { id: "categories", title: "分类索引", directory: true },
  { id: "web-categories", title: "官网分类／字母索引", directory: true }, { id: "ranks", title: "排行榜", directory: true }];
interface RawComic {
  id?: string | number; comic_id?: string | number; title?: string; name?: string; cover?: string; authors?: string | Tag[];
  description?: string; types?: string | Tag[]; status?: string | Tag[]; chapters?: RawGroup[]; chapterList?: RawGroup[];
  isHideChapter?: number; canRead?: boolean; last_update_chapter_id?: number; last_updatetime?: number;
}
interface Tag { tag_name?: string; tagName?: string }
interface RawGroup { title: string; data: { chapter_id: number; chapter_title: string; updatetime?: number }[] }
const names = (value?: string | Tag[]) => Array.isArray(value) ? value.map(tag => tag.tag_name || tag.tagName || "").filter(Boolean) : String(value || "").split("/").filter(Boolean);
export function comic(raw: RawComic): Manga {
  const id = [raw.comic_id, raw.id].find(value => value && String(value) !== "0");
  if (!id || !(raw.title || raw.name)) throw new Error("再漫画作品数据格式已变化。");
  return { id: String(id), title: raw.title || raw.name!, cover: raw.cover, author: names(raw.authors).join("、"),
    description: raw.description, tags: [...names(raw.types), ...names(raw.status)] };
}
export function readData<T>(response: { status: number; body: string }): T {
  if (response.status === 401) throw new Error("再漫画登录已失效，请重新登录。");
  if (response.status !== 200) throw new Error(`再漫画请求失败（HTTP ${response.status}）。`);
  const body = JSON.parse(response.body) as { errno?: number; errmsg?: string; data: T };
  if (body.errno && body.errno !== 0) throw new Error(`再漫画：${body.errmsg || body.errno}`);
  if (body.data == null) throw new Error(body.errmsg || "再漫画未返回数据。");
  return body.data;
}
export function parseDetails(raw: RawComic, expectedId: string): Details {
  const manga = comic(raw);
  if (manga.id !== expectedId) throw new Error("再漫画返回了其他作品的数据。");
  if (raw.canRead === false) throw new Error("再漫画：当前账号无权读取这部作品，请在官网核对登录和账号等级。");
  const groups = raw.chapters || raw.chapterList || [];
  const chapters = groups.flatMap(group => [...group.data].reverse().map(ch => ({ id: String(ch.chapter_id),
    title: ch.chapter_title.replace(/^(?:连载版?)?(\d+(?:\.\d+)?)([话卷])?$/, (_, n, t) => `第${n}${t || "话"}`), group: group.title,
    number: chapterNumber(ch.chapter_title), date: ch.updatetime ? ch.updatetime * 1000 : ch.chapter_id === raw.last_update_chapter_id && raw.last_updatetime ? raw.last_updatetime * 1000 : undefined })));
  if (!chapters.length) throw new Error("再漫画未返回章节，请在官网核对作品是否存在及账号权限。");
  return { ...manga, chapters, status: status(names(raw.status).join("")), url: `https://m.zaimanhua.com/pages/comic/detail?id=${expectedId}` };
}
export function imagePages(raw: { canRead?: boolean; page_url_hd?: string[]; page_url?: string[] }): string[] {
  if (raw.canRead === false) throw new Error("再漫画：当前账号无权读取这一章节，请在官网核对账号等级。");
  const pages = raw.page_url_hd?.length ? raw.page_url_hd : raw.page_url;
  if (!Array.isArray(pages) || !pages.length) throw new Error("再漫画未返回章节图片，请核对登录和账号权限。");
  return pages.map(value => value.startsWith("//") ? `https:${value}` : value);
}
export class Zaimanhua implements Site {
  readonly id = "zaimanhua"; readonly name = "再漫画"; readonly website = WEBSITE;
  readonly feeds = FEEDS; readonly filters = FILTERS;
  constructor(private readonly request: Request, private readonly session: Session) {}
  imageHeaders() { return { "User-Agent": "Mozilla/5.0 (Linux; Android) Mobile", Referer: `${WEBSITE}/` }; }
  private async get<T>(path: string, platform = "android", absolute = false): Promise<T> {
    const token = await this.session.get();
    return readData<T>(await this.request(absolute ? path : `${API}/${path}`, { ...this.imageHeaders(), Platform: platform,
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }));
  }
  private listing(data: RawComic[] | { comicList?: RawComic[]; list?: RawComic[]; totalNum?: number; total?: number }, page: number): MangaList {
    const rows = Array.isArray(data) ? data : data.comicList || data.list;
    if (!Array.isArray(rows)) throw new Error("再漫画列表格式已变化。");
    const total = Array.isArray(data) ? undefined : data.totalNum ?? data.total;
    return { items: rows.map(comic), total, last: total === undefined ? rows.length < 20 : page * 20 >= total };
  }
  async browse(key: string, page: number, filters: Record<string, string> = {}): Promise<MangaList> {
    if (key.startsWith("web-filter:")) {
      const [, field, value] = key.split(":");
      const data = await this.get<{ comicList?: RawComic[]; totalNum?: number; data?: { comicList?: RawComic[]; totalNum?: number } }>(`${WEBSITE}/api/v1/comic1/filter?${query({ [field]: value, page, size: 20 })}`, "pc", true);
      return this.listing(data.data || data, page);
    }
    if (key === "latest") return this.listing(await this.get(`comic/update/list/0/${page}`), page);
    if (key.startsWith("rank:") || key === "popular") {
      const [, period = "3", metric] = key.split(":");
      return this.listing(await this.get(`comic/rank/list?${query({ page, by_time: period, rank_type: metric || filters.rank_type || "0", tag_id: "0" })}`), page);
    }
    const values: Record<string, string | number> = { status: "0", theme: "0", zone: "0", cate: "0", sortType: "1", ...filters, page, size: 20 };
    delete values.rank_type;
    if (key.startsWith("filter:")) { const [, field, value] = key.split(":"); values[field] = value; }
    if (key === "completed" || key === "short") values.status = key === "completed" ? "2310" : "29205";
    return this.listing(await this.get(`comic/filter/list?${query(values)}`), page);
  }
  async search(keyword: string, page: number): Promise<MangaList> {
    return this.listing(await this.get(`search/index?${query({ keyword, page, source: "0", sort: "0", size: 20 })}`), page);
  }
  async directory(key: string): Promise<Section[]> {
    if (key === "home") {
      const response = await this.get<{ data: Record<string, (RawComic & { obj_id?: number; sub_title?: string })[]> }>(`${WEBSITE}/api/v1/comic2/index`, "pc", true);
      const home = response.data;
      return options([["bannerList", "焦点推荐"], ["recList", "精品推荐"], ["updateList", "最新更新"], ["weekRankList", "周排行榜"], ["monthRankList", "月排行榜"]]).map(section => ({
        id: section.id, title: section.title, items: (home[section.id] || []).map(raw => comic({ ...raw, id: raw.obj_id || raw.id, authors: raw.authors || raw.sub_title })) }));
    }
    if (key === "web-categories") {
      const types = await this.get<Record<string, { id?: number; val?: string; name: string }[]>>(`${WEBSITE}/api/v1/comic1/filter_type`, "pc", true);
      const titles: Record<string, string> = { audience: "读者群", cate: "作品形式", firstLetter: "首字母", sortType: "排序", status: "状态", theme: "题材", zone: "地区" };
      return Object.entries(types).map(([field, rows]) => ({ id: `web:${field}`, title: titles[field] || field,
        entries: rows.map(row => ({ id: `web-filter:${field}:${row.val ?? row.id ?? ""}`, title: row.name })) }));
    }
    if (key === "ranks") return options([["0", "日排行"], ["1", "周排行"], ["2", "月排行"], ["3", "总排行"]]).map(period => ({
      id: `rank:${period.id}`, title: period.title, entries: FILTERS[5].options.map(metric => ({ id: `rank:${period.id}:${metric.id}`, title: metric.title })) }));
    return FILTERS.slice(1, 5).map(filter => ({ id: filter.id, title: filter.title,
      entries: filter.options.map(option => ({ id: `filter:${filter.id}:${option.id}`, title: option.title })) }));
  }
  async details(id: string): Promise<Details> {
    const data = await this.get<{ data?: RawComic; comicInfo?: RawComic }>(`comic/detail/${numericId(id)}?_v=2.2.5`, "pc");
    let raw = data.data || data.comicInfo;
    if (!raw) throw new Error("再漫画未返回作品详情。");
    if (raw.isHideChapter === 1 && raw.canRead === true) {
      const web = await this.get<{ data?: RawComic; comicInfo?: RawComic }>(`${WEBSITE}/api/v1/comic2/comic/detail?id=${id}`, "pc", true);
      const chapters = web.data || web.comicInfo;
      if (chapters) raw = { ...raw, ...chapters };
    }
    return parseDetails(raw, id);
  }
  async pages(id: string, chapter: string): Promise<string[]> {
    const data = await this.get<{ data?: Parameters<typeof imagePages>[0]; comicInfo?: Parameters<typeof imagePages>[0] }>(`comic/chapter/${numericId(id)}/${numericId(chapter)}?_v=2.2.5`, "h5");
    return imagePages(data.data || data.comicInfo || {});
  }
  async login(username: string, password: string): Promise<void> {
    const data = readData<{ user?: { token: string }; userInfo?: { token: string } }>(await this.request(`${ACCOUNT_API}/login/passwd`,
      { ...this.imageHeaders(), "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, query({ username, passwd: MD5(password).toString() })));
    const token = data.user?.token || data.userInfo?.token;
    if (!token) throw new Error("再漫画未返回登录令牌。");
    await this.session.set(token);
  }
  async logout(): Promise<void> { await this.session.clear(); }
}
