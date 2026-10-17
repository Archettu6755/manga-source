import { Zaimanhua } from "@archettu/zaimanhua";
import { createCatalog } from "./catalog";
import type { SourceStore } from "./runtime";
export function createSource(source: SourceStore) {
  return createCatalog(source, request => new Zaimanhua(request, { get: async () => String(source.loadData("token") || ""),
    set: async token => { source.saveData("token", token); }, clear: async () => { source.deleteData("token"); } }), 500);
}
