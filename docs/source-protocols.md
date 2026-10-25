# 漫画源协议与验证记录

初次核对日期：2026-10-17；后续复核按日期追加。适配覆盖 Suwatte、原版 Venera 接口及 Tachimanga 扩展 API 1.4。目前仅 Suwatte 完成实际使用测试，Venera 和 Tachimanga 尚未完成实机验证。

## CopyManga

大陆线路在作品详情、章节分组分页和章节图片地址请求前，从官方客户端使用的 `marketing.aiacgn.com/api/v2/adopr/query3/` 获取 `request_id`。每次请求使用新参数，海外线路不访问这个服务。获取参数的请求只使用公开请求头，不携带账号令牌、设备标识或签名。

此前三个适配均缺少该流程。本次补齐，保留已有源 ID、登录状态、线路、浏览入口及网页／App 两种搜索。返回 210、401、403、429 时停止该次加载，显示服务器提示。自动发现 API 遇到明确的访问限制时也停止。

本机实测：自动发现、App 搜索和参数服务能够访问；加入参数后的匿名详情仍返回空数据。未继续请求章节或图片。这个改动修复协议缺口，不代表网站解除第三方客户端或账号的访问限制。用户提供的“安装正版并等待一小时”提示来自服务器；它不能证明用户安装过破解客户端。

