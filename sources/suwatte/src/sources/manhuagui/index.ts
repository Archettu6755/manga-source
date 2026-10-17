"use httpclient";
import { ContentRating, type SourceInfo } from "@suwatte/toolchain/types";
import { Manhuagui, WEBSITE } from "@archettu/manhuagui";
import { CatalogSource } from "../../catalog";
export default class ManhuaguiSource extends CatalogSource {
  static info: SourceInfo = { id: "zh.manhuagui", name: "漫画柜 · Archettu", version: 1, website: WEBSITE,
    languages: ["zh-Hans", "zh-Hant"], rating: ContentRating.UNKNOWN, minSupportedAppVersion: "7.0.0" };
  constructor() { super(request => new Manhuagui(request, async key => await ObjectStore.string(`manhuagui.${key}`) || ""), 1); }
}
