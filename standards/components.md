# 开发控件与接入

本次沉淀的公共控件统一从 `@open-design/components` 导入。实现仅依赖 React 和浏览器能力；业务资产、文案、权限、数据请求和发布逻辑保留在 app。

| 控件 | 用途 | 源码 |
| --- | --- | --- |
| `Dialog layout="scrollable"` | 固定头部、工具区、操作区，主体独立滚动 | [dialog.tsx](../packages/components/src/dialog.tsx) |
| `DialogToolbar` | 类型切换等固定控件，底部保留 `4px` 安全间距 | [dialog.tsx](../packages/components/src/dialog.tsx) |
| `DialogBody` | 内容滚动区，支持 `ref` 读取或重置滚动位置 | [dialog.tsx](../packages/components/src/dialog.tsx) |
| `FieldGroup` | 常规左对齐标签、原生字段分组与禁用语义 | [field-group.tsx](../packages/components/src/field-group.tsx) |
| `VisualChoiceGroup` | 带统一外框状态的受控图形选项组 | [visual-choice-group.tsx](../packages/components/src/visual-choice-group.tsx) |
| `OverlayScrollbars` / `installOverlayScrollbars` | 覆盖式滚动条的挂载与清理 | [overlay-scrollbars.tsx](../packages/components/src/overlay-scrollbars.tsx) |

## 可滚动对话框

```tsx
import { useRef, useState } from 'react';
import {
  Button, Dialog, DialogBody, DialogFooter, DialogHeader,
  DialogTitle, DialogToolbar, FieldGroup, Input,
} from '@open-design/components';

export function ExampleDialog({ onClose }: { onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  return (
    <Dialog layout="scrollable" ariaLabelledBy="example-title"
      closeOnEscape onClose={onClose}>
      <DialogHeader>
        <DialogTitle id="example-title">编辑内容</DialogTitle>
      </DialogHeader>
      <DialogToolbar>
        <Button onClick={() => { bodyRef.current?.scrollTo({ top: 0 }); }}>
          返回内容顶部
        </Button>
      </DialogToolbar>
      <DialogBody ref={bodyRef}>
        <FieldGroup label="名称">
          <Input aria-label="名称" value={name}
            onChange={event => setName(event.target.value)} />
        </FieldGroup>
      </DialogBody>
      <DialogFooter><Button onClick={onClose}>完成</Button></DialogFooter>
    </Dialog>
  );
}
```

`DialogProps.layout` 默认为 `scrollable`；`default` / `sectioned` 标识保留兼容，通用分区尺寸统一遵循当前规范。`DialogToolbar` 接收常规 `div` 属性，`DialogBody` 支持 `HTMLDivElement` ref。复杂预览可用 `appearance="workspace"` 保留内容区布局。

通过 `className` 设置业务面板尺寸和内容样式。需要自定义完整外观时，传入 `includeChromeClassName={false}`、`className` 和 `backdropClassName`；`scrollable` 的结构布局仍然生效。四个区域保持为 Dialog 的直接子元素。

既有动画面板或原生表单可以保留宿主元素，并接入相同的 CSS 属性契约。组件包的 Dialog 入口自动带入 [`dialog-chrome.css`](../packages/components/src/dialog-chrome.css)：

```tsx
<section data-dialog-surface="standard" role="dialog" aria-modal="true"
  aria-labelledby="edit-title">
  <header data-dialog-part="header">
    <h2 id="edit-title" data-dialog-part="title">编辑内容</h2>
    <button data-dialog-part="close" aria-label="关闭" onClick={onClose}>×</button>
  </header>
  <form data-dialog-part="form" onSubmit={onSubmit}>
    <div data-dialog-part="body">
      <label data-dialog-field><span>名称</span><input name="name" /></label>
    </div>
    <footer data-dialog-part="footer"><button type="submit">保存</button></footer>
  </form>
</section>
```

`data-dialog-surface` 支持普通面板 `standard`、复杂工作区 `workspace` 和原生全屏容器 `fullscreen`。分区值为 `header`、`toolbar`、`body`、`footer`、`form`；细部值为 `title`、`description`、`close`、`label`、`actions`。`data-dialog-field` 仅标记普通纵向字段，不能用于复选框行、资源列表项或工具按钮。`data-dialog-control` 可标记字段内部较深的文本控件。`data-dialog-backdrop` 统一遮罩容器的 `24px` 安全内边距，保留业务层叠顺序；遮罩不绑定关闭事件，独立门户和动画弹窗也必须遵循。

