# Phase 3.5 Repeatable Action Boundary 报告

## 结论

本轮确认旧路径中确实存在以下边界自锁：

`fallback table → boundaryRoot = table → actionOwnerChain 仅检查 depth 0`

当重复栏目为 zero-row、`detectSectionRoot()` 又只能退回到表格时，旧逻辑会同时把该表格当作数据区域和新增动作搜索硬边界。因此诊断只能看到 `ownerCandidateCount = 1`、`localButtonCount = 0`、`NO_LOCAL_ADD`，无法继续到父级容器寻找与表格并列的“新增”按钮。

该自锁已经解除。表格仍可作为重复数据区域，但不会因为它是 fallback 就自动成为 ancestor action search 的硬边界。

## 三个根节点的正式拆分

现在分别维护以下三种语义，不再混用：

1. `regionRoot`（引擎绑定中对应 `collectionRoot`）：当前 repeatable table/region，只负责行组检测、实际 DOM 数量重扫和字段上下文。
2. `resolvedActionOwner`：从 `regionRoot` 向上检查后，已经证明拥有唯一、可见、启用且安全的本栏目 Add 的最小结构 owner。执行每次新增前都会重新解析，不依赖陈旧按钮引用。
3. `actionSearchBoundary`：允许向上寻找 action owner 的最大安全边界。它独立于 `regionRoot`；只有包含 `regionRoot` 的边界才有效。

`addRoot` 继续作为兼容参数和已解析 owner/局部限制区域的载体，但不再被无条件当作 `actionSearchBoundary`。引擎的嵌入栏目绑定会同时向诊断、通用数组执行和 Awards 适配器传递 `collectionRoot`、`addRoot` 与 `actionSearchBoundary`。

## Owner 解析与执行约束

搜索从 `regionRoot` 的 depth 0 开始，逐层向上，选择第一个满足全部条件的最小 owner：

- 包含当前 `regionRoot`；
- 只拥有一个相关 embedded region；
- 只有一个本栏目语义的 local Add；
- Add 可见、启用并通过两层动作安全校验；
- 不把 Delete、Submit、Next、Upload 或 Save 当作 Add；
- 不存在 collection conflict；
- 不越过配置的安全边界、过宽的 `FORM`/`MAIN`/`BODY` 限制或最大搜索深度。

每次点击后都重新扫描真实行组数量；只有 DOM 行数实际增加才继续。达到目标后停止，较短 JSON 不删除现有行，按钮失效、歧义、跨栏目冲突或行数未增长均失败关闭。

## 真实 DOM fidelity fixture 结果

受控浏览器 fixture 使用了“标题/新增按钮/表格互为 sibling”的实际 DOM 布局，并在页面中保留多个相同“新 增”按钮以验证栏目隔离：

| 场景 | 初始行数 | 目标行数 | `selectedOwnerDepth` | 实际点击 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| Papers zero-row | 0 | 2 | 1 | 2 | 成功，行索引 `[0, 1]` |
| Awards zero-row | 0 | 7 | 1 | 7 | 成功，行索引 `[0, 1, 2, 3, 4, 5, 6]` |

两种场景均得到：

- `localAddCandidateCount = 1`
- `acceptedAddCandidateCount = 1`
- `finalReasonCode = ACTION_OWNER_RESOLVED`
- 只点击目标栏目自己的 sibling Add，其他同文案按钮点击数保持为 0

因此本轮要求的 Papers `0→2` 与 Awards `0→7` 均已在真实 DOM fidelity fixture 中闭环，且两者的 `selectedOwnerDepth` 都是 `1`。

## 无关显式边界的失败关闭

诊断与执行现已统一处理无关的显式 `actionSearchBoundary`：

- 若边界等于 `regionRoot` 或包含 `regionRoot`，按该边界进行有界向上搜索；
- 若显式边界与 `regionRoot` 无包含关系，诊断会把边界钳制为 `regionRoot`，执行侧也通过相同包含关系规则锁回 `regionRoot`；
- 此时不会退化成无边界祖先搜索，不会发现或点击外部 Add。

新增回归构造 Papers owner、内部 table/Add 和一个无关 Awards sibling，并故意把 Awards sibling 传为 `actionSearchBoundary`。结果为：只检查 depth 0、`selectedOwnerDepth = null`、`finalReasonCode = NO_LOCAL_ADD`、执行失败且所有 Add 点击数为 0。

## 代码与测试覆盖

主要实现涉及：

- `src/core/autofill-engine.js`：生成并贯穿三类根节点绑定；
- `src/core/array-handler.js`：有界 owner 诊断、逐次 fresh resolve、DOM 增长复核及无关边界钳制；
- `src/adapters/undergraduate-awards.js`：Awards 使用同一套 action owner 和边界语义；
- `tests/unit/phase3-5-repeatable-action-ownership-runtime.test.mjs`：zero-row、sibling Add、歧义、冲突、禁用、无增长、无关边界等回归；
- `tests/unit/phase3-5-completion-repeatable-action-owner.test.mjs`：重复栏目完成路径回归；
- `tests/e2e/compound-ant.e2e.mjs`：Papers `0→2`、Awards `0→7` 的浏览器 fixture 验证。

本报告创建时已运行重复动作边界专项组合测试：`27 / 27 PASS`。相关更广的 Unit、Matrix、完整 E2E 与构建结果由主任务最终验证和总报告统一记录。

## 安全结论

本修复只扩大“查找 owner”的受控祖先路径，不扩大可点击动作集合。只有最小结构 owner 内唯一且通过安全检查的 Add 可以被点击；任何边界无关、候选歧义、栏目冲突、按钮不安全或 DOM 未增长的情况仍为零点击或立即停止。不会触发下一步、提交、删除、上传或保存动作。
