const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DIAGNOSTIC_SOURCES, DIAGNOSTIC_STAGES, sanitizeDiagnosticMessage } = require("@archettu/manga-core");
const root = path.resolve(__dirname, "..");

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("npm run diagnose -- [--reader suwatte|venera] [--source all|copymanga|komiic|mangadex|manhuagui|zaimanhua] [--komiic-site com|cc] [--stage browse|search|details|chapters|pages|image] [--output report.json]");
    return;
  }
  const values = { "--reader": "suwatte", "--source": "all", "--komiic-site": "com", "--stage": "pages", "--output": "__temp__/diagnostics-latest.json" };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!(key in values) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`无效参数：${key}。运行 --help 查看用法。`);
    values[key] = args[index + 1];
  }
  const reader = values["--reader"], source = values["--source"], site = values["--komiic-site"], stage = values["--stage"];
  if (!["suwatte", "venera"].includes(reader)) throw new Error("诊断阅读器可选 suwatte 或 venera；Tachimanga 需要设备端验证。");
  if (source !== "all" && !DIAGNOSTIC_SOURCES.includes(source)) throw new Error("无效图源名称。");
  if (!["com", "cc"].includes(site)) throw new Error("Komiic 入口可选 com 或 cc。");
  if (!DIAGNOSTIC_STAGES.includes(stage)) throw new Error("无效诊断阶段。");
  const output = path.resolve(root, values["--output"]);
  if (!output.endsWith(".json")) throw new Error("诊断报告路径必须以 .json 结尾。");
  const options = { sources: source === "all" ? DIAGNOSTIC_SOURCES : [source], stage, komiicWebsite: `https://komiic.${site}` };
  const tsx = require.resolve("tsx/cli");
  const child = spawn(process.execPath, [tsx, path.join(root, "sources", reader, "scripts", "diagnose.ts"), JSON.stringify(options)], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", data => { stdout += data; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  if (code !== 0) throw new Error("诊断进程未完成，请查看上方初始化或运行错误。");
  const results = JSON.parse(stdout);
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), reader, requestedStage: stage, komiicWebsite: options.komiicWebsite, results };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  const lines = ["| 图源 | 结果 | 已执行步骤 |", "| --- | --- | --- |", ...results.map(result => `| ${result.source} | ${result.status} | ${result.stages.filter(step => step.status !== "skipped").map(step => `${step.stage}: ${step.status}`).join(" / ")} |`)];
  console.log(lines.join("\n"));
  console.log(`报告：${path.relative(root, output)}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  if (results.some(result => result.status !== "passed")) process.exitCode = 2;
}
main().catch(error => { console.error(sanitizeDiagnosticMessage(error)); process.exitCode = 1; });
