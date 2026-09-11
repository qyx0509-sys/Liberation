# Phase 3.5 Cascader Final 报告

## 结论

现有 Cascader 生产适配器已具备 owned overlay 和逐级重新绑定能力。本轮没有重写适配器；重点补齐四个同页、同文案噪声下的三级 same-overlay 真实浏览器验证，并强化空 lower-column、替换列、竞争列和 TOCTOU 回归。

四个独立字段为：

- 籍贯地区 → `basic.hometownRegion`
- 出生地 → `basic.birthplaceRegion`
- 户口所在地 → `basic.householdRegion`
- 档案所在地 → `contact.archiveRegion`

每个 trigger 都通过自己的 `aria-controls` 绑定 panel，地区与详细地址保持为不同 canonical path。

## Same-overlay 行为

省级 option 点击后，城市列追加到同一 overlay；城市点击后，区县列继续追加。每一级执行前后都重新：

1. 取得当前 trigger 的 owned panel；
2. 枚举可见 canonical menu 列；
3. 验证新列/option set 的真实变化；
4. 重新查找目标 option；
5. 在 pointerdown、mousedown、mouseup 和最终 click 前复核 owner/menu/option 状态。

当 panel node 不变而列数增加时，调试记录 `rebindStrategy = same-overlay`；不会把旧列或另一个 Cascader 的列当成下一层。

## 四字段浏览器证据

每个字段最终都得到同一结构证据：

- `levelCount = 3`
- `selectedLevelCount = 3`
- `panelOwnership = aria-controls`
- `overlayIdentityStable = true`
- `menuCountBefore = 2`
- `menuCountAfter = 3`
- `visibleMenuCountBefore = 2`
- `visibleMenuCountAfter = 3`
- `newMenuIndexes = [2]`
- `newMenuCount = 1`
- `optionSetChanged = true`
- `rebindStrategy = same-overlay`
- `rebindFailureReason = ''`

四个字段的 trigger click 均为 1，各三级 option click 均为 `[1, 1, 1]`。选择结束后没有残留打开 panel；再次填写为 `SKIPPED_EXISTING`，不同值为 `CONFLICT` 且不改写现值。

## 失败关闭

- 同一逻辑层出现两个竞争新列时不选择任何一个。
- lower menu 尚为空/加载中时等待真实 option，不提前 SUCCESS。
- stale visible 列必须以真实 topology/option-set 变化重新证明。
- hidden/disabled/detached owner 或 pointer/mouseup 中途变化会阻止真实 click。
- unrelated visible overlay、错误 trigger owner、跨控件 option 均为 0 点击。
- 不根据预期私有数据推断 level 数；debug 只统计实际 DOM 元数据。

## 验证

专项组合：`48 / 48 PASS`，由 Cascader adapter 35 项和 compound fixture contract 13 项组成。headed Edge compound E2E 的四字段三级选择 PASS；完整 E2E `51/51`。Matrix capability `four-cascader-same-overlay-append` 具备可执行 unit 与 FULL browser evidence。

没有认证高校生产会话；报告中的“真实浏览器”指 headed Edge 加载的本地结构等价 fixture。
