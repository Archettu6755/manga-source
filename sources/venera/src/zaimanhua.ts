import { httpError, numericId, query } from "@archettu/manga-core";
import { API, Zaimanhua, readData } from "@archettu/zaimanhua";
import { createCatalog } from "./catalog";
import { comicLink, pageNumber, type SourceStore } from "./runtime";

const domains = ["zaimanhua.com", "www.zaimanhua.com", "manhua.zaimanhua.com", "m.zaimanhua.com"];
const link = comicLink(domains, path => /^\/comic\/(\d+)(?:[/?]|$)/.exec(path)?.[1] ??
  /^\/pages\/comic\/detail\?(?:[^&]+&)*id=(\d+)(?:&|$)/.exec(path)?.[1]);
const commentParams = (id: string, chapter: string) => ({ comicId: numericId(id), chapterId: numericId(chapter.replace(/^ep:/, "")) });

export function createSource(source: SourceStore) {
  const token = () => String(source.loadData("token") || "");
  return createCatalog(source, request => new Zaimanhua(request, { get: async () => token(),
    set: async value => { source.saveData("token", value); }, clear: async () => { source.deleteData("token"); } }), 500, "1.2.6", (site, request) => {
    const headers = (value: string) => ({ ...site.imageHeaders(), Platform: "android", ...(value ? { Authorization: `Bearer ${value}` } : {}) });
    return {
      link,
      async loadChapterComments(id, chapter, page, replyTo) {
        pageNumber(page);
        if (replyTo || page !== 1) return { comments: [], maxPage: 1 };
        const result = readData<{ list?: unknown }>(await request(`${API}/viewpoint/list?${query(commentParams(id, chapter))}`, headers(token())));
        if (!Array.isArray(result.list)) throw new Error("再漫画章节评论格式已变化。");
        const unique = new Map<string, { user: string; content: string }>();
        for (const row of result.list) {
          const content = Array.isArray(row) ? row[row.length - 1] : undefined;
          if (!Array.isArray(row) || row.length < 2 || typeof content !== "string") throw new Error("再漫画章节评论格式已变化。");
          const value = row[row.length - 2];
          const user = typeof value === "string" || typeof value === "number" ? String(value) : "";
          unique.set(JSON.stringify([user, content]), { user, content });
        }
        const comments = [...unique.values()].map(({ user, content }, index) => ({ id: `${chapter}:${index}`, userName: user ? `用户 ${user}` : "匿名用户", content }));
        return { comments, maxPage: 1 };
      },
      async sendChapterComment(id, chapter, content, replyTo) {
        if (replyTo) throw new Error("再漫画章节评论仅支持直接发表。");
        const value = token();
        if (!value) throw new Error("请先登录再漫画。");
        if (!content.trim()) throw new Error("评论不能为空。");
        const response = await request(`${API}/viewpoint/add`, { ...headers(value), "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
          query({ ...commentParams(id, chapter), content }));
        if (response.status !== 200) throw httpError(response.status, "再漫画");
        const result = JSON.parse(response.body) as { errno?: number; errmsg?: string };
        if (result?.errno !== 0) throw new Error(result?.errmsg || "再漫画未确认评论已发送。");
      },
    };
  });
}
