---
name: hi-builder
description: 将海康安防领域的自然语言页面需求编译为稳定一致的HUI Vue（V2.6.1版本）单页HTML。用于生成或修改行业产品页面、复用产品门户框架、选择业务Composition与TPP页面族Renderer，并执行静态和浏览器验收。
---

# Hi-Builder

## 目标

把自然语言业务需求转换为语义PageSpec，再由确定性编译器生成符合HUI通用规范、行业语义、产品外观和D2C协议的单文件HTML。

AI只负责需求理解和PageSpec选择；不得直接推测HUI属性、资源地址、服务API、图标注册方式或视觉数值。Compiler和Validator必须从本Skill的权威合同读取这些事实，不得引用本仓库之外的运行资源。

## 必读契约

按任务阶段读取对应文件，不在本入口复制具体规则：

| 阶段 | 必读文件 | 用途 |
| --- | --- | --- |
| 判断职责与知识归属 | `references/architecture.md` | 使命、边界、知识所有者和消费者 |
| 解析行业、产品和页面能力 | `references/knowledge-resolution.md` | 检索顺序、Capability Bundle、PageSpec选择和缺口处理 |
| 生成或修改HTML | `references/generation-contract.md` | PageSpec边界、HTML语义、tokens、脚本数据分层和验收 |
| 使用HUI Vue | 本项目`references/hui-vue-runtime-contract.md` | 运行资源、组件接口、服务API、Dialog和图标 |

规则归属以`references/rule-ownership.json`为机器可读索引。修改规则前先查询该索引，只修改登记的权威来源；其他文件只能引用，不得创建并行定义。

## 工作流

<!-- rule-owner:skill-workflow -->

执行以下工作流时，当前目录必须始终保持为客户端提供的项目根目录。`<skill-root>`表示提示开头给出的Skill root；只通过它读取契约和调用脚本，不得`cd`到`<skill-root>`。PageSpec、HTML和随HTML交付的资源都使用以`./`开头的项目相对路径，具体输出边界遵循`references/generation-contract.md`。

1. 从需求识别`industry`、`product`、明确出现的产品版本和页面类型；用户说“ISC新版本”“ISC 3.0”或“ISC 3.0.0”时统一归一为`product=isc`、`product_version=3.0.0`，自动使用`isc-3.0.0`框架。HUI兜底时再一次性归一为`schemas/tpp-page-intent.schema.json`定义的`PageIntent`，包含语义族和已确认特征，不确定特征不填。
2. 读取`references/knowledge-resolution.md`并解析能力：

```bash
python3 "<skill-root>/scripts/resolve_capabilities.py" \
  --industry <industry> \
  --product <product> \
  --product-version <明确指定时的版本> \
  --page-type <page_type>
```

HUI兜底的结构化入口为：

```bash
python3 "<skill-root>/scripts/resolve_capabilities.py" \
  --industry <industry> \
  --product <product> \
  --intent ./<tpp-page-intent.json>
```

3. 读取`selection.compile_route`和`selection.input_contract`：产品路由生成产品页面合同；HUI兜底必须使用Resolver返回的唯一`selection.pattern_contract`，不得由AI从候选数组随意默认。零候选是知识缺口；多候选时补充诊断列出的区分特征后重新解析。表格自然语言归一仍遵循`mappings/table.json`的`selection_strategy`。Pattern PageSpec中的模拟业务值必须全部写入`preview`，页面结构、字段定义、选项和动作留在配置层；不得在PageSpec中写CSS值、HUI属性、资源URL或未登记扩展。
4. 读取`references/generation-contract.md`；涉及HUI标签、资源、服务或图标时同时读取`references/hui-vue-runtime-contract.md`。
5. `compile_route=product-composition`使用产品页面编译入口：

```bash
python3 "<skill-root>/scripts/compile_page.py" \
  --spec ./<page-spec.json> \
  --out ./output/<page>.html
```

6. `compile_route=hui-pattern-fallback`使用页面族入口；不得因为产品缺少页面Composition而改用产品Renderer：

```bash
python3 "<skill-root>/scripts/compile_pattern_page.py" \
  --spec ./<pattern-page-spec.json> \
  --out ./output/<page>.html
```

`compile_generation_test.py`只用于旧自动化兼容转发，不作为新调用入口。

7. 执行对应静态验收：

```bash
python3 "<skill-root>/scripts/validate_page.py" \
  --spec ./<page-spec.json> \
  --html ./output/<page>.html
```

```bash
python3 "<skill-root>/scripts/validate_pattern_page.py" \
  --spec ./<pattern-page-spec.json> \
  --html ./output/<page>.html
```

8. 在浏览器中打开结果，检查运行时错误、资源请求、关键交互和目标产品页面`golden.json`声明的几何状态。

9. 对产品全部已登记页面做回归时运行产品验收套件：

```bash
python3 scripts/build_product_acceptance.py \
  --suite tests/product-pages/<product>/cases.json
```

## 维护流程

<!-- rule-owner:skill-maintenance -->

修改知识或规则时：

1. 查询`references/rule-ownership.json`确认唯一所有者和机器事实源。
2. 只修改权威来源；派生Catalog通过对应生成脚本更新。
3. 更新直接受影响的Schema、Compiler、Validator和测试，不顺带改动无关规则。
4. 运行：

```bash
python3 scripts/validate_skill.py
python3 -m unittest discover -s tests -p 'test_*.py'
```

5. 对页面生成变化补做浏览器验收。
