# 网站适配器开发说明

“解放”采用分层适配：Generic Adapter 负责通用栏目与字段证据，声明式 Site Profile 只覆盖经诊断确认的局部 DOM 差异，Core 与 Control Adapter 仍是唯一执行层。不要为每个学校复制整套填写引擎，也不要根据截图猜 CSS 选择器。

## 核心原则

1. 页面类型只提供字段匹配上下文，不能作为允许填写的硬门槛。
2. 是否填写由真实 DOM 字段与 Resume JSON 的语义匹配分数决定。
3. 低可靠匹配返回 `NEEDS_CONFIRMATION`，不能猜填。
4. 数组一条数据只能对应一个重复 DOM 组，不能把所有值写入第一组。
5. Site Adapter 不能绕过新增、导航、暂存和最终提交安全规则。
6. 未取得真实 DOM 或脱敏诊断前，不提交学校专用选择器。
7. Site Profile 必须是可序列化纯数据，不能包含函数、脚本、回调、正则对象或任何执行能力。

## 当前架构

```text
src/
├─ core/
│  ├─ autofill-engine.js          全栏目状态机和运行授权
│  ├─ navigation-engine.js        导航扫描、分类、队列和 SPA 切换
│  ├─ field-detector.js           普通/自定义表单字段上下文
│  ├─ field-matcher.js            统一 Resume 路径评分
│  ├─ form-filler.js              空值/覆盖/敏感策略与薄编排
│  ├─ event-dispatcher.js         原生 setter 与 React/Vue 事件
│  ├─ array-handler.js            重复组、动态新增和索引映射
│  ├─ file-field-detector.js      标准和自定义上传区域
│  ├─ file-matcher.js             文件字段与材料库语义匹配
│  ├─ file-upload-engine.js       限制检查、FileList 注入和验证
│  ├─ page-ready.js               DOM 稳定、元素和导航等待
│  ├─ save-handler.js / safety.js 安全暂存与危险动作全局拦截
│  └─ task-state.js / report-manager.js
├─ controls/
│  ├─ control-adapter-registry.js 唯一控件执行入口
│  └─ adapters/                   Native/Select/Choice/Custom/Date 执行器
├─ mappings/
│  ├─ section-aliases.js
│  ├─ field-aliases.js
│  ├─ option-aliases.js
│  ├─ date-rules.js
│  └─ file-field-aliases.js
└─ adapters/
   ├─ site-profile.js             纯数据 schema、校验、归一化与局部 overlay
   ├─ generic-adapter.js          通用站点适配层
   ├─ registry.js                 Profile 的确定性选择与 Generic 回退
   ├─ generic.js                  旧奖励适配器复用的 DOM/事件工具
   └─ undergraduate-awards.js     原“奖励情况（本科期间）”回退能力
```

`src/content-controller.js` 把 Popup、AutofillEngine、TaskState、诊断与悬浮面板连接起来。新增站点逻辑应落在 Adapter/配置或映射中，不要写进 Popup。

## Generic Adapter 的处理流程

1. `NavigationEngine.scan()` 在语义导航容器中扫描 `a`、`button`、`li`、menuitem、tab 及 Ant Design、Element Plus 等常见菜单节点。
2. 栏目文本由 `SECTION_ALIASES` 模糊分类；URL 只作为辅助，危险或表单按钮被排除。
3. `FieldDetector.scan()` 收集标签、placeholder、aria-label、name/id、表头、父容器、附近文本、字段类型和选项，不只看 name/id。
4. `FieldMatcher` 综合标签、别名、控件类型、当前栏目、附近文本、冲突关键词和候选差距评分。
5. 数组栏目先由 `ArrayHandler` 找重复组，确认缺少的组数，再逐次点击安全“新增”并等待真实组数增加。
6. `FormFiller` 只处理空值、覆盖、敏感字段和结果编排，并把普通控件委托给 `ControlAdapterRegistry`；具体 Adapter 复用 `EventDispatcher` 写入，再由 `VerificationEngine` 回读真实 UI 状态。
7. 文件字段走独立的 Detector → Matcher → UploadEngine 链路。
8. 开启自动暂存时，`SaveHandler` 只点击语义明确且再次通过安全检查的保存候选。

页面标题或活动栏目未识别时，字段扫描仍会继续。诊断中的“栏目分数 0”不等于禁用填表；只有具体字段的候选分数不足时才不填写。

## 先导出诊断

在真实网站失败的栏目：

1. 打开 Popup 或网页悬浮面板。
2. 点击“诊断当前栏目”。
3. 在 Popup 复制或下载诊断 JSON。
4. 分享前人工检查学校域名、标题和 DOM 命名。

诊断结构包括：

```json
{
  "section": {
    "detected": "awards",
    "title": "奖励或处分",
    "score": 0.92,
    "source": "active-navigation"
  },
  "navigation": {
    "itemCount": 6,
    "items": []
  },
  "fields": [
    {
      "labelText": "获奖名称",
      "type": "text",
      "matchedJsonPath": "awards[].name",
      "score": 92,
      "status": "MATCHED"
    }
  ],
  "fileFields": [],
  "groups": [],
  "buttons": [],
  "saveCandidates": [],
  "warnings": []
}
```

