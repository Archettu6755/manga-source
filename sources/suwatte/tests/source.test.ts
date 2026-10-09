import assert from "node:assert/strict";
import test from "node:test";
import emulate, { HttpClient as EmulatorClient, HttpHeaders, STTStore } from "@suwatte/toolchain/emulator";
import { wrapDelegateWithValidation } from "@suwatte/toolchain/validate";
import type { Awaitable, HttpRequest, RequestConfig } from "@suwatte/toolchain/types";
import CopyManga from "../src/sources/copymanga";

type Call = { url: string; config?: RequestConfig; body?: unknown };
type Reply = { status?: number; results?: unknown; body?: unknown; text?: string };
const comic = {
  path_word: "sample", name: "测试漫画", cover: "https://images.example/cover.webp",
  author: [{ name: "作者", path_word: "author" }], theme: [{ name: "冒险", path_word: "adventure" }],
  status: { value: 0, display: "連載中" }, brief: "简介",
};

function fixture(handler: (call: Call) => Reply) {
  const calls: Call[] = [];
  class Client {
    private hooks: ((request: HttpRequest) => Awaitable<HttpRequest>)[] = [];
    readonly interceptors = { request: { use: (hook: (request: HttpRequest) => Awaitable<HttpRequest>) => this.hooks.push(hook) } };
    async get(url: string, config?: RequestConfig) { return this.request(url, config); }
    async head(url: string, config?: RequestConfig) { return this.request(url, config); }
    async post(url: string, body: unknown, config?: RequestConfig) { return this.request(url, config, body); }
    private async request(url: string, config?: RequestConfig, body?: unknown) {
      if (this.hooks.length) {
        let request = { url, method: "GET", headers: new HttpHeaders(config?.headers), params: {}, cookies: [] } as HttpRequest;
        for (const hook of this.hooks) request = await hook(request);
        config = { ...config, headers: request.headers.toJSON() };
      }
      const call = { url, config, body };
      calls.push(call);
      const reply = handler(call);
      return {
        status: reply.status ?? 200,
        json: async () => reply.body ?? { code: 200, results: reply.results },
        text: async () => reply.text ?? "",
      };
    }
  }
  const source = emulate<CopyManga>(CopyManga, { resetStores: true, globals: { HttpClient: Client as unknown as typeof EmulatorClient } });
  return { source: wrapDelegateWithValidation(source), calls };
}

test("search resolves the live relative endpoint and uses total for pagination", async () => {
  const { source, calls } = fixture(call => call.url.endsWith("/search")
    ? { text: 'const countApi = "/api/kb/web/searchcl/comics";' }
    : { results: { list: [comic], total: 31, offset: 30 } });
  const results = await source.getSearchResults({ query: " 测试 " }, 2);
  assert.equal(results.items[0].id, "sample");
  assert.equal(results.isLastPage, true);
  assert.equal(calls[1].url, "https://www.copy4000.com/api/kb/web/searchcl/comics");
  assert.equal(calls[1].config?.params?.offset, 30);
  assert.equal(calls[1].config?.params?.q, "测试");
  assert.equal(calls[1].config?.headers?.authorization, undefined);
});

test("images use their own client and send public image headers without the account token", async () => {
  const { source, calls } = fixture(() => ({ results: {} }));
  const secure = (globalThis as unknown as { SecureStore: STTStore }).SecureStore;
  await secure.set("copymanga.token", "fixture-token");
  await source.client.head("https://images.example/page.webp");
  assert.equal(source.getConfiguration().useClientForImageRequests, true);
  assert.equal(calls[0].config?.headers?.["User-Agent"], "COPY/3.0.9");
  assert.equal(calls[0].config?.headers?.authorization, undefined);
});

test("connection settings select the website and resource region while refresh preserves login", async () => {
  const { source, calls } = fixture(call => {
    if (call.url.includes("network2")) return { results: { api: [["api.copy202601.com"]] } };
    if (call.url.endsWith("/search")) return { text: 'const countApi = "/api/kb/web/searchcl/comics";' };
    if (call.url.includes("chapter2")) return { results: { chapter: { words: [0], contents: [{ url: "https://images.example/page.webp" }] } } };
    return { results: { list: [comic], total: 1, offset: 0 } };
  });
  const secure = (globalThis as unknown as { SecureStore: STTStore }).SecureStore;
  await secure.set("copymanga.token", "fixture-token");
  await ObjectStore.set("copymanga.discoveredApi", { url: "https://api.copy2000.online", at: Date.now(), region: "0" });
  await source.onFormSubmitted("settings", { api: "", website: "global", region: "0", refreshApi: true });
  assert.equal(calls[0].config?.headers?.region, "0");
  assert.equal(await secure.string("copymanga.token"), "fixture-token");
  await source.getSearchResults({ query: "测试" }, 1);
  assert.equal(calls[1].url, "https://www.copy20.com/search");
  await source.getChapterPages("sample", "chapter");
  assert.equal(calls.at(-1)?.config?.params?.in_mainland, false);
  await source.onFormSubmitted("settings", { region: "1", website: "mainland" });
  await source.getChapterPages("sample", "chapter");
  assert.equal(calls.at(-1)?.config?.params?.in_mainland, true);
  assert.equal(calls.at(-1)?.config?.headers?.region, "1");
  await source.client.head("https://images.example/page.webp");
  assert.equal(calls.at(-1)?.config?.headers?.region, "1");
});

