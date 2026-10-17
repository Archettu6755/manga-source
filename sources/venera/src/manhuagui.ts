import { Manhuagui } from "@archettu/manhuagui";
import { createCatalog } from "./catalog";
import type { SourceStore } from "./runtime";
export function createSource(source: SourceStore) {
  return createCatalog(source, request => new Manhuagui(request, async key => String(source.loadSetting(key) ?? "")), 1000);
}
