import Base64 from "crypto-js/enc-base64";
import Utf8 from "crypto-js/enc-utf8";
import HmacSHA256 from "crypto-js/hmac-sha256";

export const WEBSITE = "https://www.mangacopy.com";
export const DEFAULT_API = "https://api.copy202601.com";
export const APP_VERSION = "3.0.9";
export const PAGE_SIZE = 30;
export const CHAPTER_PAGE_SIZE = 100;

export * from "./browse";

export function imageHeaders(now = new Date()): Record<string, string> {
  return {
    "User-Agent": `COPY/${APP_VERSION}`,
    source: "copyApp",
    referer: `com.copymanga.app-${APP_VERSION}`,
    version: APP_VERSION,
    platform: "3",
    dt: `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`,
  };
}

export interface DeviceInfo {
  deviceinfo: string;
  device: string;
  pseudoid: string;
}

export interface Tag {
  name: string;
  path_word: string;
}

export interface Comic {
  path_word: string;
  name: string;
  cover: string;
  author?: Tag[];
  theme?: Tag[];
  brief?: string;
  status?: { value: number; display: string };
}

export interface Details {
  comic: Comic;
  groups: Record<string, Tag>;
}

export interface ApiList<T> {
  list: T[];
  total: number;
  offset: number;
}

export interface ApiChapter {
  uuid: string;
  name: string;
  datetime_created?: string;
}

export interface ApiPages {
  chapter: { contents: { url: string }[]; words: number[] };
}

export function normalizeApi(value: string): string {
  const hostname = value.trim().replace(/^https:\/\//i, "").replace(/\/$/, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname)) {
    throw new Error("API 地址应为 HTTPS 域名，不能包含路径、端口或账号信息。");
  }
  return `https://${hostname.toLowerCase()}`;
}

export function isCopyApi(value: string): boolean {
  return /^https:\/\/api\.(?:copy[a-z0-9-]*|mangacopy|copymanga)\.(?:com|online|net|org|site)$/.test(value);
}

export function createDevice(): DeviceInfo {
  const random = (length: number, alphabet: string): string =>
    Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  const digits = "0123456789";
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return {
    deviceinfo: `${Math.floor(1_000_000 + Math.random() * 9_000_000)}V-${Math.floor(1_000 + Math.random() * 9_000)}`,
    device: `${random(2, letters)}${random(1, digits)}${random(1, letters)}.${random(6, digits)}.${random(3, digits)}`,
    pseudoid: random(16, `${letters}${letters.toLowerCase()}${digits}`),
  };
}

export function appHeaders(device: DeviceInfo, token = "", now = new Date()): Record<string, string> {
  const timestamp = Math.floor(now.getTime() / 1_000).toString();
  // Public request-signing parameter used by the Venera CopyManga adapter.
  const key = Base64.parse("M2FmMDg1OTAzMTEwMzJlZmUwNjYwNTUwYTA1NjNhNTM=");
  return {
    "User-Agent": `COPY/${APP_VERSION}`,
    source: "copyApp",
    ...device,
    dt: `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`,
    platform: "3",
    referer: `com.copymanga.app-${APP_VERSION}`,
    version: APP_VERSION,
    Accept: "application/json",
    region: "0",
    authorization: token ? `Token ${token}` : "Token",
    umstring: "b4c89ca4104ea9a97750314d791520ac",
    "x-auth-timestamp": timestamp,
    "x-auth-signature": HmacSHA256(timestamp, key).toString(),
  };
}

export function loginBody(username: string, password: string, salt: number): Record<string, string> {
  return {
    username,
    password: Base64.stringify(Utf8.parse(`${password}-${salt}`)),
    salt: String(salt),
    authorization: "Token ",
  };
}

export function readResults<T>(status: number, body: unknown): T {
  const payload = body as { code?: number; message?: string; results?: T & { detail?: string } } | null;
  const code = Number(payload?.code ?? status);
  const message = typeof payload?.message === "string" ? payload.message : payload?.results?.detail;
  if (status === 401 || code === 401) {
    throw new Error("CopyManga 登录已过期，请在源设置中重新登录。");
  }
  if (status === 210 || code === 210 || status === 429) {
    throw new Error(`CopyManga 请求受限（${code}）：${message || "请稍后重试，或在官方客户端查看限制提示。"}`);
  }
  if (status < 200 || status >= 300 || code !== 200) {
    throw new Error(`CopyManga 请求失败（HTTP ${status} / ${code}）${message ? `：${message}` : ""}`);
  }
  if (payload?.results == null) {
    throw new Error("CopyManga 未返回数据，可能需要在源设置中登录，或当前访问受限；请在官网核对后重试。");
  }
  if (typeof payload.results !== "object") {
    throw new Error("CopyManga 返回了无法识别的数据，请检查 API 地址或更新源。");
  }
  return payload.results;
}

export function readList<T>(value: ApiList<T>): ApiList<T> {
  if (!Array.isArray(value.list) || !Number.isInteger(value.total) || value.total < 0) {
    throw new Error("CopyManga 返回的列表格式已变化，请更新源。");
  }
  return value;
}

export function orderedPages(value: ApiPages): { url: string }[] {
  const chapter = value.chapter;
  if (!chapter || !Array.isArray(chapter.contents) || !Array.isArray(chapter.words) ||
      !chapter.contents.length || chapter.contents.length !== chapter.words.length) {
    throw new Error("CopyManga 未返回完整的章节图片，请检查访问限制后重试。");
  }
  const orders = new Set<number>();
  return chapter.contents.map((content, index) => {
    const order = chapter.words[index];
    if (!Number.isInteger(order) || order < 0 || orders.has(order) ||
        typeof content?.url !== "string" || !/^https:\/\//i.test(content.url)) {
      throw new Error("CopyManga 返回的图片顺序或地址无效，请更新源。");
    }
    orders.add(order);
    return { order, url: content.url };
  }).sort((a, b) => a.order - b.order).map(({ url }) => ({ url }));
}

export function chapterNumber(title: string): number {
  const match = title.match(/第\s*(\d+(?:\.\d+)?)\s*[话話章回]/) ??
    title.match(/^(?:[Cc]h(?:apter)?\.?\s*)?(\d+(?:\.\d+)?)(?:\s|$)/);
  return match ? Number(match[1]) : -1;
}

export function requireComic(comic: Comic | undefined): Comic {
  if (!comic || typeof comic.path_word !== "string" || !comic.path_word ||
      typeof comic.name !== "string" || !comic.name || typeof comic.cover !== "string") {
    throw new Error("CopyManga 返回的漫画信息格式已变化，请更新源。");
  }
  return comic;
}
