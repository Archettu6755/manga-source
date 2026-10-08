import assert from "node:assert/strict";
import test from "node:test";
import emulate, { HttpClient as EmulatorClient } from "@suwatte/toolchain/emulator";
import type { HttpRequest } from "@suwatte/toolchain/types";
import CopyManga from "../src/sources/copymanga";
import Komiic from "../src/sources/komiic";
import MangaDex from "../src/sources/mangadex";

test("all source limiters permit continued browsing after the initial five requests", async () => {
  const prototype = EmulatorClient.prototype as unknown as { dispatch(request: HttpRequest): Promise<unknown> };
  const original = prototype.dispatch;
  let count = 0;
  prototype.dispatch = async request => {
    count++;
    const body = request.url.includes("komiic.com") ? { data: { comics: [{ id: "k", title: "K", imageUrl: "https://images.example/k.jpg", status: "ONGOING" }] } }
      : request.url.includes("mangadex.org") ? { result: "ok", offset: 0, total: 1, data: [{ id: "m", relationships: [], attributes: { title: { en: "M" }, originalLanguage: "ja", availableTranslatedLanguages: ["en"] } }] }
        : { code: 200, results: { list: [{ path_word: "c", name: "C", cover: "https://images.example/c.jpg" }], offset: 0, total: 1 } };
    return { status: 200, json: async () => body,
      text: async () => '<main><div class="exemptComic-box" total="1" list="[{&quot;path_word&quot;:&quot;c&quot;,&quot;name&quot;:&quot;C&quot;,&quot;cover&quot;:&quot;https://images.example/c.jpg&quot;}]"></div></main>' };
  };
  const keepAlive = setInterval(() => {}, 1_000);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        for (const name of ["copymanga", "komiic", "mangadex"]) {
          const source = name === "copymanga" ? emulate<CopyManga>(CopyManga, { resetStores: true })
            : name === "komiic" ? emulate<Komiic>(Komiic, { resetStores: true }) : emulate<MangaDex>(MangaDex, { resetStores: true });
          if (name === "copymanga") await ObjectStore.set("copymanga.api", "https://api.copy202601.com");
          for (let index = 0; index < 6; index++) assert.equal((await source.getItemList({ key: "popular" }, 1)).items.length, 1);
        }
      })(),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Source limiter blocked browsing: period must be expressed in seconds.")), 7_000); }),
    ]);
    assert.equal(count, 18);
  } finally {
    prototype.dispatch = original;
    if (deadline) clearTimeout(deadline);
    clearInterval(keepAlive);
  }
});
