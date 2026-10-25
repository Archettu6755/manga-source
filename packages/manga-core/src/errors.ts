export type FailureKind = "connection" | "timeout" | "authentication" | "permission" | "quota" | "rate-limit" | "restricted" | "empty" | "format" | "upstream";

export class SourceError extends Error {
  constructor(message: string, readonly kind: FailureKind, readonly status?: number) {
    super(message);
    this.name = "SourceError";
  }
}

export function httpError(status: number, service: string): SourceError {
  if (status === 401) return new SourceError(`${service} 登录已失效（HTTP 401），请重新登录。`, "authentication", status);
  if (status === 402) return new SourceError(`${service} 阅读额度已用完（HTTP 402），请在官网核对额度或等待恢复。`, "quota", status);
  if (status === 429) return new SourceError(`${service} 请求过于频繁（HTTP 429），请等待后再试。`, "rate-limit", status);
  if ([210, 403, 451].includes(status)) return new SourceError(`${service} 访问受限（HTTP ${status}），请在官网查看访问或账号提示。`, "restricted", status);
  return new SourceError(`${service} 请求失败（HTTP ${status}），请稍后再试。`, "upstream", status);
}

export function failureKind(error: unknown): FailureKind {
  const value = error as { kind?: FailureKind; name?: string; message?: string; cause?: { code?: string } } | null;
  if (value?.kind) return value.kind;
  const text = `${value?.name ?? ""} ${value?.message ?? String(error)} ${value?.cause?.code ?? ""}`;
  if (/timeout|timed out|超时/i.test(text)) return "timeout";
  if (/额度|quota|HTTP 402/i.test(text)) return "quota";
  if (/无权|权限|canRead|permission/i.test(text)) return "permission";
  if (/HTTP 429|限频|过于频繁|rate.?limit/i.test(text)) return "rate-limit";
  if (/HTTP (210|403|451)|访问受限|访问限制|验证码|browser challenge/i.test(text)) return "restricted";
  if (/HTTP 401|登录已失效|请重新登录|token.*expired|unauthenticated/i.test(text)) return "authentication";
  if (/fetch failed|terminated|ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR|TLS|SSL|socket|连接|网络|network/i.test(text)) return "connection";
  if (/空数据|空目录|未返回.*(?:数据|章节|图片)|未找到|没有可读|为空/i.test(text)) return "empty";
  if (/格式|分页不完整|截断|不完整|不是|不匹配|JSON|schema|SyntaxError/i.test(text)) return "format";
  return "upstream";
}

export function networkError(error: unknown, url: string): SourceError {
  if (error instanceof SourceError) return error;
  const host = url.match(/^https?:\/\/(?:[^/@]+@)?([^/?#:]+)/i)?.[1] ?? "图源服务";
  const service = host === "marketing.aiacgn.com" ? `CopyManga 大陆参数服务（${host}）` : host;
  const kind = failureKind(error);
  if (kind === "timeout") return new SourceError(`${service} 连接超时，请检查网络或稍后再试。`, kind);
  if ((error as { kind?: string })?.kind || ["restricted", "authentication", "quota", "permission", "rate-limit"].includes(kind)) {
    return new SourceError(String((error as { message?: string })?.message ?? error), kind);
  }
  return new SourceError(`${service} 连接中断或无法建立连接，请检查网络、DNS 和当前代理设置。`, "connection");
}
