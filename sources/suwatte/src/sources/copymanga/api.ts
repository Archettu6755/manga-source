import type { HttpClient as Client, Primitive, STTStore } from "@suwatte/toolchain/types";
import {
  appHeaders, createDevice, DEFAULT_API, isCopyApi, loginBody, normalizeApi,
  readResults, WEBSITE, type DeviceInfo,
} from "@archettu/copymanga";

declare const SecureStore: STTStore;

export class CopyMangaApi {
  readonly client: Client;
  private discoveredApi?: string;

  constructor() {
    this.client = new HttpClient({
      timeout: 20_000,
      retries: 0,
      rateLimit: { permits: 1, period: 1_500 },
      validateStatus: () => true,
    });
  }

  reset(): void {
    this.discoveredApi = undefined;
  }

  private async headers(includeToken = true): Promise<Record<string, string>> {
    let device = await ObjectStore.object("copymanga.device") as DeviceInfo | null;
    if (!device) {
      device = createDevice();
      await ObjectStore.set("copymanga.device", device);
    }
    return appHeaders(device, includeToken ? await SecureStore.string("copymanga.token") ?? "" : "");
  }

  async baseUrl(): Promise<string> {
    const manual = await ObjectStore.string("copymanga.api");
    if (manual) return normalizeApi(manual);
    if (this.discoveredApi) return this.discoveredApi;
    const cached = await ObjectStore.object("copymanga.discoveredApi");
    if (cached && typeof cached.url === "string" && isCopyApi(cached.url) &&
        typeof cached.at === "number" && Date.now() - cached.at < 86_400_000) {
      this.discoveredApi = cached.url;
      return cached.url;
    }
    try {
      const response = await this.client.get("https://api.copy-manga.com/api/v3/system/network2", {
        params: { platform: "3" }, headers: await this.headers(false),
      });
      const results = readResults<{ api?: string[][] }>(response.status, await response.json());
      const host = results.api?.[0]?.[0];
      if (typeof host === "string") {
        const candidate = normalizeApi(host);
        if (isCopyApi(candidate)) {
          this.discoveredApi = candidate;
          await ObjectStore.set("copymanga.discoveredApi", { url: candidate, at: Date.now() });
          return candidate;
        }
      }
    } catch {
      // Discovery is optional; its failure must not prevent a normal API request.
    }
    this.discoveredApi = DEFAULT_API;
    return DEFAULT_API;
  }

  async get<T>(path: string, params: Record<string, Primitive> = {}): Promise<T> {
    const response = await this.client.get(`${await this.baseUrl()}/api/v3/${path}`, {
      params: { in_mainland: false, ...params }, headers: await this.headers(),
    });
    let body: unknown;
    try { body = await response.json(); } catch {
      throw new Error(`CopyManga API 返回了非 JSON 内容（HTTP ${response.status}），请检查 API 地址或访问验证。`);
    }
    return readResults<T>(response.status, body);
  }

  async webSearch<T>(query: string, limit: number, offset: number): Promise<T> {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
      Referer: `${WEBSITE}/`,
    };
    const page = await this.client.get(`${WEBSITE}/search`, { headers });
    if (page.status !== 200) throw new Error(`CopyManga 搜索页暂时无法访问（HTTP ${page.status}）。`);
    const path = (await page.text()).match(/const\s+countApi\s*=\s*["']([^"']+)["']/)?.[1];
    if (!path) throw new Error("CopyManga 搜索接口已变化，请在源设置中切换 App 搜索或更新源。");
    let url: string;
    if (path.startsWith("/api/")) url = `${WEBSITE}${path}`;
    else if (path.startsWith(`${WEBSITE}/api/`)) url = path;
    else throw new Error("CopyManga 搜索页返回了无法识别的接口地址。");
    const response = await this.client.get(url, { headers, params: { q: query, q_type: "", platform: 2, limit, offset } });
    return readResults<T>(response.status, await response.json());
  }

  async login(username: string, password: string): Promise<void> {
    const fields = loginBody(username, password, Math.floor(1_000 + Math.random() * 9_000));
    const body = Object.entries(fields).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    const response = await this.client.post(`${await this.baseUrl()}/api/v3/login`, body, {
      headers: { ...await this.headers(false), "Content-Type": "application/x-www-form-urlencoded" },
    });
    const results = readResults<{ token: string }>(response.status, await response.json());
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
