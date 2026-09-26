# 知识解析契约

## 解析输入

<!-- rule-owner:resolution-input -->

Resolver只接受语义标识：

- `industry`
- `product`
- `product_version`（用户明确指定产品版本时）
- `page_type`或标准页面意图
- 用户明确提供的参考资料类型

不得使用颜色、坐标或DOM片段决定知识命中。

ISC版本表达统一归一如下：用户说“ISC新版本”“ISC 3.0”或“ISC 3.0.0”时，`product=isc`、`product_version=3.0.0`，并自动选择产品登记的`isc-3.0.0` Portal Shell标准。未提版本时不得擅自升级，继续使用产品默认Shell。

## 分层检索顺序

<!-- rule-owner:knowledge-resolution-order -->

按以下顺序解析并记录每层命中来源：

1. 从`design-systems/catalog.json`确定HUI通用知识、行业和产品根目录。
2. 读取HUI manifest的紧凑运行时摘要，不加载全部原子合同。
3. 读取HUI通用Zone和Component Pattern目录。
4. 先读取HUI通用业务语义，再读取行业产品索引及行业扩展；只加载与本次页面意图相关的实体、字段、枚举和动作。
5. 通过产品`product.json`的显式指针加载产品Profile、Shell、tokens和资产清单。
6. 先通过产品页面索引查找精确页面入口；命中时按显式指针读取Capability、payload Schema、Composition、Fixture和Golden。
7. 未命中产品页面时，继续查找已验证HUI页面族及其中央Registry Renderer；仅在目标产品Profile、Shell、tokens均可加载时提供页面族兜底能力。
8. 精确产品页由Composition选择HUI页面模式；HUI兜底页先把需求归一为一次性的`PageIntent`（页面类型、语义族、已确认特征），再由确定性Resolver从映射事实中选择唯一精确Variant。
9. 编译器根据实际使用的HUI标签按需加载原子合同。
10. Validator最后加载完整白名单和golden断言，不把这些内容回灌给AI。

继承方向为：

```text
HUI通用知识 → 行业扩展 → 产品差异 → 页面约束 → 本次PageSpec
```

下层只能在合同允许范围内覆盖上层，不得复制后改名。

## Capability Bundle

<!-- rule-owner:capability-bundle -->

Resolver面向AI输出精简Capability Bundle，而不是原始知识文件集合：

```json
{
  "selection": {
    "industry": "general",
    "product": "isc",
    "page_intent": "manual-filter-table",
    "page_pattern": "hui.tpp.family.table-manual-filter"
  },
  "allowed_zone_ids": [],
  "allowed_component_pattern_ids": [],
  "business_fields": [],
  "business_actions": [],
  "extension_kinds": [],
  "shell_capabilities": {},
  "runtime_features": []
}
```

Bundle只暴露AI需要做选择的内容。tokens值、HUI完整props、CDN URL、golden坐标和fixture正文不得进入能力摘要。

`resolve_capabilities.py`输出该Bundle。`selection.compile_route`只能是`product-composition`或`hui-pattern-fallback`。HUI兜底还必须输出可选的`pattern_variants`；`can_compile=false`表示产品Composition与可编译HUI兜底均不可用，AI必须报告`knowledge_gaps`。

## AI调用与输入合同选择

<!-- rule-owner:spec-selection -->

AI按以下步骤工作：

1. 从需求识别行业、产品，并一次性形成符合`schemas/tpp-page-intent.schema.json`的结构化页面意图；不能确定的特征不填，不得编造默认值。
2. 调用Resolver获取能力摘要。一个候选时允许继续，零个候选时报告知识缺口，多个候选时只请求Resolver所列的区分特征。
3. 只在能力摘要允许范围内选择业务字段、动作、Zone、Component Pattern和扩展。
4. 生成语义PageSpec，不生成HUI属性、CSS、资源URL或HTML片段。
5. PageSpec Schema不支持用户需求时报告Schema或知识缺口，不用自由字段绕过。

表单锚点Variant按以下优先级选择：

1. 用户明确要求锚点、目录导航或分段定位时，必须选择已验证的`form-anchored`页面族及其精确Variant。
2. 用户未明确要求时，不得仅因存在多个`form_sections`选择锚点；少于4个可见区块时默认选择非锚点表单。
3. 用户未明确要求且至少有4个可见区块时，只有根据字段数量、条件展开状态和目标视口判断主要内容无法在一页完整展示，才允许选择锚点；区块数量只是候选门槛，不是自动触发条件。
4. 已选择非锚点Variant时，Renderer不得根据运行时区块数量自行显示锚点。

