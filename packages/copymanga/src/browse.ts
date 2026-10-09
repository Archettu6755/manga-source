import { load, type CheerioAPI } from "cheerio/slim";
import JSON5 from "json5";
import { WEBSITE, COPY_WEBSITES, type ApiList, type Comic, type Tag } from "./index";

export const WEB_PAGE_SIZE = 50;
export const RECOMMEND_PAGE_SIZE = 60;
export const TOPIC_PAGE_SIZE = 6;
export const RANK_PERIODS = [
  { id: "day", title: "日榜" }, { id: "week", title: "周榜" },
  { id: "month", title: "月榜" }, { id: "total", title: "总榜" },
];
export const REGIONS = [{ id: "", title: "全部" }, { id: "0", title: "日漫" }, { id: "1", title: "韩漫" }, { id: "2", title: "美漫" }];
export const STATUSES = [{ id: "", title: "全部" }, { id: "0", title: "连载中" }, { id: "1", title: "已完结" }, { id: "2", title: "短篇" }];
export interface Topic { id: string; title: string; cover?: string; summary?: string }
export interface BrowseTheme extends Tag { count: number }
export interface HomeSection { id: string; title: string; comics: Comic[]; list?: string; topics?: Topic[] }

function pathId(href: string | undefined, kind: "comic" | "topic"): string | undefined {
  const origin = COPY_WEBSITES.find(entry => href?.startsWith(`${entry.url}/`));
  const path = origin ? href!.slice(origin.url.length) : href;
  const match = path?.match(new RegExp(`^/${kind}/([^/?#]+)/?$`));
  return match ? decodeURIComponent(match[1]) : undefined;
}
function imageUrl(value: string | undefined): string | undefined {
  return value?.startsWith("https://") ? value : value?.startsWith("//") ? `https:${value}` : undefined;
}
function cards($: CheerioAPI, selector: string): Comic[] {
  const entries = new Map<string, Comic>();
  $(selector).find('a[href]').each((_, element) => {
    const link = $(element);
    const id = pathId(link.attr("href"), "comic");
    if (!id) return;
    const box = link.closest(".exemptComic_Item, .specialDetailItem, .ranking-all-box, .col-auto, .carousel-item, .comicRank-yi");
    const scope = box.length ? box : link.parent();
    const image = scope.find("img").first();
    const title = link.text().trim() || scope.find(".twoLines, .edit-txt, .specialDetailItemHeaderContentName").first().text().trim() || image.attr("alt")?.trim();
    const previous = entries.get(id);
    const cover = imageUrl(image.attr("data-src") || image.attr("src"));
    entries.set(id, { path_word: id, name: previous?.name && previous.name !== id ? previous.name : title || id,
      cover: previous?.cover || cover || "", author: previous?.author });
  });
  return [...entries.values()].map(entry => ({ ...entry, cover: entry.cover || `${WEBSITE}/favicon.ico` }));
}

export function parseLiteral(text: string): unknown {
  // Preserve quoted titles while translating the website's Python literals.
  const normalized = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:None|True|False)\b/g,
    token => ({ None: "null", True: "true", False: "false" }[token] ?? token));
  try { return JSON5.parse(normalized); } catch { throw new Error("CopyManga 网页列表数据格式已变化，请更新源。"); }
}
export function parseComicList(html: string, offset: number): ApiList<Comic> {
  const $ = load(html);
  const payload = $(".exemptComic-box[list]");
  if (!payload.length) throw new Error("CopyManga 网页未返回漫画列表，请检查访问提示或更新源。");
  const list = parseLiteral(payload.attr("list") ?? "") as Comic[];
  const total = Number(payload.attr("total"));
  if (!Array.isArray(list) || !Number.isInteger(total) || total < 0) throw new Error("CopyManga 网页分页格式已变化。");
  return { list, total, offset };
}
export function parseCardList(html: string, offset: number, limit: number): { list: Comic[]; isLastPage: boolean } {
  const $ = load(html);
  if (!$("main").length) throw new Error("CopyManga 网页未返回浏览内容，请检查访问提示。");
  if (!$("main .correlationList, main.specialDetail, main .ranking-all").length) throw new Error("CopyManga 网页未返回浏览列表，请更新源。");
  const list = cards($, "main .correlationList, main.specialDetail, main .ranking-all");
  return { list, isLastPage: lastPage($, offset, limit) };
}
function lastPage($: CheerioAPI, offset: number, limit: number): boolean {
  if (!$(".page-all").length) return true;
  const totalPages = Number($(".page-total").text().match(/\/(\d+)/)?.[1]);
  if (!Number.isInteger(totalPages) || totalPages < 1) throw new Error("CopyManga 网页分页格式已变化。");
  return Math.floor(offset / limit) + 1 >= totalPages;
}
export function parseTopics(html: string, offset: number): { list: Topic[]; isLastPage: boolean } {
  const $ = load(html);
  if (!$("main").length) throw new Error("CopyManga 网页未返回专题内容，请检查访问提示。");
  const list: Topic[] = [];
  $(".specialContent.comic").each((_, element) => {
    const box = $(element);
    const id = pathId(box.find('a[href^="/topic/"]').first().attr("href"), "topic");
    const title = box.find(".specialContentImageSpan").text().trim();
    if (!id || !title) throw new Error("CopyManga 专题数据格式已变化。");
    list.push({ id, title, cover: imageUrl(box.find("img").attr("data-src")), summary: box.find(".specialContentTextContent").text().trim() });
  });
  return { list, isLastPage: lastPage($, offset, TOPIC_PAGE_SIZE) };
}
export function parseThemes(html: string): BrowseTheme[] {
  const $ = load(html);
  const themes = new Map<string, BrowseTheme>();
  $('#all a[href^="/comics?theme="], #all a[disabled]').each((_, element) => {
    const link = $(element);
    const id = link.attr("href")?.match(/[?&]theme=([^&#]+)/)?.[1];
    const name = link.clone().children().remove().end().text().trim();
    const count = Number(link.find("span").text().match(/\d+/)?.[0] ?? 0);
    const key = id ? decodeURIComponent(id) : `empty:${name}`;
    if (name) themes.set(key, { path_word: key, name, count });
  });
  if (!themes.size) throw new Error("CopyManga 未返回题材分类，请更新源或检查访问提示。");
  return [...themes.values()];
}
export function parseHome(html: string): HomeSection[] {
  const $ = load(html);
  if (!$("main").length) throw new Error("CopyManga 网页未返回首页内容，请检查访问提示。");
  const sections: HomeSection[] = [{ id: "banners", title: "首页推荐", comics: cards($, ".swiperList") }];
  $("h4.index-all-icon-left-txt").each((index, heading) => {
    const box = $(heading).closest(".container");
    if (box.hasClass("comicRank")) return;
    const href = box.find("a.index-all-icon-right-txt").attr("href");
    const list = href === "/recommend" ? "recommend" : href === "/newest" ? "newest" : href === "/comics" ? "all" : undefined;
    sections.push({ id: `home-${index}`, title: $(heading).text().trim(), comics: cards(load($.html(box)), ".container"), list });
  });
  const topics: Topic[] = [];
  $('.special').each((_, element) => {
    const link = $(element).closest('a[href^="/topic/"]');
    const id = pathId(link.attr("href"), "topic");
    const box = link.closest(".container");
    if (id) topics.push({ id, title: box.find(".special-text-h4").text().trim() || id,
      cover: imageUrl(box.find("img").attr("data-src")) });
  });
  if (topics.length) sections.push({ id: "home-topics", title: "首页专题", comics: [], topics, list: "topics" });
  return sections;
}
