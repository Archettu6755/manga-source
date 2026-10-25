"use httpclient";
import { ContentRating, type SourceInfo, type STTStore } from "@suwatte/toolchain/types";
import { Zaimanhua, WEBSITE } from "@archettu/zaimanhua";
import { CatalogSource } from "../../catalog";
declare const SecureStore: STTStore;
export default class ZaimanhuaSource extends CatalogSource {
  static info: SourceInfo = { id: "zh.zaimanhua", name: "再漫画 · Archettu", version: 2, website: WEBSITE,
    languages: ["zh-Hans", "zh-Hant"], rating: ContentRating.UNKNOWN, minSupportedAppVersion: "7.0.0" };
  constructor() { super(request => new Zaimanhua(request, { get: async () => await SecureStore.string("zaimanhua.token") || "",
    set: token => SecureStore.set("zaimanhua.token", token), clear: () => SecureStore.remove("zaimanhua.token") }), 0.5); }
}
