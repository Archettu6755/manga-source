import type { HttpClient as Client, HttpResponse, Primitive, STTStore, RequestConfig } from "@suwatte/toolchain/types";
import { networkRequest } from "../../network";
import { httpError } from "@archettu/manga-core";
import {
  appHeaders, createDevice, DEFAULT_API, isCopyApi, loginBody, normalizeApi,
  readResults, copyRegion, copyWebsite, imageHeaders, REQUEST_ID_URL, CopyRoute, readRequestId, type DeviceInfo,
} from "@archettu/copymanga";

declare const SecureStore: STTStore;

export class CopyMangaApi {
  readonly client: Client;
  private readonly route = new CopyRoute();
  private discoveredApi?: string;

  constructor() {
    this.client = new HttpClient({
      timeout: 20_000,
      retries: 0,
      rateLimit: { permits: 1, period: 1.5 },
      validateStatus: () => true,
    });
  }

  reset(): void {
    this.discoveredApi = undefined;
    this.route.reset();
  }

  private getResponse(url: string, config?: RequestConfig) {
    return networkRequest(url, () => this.client.get(url, config));
  }
  private postResponse(url: string, body: string, config?: RequestConfig) {
    return networkRequest(url, () => this.client.post(url, body, config));
  }
  private async json(response: HttpResponse, service = "CopyManga API"): Promise<unknown> {
    try { return await response.json(); }
    catch {
      if ([210, 401, 402, 403, 429, 451].includes(response.status)) throw httpError(response.status, service);
      throw new Error(`${service} 返回了非 JSON 内容（HTTP ${response.status}），请检查 API 地址或网站访问提示。`);
    }
  }

  async refresh(): Promise<void> {
    this.reset();
    await ObjectStore.remove("copymanga.discoveredApi");
    await this.discover(copyRegion(await ObjectStore.string("copymanga.region")));
  }

  async region(): Promise<"0" | "1"> {
    return this.route.region(await ObjectStore.string("copymanga.region"));
  }

  async website(): Promise<string> {
    return copyWebsite(await ObjectStore.string("copymanga.website"));
  }

  private async headers(region: "0" | "1", includeToken = true): Promise<Record<string, string>> {
    let device = await ObjectStore.object("copymanga.device") as DeviceInfo | null;
    if (!device) {
      device = createDevice();
      await ObjectStore.set("copymanga.device", device);
    }
    return appHeaders(device, includeToken ? await SecureStore.string("copymanga.token") ?? "" : "", new Date(), region);
  }

  private async baseUrl(region: "0" | "1"): Promise<string> {
    const manual = await ObjectStore.string("copymanga.api");
    if (manual) return normalizeApi(manual);
    if (this.discoveredApi) return this.discoveredApi;
    const cached = await ObjectStore.object("copymanga.discoveredApi");
    if (cached && typeof cached.url === "string" && isCopyApi(cached.url) &&
        cached.region === region && typeof cached.at === "number" && Date.now() - cached.at < 86_400_000) {
      this.discoveredApi = cached.url;
      return cached.url;
    }
    return this.discover(region);
  }

  private async discover(region: "0" | "1"): Promise<string> {
    let restricted = false;
    try {
      const response = await this.getResponse("https://api.copy-manga.com/api/v3/system/network2", {
        params: { platform: "3" }, headers: await this.headers(region, false),
      });
      restricted = [210, 401, 402, 403, 429, 451].includes(response.status);
      const body = await this.json(response, "CopyManga 地址发现服务");
      restricted ||= [210, 401, 402, 403, 429, 451].includes(Number((body as { code?: number })?.code));
      const results = readResults<{ api?: string[][] }>(response.status, body);
      const host = results.api?.[0]?.[0];
      if (typeof host === "string") {
        const candidate = normalizeApi(host);
        if (isCopyApi(candidate)) {
          this.discoveredApi = candidate;
          await ObjectStore.set("copymanga.discoveredApi", { url: candidate, at: Date.now(), region });
          return candidate;
        }
      }
    } catch (error) {
      if (restricted) throw error;
      // Discovery is optional; its failure must not prevent a normal API request.
    }
    this.discoveredApi = DEFAULT_API;
    return DEFAULT_API;
  }

  async get<T>(path: string, params: Record<string, Primitive> = {}): Promise<T> {
    const setting = await ObjectStore.string("copymanga.region");
    const base = await this.baseUrl(copyRegion(setting));
    const { region, requestId } = await this.route.forRequest(path, setting, async () => {
      const response = await this.getResponse(REQUEST_ID_URL, { headers: imageHeaders(new Date(), "1"), timeout: setting === "1" ? 20_000 : 6_000 });
      return readRequestId(response.status, await this.json(response, "CopyManga 大陆参数服务"));
    });
    const response = await this.getResponse(`${base}/api/v3/${path}`, {
      params: { in_mainland: region === "1", ...params, ...(requestId ? { request_id: requestId } : {}) }, headers: await this.headers(region),
    });
    return readResults<T>(response.status, await this.json(response));
  }

  async webSearch<T>(query: string, limit: number, offset: number): Promise<T> {
    const website = await this.website();
    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
      Referer: `${website}/`,
    };
    const page = await this.getResponse(`${website}/search`, { headers });
    if (page.status != 200) throw httpError(page.status, "CopyManga 搜索页");
    const path = (await page.text()).match(/const\s+countApi\s*=\s*["']([^"']+)["']/)?.[1];
    if (!path) throw new Error("CopyManga 搜索接口已变化，请在源设置中切换 App 搜索或更新源。");
    let url: string;
    if (path.startsWith("/api/")) url = `${website}${path}`;
    else if (path.startsWith(`${website}/api/`)) url = path;
    else throw new Error("CopyManga 搜索页返回了无法识别的接口地址。");
    const response = await this.getResponse(url, { headers, params: { q: query, q_type: "", platform: 2, limit, offset } });
    return readResults<T>(response.status, await this.json(response, "CopyManga 搜索接口"));
  }

  async web(path: string, params: Record<string, Primitive> = {}): Promise<string> {
    const website = await this.website();
    const response = await this.getResponse(`${website}${path}`, { params, headers: { Referer: `${website}/`,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15" } });
    if (response.status !== 200) throw httpError(response.status, "CopyManga 浏览页面");
    return response.text();
  }

  async login(username: string, password: string): Promise<void> {
    const region = copyRegion(await ObjectStore.string("copymanga.region"));
    const fields = loginBody(username, password, Math.floor(1_000 + Math.random() * 9_000));
    const body = Object.entries(fields).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    const response = await this.postResponse(`${await this.baseUrl(region)}/api/v3/login`, body, {
      headers: { ...await this.headers(region, false), "Content-Type": "application/x-www-form-urlencoded" },
    });
    const results = readResults<{ token: string }>(response.status, await this.json(response, "CopyManga 登录接口"));
    if (typeof results.token !== "string" || !results.token.trim()) throw new Error("CopyManga 登录未返回有效令牌。");
    await SecureStore.set("copymanga.token", results.token);
  }

  async isLoggedIn(): Promise<boolean> {
    return Boolean(await SecureStore.string("copymanga.token"));
  }

  async logout(): Promise<void> {
    await SecureStore.remove("copymanga.token");
  }
}
