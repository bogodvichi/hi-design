# HTML生成契约

## 输入输出

<!-- rule-owner:generation-output -->

编译器输入必须通过相应Schema和Capability约束，输出为可直接CDN预览的HTML。输入合同的选择读取`references/knowledge-resolution.md`，交付范围读取`references/architecture.md`。

客户端提供的当前工作目录是本次项目根目录，也是所有生成成果物的唯一写入根。Skill root只提供只读契约、知识和脚本：调用Compiler或Validator时必须保持当前目录不变，通过Skill root路径定位脚本，并将PageSpec、HTML及随HTML交付的资源写入项目相对路径。不得写入`.od-skills/`、Skill root或仓库内的Skill源目录。

用户明确要求连同本地图片交付时，可创建同目录资源文件夹并使用相对路径；图片只属于本次HTML交付，不进入设计知识库。

产品回归验收是测试构建，不是每次页面生成的附加产物。验收套件输出到`output/product-tests/<product>/`并复制HTML实际引用的产品静态资源；`output/generation-tests/`只保存TPP页面族生成测试，不能登记成产品业务页面结果。

## PageSpec边界

<!-- rule-owner:page-spec-boundary -->

PageSpec只表达本次需求中的语义变量：

- 行业、产品、页面意图。
- 页面标题和业务内容。
- 字段、动作、筛选条件和数据展示选择。
- 允许的区域、组合模式和交互状态。
- 预览fixture的选择或本次样例数据。

全局Schema只约束稳定信封；页面Capability必须显式指向当前页面的payload合同。不得为新增页面向全局Schema加入业务专用字段。

PageSpec不得包含：

- HUI props、events、slots或组件注册代码。
- CDN/npm资源地址。
- CSS选择器、颜色、字号、间距、坐标或`px`值。
- 未在能力摘要登记的Zone、Component Pattern或扩展。
- 用宽泛对象绕过页面Schema的未建模业务结构。

## HTML结构

<!-- rule-owner:html-semantic-structure -->

- 业务区域根节点使用HUI通用Registry登记的`data-zone`。
- 可复用组合模式使用HUI通用Registry登记的`data-component`，并位于Zone内。
- Component内部使用已验证的`el-*`或`h-*`原子标签。
- Component不得互相嵌套；更大编排由Zone表达。
- 不输出页面级`data-component-instance`、`data-component-template`或已废弃的`data-origin`。
- 公共词典只约束稳定命名和拆分映射，不固定Component内部DOM；具体结构和交互来自本次PageSpec与页面Composition。

Zone、Component Pattern和HUI原子标签的合法ID分别以HUI通用Registry和HUI运行契约索引为机器事实源。Component拆分模式的可选值只读取派生Catalog，不在本文重复枚举。

## 样式与tokens

<!-- rule-owner:token-application -->

样式来源按优先级合并：

1. HUI CSS及默认tokens。
2. 产品tokens。
3. 页面模式的布局规则。
4. 合同允许的页面局部语义变量。

产品tokens由产品清单显式引用，并由Compiler注入。变量必须出现在HUI token合同白名单中。

禁止从参考图直接生成散落的品牌色和全局HUI覆盖。页面局部变量只能描述本页面布局语义，不能伪装成产品token或重定义产品品牌token。

## 脚本与data分层

<!-- rule-owner:data-layering -->

- `PAGE_CONFIG`：只保存不随预览样例变化的菜单、字段定义、字段选项、动作和页面配置，置于Vue实例外。
- `PREVIEW_FIXTURES`：只保存CDN预览所需的模拟业务值，置于Vue实例外；Pattern PageSpec中的模拟数据必须显式置于`preview`，Compiler必须原样路由且不得按字段名或页面类型推测归属。
- `data()`：仅声明响应式页面状态、表单状态、选中状态、分页状态和模板必要的只读配置引用。
- `computed`：保存可由响应状态推导的值，不复制状态。
- `methods`：保存用户交互、数据装载和Vue实例服务调用。
- `created()`：调用`loadPreviewFixtures()`，不混入配置声明。
- `loadPreviewFixtures()`：深复制fixture，并且只允许写入`data()`已声明的同名状态，禁止覆盖`config`或创建未声明状态。
- Vue实例外可以声明不可变映射常量；不得把大段mock、资源地址或HUI合同放入`data()`。

页面fixture是预览数据，不是产品知识。同一份默认预览数据只能由`preview`/产品页面fixture拥有，Compiler负责把它序列化到HTML。业务字段名称保持开放；本规则只约束模拟值的容器和运行状态归属，不登记或推测具体业务字段。

## HUI运行资源

<!-- rule-owner:generation-runtime-routing -->

生成HTML时必须读取`references/hui-vue-runtime-contract.md`，并从HUI manifest及按需原子合同获得运行版本、资源、服务API、Dialog和图标规则。本文不重复这些运行时事实。

不得引用Skill父目录的CSS、字体、脚本或token文件。HUI控件内部图标由组件自身负责，不在页面中重复实现。

## 验收

<!-- rule-owner:generation-acceptance -->

生成结果必须依次通过：

1. PageSpec Schema校验。
2. HUI标签、属性、服务API和资源静态校验。
3. Zone、Component Pattern和原子标签层级校验。
4. token白名单及覆盖顺序校验。
5. 产品页面golden几何与交互校验。
6. 浏览器无运行时错误、资源404或关键图标缺失。

任何一级失败都不得把HTML标记为完成。
