import { httpError } from "@archettu/manga-core";

export const WEBSITE = "https://komiic.com";
export const WEBSITES = [
  { id: WEBSITE, title: "komiic.com（原入口）" },
  { id: "https://komiic.cc", title: "komiic.cc（大陆入口）" },
];
export function komiicWebsite(value: unknown): string {
  if (value === undefined || value === null || value === "") return WEBSITE;
  if (!WEBSITES.some(site => site.id === value)) throw new Error("请选择 Komiic 提供的访问入口。");
  return String(value);
}
export function komiicUrl(url: string, website = WEBSITE): string {
  const host = komiicWebsite(website).slice(8);
  return url.replace(/^https:\/\/((?:[a-z0-9-]+\.)*)komiic\.(?:com|cc)(?=[/?#]|$)/i, (_match, prefix: string) => `https://${prefix}${host}`);
}
export const PAGE_SIZE = 30;
export const COMIC_FIELDS = "id title description status imageUrl authors { id name } categories { id name }";
export interface Comic {
  id: string; title: string; description?: string; status: string; imageUrl: string;
  authors?: { id: string; name: string }[]; categories?: { id: string; name: string }[];
}
export interface ComicChapter { id: string; serial: string; type: string; size: number; dateCreated?: string }
export function readData<T>(status: number, body: unknown): T {
  if (status !== 200) throw httpError(status, "Komiic");
  const reply = body as { data?: T; errors?: { message?: string }[] } | null;
  if (reply?.errors?.length) throw new Error(`Komiic：${reply.errors.map(error => error.message || "接口错误").join("；")}`);
  if (!reply?.data) throw new Error("Komiic 返回了空数据，请更新源或稍后重试。");
  return reply.data;
}
export function requireComic(comic: Comic | undefined): Comic {
  if (!comic?.id || !comic.title || !comic.imageUrl) throw new Error("Komiic 作品不存在或数据格式已变化。");
  return comic;
}
export function numericSerial(serial: string | null | undefined): number {
  return serial?.trim() && Number.isFinite(Number(serial)) ? Number(serial) : -1;
}
export function imagePages(images: { kid: string }[], website = WEBSITE) {
  if (!Array.isArray(images) || !images.length || images.some(image => !image.kid)) throw new Error("Komiic 未返回章节图片。");
  return images.map(image => `${komiicWebsite(website)}/api/image/${encodeURIComponent(image.kid)}`);
}
export function sessionCookies(header: string | null): string {
  return Array.from((header ?? "").matchAll(/(?:^|[,\n]\s*)(komiic-[a-z-]+)=([^;,\s]+)/g), match => `${match[1]}=${match[2]}`).join("; ");
}
