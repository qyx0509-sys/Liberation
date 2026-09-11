# Phase 3.5 Legacy Ant Date Safety 报告

## 原因定位

Legacy Ant 日期问题不是 selector discovery 失败。原运行时已在 owned DAY panel 中找到唯一 month/year header candidate，调试只在最后留下笼统的 `SAFETY_REJECTED`。

真实形态是无 `role=button` 的 `<a class="ant-calendar-month-select|ant-calendar-year-select" href="#">`。旧通用 anchor 安全规则会先因缺少按钮角色得到 `LINK_ROLE_MISSING`；即使补角色，可导航或未经证明的 href 仍会得到 `HREF_PRESENT`。所以真正阻塞点位于 EventDispatcher 的 click safety，而不是 DateLike 的 mode-switch selector。

## 最小安全修复

`src/core/event-dispatcher.js` 增加了只适用于可信 calendar internal mode switch 的 scoped override，`src/controls/adapters/date-like-adapter.js` 负责提供并再次核验上下文。放行必须同时满足：

- purpose 精确为 `date-picker-mode-switch`；
- candidate 位于当前 canonical owned DatePanel；
- 当前 mode 与目标 `MONTH`/`YEAR` 语义一致；
- class 是精确认可的 Legacy/Modern mode-switch marker；
- candidate 唯一、可见、启用、connected；
- live owner guard 在 pointer/mouse/click 前持续为真；
- 不是 submit、form action、upload、危险动作、扩展 UI 或外部导航。

Legacy 惰性 href 仅接受空 href、`#`、`javascript:void(0)`、`javascript:;`。这类 anchor 不调用可能执行默认导航的 `element.click()`；事件层发送完整 pointer/mouse 序列，最后发送可取消的 synthetic click 并预先阻止默认导航，框架 listener 仍能收到事件。

## 为什么没有放宽普通 anchor

- 非精确 framework class 仍为 `LINK_ROLE_MISSING` 或其他原安全原因。
- `/application/next` 等普通 href 仍为 `HREF_PRESENT`。
- owner、mode、purpose 或 live guard 不一致分别返回白名单原因并零点击。
- form action、inline handler、disabled、detached、危险动作仍拒绝。
- 同一 panel 出现两个 mode switch candidate 时为 `MULTIPLE_*_SWITCH_CANDIDATES`，不会猜第一个。
- 指针事件期间插入竞争 panel/candidate 会被 TOCTOU 复核拦截。

`modeSwitchDebug.safetyReason` 与 rejection reasons 只允许输出有限枚举，不记录真实 href、DOM 或字段值。

## 受控浏览器结果

Birthday fixture 的 switch discovery 证据：

- `panelMode = DAY`
- `headerCandidateCount = 2`
- `monthSwitchCandidateCount = 1`
- `yearSwitchCandidateCount = 1`
- `candidateKinds = [MONTH_ANCHOR, YEAR_ANCHOR]`
- `selectedSwitchSource = LEGACY_ANT_CLASS`
- `safetyReason = ''`

Birthday 完成 `DAY → YEAR/MONTH → DAY → exact day`，最终 `2000-02-03`；入学与毕业年月也真正进入 DateLike Adapter 并成功写入。第二次执行均为 `SKIPPED_EXISTING`。fixture 的 `location.href`/hash 未变化，图片查看器、提交和下一步点击均为 0。

## 验证

日期专项：`49 / 49 PASS`。

包含：

- `tests/unit/phase3-3-2-1-calendar-mode-strategy.test.mjs`
- `tests/unit/phase3-3-2-2b-calendar-transition-hardening.test.mjs`

headed Edge compound fixture 日期路径 PASS；完整 E2E `51/51`。Matrix capability `legacy-ant-anchor-mode-switch-safety` 使用可执行 unit 与浏览器证据。

没有认证高校账号页面会话；本结论限定为真实浏览器中的本地结构等价 fixture。
