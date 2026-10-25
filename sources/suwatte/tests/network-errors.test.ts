import assert from "node:assert/strict";
import test from "node:test";
import type { Delegate } from "@suwatte/toolchain/types";
import CopyManga from "../src/sources/copymanga";
import Komiic from "../src/sources/komiic";
import MangaDex from "../src/sources/mangadex";
import Manhuagui from "../src/sources/manhuagui";
import Zaimanhua from "../src/sources/zaimanhua";
import { fixture } from "./fixture";

test("CopyManga HTML access restrictions retain HTTP status and stop API discovery without fallback", async () => {
  for (const status of [210, 401, 402, 403, 429, 451]) {
    const { source, calls } = fixture(CopyManga, () => ({ status, get body() { throw new SyntaxError("Unexpected token <"); } }));
    await assert.rejects(() => source.getContent("fixture"), new RegExp(`地址发现服务.*HTTP ${status}`));
    assert.equal(calls.length, 1);
  }
});

test("CopyManga parameter service HTML restrictions are identified before a protected chapter request", async () => {
  const { source, calls } = fixture(CopyManga, () => ({ status: 403, get body() { throw new SyntaxError("Unexpected token <"); } }));
  await ObjectStore.set("copymanga.api", "https://api.copy202601.com");
  await assert.rejects(() => source.getContent("fixture"), /大陆参数服务.*访问受限.*HTTP 403/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://marketing.aiacgn.com/"));
});

test("All Suwatte source adapters explain transport failures without exposing request URLs or credentials", async () => {
  for (const Source of [Komiic, MangaDex, Manhuagui, Zaimanhua]) {
    const { source } = fixture<Delegate>(Source, () => { throw new Error("fetch failed password=fixture-secret"); });
    await assert.rejects(() => source.getSearchResults!({ query: "fixture" }, 1), (error: Error) => {
      assert.match(error.message, /连接中断|无法建立连接/);
      assert.doesNotMatch(error.message, /fetch failed|fixture-secret|\?/);
      return true;
    });
  }
});
