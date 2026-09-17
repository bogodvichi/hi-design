# Hi-Builder Skill 工程导航

`Hi-Builder/`是一套设计知识驱动的页面编译工程：AI把自然语言需求收敛为结构化页面意图，脚本解析HUI通用知识与行业产品知识，确定性生成并校验可预览的单页HTML。

本文面向共同维护知识库的设计师和工程人员，只提供工程导航、目录职责与维护入口，不是生成规则的权威来源。具体规则从以下文件读取：

- `SKILL.md`：AI执行入口与工作流。
- `references/architecture.md`：知识分层、消费者边界与事实源归属。
- `references/knowledge-resolution.md`：知识查找顺序与缺口处理。
- `references/generation-contract.md`：HTML输出、语义标注、数据分层与验收。
- `references/hui-vue-runtime-contract.md`：HUI资源、组件、服务和图标用法。
- `references/rule-ownership.json`：规则权威来源及机器事实源登记。

README被登记为导航文档，校验器会阻止它复制独占规则或版本、资源地址等机器事实。

## 工程全景

```text
Hi-Builder/
├── SKILL.md                                      # Agent入口：选择知识、生成PageSpec、调用编译和完成验收
├── agents/                                       # Skill运行界面元数据
│   └── openai.yaml                               # Skill名称、简介和默认提示词
├── references/                                   # AI按需读取的架构与生成规则
│   ├── architecture.md                           # 知识职责、事实源和编译架构
│   ├── knowledge-resolution.md                   # HUI、行业产品与页面知识解析顺序
│   ├── generation-contract.md                    # HTML生成与验收合同
│   ├── hui-vue-runtime-contract.md               # HUI Vue运行时使用合同
│   └── rule-ownership.json                       # 规则与机器事实源的归属索引
├── schemas/                                      # 页面输入的机器校验结构
│   ├── page-spec.schema.json                     # 产品业务页面输入信封
│   ├── pattern-page-spec.schema.json             # HUI典型页面族输入信封
│   └── tpp-page-intent.schema.json               # TPP页面类型、语义族与选择特征合同
├── design-systems/                               # HUI通用与行业产品设计知识库
│   ├── catalog.json                              # 全部设计知识的根索引
│   ├── HUI/                                      # HUI通用知识
│   │   ├── common-domain/fields/catalog.json   # HUI通用业务字段
│   │   ├── manifest.json                     # HUI知识与运行资源总入口
│   │   ├── runtime-contracts/                # HUI原子组件运行时合同
│   │       │   ├── index.json                    # Vue实际标签到组件合同的派生索引
│   │       │   ├── basic-form/                   # 基础、表单和图标组件合同
│   │       │   ├── data/                         # 表格、树、分页等数据组件合同
│   │       │   ├── navigation/                   # 菜单、页签、步骤等导航组件合同
│   │       │   ├── notice/                       # 消息、通知、加载等反馈合同
│   │       │   ├── others/                       # Dialog、Card、Tooltip等其他组件合同
│   │       │   ├── mappings/                     # 官方目录、采集批次与合同文件映射
│   │       │   └── evidence/                     # 官方文档采集证据，不作为默认生成输入
│   │   ├── zones/                            # 跨产品通用的业务区域语义合同
│   │   ├── component-patterns/               # HUI通用data-component组合模式
│   │       │   ├── catalog.json                  # 从各词条合同汇总的公共词典
│   │       │   └── <component-id>/contract.json  # 一个组合模式词条的人工维护事实源
│   │   ├── page-patterns/                    # HUI通用页面模式
│   │       │   ├── catalog.json                  # 通用页面模式路由
│   │       │   ├── generic/                      # 最低通用页面模式
│   │       │   ├── list-search/                  # 查询列表页面模式
│   │       │   ├── form-fixed-width-one-column/  # 定宽单列表单合同与证据
│   │       │   └── tpp/                          # TPP典型页面知识
│   │       │       ├── catalog.json              # TPP典型页面总目录
│   │       │       ├── families/                 # 多个典型页共享的页面族合同
│   │       │       ├── pages/                    # 一个真实典型页的精确参数合同
│   │       │       ├── mappings/                 # 官方路由到页面族和合同文件的导入映射
│   │       │       └── evidence/                 # 浏览器测量与DOM采集证据
│   │   └── theme/                            # HUI主题知识
│   │           └── token-contract.json           # 产品可以覆盖的HUI token边界
│   └── industry-products/                         # 行业及其产品知识
│       ├── general/                              # 通用行业知识
│       │   ├── industry.json                     # 通用行业索引
│       │   ├── domain/fields/catalog.json        # 继承HUI通用字段的行业扩展
│       │   └── products/isc/                     # ISC产品知识
│       │       ├── product.json                  # ISC产品知识总入口
│       │       ├── profile.json                  # 产品身份、Logo和几何角色
│       │       ├── theme/tokens.json             # ISC产品视觉token覆盖
│       │       ├── portal-shell/contract.json    # 产品头部、侧栏、菜单和响应式壳子
│       │       └── pages/<page-type>/            # 按业务页面类型组织的产品页面知识
│       │           ├── page.json                 # 一个产品页面的本地索引
│       │           ├── capabilities.json         # AI可读取的页面能力
│       │           ├── payload.schema.json       # 页面业务输入Schema
│       │           ├── composition.json          # 页面组合与Renderer选择
│       │           ├── fixture.json              # CDN预览样例数据
│       │           └── golden.json               # 页面验收基线
│       └── public-security/                      # 公安行业知识
│           ├── industry.json                     # 公安行业索引
│           └── products/pvia/product.json        # PVIA产品入口及当前知识建设状态
├── assets/                                       # 编译使用但不加载为知识文本的资产
│   ├── templates/                                # Renderer使用的HTML模板，不是产品页面知识
│   └── imgs/                                     # 编译结果复制或引用的本地静态图片
├── scripts/                                      # 知识解析、编译、导入和校验程序
│   ├── resolve_capabilities.py                   # 为AI解析精简页面能力
│   ├── resolve_tpp_intent.py                     # 将结构化PageIntent解析为唯一TPP Variant
│   ├── tpp_intent.py                             # TPP确定性选择与歧义、知识缺口诊断
│   ├── compile_page.py                           # 编译产品业务页面
│   ├── compile_pattern_page.py                   # 编译HUI典型页面族
│   ├── renderer_registry.py                      # Renderer、输入合同、页面种类与模板路径中央映射
│   ├── semantic_registry.py                      # Zone、Component Pattern和HUI原子控件语义校验
│   ├── validate_page.py                          # 产品业务页面校验
│   ├── validate_pattern_page.py                  # 典型页面族校验
│   ├── validate_skill.py                         # 全工程结构、索引、规则归属和模板校验
│   ├── generate_component_pattern_catalog.py     # 重建公共data-component派生词典
│   ├── import_hui_contracts.py                   # 从HUI证据重建组件合同与运行时索引
│   └── import_tpp_page_patterns.py               # 从TPP证据提炼页面目录、页面族和精确合同
├── tests/                                        # 自动化回归与验收输入
│   ├── test_pipeline.py                          # 编译、规则归属、索引说明和生成行为回归测试
│   ├── fixtures/                                 # 产品业务页PageSpec测试输入
│   ├── generation/                               # HUI典型页面族测试输入
│   └── product-pages/                            # 按产品登记的完整页面验收套件
└── output/                                       # 可重新生成的HTML、资源和验收结果，不是知识事实源
```

