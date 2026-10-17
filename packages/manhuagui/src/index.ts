import { load, type CheerioAPI } from "cheerio/slim";
import JSON5 from "json5";
import LZString from "lz-string";
import { options, status, chapterNumber, numericId, type Site, type Filter, type Manga, type MangaList, type Details, type Request, type Section } from "@archettu/manga-core";

export const WEBSITE = "https://www.manhuagui.com";
export const IMAGE_SERVERS = ["https://i.hamreus.com", "https://cf.hamreus.com", "https://us.hamreus.com"];
export const GENRES = options([["", "全部"], ["rexue", "热血"], ["maoxian", "冒险"], ["mohuan", "魔幻"], ["shengui", "神鬼"], ["gaoxiao", "搞笑"], ["mengxi", "萌系"], ["aiqing", "爱情"], ["kehuan", "科幻"], ["mofa", "魔法"], ["gedou", "格斗"], ["wuxia", "武侠"], ["jizhan", "机战"], ["zhanzheng", "战争"], ["jingji", "竞技"], ["tiyu", "体育"], ["xiaoyuan", "校园"], ["shenghuo", "生活"], ["lizhi", "励志"], ["lishi", "历史"], ["weiniang", "伪娘"], ["zhainan", "宅男"], ["funv", "腐女"], ["danmei", "耽美"], ["baihe", "百合"], ["hougong", "后宫"], ["zhiyu", "治愈"], ["meishi", "美食"], ["tuili", "推理"], ["xuanyi", "悬疑"], ["kongbu", "恐怖"], ["sige", "四格"], ["zhichang", "职场"], ["zhentan", "侦探"], ["shehui", "社会"], ["yinyue", "音乐"], ["wudao", "舞蹈"], ["zazhi", "杂志"], ["heidao", "黑道"]]);
export const FILTERS: Filter[] = [
  { id: "sort", title: "排序", options: options([["update", "最新更新"], ["index", "最新发布"], ["view", "人气最旺"], ["rate", "评分最高"]]) },
  { id: "region", title: "地区", options: options([["", "全部"], ["japan", "日本"], ["hongkong", "港台"], ["other", "其他"], ["europe", "欧美"], ["china", "内地"], ["korea", "韩国"]]) },
  { id: "genre", title: "题材", options: GENRES },
  { id: "audience", title: "读者群", options: options([["", "全部"], ["shaonv", "少女"], ["shaonian", "少年"], ["qingnian", "青年"], ["ertong", "儿童"], ["tongyong", "通用"]]) },
  { id: "year", title: "年份", options: [{ id: "", title: "全部" }, ...Array.from({ length: 17 }, (_, i) => ({ id: String(2026 - i), title: `${2026 - i}年` })), ...options([["200x", "00年代"], ["199x", "90年代"], ["198x", "80年代"], ["197x", "更早"]])] },
  { id: "letter", title: "首字母", options: [{ id: "", title: "全部" }, ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", title => ({ id: title.toLowerCase(), title })), { id: "0-9", title: "0-9" }] },
  { id: "status", title: "状态", options: options([["", "全部"], ["lianzai", "连载"], ["wanjie", "完结"]]) },
];
export const FEEDS = [
  { id: "home", title: "网站首页", directory: true }, { id: "latest", title: "最近更新" }, { id: "popular", title: "热门漫画" },
  { id: "all", title: "全部漫画" }, { id: "newest", title: "最新上架" }, { id: "top-rated", title: "评分最高" },
  { id: "ongoing", title: "连载漫画" }, { id: "completed", title: "完结漫画" },
  { id: "categories", title: "漫画索引", directory: true }, { id: "ranks", title: "排行榜", directory: true },
];
const absolute = (value = "") => value.startsWith("//") ? `https:${value}` : value.startsWith("/") ? `${WEBSITE}${value}` : value;
function item($: CheerioAPI, element: Parameters<CheerioAPI>[0]): Manga | undefined {
  const box = $(element), link = box.find('.book-detail dt a[href],.ell a[href]').first();
  const actual = link.length ? link : box.find('a[href^="/comic/"]').first();
  const id = actual.attr("href")?.match(/^\/comic\/(\d+)\/?$/)?.[1];
  if (!id) return;
  const image = box.find("img").first();
  return { id, title: actual.attr("title") || actual.text().trim() || image.attr("alt") || id,
    cover: absolute(image.attr("data-src") || image.attr("src")), author: box.find('a[href*="/author/"]').map((_, a) => $(a).text()).get().join("、"),
    description: box.find(".intro span,.tt").first().text().trim() };
}
export function parseList(html: string, page: number): MangaList {
  const $ = load(html);
  const selector = $(".book-result").length ? ".book-result > ul > li" : $("td.rank-title").length ? "td.rank-title" : "#contList > li";
  if (!$(".book-result,#contList,td.rank-title,.result-count").length) throw new Error("漫画柜未返回漫画列表，请检查网站访问提示。");
  const items = $(selector).map((_, element) => item($, element)).get().filter((value): value is Manga => Boolean(value));
  const next = $("span.current + a,.pager a.next").length > 0;
  return { items, last: selector === "td.rank-title" || !next };
}
export function parseDetails(html: string, id: string, adult = false): Details {
  const $ = load(html), title = $(".book-title h1").first().text().trim();
  if (!title) throw new Error("漫画柜未返回作品详情，请检查网站访问提示。");
  let chapterHtml = html;
  const hidden = $("#__VIEWSTATE").attr("value");
  if (hidden) {
    if (!adult) throw new Error("漫画柜要求确认成人提示，请在源设置中确认后重新加载。");
    chapterHtml = LZString.decompressFromBase64(hidden) || "";
  }
  const chaptersDoc = load(chapterHtml), chapters: Details["chapters"] = [];
  const groups = chaptersDoc('[id^="chapter-list-"]');
  const containers = groups.length ? groups.toArray() : chaptersDoc(".chapter-list").toArray();
  const seen = new Set<string>();
  for (const element of containers) {
    const container = chaptersDoc(element);
    const group = container.prevAll("h4,h3").first().text().trim() || "连载";
    const lists = container.find("ul").toArray();
    const links = (lists.length ? lists.reverse().flatMap(ul => chaptersDoc(ul).find("li > a").toArray()) : container.find("li > a").toArray()).reverse();
    for (const link of links) {
      const a = chaptersDoc(link), match = a.attr("href")?.match(/^\/comic\/(\d+)\/(\d+)\.html$/);
      if (!match || match[1] !== id || seen.has(match[2])) continue;
      seen.add(match[2]);
      const name = a.attr("title") || a.find("span").text().trim() || a.text().trim();
      chapters.push({ id: match[2], title: name, group, number: chapterNumber(name) });
    }
  }
  const tag = (selector: string) => $(selector).map((_, element) => $(element).text().trim()).get();
  const authors = tag('a[href*="/author/"]'), genres = tag('.detail-list a[href*="/list/"]');
  return { id, title, url: `${WEBSITE}/comic/${id}/`, cover: absolute($(".hcover img").attr("src")),
    description: $("#intro-all").text().trim(), author: [...new Set(authors)].join("、"), tags: [...new Set(genres)],
    status: status($(".detail-list .status,li.status").text()), chapters, mature: Boolean(hidden) };
}
function packedCode(html: string): string {
  if (/SMH\.imgData\s*\(/.test(html)) return html;
  const match = html.match(/}\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/s);
  if (!match) throw new Error("漫画柜章节脚本格式已变化，请更新源。");
  const payload = JSON5.parse(match[1]) as string, radix = Number(match[2]), count = Number(match[3]);
  const encoded = JSON5.parse(match[4]) as string;
  const tail = html.slice(match.index! + match[0].length);
  const words = (/^\s*\.split\(/.test(tail) ? encoded : LZString.decompressFromBase64(encoded) || "").split("|");
  const key = (n: number): string => (n < radix ? "" : key(Math.floor(n / radix))) + (n % radix > 35 ? String.fromCharCode(n % radix + 29) : (n % radix).toString(36));
  const table = new Map(Array.from({ length: count }, (_, n) => [key(n), words[n] || key(n)]));
  return payload.replace(/\b\w+\b/g, token => table.get(token) ?? token);
}
export function parsePages(html: string, server = IMAGE_SERVERS[0]): string[] {
  const code = packedCode(html), start = code.indexOf("{", code.indexOf("SMH.imgData"));
  let depth = 0, quote = "", end = -1;
  for (let i = start; i >= 0 && i < code.length; i++) {
    const c = code[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { end = i + 1; break; }
  }
  if (start < 0 || end < 0) throw new Error("漫画柜未返回章节图片数据。");
  const value = JSON5.parse(code.slice(start, end)) as { path: string; files: string[]; sl: { e: string | number; m: string } };
  if (!Array.isArray(value.files) || !value.files.length || !value.path || !value.sl) throw new Error("漫画柜章节图片不完整。");
  return value.files.map(file => `${server}${value.path}${file}?e=${encodeURIComponent(value.sl.e)}&m=${encodeURIComponent(value.sl.m)}`);
}
export class Manhuagui implements Site {
  readonly id = "manhuagui"; readonly name = "漫画柜"; readonly website = WEBSITE;
  readonly feeds = FEEDS; readonly filters = FILTERS;
  constructor(private readonly request: Request, private readonly setting: (key: string) => Promise<string> = async () => "") {}
  imageHeaders() { return { Referer: `${WEBSITE}/`, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" }; }
  private async get(path: string): Promise<string> {
    const headers: Record<string, string> = this.imageHeaders();
    if (await this.setting("adult") === "true") headers.Cookie = "isAdult=1";
    const response = await this.request(`${WEBSITE}${path}`, headers);
    if (response.status !== 200) throw new Error(`漫画柜请求失败（HTTP ${response.status}），请先在网站核对访问提示。`);
    return response.body;
  }
  async browse(key: string, page: number, filters: Record<string, string> = {}): Promise<MangaList> {
    const values = { ...filters };
    if (key.startsWith("filter:")) { const [, field, value] = key.split(":"); values[field] = value; }
    if (key === "completed" || key === "ongoing") values.status = key === "completed" ? "wanjie" : "lianzai";
    const parts = FILTERS.slice(1).map(filter => {
      const value = values[filter.id] || "";
      if (!filter.options.some(option => option.id === value)) throw new Error(`不支持的漫画柜${filter.title}。`);
      return value;
    }).filter(Boolean).join("_");
    if (key.startsWith("rank:")) {
      if (page > 1) return { items: [], last: true };
      const period = key.slice(5), suffix = period === "day" ? "" : period;
      return parseList(await this.get(`/rank/${parts ? parts + (suffix ? "_" + suffix : "") + ".html" : suffix ? suffix + ".html" : ""}`), page);
    }
    const sort = values.sort || (key === "popular" ? "view" : key === "newest" || key === "all" ? "index" : key === "top-rated" ? "rate" : "update");
    return parseList(await this.get(`/list/${parts ? parts + "/" : ""}${sort}_p${page}.html`), page);
  }
  async search(keyword: string, page: number, filters: Record<string, string> = {}): Promise<MangaList> {
    const sort = { update: "", view: "1", index: "2", rate: "3" }[filters.sort || "update"];
    return parseList(await this.get(`/s/${encodeURIComponent(keyword)}${sort ? "_o" + sort : ""}_p${page}.html`), page);
  }
  async directory(key: string): Promise<Section[]> {
    if (key === "categories") return FILTERS.slice(1).map(filter => ({ id: filter.id, title: filter.title,
      entries: filter.options.map(option => ({ id: `filter:${filter.id}:${option.id}`, title: option.title })) }));
    if (key === "ranks") return [{ id: "ranks", title: "排行榜", entries: options([["rank:day", "日排行"], ["rank:week", "周排行"], ["rank:month", "月排行"], ["rank:total", "总排行"]]) }];
    const $ = load(await this.get("/")), sections: Section[] = [];
    const cards = (selector: string) => $(selector).map((_, element) => item($, element)).get().filter((value): value is Manga => Boolean(value));
    sections.push({ id: "updates", title: "热门漫画最新更新", items: cards(".update-cont li") });
    $("#cmt-tab li").each((index, element) => {
      sections.push({ id: `home-tab-${index}`, title: $(element).text().trim(), items: cards(`#cmt-cont ul.cover-list:nth-of-type(${index + 1}) > li`) });
    });
    return sections;
  }
  async details(id: string): Promise<Details> { return parseDetails(await this.get(`/comic/${numericId(id)}/`), id, await this.setting("adult") === "true"); }
  async pages(id: string, chapter: string): Promise<string[]> {
    const server = await this.setting("imageServer");
    return parsePages(await this.get(`/comic/${numericId(id)}/${numericId(chapter)}.html`), IMAGE_SERVERS.includes(server) ? server : IMAGE_SERVERS[0]);
  }
}
