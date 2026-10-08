const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHmac } = require("node:crypto");

const catalog = JSON.parse(fs.readFileSync("dist/sources.json", "utf8"));
assert.equal(catalog.catalogVersion, 2);
assert.deepEqual(catalog.sources.map(source => source.id).sort(), ["en.mangadex", "zh.copymanga", "zh.komiic"]);
const info = catalog.sources.find(source => source.id === "zh.copymanga");
assert.equal(info.id, "zh.copymanga");
assert.equal(info.environment, "jsc");
const artifact = path.join("dist", "sources", `${info.path}.stt`);
const notices = [
  ["CryptoJS", path.join(path.dirname(require.resolve("crypto-js")), "LICENSE")],
  ["Suwatte Toolchain", path.join(path.dirname(require.resolve("@suwatte/toolchain")), "..", "LICENSE")],
  ...["cheerio", "cheerio-select", "htmlparser2", "domhandler", "domutils", "dom-serializer", "domelementtype", "entities", "css-select", "css-what", "boolbase", "nth-check", "json5"].map(name => {
    if (name === "boolbase") return [name, path.join("scripts", "licenses", "boolbase.txt")];
    const directory = path.join("..", "..", "node_modules", name);
    const license = fs.readdirSync(directory).find(file => /^license(?:\.md|\.txt)?$/i.test(file));
    assert.ok(license, `${name} license`);
    return [name, path.join(directory, license)];
  }),
].map(([name, file]) => `${name}\n${fs.readFileSync(file, "utf8")}`).join("\n\n");
for (const source of catalog.sources) {
  assert.equal(source.environment, "jsc");
  const file = path.join("dist", "sources", `${source.path}.stt`);
  const bundle = fs.readFileSync(file, "utf8") + `\n/*\nThird-party notices\n${notices.replace(/\*\//g, "* /")}\n*/\n`;
  assert.match(bundle.slice(0, 512), /"use httpclient"/);
  fs.writeFileSync(file, bundle);
}
const script = fs.readFileSync(artifact, "utf8");
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
    if (url.includes("/comics") && url.startsWith("https://www.mangacopy.com/")) {
      return { status: 200, text: async () => '<main><div class="exemptComic-box" total="1" list="[{&quot;path_word&quot;:&quot;fixture&quot;,&quot;name&quot;:&quot;Fixture&quot;,&quot;cover&quot;:&quot;https://images.example/cover.jpg&quot;}]"></div></main>' };
    }
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
  assert.equal((await source.getItemList({ key: "all" }, 1)).items[0].title, "Fixture");
  console.log(`Verified ${artifact} (${Buffer.byteLength(script)} bytes), catalog, JSC signing and page ordering.`);
  for (const id of ["zh.komiic", "en.mangadex"]) {
    const metadata = catalog.sources.find(entry => entry.id === id);
    const file = path.join("dist", "sources", `${metadata.path}.stt`);
    const japaneseManga = { id: "fixture", attributes: { originalLanguage: "ja", title: { en: "Fixture" } }, relationships: [] };
    class NewClient {
      interceptors = { request: { use() {} }, response: { use() {} } };
      async post(url, body) {
        const request = JSON.parse(body);
        return { status: 200, json: async () => ({ data: request.operationName === "imagesByChapterId"
          ? { imagesByChapterId: [{ kid: "z" }, { kid: "a" }] }
          : { comicById: { id: "fixture", title: "Fixture", imageUrl: "https://images.example/cover.jpg", status: "ONGOING" } } }) };
      }
      async get(url) {
        const body = url.includes("/at-home/")
          ? { baseUrl: "https://images.example", chapter: { hash: "hash", data: ["z.jpg", "a.jpg"], dataSaver: [] } }
          : { data: url.includes("/chapter/")
            ? { id: "chapter", attributes: { translatedLanguage: "en", pages: 2 }, relationships: [{ id: "fixture", type: "manga" }] }
            : japaneseManga };
        return { status: 200, json: async () => ({ result: "ok", ...body }) };
      }
    }
    const scope = vm.createContext({ HttpClient: NewClient, ObjectStore: store, SecureStore: store });
    vm.runInContext(fs.readFileSync(file, "utf8"), scope, { timeout: 5_000 });
    const delegate = scope.SourcePackage.bootstrap();
    assert.equal((await delegate.getContent("fixture")).title, "Fixture");
    const images = await delegate.getChapterPages("fixture", "chapter");
    assert.deepEqual(Array.from(images, page => page.url), id === "zh.komiic"
      ? ["https://komiic.com/api/image/z", "https://komiic.com/api/image/a"]
      : ["https://images.example/data/hash/z.jpg", "https://images.example/data/hash/a.jpg"]);
    if (id === "zh.komiic") assert.equal(images[0].context.chapterId, "chapter");
    console.log(`Verified ${file}, JSC content, image order and source bootstrap.`);
  }
}
verifyRuntime().catch(error => { console.error(error); process.exitCode = 1; });
