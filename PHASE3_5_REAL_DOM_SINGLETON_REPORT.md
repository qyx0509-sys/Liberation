# Phase 3.5 Real DOM Singleton 报告

## 问题与根因

真实 Ant 风格页面把本科院校、专业、入学/毕业年月、学制、GPA 和排名等 7 个 Education 字段分别包在 `ant-row`、`ant-col`、`ant-form-item` 等多层 wrapper 中。它们在页面语义上是一条本科经历，但旧聚类只接受显式 repeatable group、表格行、窄 `SECTION/FIELDSET/role=group|region` 或直接共同父级。

因此，旧扫描虽然得到 `semanticDescriptorCount = 7`，却无法从这些分散 wrapper 中证明单一 slot，结果为 `inlineCandidateClusterCount = 0`。根因不是 JSON 缺失，也不是字段 alias 缺失，而是页面没有旧算法认可的共同 slot 结构。

## 实现

`src/core/field-matcher.js` 新增了严格受限的 `semantic-region-singleton` 证据，`src/adapters/generic-adapter.js` 只传播白名单聚合元数据。它不是“数组只有一条就全页强取 index 0”，而是同时要求：

- semantic collection 只能是本轮允许的 `education` 或 `language`；
- descriptor 位于同一严格 page/region 语义边界；
- 至少两个强、唯一 canonical leaf；
- canonical path 不能重复；
- 不存在显式数组 index；
- 不能跨越两个已证明的结构 slot；
- `FORM`、`MAIN`、`BODY`、整页 document 等过宽 owner 不能单独作为 slot 证明。

选中后仍沿用原有单槽绑定政策：只有一条 JSON 时可选 index 0；多条 JSON 必须有唯一 discriminator，否则 `NEEDS_CONFIRMATION`。

## 正向证据

受控 Real-DOM fidelity 测试保留了 7 个互相分散的 Ant wrapper，并把一个 Basic 姓名字段穿插在 Education 字段之间。最终每个 Education match 都得到：

- `semanticDescriptorCount = 7`
- `inlineCandidateClusterCount = 1`
- `pageSlotCount = 1`
- `candidateIndexes = [0]`
- `selectedIndex = 0`
- `slotSources[0].kind = semantic-region-singleton`
- `slotSources[0].descriptorCount = 7`
- `slotSources[0].pathCount = 7`

Language page-mode 的两个唯一 leaf 也可形成一个严格单槽；一条 JSON 时匹配成功。

## 防误合并证据

- 两套独立 Education 结构会得到两个 slot，绝不会合并成 index 0。
- Education 与 Language 即使交错排列并共享一个 broad page region，也按 semantic collection 形成两份不同的 singleton evidence，不互相借用。
- 单个 leaf 证据不足，继续人工确认。
- 相同 canonical path 重复出现时视为歧义。
- broad `FORM` 即使包住多个唯一 leaf，也不能自行证明 slot。
- 显式 repeatable/index context 始终优先，不被 fallback 覆盖。
- Language 页面只有一个 slot、JSON 有两条且无唯一 discriminator 时仍为 `NEEDS_CONFIRMATION / NO_DISCRIMINATOR`。

诊断仅输出 collection、计数、reason code、candidate index 等聚合元数据，不包含 DOM、字段值或真实 label 内容。

## 验证

专项命令：

`node --test tests/unit/phase3-5-semantic-collection-singleton-binding.test.mjs`

结果：`13 / 13 PASS`。完整 Unit：`743 / 743 PASS`。Matrix 的 `ant-inline-singleton-nested-grid` 通过可执行 runtime test 获证，不是 catalog-only 标记。

## 浏览器证据边界

本项的严格散列 wrapper 证明来自本地结构等价 fixture/unit DOM；完整 headed Edge E2E `51/51` 同时验证 Education singleton 进入真实 DateLike 路径。没有可登录的高校生产会话，因此不把本报告描述为认证目标站点人工验收。
