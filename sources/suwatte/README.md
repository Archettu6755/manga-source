# Archettu 的 Suwatte 漫画源

供 iPad 和 iPhone 上的 Suwatte 使用，提供 CopyManga、Komiic 和 MangaDex。仓库保存适配代码和订阅目录；漫画图片由阅读器直接请求各站点。

## 安装

本项目使用官方 `@suwatte/toolchain`，当前源要求 Suwatte 7.0.0 或更新版本。

在 Suwatte 的设置中打开 Sources，添加以下源列表地址，再选择要安装的源。已添加过此地址时，刷新源列表即可看到新源：

```text
https://archettu6755.github.io/manga-source/suwatte/
```

目录文件位于 `sources.json`。发布页由 GitHub Pages 提供，推送到 `main` 后自动构建和更新。

## CopyManga

- 首页推荐、发现／全部漫画、专题与专题详情、全部题材、日／周／月／总榜、漫画推荐、全新上架、最近更新、热门漫画和已完结入口。
- 网页搜索与 App 搜索；空关键词搜索可组合题材、地区、状态及更新时间／热度排序。
- 漫画详情、作者、题材和状态。
- 多分组章节与完整分页，按接口提供的顺序读取图片。
- 大陆／海外资源线路；官网入口可选 copy4000、copy20 或 mangacopy。
- 自动获取 API 域名，也可手动填写或刷新自动地址。
- CopyManga 账号登录。密码只用于登录请求，令牌保存在阅读器的 SecureStore。

大陆直连默认使用 copy4000 官网入口、大陆资源线路和网页搜索。官网入口控制浏览页面与网页搜索；资源线路同时影响 API 的地域参数和图片请求头。使用海外代理时，可手动改为海外线路，并按连接情况选择 copy20 或 mangacopy 入口。

API 地址留空时自动获取。勾选「刷新自动 API」后保存可重新查询官方网络配置；手动填写的地址仍优先使用。修改入口、线路或刷新地址会更新目录缓存，保留登录与设备信息。账号和密码填写后提交即可登录，勾选「退出登录」后提交可移除令牌。切换资源线路后请重新打开漫画并刷新目录；已缓存的章节图片地址需要重新获取。

官网在 2026-10-10 标注 copy4000 为大陆访问入口，官方网络配置当天返回 api.copy202601.com，未提供不同的备用 API。入口和线路的直连效果仍取决于用户网络；切换搜索不能单独修复图片 CDN 的连接问题。

排行榜保留男频、女频各自的日／周／月／总榜，按网站原始顺序展示。题材从官网读取，数量为零的题材也保留。浏览入口读取公开网页；详情、章节和图片沿用 API。网页中的列表数据按字面量解析，不执行网站脚本。

## Komiic

提供繁体中文搜索、热门与更新列表、详情、卷与章节目录、图片读取。默认同时显示卷和章节，可在源设置中改为仅章节或仅卷；它们可能是同一作品的不同版本。

浏览入口包括所有漫画、最近上架、已完结、短篇、题材分类、标签、作者及作者作品、原作、角色、本周推荐、本月推荐、年度推荐和随机发现。分类与标签从站点动态读取，保留零数量的条目。空关键词搜索可组合题材、状态和排序。

账号登录使用邮箱和密码。密码只用于当前登录请求，登录 Cookie 和旧接口可能返回的令牌存入 SecureStore。会话会通过站点的 `/auth/refresh` 刷新；刷新失败时提示重新登录。勾选「退出登录」后提交可退出账号。图片请求携带该章节的 Referer，会话凭据仅发送至 `komiic.com` 的图片接口，不发送给封面 CDN。

图片额度由网站决定。HTTP 402 会提示当日额度用尽并停止读取。账号登录能否提高额度取决于网站的账号规则，源不会自行重置额度。

## MangaDex

只收录原始语言为日语的日本漫画，默认获取英文译文，可在源设置中选择日语原文。列表、详情、章节目录与图片请求都会检查语言；英文翻译的韩漫和欧美原创作品不会被当作日漫提供。修改语言后请刷新章节目录。

基础读取无需登录。支持搜索、热门与更新列表、作者和题材、完整章节分页，以及正常质量或节省流量的图片。目录保留不同翻译组上传的章节，标题附带翻译组名称。外站章节、空章节、未发布章节与已标记不可用的章节不显示。站点撤下的内容无法通过源恢复。

