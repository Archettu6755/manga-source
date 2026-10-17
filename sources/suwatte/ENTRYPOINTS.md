# 漫画浏览入口

核对日期：2026-10-17。此表记录阅读器中的公开漫画浏览入口。账号收藏、阅读记录、评论、投稿、下载客户端和站点设置属于网站账号或工具功能，尚未适配成源入口；Suwatte 的本地书架和阅读记录由阅读器管理。

## CopyManga

| 入口 ID | 显示名称 | 数据来源 |
| --- | --- | --- |
| home | 首页推荐 | 官网 `/` 的轮播、推荐、热门更新、新上架、专题 |
| all | 发现／全部漫画 | `/comics`，完整分页 |
| topics | 专题 | `/topic`；点击进入 `/topic/<id>` |
| themes | 题材 | `/filter`；点击进入带 `theme` 的漫画列表，保留空分类 |
| ranks | 排行榜 | 男频、女频各自的日、周、月、总榜，保留网站原始顺序 |
| recommend | 漫画推荐 | `/recommend`，完整分页 |
| newest | 全新上架 | `/newest`，完整分页 |
| latest | 最近更新 | `/comics`，更新时间排序 |
| popular | 热门漫画 | `/comics`，热度排序 |
| completed | 已完结 | `/comics?status=1` |

搜索页提供全部题材、地区、状态及双向排序。题材 ID 保留网站大小写。漫画详情、章节和图片接口沿用原实现。

## Komiic

| 入口 ID | 显示名称 | GraphQL 字段 |
| --- | --- | --- |
| latest / popular | 最近更新／热门漫画 | `recentUpdate` / `hotComics` |
| all / newest / completed / short | 所有漫画／最近上架／已完结／短篇 | `comicByCategories`，传排序和状态 |
| categories | 题材分类 | `allCategory` → `comicByCategories` |
| elements | 标签 | `allElements` → `comicByElements` |
| authors | 作者列表 | `authors` → `getComicsByAuthor` |
| originals | 原作 | `hOriginalComics` → `comicsByHOriginalComicId`，`REGULAR` 内容类型 |
| characters | 角色 | `hCharacters` → `comicsByHCharacterId`，`REGULAR` 内容类型 |
| recommended-week / recommended-month / recommended-year | 本周推荐／本月推荐／年度推荐 | `topRecommendedComics`，`WEEK` / `MONTH` / `YEAR` |
| random | 随机发现 | `randomComics` |

分类、标签和作者导航指向各自的漫画列表，不作为漫画作品打开。原作和角色数据由网站提供；空列表保留其入口。搜索页提供题材、状态及双向排序。

## MangaDex

| 入口 ID | 显示名称 | 数据来源 |
| --- | --- | --- |
| popular / latest | 热门日漫／最近更新 | `/manga`，收藏数／章节更新时间排序 |
| all | 全部日漫 | `/manga`，保留语言筛选 |
| newest | 新上架 | `/manga`，创建时间排序 |
| popular-new | 本月热门新作 | `/manga`，最近 30 天新作按收藏数排序 |
| top-rated | 评分排行 | `/manga`，评分排序 |
| tags | 分类／标签 | `/manga/tag` → 带标签的漫画列表 |
| seasonal / recommended / selfpublished | 当季漫画／官网推荐／自主出版 | 官网前端使用的公开 `/list/<id>` → `/manga?ids[]=` |

所有入口都限制原始语言为日语，不默认译文语言；章节语言默认为不限，可手动选择简体中文、繁体中文、英文或日语。官网书单筛选为空时不删除入口。搜索页提供标签包含／排除、匹配方式、连载状态、内容分级和排序。官网 `staffpicks` 路由当前返回空组件，并重定向到官网推荐；它没有独立的可用作品列表。

## 维护

新增或调整入口时核对官网与公开接口，保留已有入口 ID，说明用户要求的排除项。完整分页和分类导航必须有测试。上游空列表、访问限制及页面变化分别报告，不能根据一次空响应删掉入口。执行 `npm run check`、`npm test`、`npm run build`，再按需执行三项 `smoke:browse` 检查。

参考：[CopyManga 官网](https://www.mangacopy.com/)、[Komiic 官网](https://komiic.com/)、[MangaDex 官网](https://mangadex.org/)、[MangaDex API](https://api.mangadex.org/docs/)。

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
