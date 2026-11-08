import CryptoJS from "crypto-js";
import { httpError, SourceError } from "@archettu/manga-core";
import { category, header, info, json, list, pageNumber, params, Transport, type ComicItem, type ComicList, type SourceConfig, type SourceStore } from "./runtime";

const API = "https://www.cdnhjk.net";
const WEBSITE = "https://18comic.vip";
const CDN = "https://cdn-msp.jmapinodeudzn.net";
const APP_VERSION = "2.1.12";
const APP_KEY = "185Hcomic3PAPP7R";
const SIZE = 80;
const entries: [string, string][] = [["recommended", "首页推荐"]];
const imgHeaders = { Referer: `${WEBSITE}/` };
type Album = { id?: string | number; name?: string; author?: string | string[]; description?: string; tags?: string[];
  series?: { id: string | number; name?: string; sort?: number | string }[] };

function jmId(value: unknown): string {
  const id = String(value ?? "").replace(/^jm/i, "");
  if (!/^[1-9]\d{0,11}$/.test(id)) throw new Error("无效的 JMComic 编号。");
  return id;
}
function names(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}
function manga(value: Album, fallbackId?: string): ComicItem {
  const id = jmId(value.id ?? fallbackId);
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("JMComic 作品格式已变化。");
  return { id, title: value.name, cover: `${CDN}/media/albums/${id}_3x4.jpg`, subtitle: names(value.author).join("、"), tags: names(value.tags) };
}
function safeSession(value: unknown): string | undefined {
  return typeof value === "string" && /^[^\s;,\x00-\x1f\x7f]{1,512}$/.test(value) ? value : undefined;
}
function decodeReply(value: unknown, signature: string): unknown {
  const reply = value as { code?: string | number; data?: unknown } | null;
  const status = Number(reply?.code);
  if ([401, 402, 403, 429, 451].includes(status)) throw httpError(status, "JMComic");
  if (status !== 200 || reply?.data == null) throw new SourceError("JMComic 未返回有效数据，请在官网核对访问或登录状态。", "upstream");
  if (typeof reply.data !== "string") return reply.data;
  try {
    const key = CryptoJS.enc.Utf8.parse(signature);
    return JSON.parse(CryptoJS.AES.decrypt(reply.data, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8));
  } catch { throw new Error("JMComic 接口响应无法解码，请更新图源。"); }
}
function stripCount(chapter: number, filename: string, threshold: number): number {
  if (chapter < threshold || /\.gif$/i.test(filename)) return 0;
  if (chapter < 268850) return 10;
  const hash = CryptoJS.MD5(`${chapter}${filename.replace(/\.[^.]+$/, "")}`).toString();
  return 2 + 2 * (hash.charCodeAt(hash.length - 1) % (chapter < 421926 ? 10 : 8));
}
function restoreStrips(count: number): string {
  return `function modifyImage(image) {
    const bands = ${count};
    const step = Math.floor(image.height / bands);
    if (!step) return image;
    const output = Image.empty(image.width, image.height);
    let y = 0;
    for (let band = bands - 1; band >= 0; band--) {
      const height = band === bands - 1 ? image.height - step * band : step;
      output.fillImageRangeAt(0, y, image, 0, step * band, image.width, height);
      y += height;
    }
    return output;
  }`;
}

