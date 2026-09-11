# 第一阶段奖励页与多栏目核心测试说明

本目录只使用 Node.js 自带测试框架和本机 Chrome/Edge，不下载依赖，也不访问外部服务。

## 测试命令

```powershell
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd test
npm.cmd run build
```

`test:e2e` 会启动无头 Chrome（找不到时尝试 Edge），通过 DevTools 协议加载本地 `file://` 夹具。它不会安装浏览器或依赖。

除原奖励页 15 项验收外，`tests/e2e/wizard.e2e.mjs` 会加载
`tests/fixtures/wizard/index.html`，验证后续全栏目核心的真实浏览器契约：

- SPA 导航识别基本、学习、奖励和科研四个栏目；跳转必须有本次用户授权。
- 字段匹配覆盖姓名、手机号、出生日期、学校、专业、获奖名称、获奖时间。
- 数组从 1 行扩展到 3 行；当资料只有 1 条而网页已有 3 行时保持 3 行，不点击删除。
- 普通输入框、原生下拉和单选框均触发框架事件并回读实际状态。
- 仅允许明确确认的“保存本页”，拒绝“保存并下一步”和正式提交。
- 文件字段识别格式、大小、数量限制；Resume JSON 明确绑定后仍须逐次确认授权。
- Shadow DOM 悬浮面板支持指针拖拽、缩放、折叠、最小化和恢复。
- 每个场景都断言没有 HTTP(S) 请求、页面网络 API 尝试或 CSP/console 错误。

## 夹具开关

`tests/fixtures/awards.html` 接受以下查询参数：

- `rows=1`：初始行数。
- `delay=80`：初始行和新增行延迟渲染毫秒数。
- `add=normal|missing|noop`：正常新增、没有新增按钮、按钮点击后 DOM 不变化。
- `existing=none|full|partial|duplicate`：空行、已有完整冲突数据、已有部分数据、已有相同数据。
- `order=time,location,content`：表头/列顺序，可改为 `content,time,location`。

夹具会在 `window.__awardsFixture` 中记录：奖励行的框架状态、六类输入事件、新增/删除/下一步/最终提交点击次数，以及任何页面上下文网络请求尝试。测试只读取这些记录，不为适配器提供专用选择器。

## 15 项验收映射

| 编号 | 自动化断言 |
| --- | --- |
| 1 | 一条奖励进入默认行 |
| 2 | 两条奖励新增一行，等待延迟 DOM 变化 |
| 3 | 三条奖励连续新增两行 |
| 4 | 空地点保持空字符串且不触发地点输入 |
| 5 | 默认不覆盖已有内容 |
| 6 | `allowOverwrite` 开启后覆盖 |
| 7 | 重复执行行数和新增点击数不增长 |
| 8 | 新增按钮缺失时明确失败 |
| 9 | 新增无 DOM 变化时在上限内失败 |
| 10 | 调换列顺序后仍按表头对应字段 |
| 11 | 奖励表外手机号、搜索框和申请理由保持不变 |
| 12 | 每个填写字段依次包含 focus、pointerdown、mousedown、input、change、blur，且框架状态同步 |
| 13 | 下一步点击次数为 0 |
| 14 | 正式提交和删除点击次数均为 0 |
| 15 | 页面网络拦截记录和 DevTools 外部请求记录均为空 |

另有一项诊断回归测试，要求诊断对象可直接序列化，且不含字段当前值、查询参数值、Cookie、Session 或 Token。

## 适配器测试契约

E2E 测试按下列公开接口调用实现：

```js
const adapter = JFAwardsAdapter.createAdapter(document);
adapter.detectPage();
await adapter.ensureRows(targetCount, { timeoutMs, maxAdds });
const plan = await adapter.buildPlan(awards, { allowOverwrite, skipEmpty });
await adapter.executePlan(plan, { allowOverwrite, skipEmpty });
```

`ensureRows` 失败时可以抛出异常，也可以返回带 `ok: false`、`success: false`、`status: "error"` 或明确错误文本的结果。
