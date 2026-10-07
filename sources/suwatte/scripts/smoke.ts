import emulate from "@suwatte/toolchain/emulator";
import { wrapDelegateWithValidation } from "@suwatte/toolchain/validate";
import CopyManga from "../src/sources/copymanga";

async function main() {
  const source = wrapDelegateWithValidation(emulate<CopyManga>(CopyManga, { resetStores: true }));
  if (process.env.COPYMANGA_API) await source.onFormSubmitted("settings", { api: process.env.COPYMANGA_API });
  const query = process.env.COPYMANGA_QUERY || "葬送的芙莉蓮";
  const itemId = process.env.COPYMANGA_COMIC;
  let id = itemId;
  let stage = "search";
  try {
    if (!id) {
      const results = await source.getSearchResults({ query }, 1);
      console.log(JSON.stringify({ stage, passed: true, count: results.items.length, total: results.total }));
      id = results.items[0]?.id;
      if (!id) throw new Error("搜索未找到测试漫画，可设置 COPYMANGA_COMIC 指定作品。");
    }
    stage = "details";
    const content = await source.getContent(id);
    console.log(JSON.stringify({ stage, passed: true, title: content.title }));
    stage = "chapters";
    const chapters = await source.getChapters(id);
    console.log(JSON.stringify({ stage, passed: true, count: chapters.length }));
    stage = "pages";
    const pages = await source.getChapterPages(id, chapters[0].id);
    console.log(JSON.stringify({ stage, passed: true, count: pages.length }));
    stage = "image-head";
    const image = await source.client.head(pages[0].url!);
    const type = image.headers.get("content-type");
    if (image.status !== 200 || !type?.startsWith("image/")) throw new Error(`图片检查失败（HTTP ${image.status}，${type}）。`);
    console.log(JSON.stringify({ stage, passed: true, type }));
  } catch (error) {
    console.error(JSON.stringify({ stage, passed: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 2;
  }
}

// The emulator unrefs rate-limit timers; retain the process until all stages finish.
const keepAlive = setInterval(() => {}, 1_000);
void main().finally(() => clearInterval(keepAlive));
