# GTNH Planner 静态汉化镜像

这是 [gtnhplanner.com](https://gtnhplanner.com/)（GregTech: New Horizons 工厂规划器）的**静态汉化镜像**，界面 UI 已翻译为简体中文，配方数据完整（GTNH 2.9.0-beta-2，约 27.6 万条），无需安装任何扩展，打开即用。

**在线访问**：https://nanshang126.github.io/gtnh-planner-zh-site/

## 工作原理

- 完整镜像原站前端静态资源（Next.js 构建产物）
- 原站的 `/api/datasets/*` 后端接口由 Service Worker 在浏览器端模拟，数据源为站点内嵌的静态配方数据集
- 物品/流体名称保留英文（与游戏内对照一致），界面按钮/标签/提示已全部汉化
- 社区功能（分享/登录）为占位模拟，不可用；核心规划功能（搜索、配方、画板）完整可用

## 与原站的关系

本项目仅为临时使用的汉化镜像，所有数据版权归原站所有。原站更新后本镜像不会自动跟进。

## 本仓库另一条路线

账号下的 [`gtnh-planner-zh`](https://github.com/NanShang126/gtnh-planner-zh) 仓库是**油猴脚本**方案：不镜像网站，直接给原站加汉化滤镜，含 3.2 万条物品官方译名，可随原站更新。两个方案可互补使用。
