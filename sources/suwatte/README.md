# Archettu 的 Suwatte 漫画源

供 iPad 和 iPhone 上的 Suwatte 使用，首个源是拷贝漫画 CopyManga。仓库保存适配代码和订阅目录；漫画图片由阅读器直接请求 CopyManga。

## 安装

本项目使用官方 `@suwatte/toolchain`，当前源要求 Suwatte 7.0.0 或更新版本。

在 Suwatte 的设置中打开 Sources，添加以下源列表地址，再安装「拷贝漫画 · Archettu」：

```text
https://archettu6755.github.io/manga-source/suwatte/
```

目录文件位于 `sources.json`。发布页由 GitHub Pages 提供，推送到 `main` 后自动构建和更新。

## 首版功能

- 网页搜索与 App 搜索，最近更新和热门列表。
- 漫画详情、作者、题材和状态。
- 多分组章节与完整分页，按接口提供的顺序读取图片。
- 自动获取 API 域名，也可在源设置中手动填写。
- CopyManga 账号登录。密码只用于登录请求，令牌保存在阅读器的 SecureStore。

源设置中的 API 地址留空时使用自动获取；搜索默认使用网页接口。账号和密码填写后提交即可登录，勾选「退出登录」后提交可移除令牌。

## 访问限制

CopyManga 可能返回 `210`、限频或账号/设备限制。源会显示服务器提示并停止该次读取，不自动切换镜像重试，不轮换设备信息。按提示等待、在官网核对作品或使用官方客户端检查账号状态后再试。

目录返回空数据时，源会明确提示，不将空目录当作读取成功。构建和离线测试通过不能证明所有网络环境下都能阅读；完整阅读仍需要在实际设备上验证。未实现云端收藏、评论和第三方代理。

## 开发

需要 Node.js 22 或更新版本。从仓库根目录安装依赖并检查：

```sh
npm ci
npm run check
npm test
npm run build
```

构建生成本目录的 `dist/sources.json`、`dist/sources/copymanga.stt` 和安装网页，再复制到根目录的 `site/suwatte/`。构建时也会检查产物能在不提供 Node.js 全局变量的 JavaScript 环境中启动。请求签名、数据模型和排序逻辑来自共享模块 `packages/copymanga`。

```sh
npm run serve:suwatte
```

使用工具链打印的局域网地址，在同一网络中的 iPad 添加源列表以测试修改。

```sh
npm run smoke:suwatte
```

此命令使用官方模拟器顺序测试搜索、详情、目录、章节图片地址和单张图片的 HTTP HEAD，不下载整章图片，不登录账号。遇到上游限制会输出失败阶段并结束为失败。可通过 `COPYMANGA_QUERY` 指定搜索词，`COPYMANGA_COMIC` 指定作品 ID，或 `COPYMANGA_API` 指定 API 域名；代理使用 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量。模拟器中的登录存储仅供测试，不能替代 iPad 的安全存储。

修改发布代码时提高源的数字版本 `sources/suwatte/src/sources/copymanga/index.ts` 中的 `info.version`，然后推送；Suwatte 据此判断是否更新。不要更改 `info.id`，否则已有书架记录可能失去关联。

## 接口参考

接口路径、请求头、登录格式和图片排序参考以下公开实现，本项目按 Suwatte 的接口重新实现：

- [Venera CopyManga 源](https://github.com/venera-app/venera-configs/blob/main/copy_manga.js)
- [Venera 衍生 CopyManga 源](https://github.com/Souitou-iop/venerax-configs-enhanced/blob/main/copy_manga.js)
- [Mihon CopyManga 扩展](https://github.com/coffee522/extensions-copymanga/tree/main/src/zh/copymanga)
- [Suwatte 官方工具链](https://github.com/Suwatte/Toolchain)

本项目与 Suwatte、CopyManga 官方无关联。项目代码采用 MIT 许可，依赖包各自保留其许可。