## 索引即说明

设计知识目录不额外散布README。每个关键层级使用本层已经存在的JSON索引提供就地说明，统一包含：

| 字段 | 给维护者的含义 |
|---|---|
| `maintenance.purpose` | 本索引和本目录解决什么问题 |
| `maintenance.edit_policy` | 哪些内容在这里维护，哪些内容应去其他知识层 |
| `maintenance.managed_paths` | 当前层级下每个关键文件或目录的职责 |

`scripts/validate_skill.py`会发现根目录、HUI、字段、页面模式、行业、产品和产品页面索引，并检查上述说明是否完整、登记路径是否真实存在。以后新建行业、产品或产品页面索引时，也会自动进入检查范围。

其中两个索引是派生产物：

- `component-patterns/catalog.json`由各Component Contract汇总。
- `runtime-contracts/index.json`由HUI合同导入脚本汇总。

它们的维护说明写在生成脚本中，重建时不会丢失。

## 维护入口速查

| 需要维护的内容 | 从哪里进入 |
|---|---|
| HUI组件属性、事件、方法或插槽 | `HUI/runtime-contracts/index.json`定位具体合同 |
| HUI图标、消息服务或运行资源 | `HUI/manifest.json`和对应运行时合同 |
| 跨产品业务区域语义 | `HUI/zones/` |
| 公共组合模式命名 | 对应`HUI/component-patterns/<id>/contract.json` |
| HUI通用页面模式 | `HUI/page-patterns/catalog.json` |
| TPP典型页面 | `HUI/page-patterns/tpp/catalog.json` |
| TPP Variant的确定性选择 | `schemas/tpp-page-intent.schema.json`、对应`tpp/mappings/<page-kind>.json`与`scripts/tpp_intent.py` |
| 跨行业基础字段 | `HUI/common-domain/fields/catalog.json` |
| 行业特有字段 | 对应行业`domain/fields/catalog.json` |
| 产品Logo、身份和几何角色 | 产品`profile.json` |
| 产品颜色和尺寸覆盖 | 产品`theme/tokens.json` |
| 产品门户头部、侧栏和菜单 | 产品`portal-shell/contract.json` |
| 产品支持哪些页面 | 产品`product.json` |
| 某个页面允许的业务能力 | 页面`capabilities.json` |
| 某个页面如何组合和选择Renderer | 页面`composition.json` |
| 某个页面的预览数据 | 页面`fixture.json` |
| 某个页面的验收标准 | 页面`golden.json` |
| Renderer使用哪个HTML模板 | `scripts/renderer_registry.py` |
| 未命中产品页面时能否复用HUI页面族 | `references/knowledge-resolution.md`与`scripts/renderer_registry.py` |

