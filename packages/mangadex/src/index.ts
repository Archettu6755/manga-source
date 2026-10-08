export const API = "https://api.mangadex.org";
export const WEBSITE = "https://mangadex.org";
export type Language = "en" | "ja";
export interface Relationship { id: string; type: string; attributes?: { fileName?: string; name?: string } }
export interface Manga {
  id: string; relationships: Relationship[];
  attributes: { originalLanguage: string; title: Record<string, string>; description?: Record<string, string>;
    status?: string; contentRating?: string; availableTranslatedLanguages?: string[];
    tags?: { id: string; attributes: { name: Record<string, string> } }[] };
}
export interface MangaChapter {
  id: string; relationships: Relationship[];
  attributes: { translatedLanguage: string; chapter: string | null; volume?: string | null;
    title?: string | null; publishAt?: string; pages: number; externalUrl?: string | null; isUnavailable?: boolean };
}
export interface Collection<T> { data: T[]; total: number; offset: number; limit: number }
export function query(params: [string, string | number][]): string {
  return params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}
export function localized(values: Record<string, string> | undefined, language: Language): string {
  return values?.[language] || values?.en || values?.ja || Object.values(values ?? {}).find(Boolean) || "";
}
export function requireJapanese(manga: Manga): Manga {
  if (!manga?.id || !manga.attributes?.title) throw new Error("MangaDex 作品不存在或数据格式已变化。");
  if (manga.attributes.originalLanguage !== "ja") throw new Error("此源仅收录原始语言为日语的日本漫画。");
  return manga;
}
export function readable(chapter: MangaChapter, language: Language): boolean {
  return chapter.attributes?.translatedLanguage === language && chapter.attributes.pages > 0 &&
    !chapter.attributes.externalUrl && !chapter.attributes.isUnavailable &&
    (!chapter.attributes.publishAt || new Date(chapter.attributes.publishAt).getTime() <= Date.now());
}
export function readReply<T>(status: number, body: unknown): T {
  if (status === 429) throw new Error("MangaDex 请求过于频繁，请稍后重试。");
  if (status !== 200) throw new Error(`MangaDex 请求失败（HTTP ${status}），请稍后重试。`);
  const reply = body as { result?: string; errors?: { detail?: string }[] } | null;
  if (reply?.result !== "ok") throw new Error(`MangaDex：${reply?.errors?.map(error => error.detail).join("；") || "接口数据格式已变化"}`);
  return body as T;
}
export function readCollection<T>(data: Collection<T>): Collection<T> {
  if (!Array.isArray(data.data) || !Number.isInteger(data.total) || data.total < 0 || !Number.isInteger(data.offset) || data.offset < 0) {
    throw new Error("MangaDex 分页数据格式已变化。");
  }
  return data;
}
export function chapterNumber(value: string | null | undefined): number {
  return value?.trim() && Number.isFinite(Number(value)) ? Number(value) : -1;
}
export function cover(manga: Manga): string | undefined {
  const file = manga.relationships?.find(entry => entry.type === "cover_art")?.attributes?.fileName;
  return file ? `https://uploads.mangadex.org/covers/${encodeURIComponent(manga.id)}/${encodeURIComponent(file)}.256.jpg` : undefined;
}
export function pageUrls(reply: { baseUrl: string; chapter: { hash: string; data: string[]; dataSaver: string[] } }, saver: boolean): string[] {
  const files = saver ? reply.chapter?.dataSaver : reply.chapter?.data;
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(reply.baseUrl) || !reply.chapter?.hash || !Array.isArray(files) || !files.length || files.some(file => !file)) {
    throw new Error("MangaDex 未返回有效的图片服务器或章节图片。");
  }
  return files.map(file => `${reply.baseUrl.replace(/\/$/, "")}/${saver ? "data-saver" : "data"}/${encodeURIComponent(reply.chapter.hash)}/${encodeURIComponent(file)}`);
}
