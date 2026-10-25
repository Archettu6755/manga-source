import { failureKind, httpError, networkError, SourceError, type FailureKind } from "./errors";

export const DIAGNOSTIC_SOURCES = ["copymanga", "komiic", "mangadex", "manhuagui", "zaimanhua"] as const;
export const DIAGNOSTIC_STAGES = ["browse", "search", "details", "chapters", "pages", "image"] as const;
export type DiagnosticStage = typeof DIAGNOSTIC_STAGES[number];
export interface DiagnosticRequest { stage: DiagnosticStage; method: string; origin: string; status?: number; elapsedMs: number; kind?: FailureKind }
export interface DiagnosticContext { stage: DiagnosticStage; requests: DiagnosticRequest[]; stopped?: SourceError; requestLimit: number }
export interface DiagnosticStep { stage: DiagnosticStage; status: "passed" | "empty" | "failed" | "skipped"; count?: number; kind?: FailureKind; message?: string }
export interface DiagnosticReport {
  source: string; reader: string; sourceId: string; version: string | number; checkedAt: string; network: "existing-proxy" | "system";
  status: "passed" | "partial" | "restricted" | "unreachable" | "failed"; stages: DiagnosticStep[]; requests: DiagnosticRequest[];
}
export interface DiagnosticProbe {
  source: string; reader: string; sourceId: string; version: string | number;
  browse(): Promise<{ id: string }[]>;
  search(): Promise<{ id: string }[]>;
  details(id: string): Promise<unknown>;
  chapters(id: string): Promise<{ id: string }[]>;
  pages(id: string, chapter: string): Promise<string[]>;
  image(url: string, id: string, chapter: string): Promise<boolean>;
}
const restrictions = [210, 401, 402, 403, 429, 451];

export function diagnosticContext(requestLimit = 40): DiagnosticContext {
  return { stage: "browse", requests: [], requestLimit };
}

export function sanitizeDiagnosticMessage(value: unknown): string {
  const message = String((value as { message?: string } | null)?.message ?? value);
  return message.replace(/https?:\/\/[^\s)）<>"']+/gi, value => value.match(/^https?:\/\/(?:[^/@]+@)?([^/?#:]+)/i)?.[1] ?? "[网址已隐藏]")
    .replace(/((?:authorization|cookie)\s*[=:]\s*)[^\r\n]+/gi, "$1[已隐藏]")
    .replace(/\b(Bearer|Token)\s+[^\s;,]+/gi, "$1 [已隐藏]")
    .replace(/((?:[\w.-]*token|authorization|cookie|password|passwd|device[_-]?id|request[_-]?id)\s*[=:]\s*)[^\s;,）)]+/gi, "$1[已隐藏]")
    .replace(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/gi, "[标识已隐藏]")
    .slice(0, 500);
}

function responseRestriction(status: number, body: string): SourceError | undefined {
  if (restrictions.includes(status)) return httpError(status, "图源服务");
  if (/<title>Just a moment|cf-chl-widget/i.test(body)) return new SourceError("站点要求浏览器验证，诊断已停止。", "restricted");
  try {
    const data = JSON.parse(body);
    if (restrictions.includes(Number(data?.code))) {
      const error = httpError(Number(data.code), "图源接口");
      return new SourceError(error.message.replace("HTTP", "API"), error.kind, error.status);
    }
    if ([data, data?.data, data?.data?.data, data?.data?.comicInfo, data?.results].some(value => value?.canRead === false)) {
      return new SourceError("测试作品或章节需要网站账号权限，诊断已停止。", "permission");
    }
    const messages = data?.errors?.map((error: { message?: string }) => error.message ?? "").join("；") || data?.errmsg;
    if (messages) {
      const kind = failureKind(new Error(messages));
      if (["authentication", "permission", "quota", "rate-limit", "restricted"].includes(kind)) return new SourceError(sanitizeDiagnosticMessage(messages), kind);
    }
  } catch { /* Metadata pages can be HTML. */ }
  return undefined;
}

