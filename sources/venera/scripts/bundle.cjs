const path = require("node:path");
const { buildSync } = require("esbuild");
const root = path.resolve(__dirname, "..");
const sources = ["copymanga", "komiic", "mangadex"];
function bundle(id) {
  if (!sources.includes(id)) throw new Error(`Unknown source: ${id}`);
  const className = `Archettu${id[0].toUpperCase()}${id.slice(1)}`;
  const namespace = `${className}Bundle`;
  const { outputFiles } = buildSync({
    entryPoints: [path.join(root, "src", `${id}.ts`)], bundle: true, write: false,
    inject: [path.join(root, "src", "base64.ts")],
    platform: "browser", format: "iife", globalName: namespace, target: "es2020", legalComments: "inline",
  });
  // Venera discovers the first class declaration before evaluating the script.
  return `class ${className} extends ComicSource {\n  constructor() {\n    super();\n    Object.assign(this, ${namespace}.createSource(this));\n  }\n}\n${outputFiles[0].text}`;
}
module.exports = { bundle, sources };