协议参考：[Venera CopyManga 实现](https://github.com/venera-app/venera-configs/blob/main/copy_manga.js)；限制讨论见 [copymanga-downloader #132](https://github.com/lanyeeee/copymanga-downloader/issues/132) 和 [venera-configs #232](https://github.com/venera-app/venera-configs/issues/232)。

## 漫画柜

主站使用 `https://www.manhuagui.com`，列表、搜索、索引、排行和详情来自网页。图片服务器提供 `i.hamreus.com`、`cf.hamreus.com`、`us.hamreus.com` 三个手动选项，默认使用前者。站点压缩的章节列表和图片字典使用 LZString 解码，图片脚本只做字符串和数据解析，不执行远程代码。

保留网站章节分组。网站要求成人提示确认时显示设置提示；确认后才解析对应列表。封面和图片请求使用网站 Referer，不携带其他站点账号。

本机连接主站超时，因此没有完成在线阅读验证。列表、搜索、排行、分组章节、LZString、图片顺序和三个阅读器适配使用合成数据验证。压缩算法的 Kotlin 实现保留 lz-string 的 MIT 许可。

参考：[Keiyoushi 漫画柜实现](https://github.com/keiyoushi/extensions-source/tree/main/src/zh/manhuagui)、[Venera 漫画柜实现](https://github.com/venera-app/venera-configs/blob/main/manhuagui.js)。

## 再漫画

App 接口使用 `https://v4api.zaimanhua.com/app/v1`，官网入口使用 `https://manhua.zaimanhua.com`。两者分类编号不同，因此 App 分类和官网动态索引分别维护。首页推荐读取官网接口，保留焦点、精品、更新、周榜和月榜五个栏目。排行榜保留四个周期和三种指标。

登录请求发送到 `https://account-api.zaimanhua.com/v1/login/passwd`，按网站要求提交密码的 MD5 值。令牌只用于再漫画 API，不发送到图片服务器。账号无权读取或章节没有图片时显示网站错误，不返回假空目录。官网章节补充接口仅在 App 明确返回可读且隐藏章节标记时调用。

本机实测通过首页五个栏目、官网六组动态索引、App 漫画列表、详情、38 个章节及一个章节的 91 个图片地址解析。没有下载漫画图片，也未使用实际账号测试登录。图片连接和账号权限仍需在设备上核对。

参考：[再漫画官网](https://manhua.zaimanhua.com/)、[Keiyoushi 再漫画实现](https://github.com/keiyoushi/extensions-source/tree/main/src/zh/zaimanhua)、[Venera 再漫画实现](https://github.com/venera-app/venera-configs/blob/main/zaimanhua.js)。

## 发布标识

| 站点 | Suwatte ID／版本 | Venera key／版本 | Tachimanga ID |
| --- | --- | --- | --- |
| CopyManga | `zh.copymanga`／6 | `archettu_copymanga`／1.0.3 | `790675500000000001` |
| Komiic | `zh.komiic`／3 | `archettu_komiic`／1.0.1 | `790675500000000002` |
| MangaDex | `en.mangadex`／4 | `archettu_mangadex`／1.0.2 | `790675500000000003` |
| 漫画柜 | `zh.manhuagui`／2 | `archettu_manhuagui`／1.0.1 | `790675500000000004` |
| 再漫画 | `zh.zaimanhua`／2 | `archettu_zaimanhua`／1.0.1 | `790675500000000005` |

当前表格包含 2026-10-26 的入口与错误提示更新。Tachimanga 扩展版本为 1.4.4，版本代码为 4，继续使用原仓库证书。MangaDex 保持日语原作筛选，默认不限译文语言。

发布前从仓库根目录执行 `npm run check`、`npm test` 和 `npm run build`。构建另行执行 Suwatte 产物回调、Venera QuickJS 加载和 APK 签名／内容核对。

## 2026-10-23 可达性复核

使用 Venera 实际源代码、默认源设置和本机已有代理检查五个站点。未登录账号、下载漫画图片或切换镜像。图片连接只使用 HEAD；Komiic 图片接口需要 GET，因此只核对图片地址，不消耗图片额度。结果代表此次网络和测试作品，设备上的阅读情况仍需单独核对。

| 图源 | 本次结果 | 验证范围或停止原因 |
| --- | --- | --- |
| CopyManga | 浏览和搜索可用，阅读未通过 | 首页 40 项、列表 50 项、搜索 5 项，API 自动发现返回 200；参数服务 `marketing.aiacgn.com` 连接重置，同地址诊断出现 TLS 握手超时，未继续请求详情或章节。 |
| Komiic | 元数据和图片地址解析通过 | 列表 30 项、搜索 2 项，测试作品返回 162 个卷／章节条目，首章解析出 110 个图片地址；未请求图片内容。 |
| MangaDex | 元数据可用，图片 HEAD 受限 | 列表 30 项、搜索 22 项，测试作品返回 783 个章节条目、首章 48 个图片地址；图片 HEAD 返回 403，立即停止，未更换图片服务器重试。 |
| 漫画柜 | 详情、目录和图片连接通过 | 首页 78 项、列表 42 项，测试作品返回 108 个章节、首章 55 个图片地址，默认图片服务器 HEAD 返回 200；本次搜索词返回空列表。 |
| 再漫画 | 浏览和搜索可用，测试作品权限受限 | 首页 50 项、列表 20 项、搜索 20 项；匿名详情返回 `canRead: false`，源显示账号权限提示后停止，未继续请求章节或图片。 |

MangaDex 首次实测在本机 Node HTTP 客户端读取 HTTP 200 响应时中断；使用独立 HTTP 客户端、相同官方 API 和原有网络复核后，列表、搜索、详情、完整目录和章节图片地址均能读取。图片服务器的 403 单独记录为访问限制，没有继续 GET 或尝试其他线路。

## 2026-10-26 大陆入口与诊断复核

Komiic 新增手动选择 `https://komiic.cc`，保留默认 `https://komiic.com`。两个主页本次均返回 HTTP 200，并引用相同的前端脚本；维护者的 [Komiic 入口适配 PR](https://github.com/keiyoushi/extensions-source/pull/16431) 也支持这两个域名及对应的封面域名。三个阅读器同步切换接口、封面、图片和网页链接，按域名分别保存登录状态；旧入口已有的登录数据继续保留。没有自动换站重试。

CopyManga 的 [官网](https://www.copy4000.com/) 明示该地址用于大陆访问，仓库已默认使用这一入口和大陆资源线路，本轮继续保留。核对 [漫画柜上游实现](https://github.com/keiyoushi/extensions-source/tree/main/src/zh/manhuagui) 后，未找到足以确认其备用域名是大陆专用入口的说明；MangaDex 和再漫画也未核实到明确公布的大陆专用入口，因此没有新增地址。这个核对范围不代表这些站点今后不会发布新入口。

统一诊断使用 Suwatte 实际适配代码、空账号存储和本机已有网络，选择 Komiic `cc`，检查到图片 HEAD。未登录、下载漫画图片或在限制后更换入口。结果只代表本次网络和抽查作品，不代表大陆所有网络或其他阅读器的实机体验。

| 图源 | 本次结果 | 验证范围或停止原因 |
| --- | --- | --- |
| CopyManga | 浏览和搜索可用，详情未完成 | 列表 50 项、搜索 8 项；大陆参数服务 `marketing.aiacgn.com` 连接超时，未继续请求目录或图片。 |
| Komiic `cc` | 元数据和图片地址通过，图片读取未验证 | 列表 30 项、搜索 2 项、目录 162 项、首章 110 个图片地址；未执行图片 HEAD 或 GET，不消耗图片额度。 |
| MangaDex | 检查阶段通过 | 列表 30 项、搜索 22 项、目录 783 项、首章 48 个图片地址及首张图片 HEAD。 |
| 漫画柜 | 检查阶段通过 | 列表 42 项、搜索 3 项、目录 162 项、首章 110 个图片地址及首张图片 HEAD。 |
| 再漫画 | 浏览和搜索可用，测试作品权限受限 | 列表 20 项、搜索 20 项；详情返回 `canRead: false` 后停止，未请求目录或图片。 |

诊断命令、报告字段和手动 GitHub Actions 入口见 [诊断说明](diagnostics.md)。网络错误提示现在区分连接中断、超时、账号权限、额度和限频；非 JSON 的 HTTP 403 也保留访问限制提示。
