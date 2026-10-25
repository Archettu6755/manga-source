import emulate, { HttpClient as EmulatorClient } from "@suwatte/toolchain/emulator";
import type { Delegate, HttpClient, HttpClientConfig, SourceInfo } from "@suwatte/toolchain/types";
import { diagnoseSource, diagnosticContext, observeDiagnosticRequest, sanitizeDiagnosticMessage,
  type DiagnosticReport, type DiagnosticStage } from "@archettu/manga-core";
import CopyManga from "../src/sources/copymanga";
import Komiic from "../src/sources/komiic";
import MangaDex from "../src/sources/mangadex";
import Manhuagui from "../src/sources/manhuagui";
import Zaimanhua from "../src/sources/zaimanhua";

const sources = { copymanga: CopyManga, komiic: Komiic, mangadex: MangaDex, manhuagui: Manhuagui, zaimanhua: Zaimanhua };
interface Options { sources: (keyof typeof sources)[]; stage: DiagnosticStage; komiicWebsite: string }

async function main() {
  const options = JSON.parse(process.argv[2]) as Options;
  const reports: DiagnosticReport[] = [];
  for (const id of options.sources) {
    const context = diagnosticContext();
    class ProbeClient extends EmulatorClient {
      constructor(config?: HttpClientConfig) { super({ ...config, retries: 0, maxRedirects: 0, validateStatus: () => true }); }
      override async request(input: Parameters<EmulatorClient["request"]>[0]) {
        const result = await observeDiagnosticRequest(context, input.method ?? "GET", input.url, async record => {
          try {
            const response = await super.request({ ...input, retries: 0, maxRedirects: 0 });
            record.status = response.status;
            record.origin = response.request.url.match(/^https?:\/\/([^/?#:]+)/)?.[1] ?? record.origin;
            return { status: response.status, body: await response.text(), response };
          } catch (error) {
            const failed = error as { status?: number; response?: { status: number } };
            record.status = failed.status ?? failed.response?.status;
            throw error;
          }
        });
        return result.response;
      }
    }
    const Source = sources[id] as { new(): Delegate; info: SourceInfo };
    const source = emulate(Source, { resetStores: true, globals: { HttpClient: ProbeClient } }) as Delegate & { client: HttpClient };
    if (id === "komiic") await source.onFormSubmitted!("settings", { website: options.komiicWebsite });
    const report = await diagnoseSource({
      source: id, reader: "suwatte", sourceId: Source.info.id, version: Source.info.version,
      browse: async () => {
        const home = await source.getHomePage!();
        const entry = home.feeds.find(feed => feed.content.list)?.content.list ?? { key: "all" };
        return (await source.getItemList!(entry, 1)).items;
      },
      search: async () => (await source.getSearchResults!({ query: process.env.SOURCE_QUERY || (id === "mangadex" ? "Yotsuba" : "葬送的芙莉蓮") }, 1)).items,
      details: comic => source.getContent!(comic),
      chapters: comic => source.getChapters!(comic),
      pages: async (comic, chapter) => (await source.getChapterPages!(comic, chapter)).map(page => page.url!).filter(Boolean),
      image: async (url, comic, chapter) => {
        if (id === "komiic") return false;
        const response = await source.client.head(url, { context: { comicId: comic, chapterId: chapter }, maxRedirects: 0, retries: 0 });
        if (response.status !== 200 || !response.headers.get("content-type")?.startsWith("image/")) throw new Error(`图片 HEAD 未返回图片（HTTP ${response.status}）。`);
        return true;
      },
    }, context, { stage: options.stage, proxy: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY) });
    reports.push(report);
    console.error(`${id}: ${report.status}`);
  }
  console.log(JSON.stringify(reports));
}
const keepAlive = setInterval(() => {}, 1000);
main().catch(error => { console.error(sanitizeDiagnosticMessage(error)); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
