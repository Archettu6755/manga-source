import emulate from "@suwatte/toolchain/emulator";
import { wrapDelegateWithValidation } from "@suwatte/toolchain/validate";
import CopyManga from "../src/sources/copymanga";
import Komiic from "../src/sources/komiic";
import MangaDex from "../src/sources/mangadex";

async function main() {
  const name = process.argv[2] || "copymanga";
  if (!["copymanga", "komiic", "mangadex"].includes(name)) throw new Error("请选择 copymanga、komiic 或 mangadex。");
  const adapter = name === "komiic" ? emulate<Komiic>(Komiic, { resetStores: true })
    : name === "mangadex" ? emulate<MangaDex>(MangaDex, { resetStores: true }) : emulate<CopyManga>(CopyManga, { resetStores: true });
  const source = wrapDelegateWithValidation(adapter);
  if (name === "copymanga" && process.env.COPYMANGA_API) await source.onFormSubmitted("settings", { api: process.env.COPYMANGA_API });
  const query = process.env.SOURCE_QUERY || (name === "mangadex" ? "Yotsuba" : process.env.COPYMANGA_QUERY || "葬送的芙莉蓮");
  const itemId = process.env.SOURCE_COMIC || (name === "copymanga" ? process.env.COPYMANGA_COMIC : undefined);
  let id = itemId;
  let stage = "search";
  try {
    if (!id) {
      const results = await source.getSearchResults({ query }, 1);
      console.log(JSON.stringify({ stage, passed: true, count: results.items.length, total: results.total }));
      id = results.items[0]?.id;
      if (!id) throw new Error("搜索未找到测试漫画，可设置 SOURCE_COMIC 指定作品。");
    }
    stage = "details";
    const content = await source.getContent(id);
    console.log(JSON.stringify({ stage, passed: true, title: content.title }));
    stage = "chapters";
    const chapters = await source.getChapters(id);
    console.log(JSON.stringify({ stage, passed: true, count: chapters.length }));
    stage = "pages";
    if (!chapters.length) throw new Error("当前语言或章节类型未返回可读章节。");
    const pages = await source.getChapterPages(id, chapters[0].id);
    console.log(JSON.stringify({ stage, passed: true, count: pages.length }));
    stage = name === "komiic" ? "image-get" : "image-head";
    // The SDK validator drops ChapterPage.context; supply it for the emulator probe.
    const config = { context: { comicId: id, chapterId: chapters[0].id } };
    const image = name === "komiic" ? await source.client.get(pages[0].url!, config) : await source.client.head(pages[0].url!, config);
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
void main().catch(error => { console.error(error.message); process.exitCode = 2; }).finally(() => clearInterval(keepAlive));
