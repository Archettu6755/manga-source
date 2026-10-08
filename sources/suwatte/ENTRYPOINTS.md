# 漫画浏览入口

核对日期：2026-10-08。此表记录阅读器中的公开漫画浏览入口。账号收藏、阅读记录、评论、投稿、下载客户端和站点设置属于网站账号或工具功能，尚未适配成源入口；Suwatte 的本地书架和阅读记录由阅读器管理。

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

所有入口都限制原始语言为日语，默认英文章节，也可选择日语章节。官网书单筛选为空时不删除入口。搜索页提供标签包含／排除、匹配方式、连载状态、内容分级和排序。官网 `staffpicks` 路由当前返回空组件，并重定向到官网推荐；它没有独立的可用作品列表。

## 维护

新增或调整入口时核对官网与公开接口，保留已有入口 ID，说明用户要求的排除项。完整分页和分类导航必须有测试。上游空列表、访问限制及页面变化分别报告，不能根据一次空响应删掉入口。执行 `npm run check`、`npm test`、`npm run build`，再按需执行三项 `smoke:browse` 检查。

参考：[CopyManga 官网](https://www.mangacopy.com/)、[Komiic 官网](https://komiic.com/)、[MangaDex 官网](https://mangadex.org/)、[MangaDex API](https://api.mangadex.org/docs/)。
