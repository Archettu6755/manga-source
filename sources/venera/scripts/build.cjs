const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { bundle, sources } = require("./bundle.cjs");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const repository = path.resolve(root, "..", "..");
const dependencies = ["crypto-js", "cheerio", "cheerio-select", "htmlparser2", "domhandler", "domutils", "dom-serializer",
  "domelementtype", "entities", "htmlparser2/node_modules/entities", "css-select", "css-what", "boolbase", "nth-check", "json5", "lz-string"];
const notices = dependencies.map(name => {
  const directory = path.join(repository, "node_modules", name);
  const license = fs.readdirSync(directory).find(file => /^license(?:\.md|\.txt)?$/i.test(file));
  const file = license ? path.join(directory, license) : name === "boolbase"
    ? path.join(root, "scripts", "licenses", "boolbase.txt") : null;
  if (!file) throw new Error(`Missing license: ${name}`);
  return `${name}\n${fs.readFileSync(file, "utf8")}`;
}).join("\n\n") + `\n\nJMComic-Crawler-Python\n${fs.readFileSync(path.join(root, "scripts", "licenses", "jmcomic-crawler.txt"), "utf8")}`;
fs.mkdirSync(output, { recursive: true });
const catalog = sources.map(id => {
  const script = bundle(id);
  const className = script.split("\n")[0].split("class ")[1].split(" extends ComicSource")[0];
  const context = vm.createContext({ ComicSource: class {} });
  vm.runInContext(`(() => { ${script}\nthis.source = new ${className}(); }).call()`, context, { timeout: 5000 });
  const source = context.source;
  const noticesComment = `\n/*\nThird-party notices\n${notices.replace(/\*\//g, "* /")}\n*/\n`;
  fs.writeFileSync(path.join(output, `${id}.js`), script + noticesComment);
  return { name: source.name, key: source.key, version: source.version, url: source.url, description: "" };
});
fs.writeFileSync(path.join(output, "index.json"), `${JSON.stringify(catalog, null, 2)}\n`);
fs.writeFileSync(path.join(output, "THIRD_PARTY_NOTICES.txt"), notices);
fs.copyFileSync(path.join(root, "web", "index.html"), path.join(output, "index.html"));
console.log(`Built ${catalog.length} Venera sources and index.json.`);
