import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

async function main() {
  const catalog = JSON.parse(fs.readFileSync("dist/index.json", "utf8")) as { key: string; url: string; name: string; version: string }[];
  assert.deepEqual(catalog.map(entry => entry.key).sort(), ["archettu_copymanga", "archettu_ehentai", "archettu_jmcomic", "archettu_komiic", "archettu_mangadex", "archettu_manhuagui", "archettu_zaimanhua"]);
  const sites = JSON.parse(fs.readFileSync(path.join("..", "..", "fixtures", "sites.json"), "utf8"));
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
        const id = ${JSON.stringify(id)};
        const settings = { api: "https://api.copy202601.com" };
        const sites = ${JSON.stringify(sites)};
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
            if (id === 'jmcomic') return { status: 200, headers: {}, body: JSON.stringify({ code: 200,
              data: url.includes('/chapter?') ? { images: ['00001.jpg', '00002.jpg'] } : [{ type: 'promote', content: [{ id: 500001, name: 'Fixture' }] }] }) };
            if (id === 'ehentai') {
              const body = url.includes('/g/') ? '<div id="gdt"><a href="/s/0000000001/23-1">1</a><a href="/s/0000000002/23-2">2</a></div>'
                : url.includes('/s/') ? '<img id="img" src="https://fixture.hath.network/image.jpg">'
                : '<table class="itg"><tr><td><a href="/g/23/0123456789/"><div class="glink">Fixture</div></a></td></tr></table>';
              return { status: 200, headers: {}, body };
            }
            if (url.startsWith('https://marketing.aiacgn.com/')) return { status: 200, headers: {}, body: JSON.stringify({ code: 200, results: { request_id: 'fixture-id' } }) };
            if (${JSON.stringify(id)} === 'manhuagui') return { status: 200, headers: {}, body: url.endsWith('22.html') ? sites.manhuagui.packed : url.includes('/comic/') ? sites.manhuagui.detail : sites.manhuagui.list };
            if (${JSON.stringify(id)} === 'zaimanhua') return { status: 200, headers: {}, body: JSON.stringify({ errno: 0, data: url.includes('/comic/chapter/') ? { data: sites.zaimanhua.pages } : [sites.zaimanhua.listItem] }) };
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
            if (id === 'ehentai') return { status: 200, headers: {}, body: JSON.stringify({ gmetadata: [{ gid: 23, token: '0123456789', title: 'Fixture', filecount: '2' }] }) };
            const data = request.operationName === 'imagesByChapterId' ? { imagesByChapterId: [{ kid: '1' }, { kid: '2' }] }
              : request.operationName === 'getImageTicket' ? { getImageTicket: { kid: request.variables.kid, url: 'https://public.komiic.com/image.jpg', ticket: 'fixture-ticket', expiresAt: new Date(Date.now()+60000).toISOString() } }
              : { comics: [{ id: 'fixture', title: 'Fixture', imageUrl: 'https://images.example/cover.jpg', status: 'ONGOING' }] };
            return { status: 200, headers: {}, body: JSON.stringify({ data }) };
          }
        };
        (() => { ${script}\nthis.temp = new ${className}(); }).call();
        globalThis.complete = false;
        globalThis.failure = null;
        (async () => {
          const added = ['manhuagui', 'zaimanhua'].includes(${JSON.stringify(id)});
          const comicId = id === 'ehentai' ? '23-0123456789' : id === 'jmcomic' ? '500001' : added ? '123' : 'fixture';
          const chapterId = id === 'ehentai' ? 'ep:gallery' : id === 'jmcomic' ? 'ep:500001' : added ? '22' : 'chapter';
          const links = { copymanga: ['https://www.copy4000.com/comic/fixture', 'fixture'], komiic: ['https://komiic.com/comic/fixture', 'fixture'],
            mangadex: ['https://mangadex.org/title/01234567-89ab-cdef-0123-456789abcdef', '01234567-89ab-cdef-0123-456789abcdef'],
            manhuagui: ['https://www.manhuagui.com/comic/123/', '123'], zaimanhua: ['https://m.zaimanhua.com/pages/comic/detail?id=123', '123'],
            jmcomic: ['https://18comic.vip/album/500001', '500001'], ehentai: ['https://e-hentai.org/g/23/0123456789/', '23-0123456789'] };
          if (temp.comic.link.linkToId(links[id][0]) !== links[id][1]) throw new Error('Invalid comic link');
          const pages = await temp.comic.loadEp(comicId, chapterId);
          if (pages.images.length !== 2) throw new Error('Missing chapter pages');
          if (id === 'komiic' && (await temp.comic.onImageLoad(pages.images[0], comicId, chapterId)).headers['X-Image-Ticket'] !== 'fixture-ticket') throw new Error('Missing Komiic image ticket');
          if (id === 'ehentai' && (await temp.comic.onImageLoad(pages.images[0], comicId, chapterId)).url !== 'https://fixture.hath.network/image.jpg') throw new Error('Invalid E-Hentai viewer image');
          if (id === 'jmcomic' && !temp.comic.onImageLoad(pages.images[0], comicId, chapterId).modifyImage) throw new Error('Missing JMComic image rearrangement');
          if (${JSON.stringify(id)} === 'copymanga' && pages.images[0] !== 'https://images.example/1.jpg') throw new Error('Incorrect CopyManga page ordering');
          const catalog = await temp.explore.find(page => page.type === 'multiPageComicList').load(1);
          if (catalog.comics[0].title !== (added ? '测试作品' : 'Fixture')) throw new Error('Invalid catalog');
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
