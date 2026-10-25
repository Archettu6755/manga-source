# 杕的自用漫画源

为 Suwatte、Venera 和 Tachimanga 维护独立的 CopyManga、Komiic、MangaDex、漫画柜和再漫画 源。仓库保存适配代码，漫画内容由设备直接请求原网站。

目前仅在 **Suwatte** 实际使用测试过。Venera 和 Tachimanga 尚未完成实机验证；编译、自动化测试和接口检查通过不代表已在这两款阅读器中验证阅读体验。

## Suwatte 安装

源要求 Suwatte 7.0.0 或更新版本。在阅读器设置的 Sources 中添加以下地址，再选择要安装的源：

```text
https://archettu6755.github.io/manga-source/suwatte/
```

[发布首页](https://archettu6755.github.io/manga-source/)提供各阅读器的入口。[Suwatte 使用说明](sources/suwatte/README.md)介绍登录、API 设置和访问限制。

## Venera 安装

以原版 Venera 1.6.3 为基准。在漫画源管理中将源仓库地址设为以下 JSON 地址，再选择需要的源；也可通过单个 `.js` 链接安装。

```text
https://archettu6755.github.io/manga-source/venera/index.json
```

[Venera 使用说明](sources/venera/README.md)包含安装、账号存储、入口导航和 fork 接口核对结果。各阅读器的源列表分别发布。

## Tachimanga 安装

在 App Store 版 Tachimanga 的「浏览 → 扩展 → ＋ → 扩展仓库」中添加以下地址，再安装「杕的自用漫画源」。一个 APK 提供五个图源，图源语言筛选启用中文和多语言（Multi）。

```text
https://archettu6755.github.io/manga-source/tachimanga/index.min.json
```

[Tachimanga 使用说明](sources/tachimanga/README.md)介绍设置、目录筛选和签名发布流程；[入口清单](sources/tachimanga/ENTRYPOINTS.md)说明原生筛选器中的导航方式。

| 源 | 阅读内容 | 设置 |
| --- | --- | --- |
| 拷贝漫画 · Archettu | 中文漫画 | 官网入口、大陆／海外线路、API 域名与刷新、搜索接口、账号登录 |
| 漫画柜 · Archettu | 简体／繁体中文漫画 | 完整索引、四周期排行、成人提示确认、图片服务器选择 |
| 再漫画 · Archettu | 简体中文为主的漫画 | 官网推荐、动态网页索引、App 分类、排行、账号登录 |
| Komiic · Archettu | 以繁体中文为主的漫画 | komiic.com／komiic.cc 入口、卷与章节筛选、账号登录 |
| MangaDex（日漫）· Archettu | 原始语言为日语的日本漫画，不默认译文语言 | 默认不限；可选简体中文、繁体中文、英文或日语，支持节省图片流量 |

MangaDex 的原始语言筛选同时作用于列表、详情、目录和图片读取。英文翻译的韩漫与欧美原创漫画不会出现在这个源中。外站章节、未发布章节和不可用章节不列入目录。

CopyManga 已补齐大陆详情和章节接口使用的 `request_id` 流程。服务器的 210 限制仍由网站决定，详见 [协议与验证记录](docs/source-protocols.md)。

各源的公开漫画浏览入口与数据来源见 [Suwatte 入口清单](sources/suwatte/ENTRYPOINTS.md)与 [Venera 入口清单](sources/venera/ENTRYPOINTS.md)。保留已发布的入口 ID；增补网站入口时同时检查分类、筛选与分页。

## 大陆入口与可达性诊断

Komiic 的图源设置新增「访问入口」。大陆网络可选择 `komiic.cc`，原入口 `komiic.com` 继续保留。接口、封面、图片和网页链接随所选入口更新；两个域名分别登录，切换后刷新当前作品和目录。不会将原入口的登录会话发送到新入口，也不会在访问受限时自动换站。

CopyManga 已默认使用 `copy4000` 大陆入口和大陆资源线路。其他图源本轮未核实到明确公布的大陆专用入口，保留现有地址；核对范围见 [协议与入口记录](docs/source-protocols.md)。

统一检查五个图源，默认使用 Suwatte 模拟器，检查到章节图片地址：

```sh
npm run diagnose -- --komiic-site cc
npm run diagnose -- --reader venera --source komiic --komiic-site cc
```

诊断按浏览、搜索、详情、目录、图片地址和可选图片 HEAD 输出结果，区分连接失败、账号权限、访问限制与空结果。报告默认保存至 `__temp__/diagnostics-latest.json`。遇到访问限制就停止该图源，不换镜像或标识重试；不登录真实账号或下载漫画图片。也可在 GitHub Actions 的 `Check source reachability` 中手动运行。命令选项、退出码和验证范围见 [诊断说明](docs/diagnostics.md)。

## 目录

```text
packages/manga-core/   新源共用的数据模型与阅读器回调约定
packages/manhuagui/    漫画柜网页解析、压缩章节与图片脚本解析
packages/zaimanhua/    再漫画 App／网页协议与账号登录
packages/copymanga/    CopyManga 共享逻辑，不依赖阅读器 API
packages/komiic/       Komiic 数据模型、响应检查和图片地址
packages/mangadex/     MangaDex 语言筛选、数据模型和图片地址
sources/suwatte/       Suwatte 适配、设置、测试和构建
sources/venera/        Venera 适配、设置、QuickJS 检查和构建
sources/tachimanga/    Tachimanga Kotlin 扩展、签名 APK 和仓库索引
scripts/              组装发布站点
web/                  各阅读器的入口页面
.github/workflows/    检查、构建和 GitHub Pages 发布
```

共享模块处理各站的数据模型、图片顺序、语言检查与服务器错误；CopyManga 模块还处理签名和登录编码。网络、存储和阅读器界面由各产品的适配层实现。新增阅读器时在 `sources/` 下创建目录并添加其 `package.json`，不会改变已有源的订阅地址。

## 开发与发布

需要 Node.js 22 或更新版本；Tachimanga 还需要 JDK 17+、Android SDK Platform 35、Build Tools 35.0.0 和 Python 3。使用 npm workspaces 管理依赖，从仓库根目录执行：

```sh
npm ci
npm run check
npm test
npm run build
```

输出位于 `site/`，Suwatte 的源列表位于 `site/suwatte/sources.json`，Venera 的源列表位于 `site/venera/index.json`，Tachimanga 的扩展仓库位于 `site/tachimanga/index.min.json`。推送 `main` 后 GitHub Actions 执行上述检查并发布 Pages，拉取请求只检查和构建。

```sh
npm run serve:suwatte
npm run smoke:suwatte
npm run smoke:suwatte -- komiic
npm run smoke:suwatte -- mangadex
npm run smoke:browse -- copymanga
npm run smoke:browse -- komiic
npm run smoke:browse -- mangadex
npm run smoke:venera -- copymanga --browse-only
npm run smoke:venera -- komiic
npm run smoke:venera -- mangadex
```

`serve` 命令供同一局域网中的 iPad 测试；`smoke` 使用官方模拟器访问真实接口，默认检查 CopyManga，也可选择 Komiic 或 MangaDex。它不登录账号，不保存漫画图片，遇到访问限制时报告失败阶段。Komiic 图片接口不支持 HEAD，检查时会 GET 一张图片，消耗一张图片额度。离线测试与构建通过不能替代设备上的阅读验证。

`smoke:browse` 检查每个首页入口、分类导航、专题或作者的下一层列表及分页。只请求浏览元数据，不请求章节图片。

Venera 的构建会检查全部 `.js` 在 QuickJS 中的加载、浏览和图片地址解析。其联网检查不登录账号、不请求漫画图片；`--browse-only` 只检查浏览目录，默认还检查搜索、详情、完整章节目录和图片地址。

修改已发布的源后，提高 Suwatte 的数字版本、Venera 的语义版本或 Tachimanga 的 APK 版本及版本代码；保持源 ID 不变，避免书架记录失去关联。公共接口变更放入对应的 `packages/<站点>`，阅读器特有修改放入对应的 `sources/` 目录。Tachimanga 使用本地私钥签名、提交公共 APK、CI 重编译核对的方式发布。

项目代码采用 MIT 许可。接口参考和依赖说明见各阅读器目录的文档。
