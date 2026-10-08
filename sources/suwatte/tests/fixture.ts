import emulate, { HttpClient as EmulatorClient, HttpHeaders } from "@suwatte/toolchain/emulator";
import { wrapDelegateWithValidation } from "@suwatte/toolchain/validate";
import type { Awaitable, Delegate, HttpRequest, HttpResponse, RequestConfig, SourceInfo } from "@suwatte/toolchain/types";

export type Call = { url: string; config?: RequestConfig; body?: unknown };
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
export function fixture<T extends Delegate>(Source: { new(): T; info: SourceInfo }, handler: (call: Call) => Reply) {
  const calls: Call[] = [];
  class Client {
    private requestHooks: ((request: HttpRequest) => Awaitable<HttpRequest>)[] = [];
    private responseHooks: ((response: HttpResponse) => Awaitable<HttpResponse>)[] = [];
    readonly interceptors = {
      request: { use: (hook: (request: HttpRequest) => Awaitable<HttpRequest>) => this.requestHooks.push(hook) },
      response: { use: (hook: (response: HttpResponse) => Awaitable<HttpResponse>) => this.responseHooks.push(hook) },
    };
    async get(url: string, config?: RequestConfig) { return this.request("GET", url, config); }
    async head(url: string, config?: RequestConfig) { return this.request("HEAD", url, config); }
    async post(url: string, body: unknown, config?: RequestConfig) { return this.request("POST", url, config, body); }
    private async request(method: string, url: string, config?: RequestConfig, body?: unknown) {
      let request = { url, method, headers: new HttpHeaders(config?.headers), params: {}, cookies: [], context: config?.context } as HttpRequest;
      for (const hook of this.requestHooks) request = await hook(request);
      const call = { url: request.url, config: { ...config, headers: request.headers.toJSON() }, body };
      calls.push(call);
      const reply = handler(call);
      let response = { status: reply.status ?? 200, json: async () => reply.body, headers: new HttpHeaders(reply.headers), request } as unknown as HttpResponse;
      for (const hook of this.responseHooks) response = await hook(response);
      return response;
    }
  }
  const source = emulate<T>(Source, { resetStores: true, globals: { HttpClient: Client as unknown as typeof EmulatorClient } });
  return { source: wrapDelegateWithValidation(source), rawSource: source, calls };
}
