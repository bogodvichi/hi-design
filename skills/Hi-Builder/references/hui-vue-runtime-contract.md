# HUI Vue HTML运行契约

生成或修改HUI Vue单HTML前读取。所有路径均相对于Hi-Builder技能仓库根目录，禁止读取或引用父项目资源。

## 运行资源

<!-- rule-owner:hui-runtime-resources -->

运行版本、CDN URL、可选依赖和加载条件唯一取自`design-systems/HUI/manifest.json`，不得在提示词、模板或本文另写版本和URL副本。CDN预览与npm完整引入必须解析为manifest登记的同一版本。

加载阶段固定为：

1. manifest登记的HUI CSS。
2. 页面自身CSS。
3. manifest登记的Vue运行时。
4. manifest登记的HUI运行时。
5. 页面实际使用且manifest登记的可选资源。
6. Vue实例脚本。

Vuex仅在代码真实使用`Vuex`或`$store`时装载。禁止引用父目录字体、CSS或脚本。

## 图标

<!-- rule-owner:hui-icon-usage -->

图标能力的机器事实源是HUI manifest的`runtime_profile.icon_modes`、可选资源配置、`icons/catalog.json`，以及`runtime-contracts/basic-form/icon.json`和`svg-icon.json`。生成时只读取目标版本合同登记的模式和组件，不从示例名称推测可用图标。

页面配置的`icon`字段兼容原有字体类字符串，并支持三种结构化引用：

```json
{"mode": "font", "name": "h-icon-car"}
{"mode": "icon-v2", "name": "Car"}
{"mode": "business-svg", "name": "SvgBoxCamera"}
```

编译器必须根据`mode`选择正确的HUI容器，并在生成前使用`icons/catalog.json`校验`name`。

### 字体图标

```html
<i class="h-icon-edit"></i>
```

类名必须由目标manifest资源中的`hui.css`定义。不得另载字体图标CSS；Select等HUI组件自带的箭头、清空和状态图标不得重复实现。

### Icon V2组件

npm工程从manifest登记的图标包导入：

```vue
<script>
import { Add, AngleDownSm } from '@hui/icons-vue'
export default {
  components: { Add },
  data() {
    return { Add, AngleDownSm }
  }
}
</script>

<template>
  <div>
    <Add />
    <h-icon><Add /></h-icon>
    <el-button :icon="Add" :icon-suffix="AngleDownSm">新增</el-button>
  </div>
</template>
```

CDN单HTML使用Icon V2组件时，在HUI运行时之后装载manifest的`optional_resources.svg_icons`，并使用其中登记的全局名在创建Vue实例前注册。未使用Icon V2组件时不得装载该资源。

### 直接SVG

```html
<h-icon>
  <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <path d="..."></path>
  </svg>
</h-icon>
```

### 预定义业务SVG

```html
<h-svg-icon>
  <svg-box-camera />
  <svg-state-cascade />
</h-svg-icon>
```

`h-svg-icon`负责尺寸和状态组合；其内部只放目标合同登记的`Svg*`业务组件（在HTML模板中可写为对应的`svg-*`标签）。

禁止`el-icon-*`、未登记图标类、用图片代替控件图标，以及在HUI控件上叠加另一套内部箭头。

## 服务API与Dialog

<!-- rule-owner:hui-services-and-dialog -->

实例服务白名单和Dialog绑定语法唯一取自manifest的`runtime_profile`，具体参数取自对应HUI运行合同。

服务必须通过当前Vue实例调用，例如`this.$message`、`this.$notify`。禁止生成`ElMessage`、`ElNotification`或`ElMessageBox`等manifest登记的非法全局调用。

Dialog可见性必须使用manifest登记的绑定语法，并保持关闭状态可回传；不得根据其他HUI版本示例自行切换语法。

## 页面脚本职责

<!-- rule-owner:runtime-data-routing -->

页面脚本的数据归类、fixture装载和Vue生命周期规则只读取`references/generation-contract.md`的“脚本与data分层”，本文不维护副本。运行时校验器负责检查生成HTML是否符合该契约。
