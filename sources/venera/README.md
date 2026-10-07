# Venera 源目录

为 Android 上兼容 Venera JavaScript 源格式的阅读器预留。此目录尚未提供可安装的源或源列表。

后续适配可以通过 `packages/copymanga` 复用 CopyManga 的请求签名、登录编码、数据模型和图片排序。Venera 的 `Network`、本地存储、账号界面与源列表格式在此目录实现，避免将阅读器 API 加入共享模块。

发布内容将放在 GitHub Pages 的 `/manga-source/venera/` 下。实现后增加该目录的 `package.json`、构建和测试命令，再纳入发布脚本。主仓库首页在源完成前不会提供安装链接。
