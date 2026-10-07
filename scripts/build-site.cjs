const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "site");
fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(root, "sources", "suwatte", "dist"), path.join(output, "suwatte"), { recursive: true });
fs.copyFileSync(path.join(root, "web", "index.html"), path.join(output, "index.html"));
fs.writeFileSync(path.join(output, ".nojekyll"), "");
console.log("Published layout: site/suwatte/. Venera is reserved and has no released source yet.");