表格、表单、卡片和详情页都必须在生成PageSpec和调用Renderer前执行一次完整Variant选择，不得只在已经命中的局部页面族中随意取默认项。各批次的`mappings/<page-kind>.json`是选择事实源；PageIntent中的每个特征都必须与候选Variant参数精确相等。以下表格策略继续作为自然语言归一到PageIntent的领域判断规则：

1. 读取`design-systems/HUI/page-patterns/tpp/mappings/table.json`的`selection_strategy`，将需求与其中登记的全部18个精确表格Variant比较。
2. 按详情栏、统计、树与标签页组合、单树、单标签页、即时过滤、手动过滤、基础表格的优先级逐层排除，最终选择唯一`pattern_contract`。
3. 用户明确提出的结构、触发方式、位置、标签样式和收起方式优先；不得用字段数量或Renderer当前支持情况覆盖明确需求。
4. 同时需要树和标签页时，必须根据主要导航轴区分`table-tabs/*-with-tree`与`table-tree/tree-with-*`，不得把两组Variant视为同义项。
5. 只有排除详情栏、统计、树、标签页和过滤需求后，才允许选择`table-basic`；是否带操作栏继续由表格级动作决定。
6. 无法唯一判断时报告具体歧义并请求选择；未得到唯一精确Variant前不得开始HTML渲染。

表格过滤Variant必须至少按四个维度依次判断：触发方式、选项密度、控件形态、收起方式。即时刷新或手动查询只决定过滤页面族，不能直接决定水平栏或侧边栏。大多数或全部枚举条件各有5个及以上选项，尤其普遍达到5至10个或更多时，应优先选择对应的水平过滤Variant，让各条件选项在内容区展开。只有用户明确要求侧栏、条件存在明显层级导航，或目标视口无法承载横向展开时，才选择侧边栏。输入框、日期和选择器等混合控件为主且选项不密集时，手动过滤优先选择常规过滤盒。

`compile_route=product-composition`时使用`page-spec.v2`，其payload结构只读取当前Capability声明的`spec_schema`。

`compile_route=hui-pattern-fallback`时使用`pattern-page-spec.v2`。该合同必须显式声明`industry`、`product`、`page_kind`和Resolver返回的精确`pattern_contract`；业务字段与内容来自本次真实需求，所有模拟业务值必须显式置于`preview`，产品提供Profile、Shell、tokens和运行资源，HUI Variant提供稳定结构、几何与布局事实。不得用fallback臆造未知业务能力。

两个输入合同的具体字段分别以`schemas/page-spec.schema.json`和`schemas/pattern-page-spec.schema.json`为机器事实源。

TPP兜底默认只选择一个精确Variant。单个Variant不能完整覆盖需求时，AI可以通过`knowledge_composition`选择一个主Variant和一个辅助Variant；辅助Variant只允许贡献`design-systems/HUI/page-patterns/tpp/mappings/composition.json`登记的能力。Compiler必须先检查同页面类型、同Renderer和独占参数冲突，再检查辅助变量完整性；冲突、未登记组合或变量缺失都必须在渲染前失败，不得静默退回主Variant或自由拼接HTML。

## 编译器调用规则

<!-- rule-owner:compiler-resolution -->

Compiler必须重新从事实源加载完整合同，不能信任AI对HUI、资源或tokens的描述：

1. 校验PageSpec。
2. 重放Resolver选择并确认继承关系。
3. 根据`compile_route`和中央Renderer Registry选择实现；产品路由加载Composition，HUI兜底路由加载精确Variant，两者都装配目标产品Shell和tokens。
4. 按需加载HUI原子合同及图标依赖。
5. 按`references/generation-contract.md`应用产品tokens和预览fixture。
6. 输出D2C语义标注及HTML。

## 缺口处理

<!-- rule-owner:knowledge-gap-policy -->

- 未知行业实体或动作：报告行业知识缺口。
- 产品未登记：报告产品知识缺口。
- 页面未登记但已验证HUI页面族可表达：只有该页面族已登记Renderer且产品上下文完整时可走`hui-pattern-fallback`；否则报告Renderer或产品知识缺口。
- HUI组件接口未验证：禁止推测prop或事件。
- 未知Component Pattern或Zone：终止编译。
- 用户要求自由视觉值但Schema不支持：报告覆盖缺口。
