# 行业知识包

| 属性 | 值 |
|------|-----|
| 行业类型 | 通用 |
| 产品类型 | isc |

---

## 目录结构

| 路径 | 说明 |
|------|------|
| "pages.json" | 页面类型索引，列出当前行业产品所有可选页面类型及其元信息 |
| "components.json" | 组件知识库，按页面区域分组，包含可用组件的名称、封面、布局结构等 |
| "pages/" | 页面布局结构文件目录，"pages.json" 中 "ref" 字段指向此目录下的 JSON 文件 |
| "images/" | 封面图目录，存放页面与组件的预览图（PNG） |

---

## pages.json

页面类型索引文件。AI 或下游服务通过该文件检索可用页面类型，再按 "ref" 加载 "pages/" 目录中的完整布局结构。

### 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| "industry" | string | ✓ | 行业类型，与知识包所属行业一致 |
| "product" | string | ✓ | 产品类型，与知识包所属产品一致 |
| "pages" | array | ✓ | 页面类型列表 |

### pages 数组项

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| "name" | string | ✓ | 页面类型名称，唯一标识一种页面布局，通常与 "ref" 文件名（不含扩展名）一致 |
| "description" | string | ✓ | 页面描述，可包含最小尺寸、适用场景等约束说明 |
| "ref" | string | ✓ | 布局文件的相对路径，指向 "pages/" 目录下的 JSON 文件 |
| "cover" | string | — | 封面图相对路径，指向 "images/" 目录下的 PNG 文件 |

> "ref" 指向的文件包含 "beginRendering"、"surfaceUpdate" 等完整渲染指令；新增页面时需同步维护索引项、布局文件及封面图。

---

## components.json

组件知识库文件。按页面功能区域（section）组织，供 AI 在组装页面时检索、引用合适的 UI 组件及其布局结构。

整体为 **数组**，每个元素代表一个页面区域分组。

### 区域分组（section 项）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| "section" | string | ✓ | 区域名称，对应页面中的功能区块，如「标题栏」「tab栏」「主内容展示区」 |
| "components" | array | ✓ | 该区域下可用的组件列表 |

### 组件项（components 数组项）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| "component" | string | ✓ | 组件名称，唯一标识该组件 |
| "key" | string | — | 组件实例标识，与 "images/" 中封面图文件名对应 |
| "cover" | string | — | 组件封面图相对路径，指向 "images/{key}.png" |
| "layout" | array | — | 组件的 DSL 布局节点列表，描述内部结构与样式 |
| "subComponents" | array | — | 子组件列表，用于组合型组件，内含可切换的变体 |

> 简单组件通常包含 "key"、"cover"、"layout"；组合型组件通过 "subComponents" 引用子组件及其变体，父级 "layout" 中通过 "ref" 节点关联子组件。

### 子组件项（subComponents 数组项）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| "component" | string | ✓ | 子组件名称 |
| "variants" | object | ✓ | 变体集合，键为变体名称，值为该变体的具体定义 |

### 变体项（variants 对象值）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| "key" | string | ✓ | 变体实例标识，与封面图文件名对应 |
| "cover" | string | ✓ | 变体封面图相对路径 |
| "layout" | array | ✓ | 该变体下的 DSL 布局节点列表 |

### 布局节点（layout 数组项）

每个 layout 节点描述组件树中的一个元素，通过 "id" 建立父子引用关系（"children.explicitList" 引用子节点 "id"）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| "id" | string | ✓ | 节点唯一标识 |
| "component" | object | △ | 内联组件定义，与 "ref" 二选一 |
| "ref" | object | △ | 对外部子组件的引用，与 "component" 二选一 |
| "x" | number | — | 相对父节点的水平偏移 |
| "y" | number | — | 相对父节点的垂直偏移 |
| "width" | number | — | 节点宽度 |
| "height" | number | — | 节点高度 |

#### component 对象

键名为组件类型，值为该类型的属性配置。常见类型：

| 类型 | 用途 |
|------|------|
| "Row" | 水平弹性布局容器 |
| "Column" | 垂直弹性布局容器 |
| "Div" | 通用容器 |
| "Text" | 文本节点，含 "text" 与字体样式 |
| "Icon" | 图标节点，通过 "name" 引用设计系统中的图标 |
| "Image" | 图片节点，通过 "href" 引用图片资源 |
| "Svg" | 矢量图形节点 |

容器类型（"Row" / "Column" / "Div"）通常包含：

- "styles" — 样式属性（"justify-content"、"align-items"、"padding"、"gap"、"backgroundColor"、"borderRadius"、"flex" 等）
- "children.explicitList" — 子节点 "id" 的有序列表

#### ref 对象

用于在父组件 layout 中引用 "subComponents" 里已定义的子组件变体。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| "component" | string | ✓ | 引用的子组件名称 |
| "currentVariant" | string | ✓ | 当前使用的变体名称 |
| "variants" | array | ✓ | 该子组件所有可用变体名称列表 |
