# Phase 3.5 Stable Scan Final 报告

## 真实日志能证明什么

已给出的真实日志显示：首次 System Scan 已看到 4 个 embedded region，却发布了 0 个当前页可靠字段；随后正式 Fill scan 又能处理大量字段。它可靠地证明“首次系统快照”和“后续填写扫描”存在时序不一致，但仅凭这份日志不能唯一归因为 Detector、Matcher、Resume availability、DOM mutation 或 snapshot 发布中的某一项。

因此本轮没有只改 UI 文案，也没有在没有证据时声称找到唯一生产根因。实现改为提供可区分这些路径的元数据，并让所有非最终 0 保持 provisional。

## Metadata-only telemetry

`scanTelemetryDebug` 固定输出九个字段：

- `phase`
- `attemptCount`
- `detectedFieldCount`
- `reliableFieldCount`
- `embeddedSectionCount`
- `topologyChanged`
- `fieldSignatureChanged`
- `resumeAvailable`
- `finalizationReason`

不输出 descriptor、label、字段值、Resume 内容或 DOM。解释方式为：

- `detectedFieldCount = 0`：当前 Detector/DOM 快照没有字段；
- `detectedFieldCount > 0 && reliableFieldCount = 0`：字段已检测，但 Matcher/Resume 可用性尚未形成可靠匹配；
- `resumeAvailable = false`：单独标记 Resume 尚未可用；
- `topologyChanged = true`：embedded collection、模式、组数或 zero-row 等结构签名真实变化；普通无关 mutation 不会冒充 topology change；
- `fieldSignatureChanged = true`：控件类型、collection/mode、matchedPath 或 status 的签名变化；
- `finalizationReason`：明确区分 initial ready、stable rescan、bounded empty、bounded unreliable 和 scan failed。

这组字段允许下一次真实站点日志把 A–E 路径分开，而不泄露用户资料。

## 最终化策略

首次检查只要 `detected=0` 或 `reliable=0` 就进入 `STABILIZING`。Popup 在 `SCANNING/STABILIZING` 显示“正在等待表单稳定…”，`scanCountsFinal=false`，不会把 0 写成完成态。`SCAN_FAILED` 同样不宣称 final count。

稳定化复用现有 `MutationObserver + quiet window + bounded rescan`：

- `delayMs = 250`
- 默认 `maxMs = 1,800`
- `maxAttempts = 8`
- 只有观察到真实 mutation、topology signature 或 field signature 变化后，才允许扩展至 `adaptiveMaxMs = 3,600`
- quiet window 为 160ms，并保留总次数/总时长上限

最终稳定后，真实空页面可以 `READY + BOUNDED_EMPTY_SCAN + countsFinal=true`；检测到字段但没有可靠 match 可以 `BOUNDED_UNRELIABLE_SCAN`。目标不是永远隐藏 0，而是不把 transient 0 当最终结果。

## 受控因果验证

late-mutation fixture 首次返回 4 embedded/0 reliable，期间出现真实 DOM/字段签名变化，后续 stable rescan 得到 22 fields，最终原因 `STABLE_RESCAN`。这证明新路径能够关闭“快照早于最终稳定扫描”的 transient-zero 漏洞。

独立回归还证明：

- 任意普通 mutation 不会直接把 `topologyChanged` 标为 true；
- canonical matchedPath 变化会进入 field signature；
- 永久空页会有界完成，而不是无限等待；
- detected-but-unreliable 的最终 0 有明确原因；
- 初次/重扫异常不会发布 final count，之后的用户重扫可以恢复；
- production engine 保留错误并进入可重置终态；
- Popup provisional/final 展示契约一致。

## 验证与限制

Stable Scan 专项：`11 / 11 PASS`。完整 Unit：`743/743`；Matrix：`43/43`，其中 `late-stable-scan-final-count` 执行真实 unit evidence；完整 headed Edge E2E：`51/51`。

当前没有可登录的高校真实目标页面，因此无法从新 telemetry 回填该生产会话的唯一根因。部署后应重新加载扩展、刷新目标页并确认 runtime `jiefang-page-runtime-v2`，再查看九字段 telemetry；在此之前，本报告只将受控 late-mutation 路径标为已闭环，不把未知生产原因包装成确定结论。
