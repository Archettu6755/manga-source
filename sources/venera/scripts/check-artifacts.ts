import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

async function main() {
  const catalog = JSON.parse(fs.readFileSync("dist/index.json", "utf8")) as { key: string; url: string; name: string; version: string }[];
  assert.deepEqual(catalog.map(entry => entry.key).sort(), ["archettu_copymanga", "archettu_komiic", "archettu_mangadex"]);
  const QuickJS = await getQuickJS();
  for (const entry of catalog) {
    const id = entry.key.replace("archettu_", "");
    const script = fs.readFileSync(path.join("dist", `${id}.js`), "utf8");
    const line = script.split("\n").find(line => line.trim().startsWith("class "))!;
    assert.match(line, /^class \w+ extends ComicSource \{$/);
    const className = line.split("class")[1].split("extends ComicSource")[0].trim();
    const context = QuickJS.newContext();
    context.runtime.setMemoryLimit(96 * 1024 * 1024);
    context.runtime.setMaxStackSize(2 * 1024 * 1024);
    context.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 15_000));
    try {
      const setup = `
        const data = {};
        const settings = { api: "https://api.copy202601.com" };
        class ComicSource {
          loadData(key) { return data[key]; }
          saveData(key, value) { data[key] = value; }
          deleteData(key) { delete data[key]; }
          loadSetting(key) { return settings[key]; }
        }
        function setTimeout(callback) { callback(); }
        const manga = { id: 'fixture', attributes: { originalLanguage: 'ja', title: { en: 'Fixture' }, availableTranslatedLanguages: ['en'] }, relationships: [] };
        const chapter = { id: 'chapter', attributes: { translatedLanguage: 'en', chapter: '1', pages: 2 }, relationships: [{ id: 'fixture', type: 'manga' }] };
        const Network = {
          async get(url, headers) {
            let body;
            if (url.startsWith('https://www.copy4000.com/comics')) return { status: 200, headers: {}, body: '<main><div class="exemptComic-box" total="1" list="[{&quot;path_word&quot;:&quot;fixture&quot;,&quot;name&quot;:&quot;Fixture&quot;,&quot;cover&quot;:&quot;https://images.example/cover.jpg&quot;}]"></div></main>' };
            if (url.includes('chapter2/')) {
              if (!headers['x-auth-signature'] || !headers.pseudoid) throw new Error('Unsigned CopyManga request');
              body = { code: 200, results: { chapter: { words: [1, 0], contents: [{ url: 'https://images.example/2.jpg' }, { url: 'https://images.example/1.jpg' }] } } };
            } else if (url.includes('/at-home/')) body = { result: 'ok', baseUrl: 'https://images.example', chapter: { hash: 'hash', data: ['1.jpg', '2.jpg'], dataSaver: [] } };
            else if (url.includes('/chapter/')) body = { result: 'ok', data: chapter };
            else if (url.includes('/manga/fixture')) body = { result: 'ok', data: manga };
            else body = { result: 'ok', total: 1, offset: 0, data: [manga] };
            return { status: 200, headers: {}, body: JSON.stringify(body) };
          },
          async post(url, headers, payload) {
            const request = JSON.parse(payload);
            const data = request.operationName === 'imagesByChapterId' ? { imagesByChapterId: [{ kid: '1' }, { kid: '2' }] }
              : { comics: [{ id: 'fixture', title: 'Fixture', imageUrl: 'https://images.example/cover.jpg', status: 'ONGOING' }] };
            return { status: 200, headers: {}, body: JSON.stringify({ data }) };
          }
        };
        (() => { ${script}\nthis.temp = new ${className}(); }).call();
        globalThis.complete = false;
        globalThis.failure = null;
        (async () => {
          const pages = await temp.comic.loadEp('fixture', 'chapter');
          if (pages.images.length !== 2) throw new Error('Missing chapter pages');
          if (${JSON.stringify(id)} === 'copymanga' && pages.images[0] !== 'https://images.example/1.jpg') throw new Error('Incorrect CopyManga page ordering');
          const catalog = await temp.explore.find(page => page.type === 'multiPageComicList').load(1);
          if (catalog.comics[0].title !== 'Fixture') throw new Error('Invalid catalog');
          globalThis.result = { name: temp.name, key: temp.key, version: temp.version, url: temp.url };
          globalThis.complete = true;
        })().catch(error => { globalThis.failure = String(error); globalThis.complete = true; });
      `;
      context.unwrapResult(context.evalCode(setup)).dispose();
      while (context.runtime.hasPendingJob()) context.unwrapResult(context.runtime.executePendingJobs());
      const outcome = context.unwrapResult(context.evalCode("JSON.stringify({ complete, failure, result: globalThis.result })"));
      const result = JSON.parse(context.getString(outcome));
      outcome.dispose();
      assert.equal(result.complete, true, `${id} unresolved promise`);
      assert.equal(result.failure, null, `${id} QuickJS runtime failure`);
      for (const key of ["key", "version", "name", "url"] as const) assert.equal(result.result[key], entry[key]);
      console.log(`Verified ${id}.js in QuickJS: loader, metadata, browsing and chapter page URLs.`);
    } finally { context.dispose(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
