import { load } from "cheerio/slim";
import { httpError, SourceError } from "@archettu/manga-core";
import { category, comicLink, info, json, list, pageNumber, params, Transport, type ComicItem, type ComicList, type SourceConfig } from "./runtime";

const WEBSITE = "https://e-hentai.org";
const FORUM = "https://forums.e-hentai.org";
const API = "https://api.e-hentai.org/api.php";
const accountCookies = ["ipb_member_id", "ipb_pass_hash"];
const webHeaders = { Referer: `${WEBSITE}/`, Accept: "text/html" };
const cdn = /^https:\/\/(?:[a-z0-9-]+\.)*(?:hath\.network|ehgt\.org|e-hentai\.org)(?::\d{1,5})?\/[^\s#]+$/i;
const types = ["Misc", "Doujinshi", "Manga", "Artist CG", "Game CG", "Image Set", "Cosplay", "Asian Porn", "Non-H", "Western"];
const languages = [["chinese", "中文"], ["english", "英文"], ["japanese", "日文"]];
const feeds: [string, string][] = [["latest", "最近更新"], ["popular", "热门"],
  ...types.map((title, index): [string, string] => [`type:${index}`, title]),
  ...languages.map(([id, title]): [string, string] => [`language:${id}`, title])];
type Gallery = { gid: number | string; token: string; title: string; title_jpn?: string; thumb?: string; uploader?: string;
  category?: string; tags?: string[]; filecount: string | number; error?: string };

function galleryId(id: string) {
  const match = /^([1-9]\d{0,11})-([a-f\d]{10})$/i.exec(id);
  if (!match) throw new Error("无效的 E-Hentai 作品编号。");
  return { gid: match[1], token: match[2].toLowerCase() };
}
function galleryHref(id: string): string {
  const { gid, token } = galleryId(id);
  return `${WEBSITE}/g/${gid}/${token}/`;
}
const galleryPath = /^\/g\/([1-9]\d{0,11})\/([a-f\d]{10})\/?(?:[?#]|$)/i;
function galleryFromPath(path: string): string | undefined {
  const match = galleryPath.exec(path);
  return match ? `${match[1]}-${match[2].toLowerCase()}` : undefined;
}
const publicLink = comicLink([WEBSITE.slice(8)], galleryFromPath);
function galleryFromUrl(url: string): string | undefined {
  return url.startsWith("/") ? galleryFromPath(url) : publicLink.linkToId(url) ?? undefined;
}
function searchParams(keyword: string, [selection, rating, language]: string[]): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  if (selection) {
    let value: unknown;
    try { value = JSON.parse(selection); }
    catch { throw new Error("E-Hentai 分类选项无效。"); }
    const selected = Array.isArray(value) ? value : [value];
    if (selected.some(value => !/^[0-9]$/.test(String(value)))) throw new Error("E-Hentai 分类选项无效。");
    if (selected.length) values.f_cats = 1023 ^ selected.reduce((mask, value) => mask | (1 << Number(value)), 0);
  }
  if (rating && /^[2-5]$/.test(rating)) Object.assign(values, { advsearch: 1, f_sr: "on", f_srdd: rating });
  if (languages.some(([id]) => id === language) && !/\blanguage:/i.test(keyword)) keyword = `${keyword} language:${language}`.trim();
  if (keyword) values.f_search = keyword;
  return values;
}
function pageNumberFromUrl(url: string, gid: string): number | undefined {
  const match = /^(?:https:\/\/e-hentai\.org)?\/s\/[a-f\d]{10}\/([1-9]\d{0,11})-([1-9]\d{0,4})\/?$/i.exec(url);
  return match?.[1] === gid ? Number(match[2]) : undefined;
}
function safeCdn(url: unknown): string {
  return typeof url === "string" && cdn.test(url) ? url : "";
}
function viewerUrl(url: string): string {
  return url.startsWith("/") ? `${WEBSITE}${url}` : url;
}
function restriction(html: string) {
  const text = html.slice(0, 32_768);
  if (/gallery has been flagged as offensive|<title>\s*Content Warning/i.test(text))
    throw new SourceError("E-Hentai 要求在官网确认内容提示后再阅读。", "restricted");
  if (/IP address has been temporarily banned|<title>\s*(?:Just a moment|Access Denied)|cf-chl-widget|image viewing limit/i.test(text))
    throw new SourceError("E-Hentai 限制了当前访问，请在官网核对登录、额度或验证提示。", "restricted");
}

export function createSource(): SourceConfig {
  const transport = new Transport(1_000);
  const cursors = new Map<string, Map<number, string>>();
  const galleries = new Map<string, Gallery>();
  async function html(url: string, referer = `${WEBSITE}/`) {
    const response = await transport.request("GET", url, { ...webHeaders, Referer: referer });
    if (response.status !== 200) throw httpError(response.status, "E-Hentai");
    restriction(response.body);
    return load(response.body);
  }
  async function gallery(id: string): Promise<Gallery> {
    const { gid, token } = galleryId(id);
    const cached = galleries.get(id);
    if (cached) return cached;
    const response = await transport.request("POST", API, { "Content-Type": "application/json", Referer: `${WEBSITE}/` },
      JSON.stringify({ method: "gdata", gidlist: [[Number(gid), token]], namespace: 1 }));
    if (response.status !== 200) throw httpError(response.status, "E-Hentai");
    restriction(response.body);
    const item = (json(response) as { gmetadata?: Gallery[] })?.gmetadata?.[0];
    if (item?.error) throw new Error("E-Hentai 未提供该作品的资料，请在官网核对访问状态。");
    if (!item?.title || String(item.gid) !== gid || item.token?.toLowerCase() !== token) throw new Error("E-Hentai 作品资料格式已变化。");
    if (galleries.size >= 32) galleries.delete(galleries.keys().next().value!);
    galleries.set(id, item);
    return item;
  }
  function item(id: string, record: Gallery): ComicItem {
    return { id, title: record.title_jpn || record.title, cover: safeCdn(record.thumb), subtitle: record.uploader, tags: record.tags };
  }
  async function browse(first: string, page: number): Promise<ComicList> {
    pageNumber(page);
    if (page === 1) {
      if (cursors.size >= 12) cursors.delete(cursors.keys().next().value!);
      cursors.set(first, new Map([[1, first]]));
    }
    const pages = cursors.get(first);
    const url = pages?.get(page);
    if (!pages || !url) throw new Error("E-Hentai 使用游标翻页，请从第一页开始浏览。");
    const $ = await html(url);
    const comics = new Map<string, ComicItem>();
    $(".itg a[href*='/g/']").each((_index, link) => {
      const anchor = $(link);
      const id = galleryFromUrl(anchor.attr("href") ?? "");
      const title = anchor.find(".glink").first().text().trim() || (anchor.hasClass("glink") ? anchor.text().trim() : "");
      if (!id || !title || comics.has(id)) return;
      const card = anchor.closest("tr,.gl1t,.gl1e,.gl1c");
      const image = card.find(".glthumb img,.gl1e img,.gl3c img,img").first();
      const cover = safeCdn(image.attr("data-src")) || safeCdn(image.attr("src"));
      comics.set(id, { id, title, cover });
    });
    if (!comics.size && !/no hits found/i.test($("body").text())) throw new Error("E-Hentai 未返回可识别的作品列表，请在官网核对访问状态。");
    const next = viewerUrl($("#unext").attr("href") ?? "");
    const hasMore = next.startsWith(`${WEBSITE}/?`) && /[?&]next=[1-9]\d*(?:&|$)/.test(next) &&
      ![...pages].some(([index, visited]) => index <= page && visited === next);
    if (hasMore) pages.set(page + 1, next);
    return list([...comics.values()], page, !hasMore);
  }
  function feed(key: string, page: number): Promise<ComicList> {
    if (key === "popular") return browse(`${WEBSITE}/popular`, page);
    const type = /^type:([0-9])$/.exec(key);
    if (type) return browse(`${WEBSITE}/?f_cats=${1023 ^ (1 << Number(type[1]))}`, page);
    return browse(key.startsWith("language:") ? `${WEBSITE}/?${params({ f_search: key })}` : `${WEBSITE}/`, page);
  }
  return {
    ...info("ehentai", "E-Hentai", "1.2.5"),
    category: category("E-Hentai", feeds),
    explore: feeds.slice(0, 2).map(([key, title]) => ({ title: `E-Hentai · ${title}`, type: "multiPageComicList", load: page => feed(key, page) })),
    categoryComics: { load: (_name, key, _options, page) => feed(key ?? "latest", page) },
    search: {
      optionList: [
        { label: "分类", type: "multi-select", options: types.map((title, index) => `${index}-${title}`), default: types.map((_title, index) => String(index)) },
        { label: "最低评分", type: "dropdown", options: ["-不限", "2-2", "3-3", "4-4", "5-5"] },
        { label: "语言", type: "dropdown", options: ["-不限", ...languages.map(([id, title]) => `${id}-${title}`)] },
      ],
      async load(keyword, options, page) {
        pageNumber(page);
        const exact = galleryFromUrl(keyword.trim());
        if (exact) return list(page === 1 ? [item(exact, await gallery(exact))] : [], page, true);
        const query = params(searchParams(keyword.trim(), options ?? []));
        return browse(`${WEBSITE}/${query ? `?${query}` : ""}`, page);
      },
    },
    comic: {
      loadInfo: async id => {
        const record = await gallery(id), entry = item(id, record);
        const tags: Record<string, string[]> = Object.create(null);
        for (const tag of record.tags ?? []) {
          const split = tag.indexOf(":");
          const namespace = split > 0 ? tag.slice(0, split) : "标签";
          (tags[namespace] ??= []).push(split > 0 ? tag.slice(split + 1) : tag);
        }
        tags.分级 = ["成人内容"];
        return { title: entry.title, cover: entry.cover, subtitle: entry.subtitle, tags, chapters: { "ep:gallery": `画廊 · ${record.filecount}P` }, url: galleryHref(id) };
      },
      loadEp: async (id, chapter) => {
        if (chapter && chapter !== "ep:gallery") throw new Error("无效的 E-Hentai 画廊章节。");
        const { gid } = galleryId(id);
        const url = galleryHref(id), count = Number((await gallery(id)).filecount);
        if (!Number.isInteger(count) || count < 1 || count > 4_096) throw new Error("E-Hentai 返回了无效的画廊图片数量。");
        const pages = new Map<number, string>();
        for (let index = 0; pages.size < count && index < 128; index++) {
          const $ = await html(index === 0 ? url : `${url}?p=${index}`, url);
          const before = pages.size;
          $("#gdt a[href*='/s/']").each((_i, link) => {
            const href = $(link).attr("href") ?? "";
            const page = pageNumberFromUrl(href, gid);
            if (page !== undefined && page <= count) pages.set(page, viewerUrl(href));
          });
          if (pages.size === before) throw new Error("E-Hentai 画廊分页不完整，请在官网核对访问状态。");
        }
        if (pages.size !== count) throw new Error("E-Hentai 未返回完整的画廊目录。");
        return { images: [...pages.entries()].sort(([a], [b]) => a - b).map(([, url]) => url) };
      },
      onImageLoad: async (url, id) => {
        if (!pageNumberFromUrl(url, galleryId(id).gid)) throw new Error("E-Hentai 图片页不属于当前画廊。");
        const $ = await html(viewerUrl(url), galleryHref(id));
        const image = safeCdn($("#img").attr("src"));
        if (!image) throw new Error("E-Hentai 未提供可用的 HTTPS 图片地址，请在官网核对访问或图片额度。");
        return { url: image, headers: { Referer: viewerUrl(url) } };
      },
      onThumbnailLoad: () => ({ headers: { Referer: `${WEBSITE}/` } }),
      link: publicLink,
    },
    account: {
      loginWithWebview: {
        url: `${FORUM}/index.php?act=Login&CODE=00`,
        checkStatus: (url, title) => url.startsWith(`${FORUM}/`) && title.trim() === "E-Hentai Forums",
        onLoginSuccess: async () => {
          const cookies = (await Network.getCookies(FORUM)).filter(cookie => accountCookies.includes(cookie.name) && Boolean(cookie.value));
          if (!accountCookies.every(name => cookies.some(cookie => cookie.name === name))) throw new Error("未取得 E-Hentai 登录会话，请在官网确认登录状态。");
          Network.setCookies(WEBSITE, cookies.map(cookie => ({ ...cookie, domain: ".e-hentai.org", path: "/", secure: true })));
        },
      },
      logout: () => { galleries.clear(); cursors.clear(); Network.deleteCookies(WEBSITE); Network.deleteCookies(FORUM); },
      registerWebsite: `${FORUM}/index.php?act=Reg&CODE=00`,
    },
  };
}
