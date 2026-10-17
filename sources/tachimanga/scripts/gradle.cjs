const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const tags = JSON.parse(fs.readFileSync(path.join(root, "..", "venera", "src", "mangadex-tags.json"), "utf8"));
const output = path.join(root, "src", "main", "java", "eu", "kanade", "tachiyomi", "extension", "all", "archettu", "GeneratedTags.kt");
const kotlin = `package eu.kanade.tachiyomi.extension.all.archettu\n\nobject GeneratedTags {\n    val values = listOf(\n${tags.map(tag => `        ${JSON.stringify(tag.id)} to ${JSON.stringify(tag.name)}`).join(",\n")}\n    )\n}\n`;
if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== kotlin) fs.writeFileSync(output, kotlin);
const assets = path.join(root, "build", "generated", "assets");
fs.mkdirSync(assets, { recursive: true });
for (const [id, name] of [["manhuagui", "Manhuagui"], ["zaimanhua", "Zaimanhua"]]) {
  const protocol = require(`@archettu/${id}`);
  fs.writeFileSync(path.join(assets, `${id}-catalog.json`), JSON.stringify({ feeds: protocol.FEEDS, filters: protocol.FILTERS }));
}
fs.writeFileSync(path.join(assets, "THIRD_PARTY_NOTICES.txt"), fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.txt"), "utf8").replace(/\r\n/g, "\n"));
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java";
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const properties = proxy ? ["http", "https"].flatMap(protocol => {
  const url = new URL(proxy);
  return [`-D${protocol}.proxyHost=${url.hostname}`, `-D${protocol}.proxyPort=${url.port || "80"}`];
}) : [];
const env = { ...process.env };
if (properties.length) env.JAVA_TOOL_OPTIONS = [env.JAVA_TOOL_OPTIONS, ...properties].filter(Boolean).join(" ");
const result = spawnSync(java, ["-classpath", path.join(root, "gradle", "wrapper", "gradle-wrapper.jar"), "org.gradle.wrapper.GradleWrapperMain", "--console=plain", ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });
if (result.error) { console.error("Tachimanga 构建需要 JDK 17+ 和 Android SDK 35：", result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
