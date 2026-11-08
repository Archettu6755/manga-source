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
export const ADULT_TYPE = "H_MANGA";
export const COMIC_FIELDS = "id title description status imageUrl contentType sexualContent sexyLevel authors { id name } categories { id name }";
export interface Comic {
  id: string; title: string; description?: string; status: string; imageUrl: string;
  contentType?: string; sexualContent?: boolean; sexyLevel?: number;
  authors?: { id: string; name: string }[]; categories?: { id: string; name: string }[];
}
export interface ComicChapter { id: string; serial: string; type: string; size: number; dateCreated?: string }
export function matureComic(comic: Comic): boolean {
  return comic.contentType === ADULT_TYPE || (comic.sexualContent === true && (comic.sexyLevel ?? 0) >= 3);
}
export function otherWebsite(website: string): string {
  return komiicWebsite(website) === WEBSITE ? WEBSITES[1].id : WEBSITE;
}
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
export function imageKid(url: string, website: string): string | undefined {
  const prefix = `${komiicWebsite(website)}/api/image/`;
  if (!url.startsWith(prefix)) return undefined;
  const encoded = url.slice(prefix.length);
  if (!encoded || /[/?#]/.test(encoded)) return undefined;
  return decodeURIComponent(encoded);
}

export const TICKET_QUERY = "query getImageTicket($kid: String!) { getImageTicket(kid: $kid) { kid url ticket expiresAt } }";
export interface ImageTicket { url: string; ticket: string; expiresAt: number }
export function readTicket(value: unknown, kid: string, now = Date.now()): ImageTicket {
  const record = value as { kid?: unknown; url?: unknown; ticket?: unknown; expiresAt?: unknown } | null;
  if (record?.kid !== kid || typeof record.url !== "string" || typeof record.ticket !== "string" ||
      !/^https:\/\/(?:[a-z0-9-]+\.)*komiic\.(?:com|cc)\/[^\s#]+$/i.test(record.url) ||
      !/^[\x21-\x7e]+$/.test(record.ticket)) {
    throw new Error("Komiic 返回了无法验证的图片票据或图床地址。");
  }
  const expiresAt = typeof record.expiresAt === "string" ? Date.parse(record.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("Komiic 返回了已过期或无效的图片票据，请重新打开章节。");
  return { url: record.url, ticket: record.ticket, expiresAt };
}
export function ticketUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !message.includes("；") && /^(?:Komiic：)?cannot query field ["'`]?getImageTicket["'`]?\s+on type/i.test(message);
}
export class ImageTickets {
  private readonly tickets = new Map<string, ImageTicket>();
  private readonly pending = new Map<string, Promise<ImageTicket | null>>();
  private legacy = false;

  get(kid: string, load: () => Promise<unknown>): Promise<ImageTicket | null> {
    if (this.legacy) return Promise.resolve(null);
    const cached = this.tickets.get(kid);
    if (cached && cached.expiresAt - Date.now() > 5_000) return Promise.resolve(cached);
    const inFlight = this.pending.get(kid);
    if (inFlight) return inFlight;
    const request = load().then(value => {
      const ticket = readTicket(value, kid);
      this.tickets.delete(kid);
      if (this.tickets.size >= 64) this.tickets.delete(this.tickets.keys().next().value!);
      this.tickets.set(kid, ticket);
      return ticket;
    }).catch(error => {
      if (!ticketUnsupported(error)) throw error;
      this.legacy = true;
      return null;
    }).finally(() => this.pending.delete(kid));
    this.pending.set(kid, request);
    return request;
  }
}

export const HISTORY_QUERY = "query readComicHistory($pagination: Pagination!) { readComicHistory(pagination: $pagination) { comicId lastDate chapters { chapterId page updatedAt } } }";
export const POSITION_QUERY = "query readComicHistoryById($comicId: ID!) { readComicHistoryById(comicId: $comicId) { comicId lastDate chapters { chapterId page updatedAt } } }";
export const PROGRESS_MUTATION = "mutation addReadComicHistoryV2($comicId: ID!, $chapterId: ID!, $page: Int!) { addReadComicHistoryV2(comicId: $comicId, chapterId: $chapterId, page: $page) }";
export interface ComicHistory { comicId: string; lastDate?: string; chapters?: { chapterId: string; page: number; updatedAt?: string }[] }
export interface ReadingPosition { chapterId: string; page: number; timestamp: number }
export function historyPagination(page: number) {
  return { limit: 20, offset: (page - 1) * 20, orderBy: "DATE_UPDATED", asc: true };
}
export function readingPosition(history: ComicHistory | null | undefined): ReadingPosition | undefined {
  if (!Array.isArray(history?.chapters)) return undefined;
  let latest: ReadingPosition | undefined;
  for (const entry of history.chapters) {
    if (!entry?.chapterId || !Number.isInteger(entry.page) || entry.page < 0) continue;
    const timestamp = Date.parse(entry.updatedAt ?? history.lastDate ?? "");
    if (Number.isFinite(timestamp) && (!latest || timestamp >= latest.timestamp)) latest = { chapterId: entry.chapterId, page: entry.page, timestamp };
  }
  return latest;
}
export function historyComics(entries: ComicHistory[], comics: Comic[]): Comic[] {
  const byId = new Map(comics.map(comic => [comic.id, comic]));
  return [...new Set(entries.map(entry => entry.comicId))].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
}
export function sessionCookies(header: string | null): string {
  return Array.from((header ?? "").matchAll(/(?:^|[,\n]\s*)(komiic-[a-z-]+)=([^;,\s]+)/g), match => `${match[1]}=${match[2]}`).join("; ");
}
