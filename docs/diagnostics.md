# 图源可达性诊断

`npm run diagnose` 从仓库根目录检查五个图源，使用真实适配代码及一次性的空账号存储。默认通过 Suwatte 官方模拟器执行，也支持 Venera 的 JavaScript 源运行环境。它不代表在阅读器应用中完成了实机阅读测试；目前仅 Suwatte 做过实际使用测试，Tachimanga 的联网阅读仍需在设备上验证。

```sh
npm run diagnose -- --help
npm run diagnose -- --komiic-site cc
npm run diagnose -- --source komiic --komiic-site cc --stage pages
npm run diagnose -- --reader venera --source all --stage image
```

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `--reader` | `suwatte` | `suwatte` 或 `venera` |
| `--source` | `all` | 五源全部检查，或指定 `copymanga`、`komiic`、`mangadex`、`manhuagui`、`zaimanhua` |
| `--komiic-site` | `com` | `com` 或 `cc`，只选择本次检查使用的入口，不自动尝试其他入口 |
| `--stage` | `pages` | 最后检查阶段：`browse`、`search`、`details`、`chapters`、`pages`、`image` |
| `--output` | `__temp__/diagnostics-latest.json` | JSON 报告保存路径 |

浏览阶段只抽查一个普通漫画列表，不遍历所有目录或所有浏览入口。搜索默认使用“葬送的芙莉蓮”，MangaDex 使用 `Yotsuba`；可通过 `SOURCE_QUERY` 指定其他词。搜索为空时记录为空结果；若浏览阶段已有测试作品，继续核对该作品，保留搜索未验证的事实。

Suwatte 分别读取详情和章节。Venera 的原生详情函数同时读取完整目录，因此相关 HTTP 请求计入 `details` 阶段，`chapters` 阶段核对已返回的目录。图片地址阶段只解析一章的地址，不请求图片内容。`image` 阶段仅对第一张图片做 HEAD；Komiic 图片接口需要 GET，因此该阶段明确标为未验证，不消耗图片额度。HEAD 失败不能直接证明真实阅读器中的 GET 也会失败。

每个图源最多发出 40 个请求。沿用本机已有代理或系统网络，报告只根据环境变量注明是否配置代理，不保存代理地址。HTTP 210、401、402、403、429、451、接口同类限制、浏览器验证和 `canRead: false` 都会停止该图源；后续阶段标为跳过，不尝试其他入口、章节、账号或设备标识。其他图源继续各自的检查。

报告包括 UTC 检查时间、阅读器适配、公开源 ID 和版本、各阶段结果、请求方法、主机名、HTTP 状态及耗时。不会保存请求体、请求头、Cookie、账号令牌、设备标识、带查询参数的 URL 或图片数据。异常信息会脱敏。

| 总结果 | 含义 |
| --- | --- |
| `passed` | 请求的阶段全部通过 |
| `partial` | 有空结果、不可读目录或未支持的图片 HEAD，验证不完整 |
| `restricted` | 网站要求登录、账号权限、阅读额度、限频或其他访问限制 |
| `unreachable` | 连接中断、DNS/TLS 错误或超时 |
| `failed` | 数据格式、初始化后的运行错误或请求预算耗尽 |

退出码为 `0` 表示所有图源都通过请求的阶段，`2` 表示存在未通过或未验证的图源，`1` 表示参数或诊断进程无法完成。空结果和访问限制不会删除任何源或浏览入口。

GitHub Actions 的 `Check source reachability` 只手动触发，独立于发布流程。结果显示在该次运行的 Summary，JSON 报告作为 `source-diagnostics` 附件保存。GitHub 运行器与用户设备的网络环境可能不同，报告不能证明大陆所有网络都能访问。
