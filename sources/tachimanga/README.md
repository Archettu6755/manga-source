# Tachimanga 漫画源

为 App Store 正式版 Tachimanga 提供拷贝漫画、Komiic、MangaDex（日漫）、漫画柜和再漫画。使用扩展 API 1.4，一个 APK 包含五个独立图源，包名为 `eu.kanade.tachiyomi.extension.all.archettu`。Tachimanga 官方的[扩展说明](https://tachimanga.app/help/guides/extensions_guide.html)和[仓库说明](https://tachimanga.app/help/guides/repositories.html)介绍了接口与安装格式。

## 安装

在「浏览 → 扩展 → ＋ → 扩展仓库」中添加以下地址，刷新列表，再安装「杕的自用漫画源」。图源语言筛选启用中文和多语言（Multi）。

```text
https://archettu6755.github.io/manga-source/tachimanga/index.min.json
```

也可从[安装页面](https://archettu6755.github.io/manga-source/tachimanga/)下载 APK，通过扩展页面的加号导入。五个图源使用本仓库独立的 ID，与社区其他同站扩展的书架记录分开；迁移已有收藏时使用阅读器的迁移功能。

## 浏览和设置

Tachimanga 的图源接口提供热门、更新、搜索和筛选器。其他浏览入口通过筛选器中的「浏览入口」选择，详见 [ENTRYPOINTS.md](ENTRYPOINTS.md)。搜索框填写文字时优先进行作品搜索；浏览分类时清空搜索文字。

拷贝的专题、题材，以及 Komiic 的题材、标签、作者、原作和角色使用可缓存的目录下拉框。首次选择对应浏览入口并搜索，会加载目录并显示提示。随后重置筛选器，再选择该入口及具体条目。空分类仍保留；上游限制作者后续分页时会说明已加载范围。加载目录的提示不表示 APK 无效或漫画服务器故障。

拷贝默认使用大陆官网入口和大陆资源线路，API 留空自动发现。海外代理可选择海外线路和 copy20 或 mangacopy 官网。保留网页／App 两种搜索接口；修改线路后刷新漫画目录。设置页面可以登录、退出及刷新 API 缓存。账号密码只用于提交登录，提交完成或失败后清除密码；令牌保存在阅读器的图源偏好数据中。

Komiic 支持邮箱登录、会话刷新、卷／章节筛选和图片额度提示。图片请求使用章节 Referer；会话只发送到 Komiic。MangaDex 收录原始语言为日语的日本漫画，不默认译文语言。章节语言默认为「不限译文语言」，可手动选择简体中文、繁体中文、英文或日语。更新后旧的语言设置恢复为不限；章节标题附带语言代码。日语原作及手动选择的章节语言筛选覆盖书单、详情和章节图片。公开 API 的漫画分页最多访问 10,000 条，超出范围需要缩小筛选条件。

登录信息由 Tachimanga 的偏好存储和 Cookie 存储管理，不属于 Suwatte 的 SecureStore。漫画内容由设备直接请求各网站；仓库不保存账号信息或漫画图片。

## 漫画柜和再漫画

漫画柜保留官网首页全部栏目、更新、热门、上架、评分、连载、完结、漫画索引和四周期排行。索引可按题材、地区、读者群、年份、首字母、状态组合筛选。源设置中可确认网站的成人提示，或手动选择图片服务器；不会自动切换服务器重试。

再漫画提供官网五个推荐栏目、更新、全部漫画、热门、完结、短篇、App 分类和官网动态索引。官网与 App 使用不同的分类编号，分别读取对应接口；官网索引包含首字母。排行保留日、周、月、总榜和人气、吐槽、订阅三种指标。部分作品需要再漫画账号或达到网站要求的等级。

CopyManga 大陆详情、章节分组和章节图片地址请求已加入 `request_id`；海外线路不请求该参数。获取参数时不发送账号令牌或设备标识。210 原始提示会显示在阅读器中，源更新不能保证解除服务器限制。[协议与验证记录](../../docs/source-protocols.md)列出本次实测结果。

再漫画在源设置中填写账号、密码后点“登录再漫画”；提交后清除密码。漫画柜首页栏目在打开首页后更新，重置筛选器即可选择。再漫画官网索引首次选择对应入口并搜索后加载，再重置筛选器选择条目。其他筛选位于原生筛选器中。

## 构建与发布

需要 JDK 17 或更新版本、Android SDK Platform 35、Build Tools 35.0.0、Python 3 和 Node.js 22。设置 `JAVA_HOME`、`ANDROID_HOME` 后，从仓库根目录运行 `npm run check`、`npm test`、`npm run build`。Gradle Wrapper 固定为 8.14.3 并校验下载摘要。MangaDex 标签选项从 Venera 的同一份标签快照生成。

首次发布和代码更新由维护者使用同一个仓库签名密钥构建。设置 `TACHIMANGA_KEYSTORE` 和 `TACHIMANGA_KEY_PASSWORD`，密钥别名为 `archettu`。密钥保存在仓库外，禁止提交密钥和密码。公共证书摘要见 `signing-fingerprint.txt`。

构建会将签名 APK 保存到 `release/`。提交这个公共安装包后，CI 重新编译代码，比较 APK 中的 DEX、清单和资源，校验签名与公开证书摘要，再生成 `dist/index.min.json`、`repo.json` 和 APK 下载目录。代码变化但未重新签名时，比较失败，阻止发布旧安装包。CI 无需持有私钥。

更新扩展时，同时提高 `build.gradle.kts` 和 `catalog.json` 的版本号及版本代码，更新网页下载链接，并提交新的签名 APK。保持五个图源 ID 不变。离线编译和协议测试不能替代 iPad 上的导入与阅读验证。

实现沿用本仓库记录的站点协议，并参考 Tachiyomi／Mihon 的公开接口。扩展 API、OkHttp、RxJava、Injekt 和 Kotlin 由阅读器提供；APK 内附带 Jsoup，许可见 `THIRD_PARTY_NOTICES.txt`。
