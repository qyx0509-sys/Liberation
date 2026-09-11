# Site Profile V2 Schema

Site Profile 是站点差异的声明式、可序列化描述。它只向既有 Core 和 Adapter 提供局部证据，不读取 DOM、不发起网络请求、不访问 Cookie/Token，也不执行选择器或任何用户提供的代码。

## Runtime 来源

- 运行时唯一来源是 `chrome.storage.local.siteAdapterConfigs`。
- `config/site-adapters.json` 只是保持空数组的 schema 入口，不会被自动加载或播种到存储。
- Profile 必须经过 `JFSiteProfile` 校验与归一化；非法、未知或含执行能力的数据必须被拒绝。
- 没有匹配、配置非法或候选并列时，Registry 确定性回退 Generic，不采用数组中的“第一个”。

## 顶层字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `2` | V2 固定版本。 |
| `id` | string | 稳定 Profile identity，只允许受限标识符。 |
| `revision` | string | 配置修订号；修改声明后必须更新。 |
| `enabled` | boolean | 是否参与选择。 |
| `priority` | integer | 相同页面上多个 Profile 的显式优先级。 |
| `match` | object | `origins`、`urlPrefixes`、`urlPatterns` 匹配证据。 |
| `navigation` | object | 导航选择器、最低置信度和局部栏目别名。 |
| `contentRoot` | string | 经诊断确认的内容根选择器。 |
| `sections` | object | 各栏目的根、重复组和安全新增候选。 |
| `fieldAliases` | object | 已知 Resume 路径的局部字段别名。 |
| `optionAliases` | object | 已知 Resume 路径的局部选项别名。 |
| `save` | object | 仅供 `SaveHandler` 再次安全复核的暂存候选。 |

至少提供一个 `match` 证据。优先同时给出精确 `origins` 和窄范围 `urlPrefixes`；`urlPatterns` 只是受限字符串通配，不是正则表达式。

## Sections

每个 `sections.<sectionId>` 只允许：

- `root`：栏目根或区域选择器；
- `groupSelector`：重复记录容器选择器；
- `addButtonSelector`：新增一条记录的候选选择器。

这些字段不授予点击权限。`ArrayHandler` 仍会检查可见性、DOM 归属、按钮语义、危险动作、用户授权和真实组数变化。

## 禁止能力

Profile 不得包含：

- 函数、getter/setter、`RegExp`、循环对象或原型污染键；
- `script`、`javascript`、`eval`、handler、callback、`onclick`；
- 自动提交、关闭 Safety、忽略 Verification、强制点击或强制控件 Adapter；
- Cookie、Token、用户简历、材料内容、真实文件名或本地路径；
- 学校真实域名或未经脱敏诊断确认的猜测选择器。

`FormFiller` 始终是薄编排层；普通控件只能由 `ControlAdapterRegistry` 选择受信任的内置 Adapter 执行。Profile 不能新增或替换执行代码。

## 确定性选择

Registry 按以下证据选择：

1. `priority`；
2. URL 匹配 specificity；
3. 若两项仍精确并列，返回 `AMBIGUOUS_PROFILE` 并回退 Generic。

Profile identity（`id` + `revision`）可进入任务状态和脱敏诊断，但诊断不得携带完整 URL、选择器正文或用户字段值。

完整脱敏样例见 [`examples/site-profile.example.json`](examples/site-profile.example.json)。