export async function observeDiagnosticRequest<T extends { status: number; body: string }>(
  context: DiagnosticContext, method: string, url: string, send: (request: DiagnosticRequest) => Promise<T>,
): Promise<T> {
  if (context.stopped) throw context.stopped;
  if (context.requests.length >= context.requestLimit) throw new SourceError("本次诊断已达到请求数量上限，后续步骤未执行。", "upstream");
  const record: DiagnosticRequest = { stage: context.stage, method, origin: url.match(/^https?:\/\/(?:[^/@]+@)?([^/?#:]+)/i)?.[1] ?? "unknown", elapsedMs: 0 };
  context.requests.push(record);
  const start = Date.now();
  try {
    const response = await send(record);
    record.status = response.status;
    context.stopped = responseRestriction(response.status, response.body);
    if (context.stopped) throw context.stopped;
    return response;
  } catch (error) {
    const failure = record.status !== undefined && restrictions.includes(record.status) ? httpError(record.status, record.origin) : networkError(error, url);
    record.kind = failure.kind;
    if (["authentication", "permission", "quota", "rate-limit", "restricted"].includes(failure.kind)) context.stopped = failure;
    throw failure;
  } finally { record.elapsedMs = Date.now() - start; }
}

export async function diagnoseSource(probe: DiagnosticProbe, context: DiagnosticContext, options: { stage: DiagnosticStage; proxy: boolean }): Promise<DiagnosticReport> {
  const report: DiagnosticReport = {
    source: probe.source, reader: probe.reader, sourceId: probe.sourceId, version: probe.version,
    checkedAt: new Date().toISOString(), network: options.proxy ? "existing-proxy" : "system", status: "passed", stages: [], requests: context.requests,
  };
  let comic = "", chapter = "", images: string[] = [];
  const requested = DIAGNOSTIC_STAGES.slice(0, DIAGNOSTIC_STAGES.indexOf(options.stage) + 1);
  for (const stage of requested) {
    context.stage = stage;
    try {
      let count: number | undefined;
      if (stage === "browse" || stage === "search") {
        const items = await (stage === "browse" ? probe.browse() : probe.search());
        if (stage === "search" && items[0]) comic = items[0].id;
        else comic ||= items[0]?.id ?? "";
        count = items.length;
      } else {
        if (!comic) throw new SourceError("浏览和搜索均未找到测试作品，后续读取未验证。", "empty");
        if (stage === "details") await probe.details(comic);
        if (stage === "chapters") {
          const chapters = await probe.chapters(comic);
          count = chapters.length; chapter = chapters[0]?.id ?? "";
          if (!chapter) throw new SourceError("测试作品没有可读章节，图片步骤未验证。", "empty");
        }
        if (stage === "pages") {
          images = await probe.pages(comic, chapter); count = images.length;
          if (!images.length) throw new SourceError("没有取得章节图片地址。", "empty");
        }
        if (stage === "image" && !await probe.image(images[0], comic, chapter)) {
          report.stages.push({ stage, status: "skipped", message: "本次未执行图片 HEAD；该图源按 GET 读取图片，诊断不下载图片或消耗阅读额度。" });
          report.status = "partial";
          continue;
        }
      }
      if (context.stopped) throw context.stopped;
      report.stages.push({ stage, status: count === 0 ? "empty" : "passed", ...(count === undefined ? {} : { count }), ...(count === 0 ? { kind: "empty", message: "本次查询返回空结果。" } : {}) });
      if (count === 0) report.status = "partial";
    } catch (error) {
      const kind = failureKind(error);
      report.stages.push({ stage, status: "failed", kind, message: sanitizeDiagnosticMessage(error) });
      report.status = ["authentication", "permission", "quota", "rate-limit", "restricted"].includes(kind) ? "restricted"
        : ["connection", "timeout"].includes(kind) ? "unreachable" : kind === "empty" ? "partial" : "failed";
      for (const next of requested.slice(requested.indexOf(stage) + 1)) report.stages.push({ stage: next, status: "skipped", message: "前一步已中止，未发起后续请求。" });
      break;
    }
  }
  return report;
}
