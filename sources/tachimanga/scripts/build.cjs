const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8"));
if (process.env.TACHIMANGA_KEYSTORE) {
  // Signed releases must use a full build, matching the fresh CI checkout.
  const clean = spawnSync(process.execPath, [path.join(__dirname, "gradle.cjs"), "clean"], { stdio: "inherit", env: process.env });
  if (clean.status !== 0) process.exit(clean.status ?? 1);
}
const build = spawnSync(process.execPath, [path.join(__dirname, "gradle.cjs"), "assembleRelease"], { stdio: "inherit", env: process.env });
if (build.status !== 0) process.exit(build.status ?? 1);
const output = path.join(root, "dist");
fs.mkdirSync(path.join(output, "apk"), { recursive: true });
const apk = `tachiyomi-all.archettu-v${catalog.version}.apk`;
const source = path.join(root, "build", "outputs", "apk", "release", process.env.TACHIMANGA_KEYSTORE ? "archettu-tachimanga-release.apk" : "archettu-tachimanga-release-unsigned.apk");
if (!fs.existsSync(source)) throw new Error(`Missing APK: ${source}`);
const release = path.join(root, "release", apk);
if (process.env.TACHIMANGA_KEYSTORE) {
  fs.mkdirSync(path.dirname(release), { recursive: true });
  fs.copyFileSync(source, release);
}
if (!fs.existsSync(release)) throw new Error("No signed release APK. Build once with TACHIMANGA_KEYSTORE and TACHIMANGA_KEY_PASSWORD, then commit the public APK in release/.");
const verify = spawnSync(process.env.PYTHON || "python", [path.join(__dirname, "verify-apk.py"), source, release], { stdio: "inherit", env: process.env });
if (verify.status !== 0) process.exit(verify.status ?? 1);
fs.copyFileSync(release, path.join(output, "apk", apk));
fs.mkdirSync(path.join(output, "icon"), { recursive: true });
fs.copyFileSync(path.join(root, "web", "icon.png"), path.join(output, "icon", `${catalog.package}.png`));
const entry = { name: `Tachiyomi: ${catalog.name}`, pkg: catalog.package, apk, lang: "all", code: catalog.code, version: catalog.version, nsfw: 0, sources: catalog.sources };
fs.writeFileSync(path.join(output, "index.min.json"), JSON.stringify([entry]));
fs.writeFileSync(path.join(output, "index.json"), `${JSON.stringify([entry], null, 2)}\n`);
const fingerprint = fs.readFileSync(path.join(root, "signing-fingerprint.txt"), "utf8").trim();
fs.writeFileSync(path.join(output, "repo.json"), JSON.stringify({ meta: { name: catalog.name, shortName: "杕", website: "https://archettu6755.github.io/manga-source/tachimanga/", signingKeyFingerprint: fingerprint } }, null, 2) + "\n");
fs.copyFileSync(path.join(root, "web", "index.html"), path.join(output, "index.html"));
fs.copyFileSync(path.join(root, "THIRD_PARTY_NOTICES.txt"), path.join(output, "THIRD_PARTY_NOTICES.txt"));
console.log(`Built Tachimanga ${catalog.version}: ${catalog.sources.length} sources.`);
