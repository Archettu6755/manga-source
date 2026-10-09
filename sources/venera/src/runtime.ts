export interface SourceStore {
  loadData(key: string): unknown;
  saveData(key: string, value: unknown): void;
  deleteData(key: string): void;
  loadSetting(key: string): unknown;
}
export interface Response { status: number; headers: Record<string, string | string[]>; body: string }
export interface ComicItem { id: string; title: string; cover: string; subtitle?: string; description?: string; tags?: string[]; language?: string }
export interface Details extends Omit<ComicItem, "id" | "tags"> {
  tags: Record<string, string[]>;
  chapters: Record<string, string>;
  url: string;
}
export interface ComicList { comics: ComicItem[]; maxPage: number }
export interface Target { page: "category"; attributes: { category: string; param: string } }
export interface Part { title: string; comics: ComicItem[]; viewMore?: Target }
export interface Option { label: string; options: string[]; type?: "select" | "multi-select" | "dropdown" }
export interface Explore {
  title: string;
  type: "multiPageComicList" | "multiPartPage";
  load: (page: number) => Promise<ComicList | Part[]>;
}
export interface Setting {
  title: string; type: "input" | "select" | "switch" | "callback";
  default?: string | boolean;
  options?: { value: string; text: string }[];
  validator?: string;
  buttonText?: string;
  callback?: () => Promise<void>;
}
export interface SourceConfig {
  name: string; key: string; version: string; minAppVersion: string; url: string;
  explore: Explore[];
  category: {
    title: string;
    parts: { name: string; type: "fixed"; categories: string[]; categoryParams: string[]; itemType: "category" }[];
    enableRankingPage?: boolean;
  };
  categoryComics: {
    load(category: string, param: string | null, options: string[], page: number): Promise<ComicList>;
    optionLoader?: (category: string, param: string | null) => Promise<Option[]>;
    ranking?: { options: string[]; load(option: string, page: number): Promise<ComicList> };
  };
  search: {
    load(keyword: string, options: string[], page: number): Promise<ComicList>;
    optionList?: Option[];
  };
  comic: {
    loadInfo(id: string): Promise<Details>;
    loadEp(id: string, chapter: string | null): Promise<{ images: string[] }>;
    onImageLoad?: (url: string, id: string, chapter: string) => { headers: Record<string, string> } | Promise<{ headers: Record<string, string> }>;
    onThumbnailLoad?: (url: string) => { headers: Record<string, string> };
    onClickTag?: (namespace: string, tag: string) => Target | null;
  };
  settings?: Record<string, Setting>;
  account?: { login(username: string, password: string): Promise<boolean>; logout(): void; registerWebsite: string };
}
declare global {
  const Network: {
    get(url: string, headers?: Record<string, string>): Promise<Response>;
    post(url: string, headers: Record<string, string>, data: string): Promise<Response>;
    deleteCookies(url: string): void;
  };
}
export const BASE = "https://archettu6755.github.io/manga-source/venera";
export function info(id: string, name: string) {
  return { name: `${name} · Archettu`, key: `archettu_${id}`, version: "1.0.0", minAppVersion: "1.6.3", url: `${BASE}/${id}.js` };
}
export function target(key: string, title = key): Target {
  return { page: "category", attributes: { category: title, param: key } };
}
export function category(title: string, entries: [string, string][]) {
  return { title, parts: [{ name: "漫画目录", type: "fixed" as const, itemType: "category" as const,
    categories: entries.map(entry => entry[1]), categoryParams: entries.map(entry => entry[0]) }] };
}
export function part(key: string, title: string): Part { return { title, comics: [], viewMore: target(key, title) }; }
export function choice(id: string, label: string): string { return `${encodeURIComponent(id).replace(/-/g, "%2D")}-${label}`; }
export function choiceId(value: string): string { return decodeURIComponent(value); }
export function pageNumber(page: number): number {
  if (!Number.isInteger(page) || page < 1) throw new Error("页码必须从 1 开始。");
  return page;
}
export function list(comics: ComicItem[], page: number, last: boolean, total?: number, size = 30): ComicList {
  pageNumber(page);
  return { comics, maxPage: total === undefined ? (last ? page : page + 1) : Math.max(1, Math.ceil(total / size)) };
}
export function params(values: Record<string, string | number | boolean>): string {
  return Object.entries(values).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}
export function json(response: Response): unknown {
  try { return JSON.parse(response.body); } catch { throw new Error(`接口未返回 JSON（HTTP ${response.status}），请检查网站访问提示。`); }
}
export function header(response: Response, name: string): string | null {
  const entry = Object.entries(response.headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? (Array.isArray(entry[1]) ? entry[1].join("\n") : entry[1]) : null;
}
export class Transport {
  private tail: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  constructor(private readonly interval: number) {}
  request(method: "GET" | "POST", url: string, headers: Record<string, string> = {}, body = ""): Promise<Response> {
    const job = this.tail.then(async () => {
      const wait = this.nextAt - Date.now();
      if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
      this.nextAt = Date.now() + this.interval;
      return method === "GET" ? Network.get(url, headers) : Network.post(url, headers, body);
    });
    this.tail = job.catch(() => undefined);
    return job;
  }
}
