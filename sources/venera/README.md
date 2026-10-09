# Venera 漫画源

提供 CopyManga、Komiic 和 MangaDex，版本均从 `1.0.0` 开始。按照原版 Venera 1.6.3 的源接口开发，使用独立的 `archettu_copymanga`、`archettu_komiic`、`archettu_mangadex` 标识，可以与其他仓库的同站源并存。

## 安装

在 Venera 的漫画源管理中修改源仓库地址，填入以下 JSON 地址，再安装所需源。原版的源仓库设置会替换当前列表；这不会卸载已安装的其他源。

```text
https://archettu6755.github.io/manga-source/venera/index.json
```

也可以在添加源时分别填写单个链接，无需修改当前源仓库设置：

- [拷贝漫画](https://archettu6755.github.io/manga-source/venera/copymanga.js)
- [Komiic](https://archettu6755.github.io/manga-source/venera/komiic.js)
- [MangaDex（日漫）](https://archettu6755.github.io/manga-source/venera/mangadex.js)

浏览入口分布在探索页和分类页中。每个探索页标题包含站点名，避免不同源之间重名。题材、专题、标签、作者、原作和角色使用目录条目及“查看更多”按钮，点击后进入该目录的漫画列表。[入口清单](ENTRYPOINTS.md)记录完整对应关系。

## 源设置与账号

CopyManga 支持 API 域名设置、网页或 App 搜索及原生账号登录。API 留空时使用官网公开的网络配置获取地址，保留固定设备信息；退出登录只清除令牌。详情和章节接口受到站点限制时，会显示错误。匿名接口可能返回空数据，这种情况下需要在设备上核对官网与账号权限。

Komiic 支持原生账号登录、会话刷新及卷／章节筛选。图片请求携带章节 Referer；登录会话仅附加到 Komiic 自己的图片接口，封面和其他图片域名不携带会话。阅读额度由网站决定。卷和话分别保留，章节键使用固定 `ep:` 前缀，避免 JavaScript 按数字 ID 重排目录。

MangaDex 只收录原始语言为日语的漫画，默认读取英文译文，可选择日语。筛选覆盖列表、官网书单、详情、目录和图片读取；外站、未来发布、空图片或不可用的章节不显示。支持省流图片、标签包含／排除、状态、分级和排序。分类页实时读取标签；搜索选项使用 2026-10-09 核对的 77 个标签，网站新增标签时应更新快照并提高源版本。

两个登录源使用 Venera 的原生账号功能。原版应用会保存账号和密码以便重新登录，令牌和 Cookie 也保存在应用数据中；不能将其描述为 Suwatte 的安全存储。源代码不会额外写入密码，也不会向本仓库或发布站点发送账号信息。

专题和作者等分页目录会读取可访问的目录页，再显示为可点击条目。Komiic 作者使用官网的更新时间升序，并缓存索引十分钟；漫画列表仍按需分页。网站在后续作者页返回 `Offset is too large` 时，保留已读到的条目并显示分页限制提示。大型目录首次打开需要等待网络请求结束。返回部分重复条目时按 ID 去重，整页重复或格式错误会报告失败，不缓存意外中断的目录。

## 原版与 fork

核对日期：2026-10-09。以下是发布版本的源码接口核对，不代表已在这些应用的 Android 安装包中完成阅读实测。

| 阅读器 | 核对版本 | 源接口 |
| --- | --- | --- |
| [原版 Venera](https://github.com/venera-app/venera/releases/tag/v1.6.3) | 1.6.3 | 本工程基准；原项目已停止维护 |
| [VeneraX](https://github.com/Kyosee/VeneraX/releases/tag/v2.3.6) | 2.3.6 | 保留 `ComicSource`、探索、分类、搜索、账号及章节接口 |
| [haukuen/venera](https://github.com/haukuen/venera/releases/tag/v1.16.0) | 1.16.0 | 保留原版解析方式及本工程使用的接口 |
| [Venera-Next](https://github.com/CyrilPeng/Venera-Next/releases/tag/v1.17.0) | 1.17.0 | 重组内部代码，保留原版 JavaScript 源接口 |

目前按接口核对结果，这三种 fork 可以使用同一套源文件，不需要单独维护 fork 目录。不同 fork 的仓库管理界面可能不同，安装时也可直接使用 `.js` 链接。将来遇到接口差异时，应先记录具体版本和差异，再增加对应适配。

核对代码：[原版解析器](https://github.com/venera-app/venera/blob/v1.6.3/lib/foundation/comic_source/parser.dart)、[VeneraX 解析器](https://github.com/Kyosee/VeneraX/blob/v2.3.6/lib/foundation/comic_source/parser.dart)、[haukuen 解析器](https://github.com/haukuen/venera/blob/v1.16.0/lib/foundation/comic_source/parser.dart)、[Venera-Next 解析器](https://github.com/CyrilPeng/Venera-Next/blob/v1.17.0/lib/features/comic_source/parser.dart)。

## 开发和验证

在仓库根目录执行 `npm ci`、`npm run check`、`npm test` 和 `npm run build`。本目录使用 TypeScript、esbuild 和独立的 Venera 接口定义；网络与存储均在本目录实现，共享协议模块不依赖阅读器全局对象。

构建文件位于 `sources/venera/dist/`，发布后位于 `site/venera/`。每个 `.js` 的首个类声明满足原版加载器要求，后面包含独立打包的协议代码。HTML 解析依赖所需的 Base64 解码函数随源打包，不依赖浏览器 `atob` 或 Node.js `Buffer`。`index.json` 带有名称、源键、语义版本和绝对更新链接。

离线测试使用构建脚本生成的源文件，在缺少 Node.js 和 DOM 对象的环境中核对浏览入口、目录分页、请求签名、账号隔离、章节顺序、语言限制及访问错误。构建还在 QuickJS 中执行加载、浏览和图片地址解析。

```sh
npm run smoke:venera -- copymanga --browse-only
npm run smoke:venera -- komiic
npm run smoke:venera -- mangadex
```

联网检查使用实际源代码和真实接口，默认还核对搜索、详情、完整章节目录和一章的图片地址。不会登录账号、请求漫画图片或保存漫画内容，遇到访问限制就停止。可用 `SOURCE_QUERY` 或 `SOURCE_COMIC` 指定检查作品；`--browse-only` 跳过读取检查。离线与联网检查不能替代 Android 设备上的安装和阅读验证。

修改已发布源时保留源键、探索页标题和章节键格式，提高对应源的语义版本。不得根据一次空列表删除入口。

## 参考和许可

接口依据：[官方源开发文档](https://github.com/venera-app/venera/blob/v1.6.3/doc/comic_source.md)、[官方 JavaScript API](https://github.com/venera-app/venera-configs/blob/main/_venera_.js)、[官方源模板](https://github.com/venera-app/venera-configs/blob/main/_template_.js)。三个站点的协议复用本仓库的共享模块；Venera 适配代码在此目录独立实现。

代码采用 MIT 许可。CopyManga 构建产物带有 CryptoJS、Cheerio、JSON5 及解析依赖的许可说明；完整依赖许可也发布为 `THIRD_PARTY_NOTICES.txt`。
