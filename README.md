# Archettu 的漫画源

为不同阅读器维护独立源列表。当前已实现 Suwatte 的 CopyManga 源，并为 Android 上的 Venera 系列阅读器预留目录。仓库保存适配代码，漫画内容由设备直接请求原网站。

## Suwatte 安装

源要求 Suwatte 7.0.0 或更新版本。在阅读器设置的 Sources 中添加以下地址，再安装「拷贝漫画 · Archettu」：

```text
https://archettu6755.github.io/manga-source/suwatte/
```

[发布首页](https://archettu6755.github.io/manga-source/)提供各阅读器的入口。[Suwatte 使用说明](sources/suwatte/README.md)介绍登录、API 设置和访问限制。Venera 尚未发布可安装源。

## 目录

```text
packages/copymanga/    CopyManga 共享逻辑，不依赖阅读器 API
sources/suwatte/       Suwatte 适配、设置、测试和构建
sources/venera/        Venera 适配预留目录
scripts/              组装发布站点
web/                  各阅读器的入口页面
.github/workflows/    检查、构建和 GitHub Pages 发布
```

共享模块处理请求签名、登录编码、数据模型、图片顺序与服务器错误。网络、存储和阅读器界面由各产品的适配层实现。新增阅读器时在 `sources/` 下创建目录并添加其 `package.json`，不会改变已有源的订阅地址。

## 开发与发布

需要 Node.js 22 或更新版本。使用 npm workspaces 管理依赖，从仓库根目录执行：

```sh
npm ci
npm run check
npm test
npm run build
```

输出位于 `site/`，Suwatte 的源列表位于 `site/suwatte/sources.json`。推送 `main` 后 GitHub Actions 执行上述检查并发布 Pages，拉取请求只检查和构建。

```sh
npm run serve:suwatte
npm run smoke:suwatte
```

第一个命令供同一局域网中的 iPad 测试；第二个使用官方模拟器访问真实接口，不登录、不下载整章，遇到访问限制时报告失败阶段。离线测试与构建通过不能替代设备上的阅读验证。

修改源后提高该源的数字版本，再发布；保持源 ID 不变，避免书架记录失去关联。公共接口变更放入 `packages/copymanga`，阅读器特有修改放入对应的 `sources/` 目录。

项目代码采用 MIT 许可。接口参考和依赖说明见 [Suwatte 文档](sources/suwatte/README.md)。
