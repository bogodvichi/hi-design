# Hi-Builder架构契约

## 使命与边界

<!-- rule-owner:mission-and-output-boundary -->

Hi-Builder把一次自然语言业务需求编译为符合HUI通用知识、行业语义、产品外观和D2C标注协议的可运行单文件HTML。

流水线为：

```text
用户需求 → 语义PageSpec → 知识解析 → 确定性编译 → 静态校验 → 浏览器验收
```

AI负责有业务歧义的判断；脚本负责可确定执行的事实。AI不得临场推测HUI属性、资源URL、服务API、图标注册方式或视觉数值。

本Skill只交付HTML及用户明确要求随HTML打包的本地静态资源，不生成`.components.json`。Vue工程拆分与研发映射关系不属于本Skill产物，公共词典也不约束每次页面中组合组件的具体内部结构和交互。

## 知识分层

<!-- rule-owner:knowledge-ownership -->

每条知识只能有一个所有者：

| 层级 | 负责 | 不负责 |
| --- | --- | --- |
| HUI通用知识 | 组件、props、events、slots、服务API、图标、资源、token合同、Zone、Component Pattern、通用页面模式与跨行业稳定复用的业务语义 | 行业特有字段、产品品牌和单次需求 |
| 行业产品知识 | 行业实体、字段、枚举、动作、页面意图，以及产品品牌资产、tokens、Portal Shell、导航、页面能力、Composition、fixture和golden | 复制HUI通用知识或其他行业产品知识 |
| 请求PageSpec | 本次字段、动作、内容、交互选择和预览数据选择 | CSS值、HUI props、资源地址 |

输出语义由业务区域、组合模式和HUI原子控件构成。这些均是HUI通用知识，物理上统一放在`design-systems/HUI/`；不再引入企业层或第二套设计系统抽象。

## 消费者边界

<!-- rule-owner:consumer-boundaries -->

| 消费者 | 读取内容 |
| --- | --- |
| AI | 精简能力、行业术语、允许的Zone/Component Pattern、可配置字段和动作 |
| Resolver | HUI目录、行业产品索引、页面能力和继承关系 |
| Compiler | 完整HUI契约、页面模式、产品Shell、tokens，以及命中产品页时的Composition和fixture |
| Validator | Schema、HUI白名单、资源规则、语义注册表、产品约束和golden |

不得把完整HUI文档、全部产品页面或证据目录一次性装入AI上下文。证据只用于维护知识和复核事实。

## 单一事实源

<!-- rule-owner:source-of-truth-map -->

- 运行版本、CDN资源和可选依赖：`design-systems/HUI/manifest.json`。
- HUI原子标签与接口：`design-systems/HUI/runtime-contracts/`。
- 公共Zone与Component Pattern：`design-systems/HUI/zones/`和`component-patterns/`。
- 跨行业基础字段：`design-systems/HUI/common-domain/fields/catalog.json`。
- 行业字段扩展：行业`domain/fields/catalog.json`，通过`extends`引用HUI通用字段目录。
- 产品品牌、Shell和页面引用：产品`product.json`及其显式指针。
- 产品tokens：产品`theme/tokens.json`，由`product.json.theme`显式引用。
- 单次需求：PageSpec。
- CDN预览样例数据：页面`fixture.json`；Composition不得维护副本。

生成目录、派生Catalog和HTML不得反向成为事实源。规则级归属及跨文档引用关系由`references/rule-ownership.json`登记并由`validate_skill.py`检查。

## 编译与验收架构

<!-- rule-owner:pipeline-architecture -->

当前实现采用中央Renderer Registry，并提供两条输入合同不同的管线：产品业务页面管线读取产品Composition；TPP页面族管线直接复用已登记的HUI页面族并显式装配产品上下文。两条管线共享HUI manifest、产品Profile/Shell/tokens、HUI通用语义注册表和运行时校验规则。

TPP管线不等于自由生成，也不能替代产品业务页面知识。页面族生成验收只证明HUI模式可用；产品回归验收必须覆盖产品清单登记的所有业务页面。具体管线选择读取`references/knowledge-resolution.md`，输出与验收步骤读取`references/generation-contract.md`。

调用方仍须遵守以下架构边界：

1. 全局PageSpec Schema只定义稳定信封；页面能力通过显式指针选择自己的payload合同。
2. `scripts/renderer_registry.py`是Renderer能力和模板路径的中央注册表。产品Composition只选择Renderer，不得声明模板；产品页按Composition选择实现，TPP页按页面种类映射实现。Compiler、Resolver和Validator不得各自扩张未登记ID或建立模板映射副本。
3. 页面编译优先级固定为：精确产品Composition → 已验证且已登记Renderer的HUI页面族 → 知识缺口。第二级使用HUI页面族骨架和对应语义输入合同，同时强制装配目标产品Profile、Shell、tokens与运行资源；它不创建产品Composition，也不得臆造产品能力。
4. 行业字段采用HUI通用字典与行业扩展两级结构；实体、枚举、动作和页面意图按真实需求补齐。
5. HUI token合同只包含已验证变量；新增变量必须先补证据和合同。

未命中精确产品页面能力时，只有同时具备目标产品上下文、已验证HUI页面族Variant和中央Registry登记的Renderer才可编译；否则必须报告知识缺口，不得自由生成HTML补齐。

## 目标结构

<!-- rule-owner:physical-structure -->

```text
design-systems/
├── HUI/
│   ├── common-domain/fields/catalog.json
│   ├── zones/
│   ├── component-patterns/
│   ├── runtime-contracts/
│   ├── icons/
│   ├── theme/token-contract.json
│   └── page-patterns/
└── industry-products/<industry>/
    ├── domain/
    │   ├── entities/
    │   ├── fields/
    │   ├── enums/
    │   ├── actions/
    │   └── page-intents/
    └── products/<product>/
        ├── theme/tokens.json
        ├── assets/
        ├── shell/contract.json
        └── pages/<page-type>/
            ├── capability.json
            ├── composition.json
            ├── fixture.json
            └── golden.json
```

HUI通用字段只接收至少被两个行业稳定复用、且数据类型和核心语义一致的词条。行业可以引用、增加别名或新建行业字段，但不得改变HUI通用字段的数据类型和核心语义。

迁移必须与Resolver、Compiler、Validator和测试同批进行；禁止只移动文件后保留隐式固定路径。
