export interface Option { id: string; title: string }
export interface Filter { id: string; title: string; options: Option[] }
export interface Manga { id: string; title: string; cover?: string; author?: string; description?: string; tags?: string[] }
export interface Chapter { id: string; title: string; group: string; number: number; date?: number }
export interface Details extends Manga { url: string; chapters: Chapter[]; status: "ongoing" | "completed" | "unknown"; mature?: boolean }
export interface MangaList { items: Manga[]; last: boolean; total?: number }
export interface Section { id: string; title: string; items?: Manga[]; entries?: Option[] }
export interface Feed extends Option { directory?: boolean }
export interface Reply { status: number; body: string }
export type Request = (url: string, headers?: Record<string, string>, body?: string) => Promise<Reply>;
export interface Session { get(): Promise<string>; set(token: string): Promise<void>; clear(): Promise<void> }
export interface Site {
  id: string; name: string; website: string; feeds: Feed[]; filters: Filter[];
  imageHeaders(): Record<string, string>;
  browse(key: string, page: number, filters?: Record<string, string>): Promise<MangaList>;
  search(keyword: string, page: number, filters?: Record<string, string>): Promise<MangaList>;
  directory(key: string): Promise<Section[]>;
  details(id: string): Promise<Details>;
  pages(id: string, chapter: string): Promise<string[]>;
  login?(username: string, password: string): Promise<void>;
  logout?(): Promise<void>;
}
export const options = (pairs: [string, string][]): Option[] => pairs.map(([id, title]) => ({ id, title }));
export function query(values: Record<string, string | number>): string {
  return Object.entries(values).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}
export function chapterNumber(title: string): number {
  const value = title.match(/(?:第\s*)?(\d+(?:\.\d+)?)\s*[话話章回]/);
  return value ? Number(value[1]) : -1;
}
export function status(text: string): Details["status"] {
  return /完[结結]/.test(text) ? "completed" : /[连連][载載]/.test(text) ? "ongoing" : "unknown";
}
export function numericId(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error("漫画或章节 ID 无效。");
  return id;
}