浏览入口还包括全部日漫、新上架、本月热门新作、评分排行、全部标签、当季漫画、官网推荐和自主出版。三个官网书单也执行日漫及当前章节语言筛选，筛选后可以为空，入口仍保留。高级筛选位于源的搜索页，支持包含／排除标签、标签匹配方式、连载状态、内容分级和排序。书单 ID 依据官网 2026-10-08 的前端配置；未来官网更换 ID 时需要更新对应常量。

## 访问限制

CopyManga 可能返回 `210`、限频或账号/设备限制。源会显示服务器提示并停止该次读取，不自动切换镜像重试，不轮换设备信息。按提示等待、在官网核对作品或使用官方客户端检查账号状态后再试。

CopyManga 目录返回空数据时，源会明确提示。Komiic 和 MangaDex 的筛选可能使目录为空；可在官网核对可用章节或调整章节设置。MangaDex HTTP 429 会提示限频并停止请求。构建和离线测试通过不能证明所有网络环境下都能阅读；完整阅读仍需要在实际设备上验证。未实现云端收藏、评论和第三方代理。

## 开发

需要 Node.js 22 或更新版本。从仓库根目录安装依赖并检查：

```sh
npm ci
npm run check
npm test
npm run build
```

构建生成本目录的 `dist/sources.json`、`dist/sources/` 下的三个 `.stt` 源和安装网页，再复制到根目录的 `site/suwatte/`。构建时会实际执行三个产物的详情和图片回调，确认它们能在不提供 Node.js 全局变量的 JavaScript 环境中工作。数据模型和协议检查来自 `packages/` 下对应的站点模块。

```sh
npm run serve:suwatte
```

使用工具链打印的局域网地址，在同一网络中的 iPad 添加源列表以测试修改。

```sh
npm run smoke:suwatte
npm run smoke:suwatte -- komiic
npm run smoke:suwatte -- mangadex
```

这些命令使用官方模拟器顺序测试搜索、详情、目录、章节图片地址和单张图片。CopyManga 和 MangaDex 使用 HTTP HEAD；Komiic 的图片接口对 HEAD 返回 404，所以会 GET 一张图片，消耗一张图片额度。测试不登录、不保存图片、不下载整章，遇到上游限制会输出失败阶段并结束为失败。可通过 `SOURCE_QUERY` 指定搜索词，`SOURCE_COMIC` 指定作品 ID；CopyManga 仍兼容 `COPYMANGA_QUERY`、`COPYMANGA_COMIC` 与 `COPYMANGA_API`。代理使用 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量。账号登录仅做了模拟响应测试，尚需在 iPad 上用实际账号验证。

SDK 1.0.0 的结果校验器会去掉类型声明中的 `ChapterPage.context`。源产物保留此字段；离线测试分别检查结果结构与原始回调的图片上下文，实时测试为模拟器补入章节上下文。设备端的上下文传递仍需在 Suwatte 7.2.0 上验证。

`npm run smoke:browse -- <站点>` 只检查浏览入口和元数据，不请求章节或图片。SDK 1.0.0 的列表校验器要求至少一个条目，站点合法返回的空列表单独检查。`HttpClient.rateLimit.period` 的单位为秒；测试使用真实模拟器限流器检查连续六次请求，防止把毫秒值误传为秒。

修改发布代码时提高对应源 `src/sources/<站点>/index.ts` 中的 `info.version`，然后推送；Suwatte 据此判断是否更新。不要更改 `info.id`，否则已有书架记录可能失去关联。

## 接口参考

接口路径、请求头、登录格式和图片排序参考以下公开实现，本项目按 Suwatte 的接口重新实现：

- [Venera CopyManga 源](https://github.com/venera-app/venera-configs/blob/main/copy_manga.js)
- [Venera 衍生 CopyManga 源](https://github.com/Souitou-iop/venerax-configs-enhanced/blob/main/copy_manga.js)
- [Mihon CopyManga 扩展](https://github.com/coffee522/extensions-copymanga/tree/main/src/zh/copymanga)
- [Komiic 官网](https://komiic.com)的公开 GraphQL 接口与前端登录调用
- [Mihon / Keiyoushi Komiic 扩展](https://github.com/keiyoushi/extensions-source/tree/main/src/zh/komiic)
- [Venera Komiic 源](https://github.com/venera-app/venera-configs/blob/main/komiic.js)
- [MangaDex 官方 API 文档](https://api.mangadex.org/docs/)
- [Venera MangaDex 源](https://github.com/venera-app/venera-configs/blob/main/manga_dex.js)
- [Suwatte 官方工具链](https://github.com/Suwatte/Toolchain)

本项目与阅读器、各站点官方无关联。项目代码采用 MIT 许可，依赖包各自保留其许可。
