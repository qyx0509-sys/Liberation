# Phase 3.5 Final Closure 报告

## 最终结论

Phase 3.5 “Real DOM Compatibility & Runtime Completion” 的六条限定主线已完成：真实 DOM 单槽数组、重复区域 sibling Add、Legacy Ant 日期切换、同 overlay Cascader、带注释 GPA 标签、稳定扫描最终化均有生产路径修改与可执行回归证据。最终版本为 `3.0.3`，页面运行时为 `jiefang-page-runtime-v2`。

在受控本地真实浏览器夹具范围内，Phase 3.5 Cross-platform Test Matrix 可以关闭为 **COMPLETE**。本结论不冒充认证高校真实账号页面的人工验收；部署到目标页面后仍应重新加载扩展、刷新页面并确认 v2 握手和 metadata-only telemetry。

## 六项收口

### 1. Real DOM semantic singleton

旧逻辑只信任显式重复组或足够窄的结构祖先。真实 Ant `row/col/form-item/wrapper` 将 7 个 Education descriptor 分散后，没有可证明的共同 slot，因此出现 `semanticDescriptorCount=7`、`clusterCount=0`。

新增 `semantic-region-singleton` 只在 Education/Language 页面单槽语义成立时工作：同一严格语义区域、至少两个唯一 canonical leaf、没有显式数组 index、没有重复 canonical path，并拒绝 `FORM/BODY/MAIN` 等过宽祖先。结果为 Education `clusterCount=1`、`pageSlotCount=1`、`selectedIndex=0`；交错 Education/Language 仍生成不同 collection 证据，两套 Education 或重复 leaf 继续失败关闭。详见 `PHASE3_5_REAL_DOM_SINGLETON_REPORT.md`。

### 2. Repeatable action boundary

确认旧路径存在 `fallback table → boundaryRoot=table → depth0 self-lock`。现在把 `collectionRoot/regionRoot`、已解析的 `resolvedActionOwner`、最大 `actionSearchBoundary` 分开传递；每次新增前重新解析最小安全 owner，点击后以真实行数增长复核。浏览器夹具中 Papers 与 Awards 的 `selectedOwnerDepth` 均为 `1`，分别完成 `0→2` 和 `0→7`；无关显式边界会钳回 region root 并零点击。详见 `PHASE3_5_REPEATABLE_ACTION_BOUNDARY_REPORT.md`。

### 3. Legacy Ant date safety

原先 switch discovery 已成功找到唯一的 Legacy Ant month/year header control；失败点是普通 anchor 安全规则要求 `role=button`/可接受 href，导致真实 Ant v3 的无 role 惰性链接被拒绝。修复只放行当前 owned calendar panel 内、精确 Legacy class、唯一且仍存活的 mode-switch anchor；`#`、`javascript:void(0)`、`javascript:;` 使用预取消合成 click，普通可导航 anchor 仍被拒绝。`modeSwitchDebug.safetyReason` 只输出白名单元数据。详见 `PHASE3_5_LEGACY_ANT_DATE_SAFETY_REPORT.md`。

### 4. Cascader same-overlay

四个独立控件均通过 owned overlay 完成三级选择。每一级点击后重新枚举可见 canonical menu；lower column 在同一 overlay 追加时采用 `same-overlay` rebind，不复用陈旧 option。单控件证据为 `menuCountBefore=2`、`menuCountAfter=3`、新增菜单索引 `2`，最终三层点击计数 `[1,1,1]`。竞争列、错误 overlay、隐藏/失效 owner 继续零点击或人工确认。详见 `PHASE3_5_CASCADER_FINAL_REPORT.md`。

### 5. Annotated GPA label

这不是新增 schema：目标仍为现有 `education[].gpa`。Matcher 只在完整 label 精确匹配，或 base label 后紧跟明确括号/方括号注释分隔符时生成 annotation-base evidence；`本科GPA排名` 不会因前缀命中 GPA，`绩点满分` 仍映射 `gpaScale`，裸 `满绩` 不映射 GPA。详见 `PHASE3_5_ANNOTATED_LABEL_GPA_REPORT.md`。

### 6. Stable Scan finalization

真实日志能证明的是：System Scan 的快照曾在 4 个 embedded region/0 reliable 时发布，而随后 Fill scan 能处理多字段，即两个扫描存在 DOM/snapshot 时序差异；单凭该日志无法唯一断定 Detector、Matcher、Resume 或 DOM mutation 中哪一个是唯一根因。

本轮加入九字段 metadata-only `scanTelemetryDebug`，分别区分 `detected=0`、`detected>0/reliable=0`、Resume 未就绪、topology/signature 变化及最终化原因。`SCANNING/STABILIZING` 与 `SCAN_FAILED` 都不发布最终 0；默认上限 1.8 秒，只在观察到真实动态证据时扩展到 3.6 秒。受控 late-mutation fixture 证明 transient 0 会被后续 stable rescan 替换为最终 22 fields，同时稳定的真实 0 仍可有界最终化。详见 `PHASE3_5_STABLE_SCAN_FINAL_REPORT.md`。

## 兼容与安全

- 未降低 FieldMatcher threshold；仅增加严格结构证明与精确主标签优先级。
- 未增加 hostname patch、远程接口或外部 AI/网络调用。
- 未改变自动提交安全策略；Submit、Delete、Next、未知 Upload、法律声明、图片查看器导航仍为 0 自动点击。
- `papers.status=published` 面对仅“在投/录用”的页面仍为 `NEEDS_CONFIRMATION`。
- authorRank 只接受有证据的一/二/三作者词表；比例、角色、普通排名和 `4→其他` 不猜。
- 单槽 Language 对 2 条 JSON 且无唯一 discriminator 时仍为 `NEEDS_CONFIRMATION`。
- 旧 Runtime 可达时 Popup 不重复注入，而是失败关闭并提示重新加载页面。
- 已保留用户工作区内此前的资料库字段/奖项类别修改，并通过 profile round-trip E2E；未回退未知 JSON 字段或照片材料路径。

## Matrix 与测试

Matrix 新增并实际执行以下六个稳定 capability ID：

- `ant-inline-singleton-nested-grid`
- `zero-row-sibling-add-after-fallback-root`
- `legacy-ant-anchor-mode-switch-safety`
- `four-cascader-same-overlay-append`
- `annotated-field-label-normalization`
- `late-stable-scan-final-count`

最终结果：Unit `743/743`、Matrix `43/43`、headed Edge E2E `51/51`、正确失败关闭专项 `122/122`、语法检查 `30/30`、构建 PASS、运行时注入 PASS、source/dist SHA-256 `84/84`。完整命令与分组见 `PHASE3_5_FINAL_TEST_RESULT.txt`，构建证据见 `PHASE3_5_FINAL_BUILD_RESULT.txt`。

## 交付与剩余限制

交付包含差分替换包与完整源码包，并由打包脚本校验版本、运行时、注入顺序、manifest 资源、source/dist parity、ZIP 路径安全、条目数量、长度和 SHA-256。

仍有一项环境限制：当前没有可登录的高校真实目标站点会话，因此未宣称完成该站点的账号内人工验收。用户实际部署时需重新加载 `dist`、刷新目标页，确认 runtime revision 为 v2，再观察 `scanTelemetryDebug`；若目标站点提供新的、与现有结构等价夹具不同的 DOM，应以脱敏诊断新增最小兼容回归，而不是放宽全局安全规则。
