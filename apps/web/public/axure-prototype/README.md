# TaskFlow — Axure RP HTML 交互稿包

一个遵循 Axure RP HTML 导出约定的可交互原型包，附带「任务管理」示例设计稿。

## 关于工具

Axure RP 是导出标准 Axure HTML 交互稿的官方工具，其运行时为专有代码，第三方生成器很少见。本包按 Axure 导出的标准目录约定，用纯 HTML/CSS/JS 复刻同样结构，可直接用浏览器打开，也便于二次编辑。

## 目录结构（对照 Axure 导出规范）

axure-prototype/
├── index.html              入口：站点地图 + 原型画布（Axure player）
├── start.html              启动器，跳转 index.html
├── data/document.js        文档元数据 / 页面树（Axure: data/document.js）
├── resources/css/           reset / axure_rp / app / sitemap 样式
├── resources/scripts/      player.js（站点地图+导航） interactions.js（弹窗/标签/图标）
└── files/<page>/           每页一目录（Axure: files/<page>/page.html）
    login · dashboard · taskdetail · settings

## 使用

用浏览器打开 index.html。左侧站点地图选页，主画布展示原型；页面内链接、弹窗、标签页均可交互。

## 示例设计稿：TaskFlow 任务管理

登录 → 仪表盘 → 任务详情 → 设置 的完整流程：统计卡片、任务表行点击进入详情、新建任务弹窗、任务详情标签页与评论流、设置多标签与开关。
