# UI standards

本目录维护产品界面中已经确认、可跨业务复用的规范。社区「新建发布」弹窗是首个落地范本。

| 文档 | 内容 | 实现入口 |
| --- | --- | --- |
| [对话框规范](dialogs.md) | 固定区域、内容滚动、字段、卡片、图形选项状态 | `Dialog`、`DialogToolbar`、`FieldGroup`、`VisualChoiceGroup` |
| [全局滚动条规范](scrollbars.md) | 原生布局、尺寸、颜色、兼容边界、生命周期 | `NativeScrollbars` |
| [设计文件查看工具栏](viewer-toolbars.md) | 左侧视图切换、32px 操作按钮、图标、只读和窄屏规则 | `ViewModeSwitch`、文件与草图工具栏 |
| [开发控件与接入](components.md) | 公共 API、示例、代码归属、验证方式 | `@open-design/components` |

## 维护方式

- 交互和视觉规则的当前版本维护在本目录；修改规则时，同步修改公共控件和相关验证。
- 公共控件维护在 [`packages/components/src/`](../packages/components/src/)，通过包入口导出。业务页面直接消费公共 API。
- 业务资产、中文/英文文案、发布类别、请求、权限和持久化由 app 维护。共享组件接收数据和回调。
- 新增规范时，在本索引登记适用范围、实现入口和验证位置；具体业务的宽高等参数在规范中标为范本参数。
- 既有页面可以逐步接入。新增或调整同类界面时，优先使用本目录对应控件。

## 当前落地

- [`PublishDialog`](../apps/web/src/components/PublishDialog.tsx)：对话框布局、固定分类切换、字段分组。
- [`DefaultLogoPicker`](../apps/web/src/components/DefaultLogoPicker.tsx)：将 Skill/MCP 资产和本地化标签转换为公共图形选项。
- [`AppEntry`](../apps/web/src/AppEntry.tsx)：安装一次全局覆盖式滚动条。
- 全局对话框：确认/重命名、分享、Skill/MCP 导入、项目/品牌/团队创建、资源选择、反馈、评审、自动化、更新和额度提示等均接入统一分区样式；设置和预览保留内部工作区布局。
- [`dialog-chrome.css`](../packages/components/src/dialog-chrome.css)：共享 React 对话框与原生/动画弹窗使用的同一套尺寸和分区契约；浏览器回归见 [`dialog-chrome.test.ts`](../e2e/ui/dialog-chrome.test.ts)。

验证分为公共控件测试、业务组件测试和实际浏览器检查；命令见[开发控件与接入](components.md#验证)。