test("chapter pagination survives a server page cap and preserves all groups", async () => {
  const { source, calls } = fixture(call => {
    if (call.url.includes("system/network2")) return { results: { api: [["api.copy202601.com"]] } };
    if (call.url.includes("comic2/")) return { results: { comic, groups: {
      extra: { path_word: "extra", name: "番外" }, default: { path_word: "default", name: "默认" },
    } } };
    if (call.url.includes("/group/default/")) {
      const offset = Number(call.config?.params?.offset);
      return { results: { total: 3, offset, list: offset === 0
        ? [{ uuid: "a", name: "第1話", datetime_created: "2026-10-01" }, { uuid: "b", name: "第2話" }]
        : [{ uuid: "c", name: "第3話" }] } };
    }
    return { results: { total: 1, offset: 0, list: [{ uuid: "extra", name: "特别篇" }] } };
  });
  const content = await source.getContent("sample");
  assert.equal(content.title, comic.name);
  const chapters = await source.getChapters("sample");
  assert.deepEqual(chapters.map(chapter => chapter.id), ["a", "b", "c", "extra"]);
  assert.deepEqual(chapters.map(chapter => chapter.index), [0, 1, 2, 3]);
  assert.equal(chapters[3].title, "番外：特别篇");
  assert.equal(chapters[3].number, -1);
  assert.equal(calls.filter(call => call.url.includes("comic2/")).length, 1);
  assert.deepEqual(calls.filter(call => call.url.includes("/group/default/")).map(call => call.config?.params?.offset), [0, 2]);
});

test("repeated or truncated chapter pages fail without looping", async () => {
  for (const truncated of [false, true]) {
    const { source, calls } = fixture(call => {
      if (call.url.includes("network2")) return { results: { api: [["api.copy202601.com"]] } };
      if (call.url.includes("comic2/")) return { results: { comic, groups: { default: { path_word: "default", name: "默认" } } } };
      const offset = Number(call.config?.params?.offset);
      return { results: { total: 3, offset, list: offset && truncated ? [] : [{ uuid: "a", name: "第1話" }] } };
    });
    await assert.rejects(() => source.getChapters("sample"), truncated ? /完整分页/ : /重复/);
    assert.equal(calls.filter(call => call.url.includes("/chapters")).length, 2);
  }
});

test("a 210 response produces one failure with no mirror requests or identifier reset", async () => {
  const { source, calls } = fixture(call => call.url.includes("network2")
    ? { results: { api: [["api.copy202601.com"]] } }
    : { status: 210, body: { code: 210, message: "请等待1小时", results: {} } });
  await assert.rejects(() => source.getChapterPages("sample", "chapter"), /请等待1小时/);
  assert.equal(calls.filter(call => call.url.includes("chapter2")).length, 1);
  const device = await ObjectStore.object("copymanga.device");
  await source.clearAuthentication();
  assert.deepEqual(await ObjectStore.object("copymanga.device"), device);
});

test("empty directories report the upstream problem instead of looking like a completed load", async () => {
  const { source } = fixture(call => {
    if (call.url.includes("network2")) return { results: { api: [["api.copy202601.com"]] } };
    if (call.url.includes("comic2")) return { results: { comic, groups: { default: { path_word: "default", name: "默认" } } } };
    return { results: { list: [], total: 0, offset: 0 } };
  });
  await assert.rejects(() => source.getChapters("sample"), /未返回章节/);
});

test("login stores only the token in SecureStore and logout preserves the device", async () => {
  const { source, calls } = fixture(call => call.url.endsWith("/login")
    ? { results: { token: "fixture-token" } }
    : { results: { list: [comic], total: 1, offset: 0 } });
  await source.onFormSubmitted("settings", { api: "api.copy202601.com", username: "fixture+user", password: "密码&+", search: "app", logout: false });
  const secure = (globalThis as unknown as { SecureStore: STTStore }).SecureStore;
  assert.equal(await secure.string("copymanga.token"), "fixture-token");
  assert.equal(await ObjectStore.get("copymanga.token"), null);
  assert.equal(await ObjectStore.get("password"), null);
  assert.equal(typeof calls[0].body, "string");
  const body = new URLSearchParams(calls[0].body as string);
  assert.equal(body.get("username"), "fixture+user");
  assert.match(Buffer.from(body.get("password")!, "base64").toString("utf8"), /^密码&\+-\d{4}$/);
  await source.getSearchResults({ query: "测试" }, 1);
  assert.equal(calls[1].config?.headers?.authorization, "Token fixture-token");
  const device = await ObjectStore.object("copymanga.device");
  await source.clearAuthentication();
  assert.equal(await secure.get("copymanga.token"), null);
  assert.deepEqual(await ObjectStore.object("copymanga.device"), device);
  await source.getSettingsPage();
});

test("discovery cannot redirect a token to an unrelated host", async () => {
  const { source, calls } = fixture(call => call.url.includes("network2")
    ? { results: { api: [["api.example.com"]] } }
    : { results: { comic, groups: {} } });
  const secure = (globalThis as unknown as { SecureStore: STTStore }).SecureStore;
  await secure.set("copymanga.token", "fixture-token");
  await source.getContent("sample");
  assert.equal(calls[0].config?.headers?.authorization, "Token");
  assert.match(calls[1].url, /^https:\/\/api\.copy202601\.com\//);
  assert.equal(calls[1].config?.headers?.authorization, "Token fixture-token");
});

test("invalid settings fail before making requests or changing the stored address", async () => {
  const { source, calls } = fixture(() => { throw new Error("unexpected request"); });
  await assert.rejects(() => source.onFormSubmitted("settings", { api: "http://example.com" }), /HTTPS/);
  await assert.rejects(() => source.onFormSubmitted("settings", { api: "api.copy202601.com", username: "user" }), /同时填写/);
  assert.equal(await ObjectStore.get("copymanga.api"), null);
  assert.equal(calls.length, 0);
});
