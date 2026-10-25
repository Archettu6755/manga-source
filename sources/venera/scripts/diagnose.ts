import vm from "node:vm";
import { fetch, ProxyAgent } from "undici";
import { diagnoseSource, diagnosticContext, observeDiagnosticRequest, sanitizeDiagnosticMessage,
  type DiagnosticReport, type DiagnosticStage } from "@archettu/manga-core";
import type { ComicList, Details, Response, SourceConfig } from "../src/runtime";
const { bundle }: { bundle(id: string): string } = require("./bundle.cjs");
interface Options { sources: string[]; stage: DiagnosticStage; komiicWebsite: string }

async function main() {
  const options = JSON.parse(process.argv[2]) as Options;
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  const reports: DiagnosticReport[] = [];
  try {
    for (const id of options.sources) {
      const context = diagnosticContext();
      async function request(method: string, url: string, headers: Record<string, string>, body?: string): Promise<Response> {
        return observeDiagnosticRequest(context, method, url, async record => {
          const response = await fetch(url, { method, headers, body, dispatcher, redirect: "manual", signal: AbortSignal.timeout(20000) });
          record.status = response.status;
          return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
        });
      }
      const data = new Map<string, unknown>();
      class ComicSource {
        loadData(key: string) { return data.get(key); }
        saveData(key: string, value: unknown) { data.set(key, value); }
        deleteData(key: string) { data.delete(key); }
        loadSetting(key: string) { return id === "komiic" && key === "website" ? options.komiicWebsite : undefined; }
      }
      const scope = vm.createContext({ ComicSource, Date, setTimeout,
        Network: { get: (url: string, headers: Record<string, string>) => request("GET", url, headers),
          post: (url: string, headers: Record<string, string>, body: string) => request("POST", url, headers, body), deleteCookies() {} } });
      const script = bundle(id);
      const className = script.match(/^class (\w+) extends ComicSource/)![1];
      vm.runInContext(`${script}\nthis.instance = new ${className}();`, scope, { timeout: 5000 });
      const source = scope.instance as SourceConfig;
      let details: { id: string; value: Details } | undefined;
      const report = await diagnoseSource({
        source: id, reader: "venera", sourceId: source.key, version: source.version,
        browse: async () => (await source.explore.find(entry => entry.type === "multiPageComicList")!.load(1) as ComicList).comics,
        search: async () => (await source.search.load(process.env.SOURCE_QUERY || (id === "mangadex" ? "Yotsuba" : "葬送的芙莉蓮"), [], 1)).comics,
        details: async comic => { details = { id: comic, value: await source.comic.loadInfo(comic) }; },
        chapters: async comic => {
          if (!details || details.id !== comic) details = { id: comic, value: await source.comic.loadInfo(comic) };
          return Object.keys(details.value.chapters).map(id => ({ id }));
        },
        pages: async (comic, chapter) => (await source.comic.loadEp(comic, chapter)).images,
        image: async (url, comic, chapter) => {
          if (id === "komiic") return false;
          const config = await source.comic.onImageLoad?.(url, comic, chapter);
          const response = await request("HEAD", url, config?.headers ?? {});
          if (response.status !== 200 || !response.headers["content-type"]?.toString().startsWith("image/")) throw new Error(`图片 HEAD 未返回图片（HTTP ${response.status}）。`);
          return true;
        },
      }, context, { stage: options.stage, proxy: Boolean(proxy) });
      reports.push(report);
      console.error(`${id}: ${report.status}`);
    }
  } finally { await dispatcher?.close(); }
  console.log(JSON.stringify(reports));
}
main().catch(error => { console.error(sanitizeDiagnosticMessage(error)); process.exitCode = 1; });
