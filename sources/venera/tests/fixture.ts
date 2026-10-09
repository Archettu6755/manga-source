import vm from "node:vm";
import type { Response, SourceConfig, SourceStore } from "../src/runtime";
const { bundle }: { bundle(id: string): string } = require("../scripts/bundle.cjs");
export interface Call { method: string; url: string; headers: Record<string, string>; body?: string }
export type Handler = (call: Call) => Partial<Response> | Promise<Partial<Response>>;
const scripts = new Map<string, string>();
export function scriptFor(id: string): string {
  if (!scripts.has(id)) scripts.set(id, bundle(id));
  return scripts.get(id)!;
}
export function fixture(id: string, handler: Handler = () => { throw new Error("Unexpected network request"); }, settings: Record<string, unknown> = {}, initial: Record<string, unknown> = {}) {
  const calls: Call[] = [], delays: number[] = [];
  const data = new Map(Object.entries(initial));
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  class Source implements SourceStore {
    key?: string;
    private registered() { if (!this.key) throw new Error("Storage accessed before source registration"); }
    loadData(key: string) { this.registered(); return data.get(key); }
    saveData(key: string, value: unknown) { this.registered(); data.set(key, value); }
    deleteData(key: string) { this.registered(); data.delete(key); }
    loadSetting(key: string) { this.registered(); return settings[key]; }
  }
  const network = {
    get: (url: string, headers: Record<string, string> = {}) => dispatch({ method: "GET", url, headers }),
    post: (url: string, headers: Record<string, string>, body: string) => dispatch({ method: "POST", url, headers, body }),
    deleteCookies: (url: string) => { calls.push({ method: "DELETE_COOKIES", url, headers: {} }); },
  };
  async function dispatch(call: Call): Promise<Response> {
    calls.push(call);
    const response = await handler(call);
    return { status: 200, headers: {}, body: "", ...response };
  }
  const context = vm.createContext({ ComicSource: Source, Network: network, Date: Clock,
    setTimeout: (callback: () => void, delay: number) => { delays.push(delay); now += delay; callback(); } });
  const script = scriptFor(id);
  const firstClass = script.split("\n").find(line => line.trim().startsWith("class "))!;
  const className = firstClass.split("class")[1].split("extends ComicSource")[0].trim();
  vm.runInContext(`(() => { ${script}\nthis.temp = new ${className}(); }).call()`, context, { timeout: 5000 });
  const source = context.temp as SourceConfig & SourceStore;
  return { source, data, settings, calls, delays, context };
}
export function response(value: unknown, status = 200, headers: Response["headers"] = {}): Response {
  return { status, headers, body: JSON.stringify(value) };
}
export const copyComic = { path_word: "comic", name: "漫画", cover: "https://images.example/copy.jpg" };
export const komiicComic = { id: "comic", title: "漫画", imageUrl: "https://images.example/komiic.jpg", status: "ONGOING" };
export const japanese = { id: "manga", attributes: { originalLanguage: "ja", title: { en: "Manga" }, availableTranslatedLanguages: ["en", "ja"] }, relationships: [] };
export const chapter = { id: "chapter", attributes: { translatedLanguage: "en", chapter: "1", title: "Title", pages: 2 }, relationships: [{ id: "manga", type: "manga" }] };
export const collection = (data: unknown[], total = data.length, offset = 0) => ({ result: "ok", data, total, offset, limit: 30 });