修改派生HTML不能修复知识问题。先找到对应索引，再修改该索引指向的事实源，最后重新编译和验收。

## 新增知识的最短流程

### 新增HUI通用组合模式

1. 在`component-patterns/`建立以语义ID命名的目录和合同。
2. 重建公共组件词典。
3. 运行Skill结构校验和完整回归。

### 新增HUI原子组件知识

1. 在`runtime-contracts/mappings/`登记官方组件与采集批次。
2. 保存或更新`evidence/`中的官方证据。
3. 运行导入脚本生成具体合同和原子标签索引。
4. 运行Skill结构校验和完整回归。

### 新增行业或产品

1. 从`design-systems/catalog.json`确认HUI通用知识或行业产品知识归属。
2. 新增行业时建立`industry.json`；新增产品时建立`product.json`。
3. 在索引的`maintenance`中说明本层职责和真实子路径。
4. 补充产品Profile、Shell和tokens；没有真实知识时明确登记待建设状态。
5. 在父级索引登记入口并运行校验。

### 新增产品页面知识

1. 在产品`pages/<page-type>/`建立页面本地索引和五类职责文件。
2. 在页面Composition中选择已登记Renderer；模板映射只在Renderer Registry维护。
3. 在产品`product.json`登记页面入口。
4. 在产品验收套件补充至少一个真实PageSpec案例。
5. 编译、静态校验并完成浏览器验收。

产品页面知识增加不等于增加HTML模板。只有出现新的稳定渲染骨架，并且现有Renderer无法表达时，才新增Renderer与模板映射。

当产品没有对应页面Composition时，先把需求归一为一个结构化`PageIntent`：确定`page_kind`、`semantic_family`以及用户已明确的`features`，再由Resolver与对应批次的TPP映射比较。唯一候选才进入`hui-pattern-fallback`；多个候选会返回需要补充的区分特征，零候选表示知识缺口或参数组合错误。选中后由HUI Renderer提供结构，目标产品继续提供Profile、Shell、tokens和运行资源。

表格、表单、卡片和详情页共用这套选择流程。默认只选择一个精确Variant；确需两个典型页知识时，仅允许使用组合登记中已开放的一个辅助Variant，不支持任意拼接。

## 常用命令

在`Hi-Builder/`目录执行：

```bash
# 查询一个产品页面可用能力
python3 scripts/resolve_capabilities.py \
  --industry general \
  --product isc \
  --page-type manual-filter-table

# 以结构化PageIntent唯一选择TPP Variant并返回可编译能力包
python3 scripts/resolve_capabilities.py \
  --industry public-security \
  --product pvia \
  --intent tests/fixtures/tpp-page-intent-manual-filter.json

# 只检查PageIntent的选择结果；selected成功，ambiguous或no-match阻断
python3 scripts/resolve_tpp_intent.py \
  --intent tests/fixtures/tpp-page-intent-manual-filter.json

# 编译HUI Pattern页面
python3 scripts/compile_pattern_page.py \
  --spec tests/generation/device-list-table.json \
  --out output/device-list-table.html

# 校验HUI Pattern页面
python3 scripts/validate_pattern_page.py \
  --spec tests/generation/device-list-table.json \
  --html output/device-list-table.html

# 编译并校验一个典型页面族
python3 scripts/compile_pattern_page.py \
  --spec tests/generation/device-details-master-detail.json \
  --out output/device-details-master-detail.html

python3 scripts/validate_pattern_page.py \
  --spec tests/generation/device-details-master-detail.json \
  --html output/device-details-master-detail.html

# 重建并检查公共组件词典
python3 scripts/generate_component_pattern_catalog.py
python3 scripts/generate_component_pattern_catalog.py --check

# 构建产品页面验收套件
python3 scripts/build_product_acceptance.py \
  --suite tests/product-pages/isc/cases.json

# 校验全部知识结构并运行完整回归
python3 scripts/validate_skill.py
python3 -m unittest discover -s tests -v
```

## 提交前检查

- 从最近的父级索引能够找到新增知识。
- 当前索引的`maintenance`准确说明本层职责和关键路径。
- 人工事实源与派生索引没有反向混用。
- 产品页面没有直接维护模板路径。
- 新增产品页面已进入产品验收套件。
- 能力、合同、工作流或命令入口发生变化时，`SKILL.md`与本README已同步。
- Skill结构校验和完整回归通过。
