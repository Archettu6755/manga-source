# Venera 漫画浏览入口

核对日期：2026-10-17。保留 [Suwatte 入口清单](../suwatte/ENTRYPOINTS.md)中的全部公开漫画浏览入口。各站账号收藏、阅读记录、评论、投稿和网站设置尚未适配；本地书架、历史和下载由 Venera 管理。

## CopyManga

| 内部入口 | 探索页名称 | 导航及分页 |
| --- | --- | --- |
| home | 首页推荐 | 官网首页的轮播、漫画列表和专题，保留“更多”目的地 |
| all | 发现／全部漫画 | 官网 `/comics`，每页 50 条 |
| topics | 专题 | 按 `/topic` 的分页读取全部目录；进入 `topic:<id>` |
| themes | 题材 | `/filter` 的全部分类，包括空分类；进入 `theme:<id>` |
| ranks | 排行榜 | 男频、女频各自的日、周、月、总榜；官网每榜前 50 条，保持原顺序 |
| recommend | 漫画推荐 | `/recommend`，每页 60 条 |
| newest | 全新上架 | `/newest`，每页 60 条 |
| latest | 最近更新 | `/comics`，更新时间降序 |
| popular | 热门漫画 | `/comics`，热度降序 |
| completed | 已完结 | `/comics?status=1` |

分类列表提供题材、地区、状态和双向排序；排行榜也可从原生排名页访问。用户最终要求保留全部入口，因此男女频及各周期榜单均保留。网页搜索动态读取官网接口，App 搜索可在源设置中切换。

## Komiic

| 内部入口 | 探索页名称 | GraphQL 数据来源 |
| --- | --- | --- |
| latest / popular | 最近更新／热门漫画 | `recentUpdate` / `hotComics` |
| all / newest / completed / short | 所有漫画／最近上架／已完结／短篇 | `comicByCategories` |
| categories | 题材分类 | `allCategory` → `categories:<id>` |
| elements | 标签 | `allElements` → `elements:<id>` |
| authors | 作者列表 | 分页读取 `authors` → `author:<id>` → `getComicsByAuthor` |
| originals | 原作 | 分页读取 `hOriginalComics` → `original:<id>` |
| characters | 角色 | 分页读取 `hCharacters` → `character:<id>` |
| recommended-week / recommended-month / recommended-year | 本周推荐／本月推荐／年度推荐 | `topRecommendedComics` 的 `WEEK` / `MONTH` / `YEAR` |
| random | 随机发现 | `randomComics` |

目录项通过“查看更多”进入对应作品列表。原作、角色和推荐请求使用 `REGULAR`；上游为空时仍保留入口。原作／角色关联 ID 通过 `comicByIds` 补齐信息，保持关联顺序。漫画列表提供题材、连载状态及双向排序；作者目录按官网更新时间升序读取。检查时网站的后续作者页返回 `Offset is too large`，源保留已读到的目录并显示限制提示，不删除作者入口。

## MangaDex

| 内部入口 | 探索页名称 | 数据来源 |
| --- | --- | --- |
| popular / latest | 热门日漫／最近更新 | `/manga`，收藏数／章节更新时间排序 |
| all / newest | 全部日漫／新上架 | `/manga`，完整可访问分页／创建时间排序 |
| popular-new | 本月热门新作 | 最近 30 天新作按收藏数排序 |
| top-rated | 评分排行 | `/manga`，评分排序 |
| tags | 分类／标签 | `/manga/tag` → `tag:<id>` |
| seasonal / recommended / selfpublished | 当季漫画／官网推荐／自主出版 | 官网公开书单 `/list/<id>`，恢复书单顺序后分页 |

所有作品入口都限制原始语言为日语，不默认译文语言；章节语言默认为不限，可手动选择简体中文、繁体中文、英文或日语。保留空书单。搜索支持多标签包含／排除、匹配方式、状态、分级和排序；分类列表支持实时标签选择。标签选项的 ID 编码避开原版 Venera 的连字符分隔规则，发请求前恢复完整 UUID。漫画列表受公开 API 的 10,000 条范围限制，不能把可访问分页描述为全站无限分页。

## 维护

保留内部入口键、探索页标题和目标参数。目录读取到末页或网站明确提供的分页上限，遇到上限时显示提示；漫画列表按需加载下一页。空目录、访问限制、重复分页和格式变化分别处理，不据此删入口。验证两套阅读器的根目录检查，并记录实际设备验证和接口检查的区别。

## 漫画柜

| 入口 ID | 名称 | 数据来源 |
| --- | --- | --- |
| home | 网站首页 | `/`，热门漫画更新和全部首页 tab 栏目，保留栏目名称 |
| latest | 最近更新 | `/list/update_p<page>.html` |
| popular | 热门漫画 | `/list/view_p<page>.html` |
| all | 全部漫画 | `/list/index_p<page>.html` |
| newest | 最新上架 | `/list/index_p<page>.html` |
| top-rated | 评分最高 | `/list/rate_p<page>.html` |
| ongoing | 连载漫画 | `/list/lianzai/update_p<page>.html` |
| completed | 完结漫画 | `/list/wanjie/update_p<page>.html` |
| categories | 漫画索引 | 题材、地区、读者群、年份、首字母、状态；进入 `filter:<字段>:<值>` |
| ranks | 排行榜 | `/rank/` 的日、周、月、总榜，进入 `rank:<周期>` |

搜索支持更新、人气、上架、评分排序。章节分组和网站返回的图片顺序均保留。压缩章节列表和图片数据按格式解析，不执行网站 JavaScript。

## 再漫画

| 入口 ID | 名称 | 数据来源 |
| --- | --- | --- |
| home | 官网首页推荐 | 官网 `/api/v1/comic2/index`，焦点、精品、更新、周榜、月榜五个栏目 |
| latest | 最近更新 | App `/comic/update/list/0/<page>` |
| popular | 热门漫画 | App `/comic/rank/list` 的总人气榜 |
| all | 全部漫画 | App `/comic/filter/list`，完整分页 |
| completed | 已完结 | App 分类接口，`status=2310` |
| short | 短篇 | App 分类接口，`status=29205` |
| categories | 分类索引 | App 的题材、状态、读者群、地区；进入 `filter:<字段>:<值>` |
| web-categories | 官网分类／字母索引 | 官网 `/api/v1/comic1/filter_type`；进入 `web-filter:<字段>:<值>`，使用官网分类接口 |
| ranks | 排行榜 | 四个周期 × 人气／吐槽／订阅，进入 `rank:<周期>:<指标>` |

App 分类编号与官网编号不同，分别保留。空推荐栏目和分类入口不因没有结果而删除。账号收藏、评论和签到尚未适配。
