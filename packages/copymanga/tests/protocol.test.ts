import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  appHeaders, chapterNumber, isCopyApi, loginBody, normalizeApi, orderedPages, readResults,
} from "../src";

test("request signing matches Node HMAC-SHA256 and preserves the device", () => {
  const device = { deviceinfo: "1234567V-1234", device: "AB1C.123456.789", pseudoid: "1234567890ABCDEF" };
  const date = new Date("2026-10-07T00:00:00Z");
  const headers = appHeaders(device, "test-token", date);
  const expected = createHmac("sha256", Buffer.from("M2FmMDg1OTAzMTEwMzJlZmUwNjYwNTUwYTA1NjNhNTM=", "base64"))
    .update(String(Math.floor(date.getTime() / 1_000))).digest("hex");
  assert.equal(headers["x-auth-signature"], expected);
  assert.equal(headers.authorization, "Token test-token");
  assert.equal(headers.pseudoid, device.pseudoid);
});

test("login encoding preserves non-ASCII passwords and form characters", () => {
  const body = loginBody("user+name@example.com", "密码&+%", 1234);
  assert.equal(body.username, "user+name@example.com");
  assert.equal(Buffer.from(body.password, "base64").toString("utf8"), "密码&+%-1234");
});

test("image pages follow words instead of the response array order", () => {
  const value = { chapter: {
    contents: [{ url: "https://images.example/three.webp" }, { url: "https://images.example/one.webp" }, { url: "https://images.example/two.webp" }],
    words: [2, 0, 1],
  } };
  assert.deepEqual(orderedPages(value).map(page => page.url), [
    "https://images.example/one.webp", "https://images.example/two.webp", "https://images.example/three.webp",
  ]);
});

test("partial pages and duplicate ordering fail instead of displaying incomplete chapters", () => {
  const contents = [{ url: "https://images.example/one.webp" }, { url: "https://images.example/two.webp" }];
  assert.throws(() => orderedPages({ chapter: { contents, words: [0] } }), /完整/);
  assert.throws(() => orderedPages({ chapter: { contents, words: [0, 0] } }), /顺序/);
  assert.throws(() => orderedPages({ chapter: { contents: [{ url: "file:///image" }], words: [0] } }), /地址/);
});

test("HTTP and payload restrictions retain the server explanation", () => {
  assert.throws(() => readResults(210, { code: 210, message: "Expected available in 40 seconds", results: {} }), /40 seconds/);
  assert.throws(() => readResults(200, { code: 210, message: "设备限制", results: {} }), /设备限制/);
  assert.throws(() => readResults(401, { code: 401 }), /登录已过期/);
  assert.throws(() => readResults(200, { code: 200, results: "encrypted-data" }), /无法识别/);
  assert.throws(() => readResults(200, { code: 200, results: null }), /未返回数据/);
});

test("manual addresses allow HTTPS hosts while discovery accepts only CopyManga hosts", () => {
  assert.equal(normalizeApi("https://API.copy202601.com/"), "https://api.copy202601.com");
  assert.equal(isCopyApi("https://api.copy202601.com"), true);
  assert.equal(isCopyApi("https://api.example.com"), false);
  for (const value of ["http://api.copy202601.com", "https://user:pass@api.copy202601.com", "api.copy202601.com/api", "api.copy202601.com:443"]) {
    assert.throws(() => normalizeApi(value));
  }
});

test("chapter numbering does not mistake unrelated digits for a chapter number", () => {
  assert.equal(chapterNumber("第12.5話 番外"), 12.5);
  assert.equal(chapterNumber("Chapter 42"), 42);
  assert.equal(chapterNumber("2026年特别篇"), -1);
  assert.equal(chapterNumber("番外"), -1);
});
