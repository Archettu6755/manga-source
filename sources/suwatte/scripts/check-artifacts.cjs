const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHmac } = require("node:crypto");

const catalog = JSON.parse(fs.readFileSync("dist/sources.json", "utf8"));
assert.equal(catalog.catalogVersion, 2);
assert.equal(catalog.sources.length, 1);
const info = catalog.sources[0];
assert.equal(info.id, "zh.copymanga");
assert.equal(info.environment, "jsc");
const artifact = path.join("dist", "sources", `${info.path}.stt`);
let script = fs.readFileSync(artifact, "utf8");
const notices = [
  ["CryptoJS", path.join(path.dirname(require.resolve("crypto-js")), "LICENSE")],
  ["Suwatte Toolchain", path.join(path.dirname(require.resolve("@suwatte/toolchain")), "..", "LICENSE")],
].map(([name, file]) => `${name}\n${fs.readFileSync(file, "utf8")}`).join("\n\n");
script += `\n/*\nThird-party notices\n${notices.replace(/\*\//g, "* /")}\n*/\n`;
fs.writeFileSync(artifact, script);
fs.writeFileSync("dist/THIRD_PARTY_NOTICES.txt", notices);
assert.match(script.slice(0, 512), /"use httpclient"/);
const values = new Map([["copymanga.api", "https://api.copy202601.com"]]);
const store = {
  get: async key => values.get(key) ?? null,
  string: async key => values.get(key) ?? null,
  object: async key => values.get(key) ?? null,
  set: async (key, value) => { values.set(key, value); },
};
class Client {
  interceptors = { request: { use() {} } };
  async get(url, config) {
    const timestamp = config.headers["x-auth-timestamp"];
    const expected = createHmac("sha256", Buffer.from("M2FmMDg1OTAzMTEwMzJlZmUwNjYwNTUwYTA1NjNhNTM=", "base64"))
      .update(timestamp).digest("hex");
    assert.equal(config.headers["x-auth-signature"], expected);
    const results = url.includes("chapter2/")
      ? { chapter: { words: [1, 0], contents: [{ url: "https://images.example/2.webp" }, { url: "https://images.example/1.webp" }] } }
      : { comic: { path_word: "fixture", name: "Fixture", cover: "https://images.example/cover.webp" }, groups: {} };
    return { status: 200, json: async () => ({ code: 200, results }) };
  }
}
const context = vm.createContext({ HttpClient: Client, ObjectStore: store, SecureStore: store });
vm.runInContext(script, context, { timeout: 5_000 });
assert.equal(typeof context.SourcePackage.bootstrap, "function");
const source = context.SourcePackage.bootstrap();
for (const method of ["getSearchResults", "getItemList", "getContent", "getChapters", "getChapterPages", "getSettingsPage"]) {
  assert.equal(typeof source[method], "function", method);
}
async function verifyRuntime() {
  const content = await source.getContent("fixture");
  assert.equal(content.title, "Fixture");
  const pages = await source.getChapterPages("fixture", "chapter");
  assert.deepEqual(Array.from(pages, page => page.url), ["https://images.example/1.webp", "https://images.example/2.webp"]);
  console.log(`Verified ${artifact} (${Buffer.byteLength(script)} bytes), catalog, JSC signing and page ordering.`);
}
verifyRuntime().catch(error => { console.error(error); process.exitCode = 1; });