`DialogToolbar role="tablist"` 自动采用分段类型切换样式；原生同类类型栏标记 `data-dialog-tabs`，直接选项使用 `role="tab"` / `aria-selected`。资源卡片中的筛选、编辑器工具和侧边栏导航保留各自控件样式。

`FieldGroup` 必填 `label`，其余接收原生 `fieldset` 属性（包括 `disabled`、`className` 和 `style`）。普通单一输入也可以继续使用原生 `label`。

## 图形选项组

```tsx
import { useState } from 'react';
import { VisualChoiceGroup, type VisualChoiceOption } from '@open-design/components';

type Shape = 'circle' | 'square';
const options: VisualChoiceOption<Shape>[] = [
  { value: 'circle', label: '圆形', visual: <span aria-hidden>●</span> },
  { value: 'square', label: '方形', visual: <span aria-hidden>■</span> },
];

export function ShapeField() {
  const [value, setValue] = useState<Shape>('circle');
  return <VisualChoiceGroup label="图形" value={value}
    onChange={setValue} options={options} />;
}
```

`VisualChoiceGroupProps<Value>`：

| 属性 | 约定 |
| --- | --- |
| `label` | 字段标题，ReactNode |
| `options` | `{ value, label, visual, disabled? }` 数组；value 为稳定且唯一的字符串 |
| `value` / `onChange` | 受控当前值及变更回调 |
| `disabled` | 禁用整个原生字段组，默认 false |
| `size` / `radius` | 原图尺寸与圆角，默认 `34` / `8` px；传入视觉资产应与之匹配 |
| `className` | 字段组的业务样式扩展 |

外框、间距与状态遵循[对话框规范](dialogs.md#图形选项)，共享控件不承担 Logo key、语言判断或资产渲染。现有 `DefaultLogoPicker` 是业务适配器示例。

## 覆盖式滚动条

```tsx
import { OverlayScrollbars } from '@open-design/components';

export function Application() {
  return <><OverlayScrollbars /><main>{/* 业务界面 */}</main></>;
}
```

组件在 effect 中安装到 `document.body`，SSR 阶段不访问 DOM；缺少必要浏览器能力时继续使用原生滚动条。包入口会带入所需滚动条 CSS。

需要手动控制生命周期时：

```ts
import { installOverlayScrollbars } from '@open-design/components';

const dispose = installOverlayScrollbars(document.body);
// 在该界面退出或根节点卸载时：
dispose();
```

React 与手动安装方式择一使用，同一文档保持一个实例。行为和状态数值的完整约定见[全局滚动条规范](scrollbars.md)。

沙箱预览使用 `buildOverlayScrollbarsScript()` 生成自包含脚本，在预览响应或 srcdoc 内执行。非 React 的服务端通过 `@open-design/components/overlay-scrollbars-runtime` 导入，避免加载 React 和组件 CSS；仅增强预览响应，不改写设计源文件。

## 视图切换

`ViewModeSwitch` 从 `@open-design/components` 导入，接收 `label`、`value`、`onChange` 和 `options`。
每项为 `{ value, label, icon, disabled?, title? }`，图标由业务传入 ReactNode。
默认在宽度不大于 720px 的容器中隐藏文字标签；设置 `collapseLabels={false}` 可始终保留文字。
控件使用受控选择、单一 Tab 停靠点和跳过禁用项的左右方向键/Home/End 导航。
布局、尺寸及接入入口见[设计文件查看工具栏](viewer-toolbars.md)。

## 验证

```sh
pnpm --filter @open-design/components test
pnpm --filter @open-design/components build
pnpm --filter @open-design/web test tests/components/PublishDialog.skill-category.test.tsx tests/components/SquareView.mcp-publication.test.tsx
pnpm --filter @open-design/e2e exec playwright test -c playwright.config.ts community-skill-publish.test.ts --grep "publish categories" --workers=1
pnpm guard
pnpm typecheck
```

公共交互与清理逻辑由 `packages/components/tests/` 覆盖；业务提交与禁用行为由 web 组件测试覆盖；固定区域、真实滚动、热区、颜色和外框几何由上述浏览器用例验证。