诊断不包含字段值、Resume 数据、真实材料文件名/正文、本地路径、完整 HTML、Cookie、Token 或 Session。

## 站点配置

仓库中的 `config/site-adapters.json` 是 schema 入口并始终保持空数组，不会自动注入任何站点规则。运行时唯一配置源是 `chrome.storage.local.siteAdapterConfigs`，只有真实诊断确认后才添加。

Site Profile 是纯声明数据：它可以提供匹配范围、导航/内容根、重复组、字段/选项别名和安全暂存候选，但不能携带函数、脚本、回调、正则对象，也不能指定或替代控件执行代码。完整字段约束见 [`SITE_PROFILE_SCHEMA.md`](SITE_PROFILE_SCHEMA.md)，可复制的脱敏样例见 [`examples/site-profile.example.json`](examples/site-profile.example.json)。

配置选择优先使用精确 `match.origins` 与 `match.urlPrefixes`；需要通配时只能使用受限的字符串 `urlPatterns`，它不是正则表达式。

```json
{
  "schemaVersion": 2,
  "id": "example-graduate-application",
  "revision": "2026-08-24.1",
  "enabled": true,
  "priority": 20,
  "match": {
    "origins": ["https://apply.example.invalid"],
    "urlPrefixes": ["https://apply.example.invalid/application/"],
    "urlPatterns": []
  },
  "navigation": {
    "selectors": ["#verified-sidebar a"],
    "minimumConfidence": 0.78
  },
  "contentRoot": "#verified-form-root",
  "sections": {
    "awards": {
      "root": "#verified-awards-panel",
      "groupSelector": ".verified-award-row",
      "addButtonSelector": "button.verified-add-award"
    }
  }
}
```

上面的选择器名称只是配置格式示意，`.invalid` 域名不会对应真实学校。实际提交配置时必须用真实诊断确认过的稳定选择器。

Profile 声明职责：

- `match`：确定 Profile 可参与选择的 URL 范围；
- `navigation.selectors`：补充导航候选范围；
- `navigation.minimumConfidence`：提高或降低该站的栏目队列阈值，最低仍受核心安全下限约束；
- `contentRoot`：整个站点的主要表单根；
- `sections.<section>.root/region`：某栏目的表单根；
- `groupSelector`：该栏目的重复记录容器；
- `addButtonSelector`：只指向该栏目的新增按钮。

即使配置了选择器，运行时仍会检查可见性、DOM 归属、按钮文字、危险关键词、实际组数变化和本次用户授权。配置不能指向“删除”“下一步”或“提交”。

## 扩展栏目和字段映射

通用别名放在 `src/mappings/`：

- 新栏目名称加入 `section-aliases.js`；
- 新 Resume 字段和同义标签加入 `field-aliases.js`；
- 同值异名的选择项加入 `option-aliases.js`；
- 文件语义加入 `file-field-aliases.js`；
- 日期展示规则加入 `date-rules.js`。

添加别名时：

1. 优先使用完整、明确的业务短语。
2. “名称”“类别”“时间”等弱词不能单独决定路径。
3. 为可能冲突的栏目增加单元测试。
4. 不把学校名称、真实个人数据或敏感样例写进映射。

## Site Profile 与可执行 Site Adapter

优先通过 Site Profile 解决 DOM 范围、别名和重复组差异。Profile 只提供局部证据，不能读取 DOM、发起网络请求、操作存储、点击元素或执行选择器；所有选择器都由现有 Core/Adapter 在全局 Safety 下消费。

若某站存在纯声明数据无法表达的特殊路由、Select、上传或暂存流程，才实现一个小型可执行 Adapter，并复用核心模块：

```js
const adapter = {
  detectCurrentSection(),
  findContentRoot(section),
  scanFields(section, root),
  scanFileFields(section, root),
  diagnose(context),
  navigation
};
```

Adapter 只提供站点证据和覆盖点。字段写入仍交给 `FormFiller`，动态数组仍交给 `ArrayHandler`，文件上传仍交给 `FileUploadEngine`，保存仍交给 `SaveHandler`。不要在 Adapter 里直接点击最终动作。

## 奖励页面回退

`undergraduate-awards.js` 仍保留原页面的可靠逻辑：表头定位时间/地点/内容、逐行映射、MutationObserver 增行、覆盖冲突和回读结果。新引擎在通用数组处理不足时可使用它作为回退，但“奖励页面置信度”不再阻止其他栏目或其他可靠字段工作。

## 测试要求

每个新站点适配至少提供脱敏 fixture，并覆盖：

- 导航识别和 SPA DOM 更新；
- 同名字段利用栏目/组上下文正确区分；
- 数组三条数据从一组增到三组；
- React-like input、select、radio 和日期回读；
- 文件格式、大小、候选歧义和确认策略；
- “保存”可识别，而“最终提交”“提交申请”“确认报名”永久拒绝；
- 不点击删除/下一步，不产生外部网络请求。

运行：

```powershell
npm.cmd run test:unit
npm.cmd run test:e2e
```

Generic Adapter 不能保证所有定制控件。遇到无法可靠处理的组件，正确行为是记录诊断并等待 Site Adapter，而不是降低分数阈值强行填写。