export function createSource(source: SourceStore): SourceConfig {
  const transport = new Transport(850);
  const scrambleIds = new Map<string, number>();
  async function api<T>(path: string, fields: Record<string, string | number>, login = false): Promise<T> {
    const stamp = Math.floor(Date.now() / 1000);
    const signature = CryptoJS.MD5(`${stamp}${APP_KEY}`).toString();
    const session = login ? undefined : safeSession(source.loadData("session"));
    const headers: Record<string, string> = { Accept: "application/json", token: signature, tokenparam: `${stamp},${APP_VERSION}` };
    if (session) headers.Cookie = `AVS=${session}`;
    if (login) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const response = await transport.request(login ? "POST" : "GET", `${API}/${path}${login ? "" : `?${params(fields)}`}`, headers, login ? params(fields) : "");
    if (response.status !== 200) throw httpError(response.status, "JMComic");
    if (/<title>Just a moment|cf-chl-widget|Restricted Access!/i.test(response.body.slice(0, 16_384)))
      throw new SourceError("JMComic 要求在官网验证访问，当前请求已停止。", "restricted");
    const value = decodeReply(json(response), signature) as T;
    if (login && typeof value === "object" && value !== null) {
      const session = safeSession((value as { s?: unknown }).s) ?? safeSession(header(response, "set-cookie")?.match(/(?:^|[,\n]\s*)AVS=([^;,\s]+)/i)?.[1]);
      if (!(value as { uid?: unknown }).uid || !session) throw new Error("JMComic 未返回有效登录会话。");
      source.saveData("session", session);
    }
    return value;
  }
  async function album(id: string) { return api<Album>("album", { id }); }
  async function recommended(page: number): Promise<ComicList> {
    pageNumber(page);
    if (page !== 1) return list([], page, true);
    const groups = await api<{ type?: string; content?: Album[] }[]>("promote", { page: 0 });
    if (!Array.isArray(groups)) throw new Error("JMComic 首页推荐格式已变化。");
    const comics = new Map<string, ComicItem>();
    for (const group of groups) {
      if (["library", "novels"].includes(group.type ?? "") || !Array.isArray(group.content)) continue;
      for (const album of group.content) { const item = manga(album); if (!comics.has(item.id)) comics.set(item.id, item); }
    }
    return list([...comics.values()], page, true);
  }
  async function browse(keyword: string, order: string, page: number): Promise<ComicList> {
    pageNumber(page);
    const data = await api<{ content: Album[]; total?: string | number; redirect_aid?: string | number }>("search", { main_tag: 0, search_query: keyword, page, o: order, t: "a" });
    if (data.redirect_aid) {
      const id = jmId(data.redirect_aid);
      return list(page === 1 ? [manga(await album(id), id)] : [], page, true, 1, SIZE);
    }
    if (!Array.isArray(data.content)) throw new Error("JMComic 列表格式已变化。");
    const total = Number(data.total);
    return list(data.content.map(item => manga(item)), page, data.content.length < SIZE, Number.isFinite(total) && total >= 0 ? total : undefined, SIZE);
  }
  return {
    ...info("jmcomic", "JMComic（成人）"), version: "1.0.0",
    category: category("JMComic", entries),
    explore: [{ title: "JMComic · 首页推荐", type: "multiPageComicList", load: recommended }],
    categoryComics: { load: (_name, _key, _options, page) => recommended(page) },
    search: { load: (keyword, _options, page) => keyword.trim() ? browse(keyword.trim(), "mr", page) : recommended(page) },
    comic: {
      loadInfo: async raw => {
        const id = jmId(raw);
        const value = await album(id), item = manga(value, id);
        if (item.id !== id) throw new Error("JMComic 返回了不同的作品编号。");
        if (value.series != null && !Array.isArray(value.series)) throw new Error("JMComic 目录格式已变化。");
        const chapters = Object.fromEntries((value.series ?? []).slice().sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
          .map((chapter, index) => [`ep:${jmId(chapter.id)}`, chapter.name?.trim() || `第 ${Number(chapter.sort) || index + 1} 话`]));
        if (!Object.keys(chapters).length) chapters[`ep:${id}`] = "第 1 话";
        return { title: item.title, cover: item.cover, subtitle: item.subtitle, description: value.description,
          tags: { 作者: names(value.author), 题材: names(value.tags), 分级: ["成人内容"] }, chapters, url: `${WEBSITE}/album/${id}` };
      },
      loadEp: async (raw, chapter) => {
        const id = jmId(chapter?.replace(/^ep:/, "") ?? raw);
        const data = await api<{ id?: string | number; images?: string[]; scramble_id?: string | number }>("chapter", { id });
        if (data.id != null && jmId(data.id) !== id) throw new Error("JMComic 返回了不同的章节编号。");
        if (!Array.isArray(data.images) || !data.images.length || data.images.some(name => !/^[\w-]+\.(?:jpe?g|png|webp|gif|avif)$/i.test(name)))
          throw new Error("JMComic 未返回有效的章节图片地址。");
        const threshold = Number(data.scramble_id);
        if (scrambleIds.size >= 64) scrambleIds.delete(scrambleIds.keys().next().value!);
        scrambleIds.set(id, Number.isInteger(threshold) && threshold > 0 ? threshold : 220980);
        return { images: data.images.map(name => `${CDN}/media/photos/${id}/${name}`) };
      },
      onImageLoad: (url, _raw, chapter) => {
        const id = jmId(chapter.replace(/^ep:/, ""));
        const prefix = `${CDN}/media/photos/${id}/`;
        if (!url.startsWith(prefix) || !/^[\w-]+\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.slice(prefix.length)))
          throw new Error("JMComic 图片地址不属于当前章节。");
        const count = stripCount(Number(id), url.slice(prefix.length), scrambleIds.get(id) ?? 220980);
        return { headers: imgHeaders, ...(count ? { modifyImage: restoreStrips(count) } : {}) };
      },
      onThumbnailLoad: () => ({ headers: imgHeaders }),
    },
    account: {
      login: async (username, password) => { await api("login", { username, password }, true); return true; },
      logout: () => { source.deleteData("session"); Network.deleteCookies(API); },
      registerWebsite: `${WEBSITE}/signup`,
    },
  };
}
