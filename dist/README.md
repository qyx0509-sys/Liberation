# 解放

“解放”是一款面向高校保研、夏令营、预推免和研究生申请系统的本地半自动填表扩展。它基于 [JobFill](https://github.com/zhuanglaihong/JobFill) 二次开发，继续保留原作者信息和 MIT 许可证；完整许可内容见 [LICENSE](LICENSE)。

扩展现在使用一套统一 Resume JSON：扫描报名系统栏目和当前真实 DOM，按语义匹配普通字段、下拉框、日期、重复经历和文件上传字段。页面名称只提供上下文，不再以“页面置信度”为是否填写的硬门槛。无法可靠匹配的字段会留给人工确认。

## 能做什么

- 在 Popup 中扫描左侧或顶部导航，建立基本信息、教育经历、奖励、科研、项目、论文等栏目队列；
- “一键填写全部”按队列逐栏处理，“填写当前栏目”只处理当前页面；
- 匹配 `input`、`textarea`、`select`、单选、多选、日期和常见自定义控件；
- 为教育、奖励、科研、项目、论文等数组识别重复表单组并按需点击安全的“新增”按钮；
- 通过原生 setter 和事件链兼容普通 HTML、React/Vue 及常见组件状态更新，并在填写后回读验证；
- 将 PDF、JPG、PNG、DOCX 拖入本地材料库，设置分类、别名、标签和 Resume 路径绑定；
- 对高可靠材料匹配执行本地文件上传，匹配不明确时在悬浮面板中要求选择或跳过；
- 在网页内显示可拖动、缩放、折叠和最小化的 Shadow DOM 悬浮面板，可暂停、继续、停止、跳过、重试和诊断；
- 可选自动点击语义明确的“保存/暂存”，但永久禁止自动最终提交。

## 必须了解的安全边界

“解放”只辅助用户本人填写申请资料：

1. 你自行登录并打开报名系统。
2. 你主动点击扩展，脚本才临时注入当前标签页。
3. 每次任务开始前，你必须在预览中确认栏目、材料和暂存策略。
4. 扩展只填写高可靠匹配；已有值冲突、低分匹配和模糊附件会等待人工处理。
5. 任务完成后，你逐页核对并自行提交。

扩展不会自动登录，不保存网站密码，不读取 Cookie、Session 或 Token，不绕过验证码，不操作后台标签页，不自动删除网页记录，也不点击“下一步”“最终提交”“提交申请”“确认报名”等危险操作。最终提交禁令不可关闭。

本地模式不调用外部 API，不发送 Resume JSON、材料正文、字段内容或网页 HTML，也没有统计和遥测。详细说明见 [隐私、权限与安全说明](docs/PRIVACY.md)。

## 下载、构建与安装

不熟悉 Git 的用户可以在项目 GitHub 页面点击 **Code → Download ZIP**，下载后解压。若拿到的是已构建发布包，直接使用其中包含 `manifest.json` 的 `dist` 目录。

开发版可在项目根目录运行：

```powershell
npm.cmd run build
```

构建产物位于 `dist`。

### Chrome

1. 在地址栏打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择构建后的 `dist`；开发调试也可选择包含 `manifest.json` 的项目根目录。
5. 在工具栏拼图菜单中固定“解放”。

### Edge

1. 在地址栏打开 `edge://extensions`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择 `dist` 或项目根目录。
5. 在扩展菜单中固定“解放”。

图文之外的详细步骤和更新方法见 [Chrome 与 Edge 安装教程](docs/INSTALL.md)。

## 第一次使用：准备 Resume JSON

1. 点击扩展图标，再点击“管理申请资料”。
2. 可在管理页逐项编辑，也可拖入完整 JSON。
3. 推荐复制 [统一 Resume JSON 示例](samples/sample-unified-resume.json)，替换为自己的资料后导入。
4. 检查数组条数、必填字段和日期格式，然后保存。
5. 需要备份时，从管理页导出 JSON，并妥善保管下载文件。

管理页现在可直接编辑姓名拼音、健康状况、政治面貌、户籍详细地址、通讯地址及邮编、档案单位及地址邮编、在校生注册学号、成绩绩点、`family[]` 家庭成员和 `internships[]` 学习/工作经历。军人状态等暂未提供独立控件的统一 JSON 字段仍会保留，可按 [统一 Resume JSON 示例](samples/sample-unified-resume.json) 修改后整体导入。示例只使用虚构占位内容，身份证号、手机号、邮箱、家庭地址等敏感字段均应由用户在本机填写，禁止提交到公开仓库。

顶层结构如下；不同网站的名称差异由语义映射和 Adapter 处理，不需要为每个网站创建一套 JSON：

```json
{
  "profileName": "默认申请资料",
  "basic": {},
  "contact": {},
  "family": [],
  "education": [],
  "awards": [],
  "research": [],
  "projects": [],
  "papers": [],
  "patents": [],
  "practice": [],
  "internships": [],
  "student_work": [],
  "certificates": [],
  "language": [],
  "skills": {},
  "files": {}
}
```

`awards` 始终是独立一级数组，不放进 `skills` 或 `customFields`。旧 JobFill 数据仍会经过兼容转换；格式和迁移细节见 [JSON 数据格式](docs/DATA_FORMAT.md) 与 [从原 JobFill 迁移](docs/MIGRATION.md)。

## 第一次使用：建立材料库

1. 在 Popup 点击“材料库”，或打开“管理申请资料”后找到“个人材料库”。
2. 把 PDF、JPG、PNG 或 DOCX 从 Windows 文件资源管理器拖到虚线区域；也可点击该区域后多选文件。
3. 查看自动推测的分类。显示“需要确认分类”时，请手动选择正确分类。
4. 可修改显示名称、分类、标签和别名，并填写“绑定 Resume 路径”，例如 `basic.photo`、`education[0]` 或 `awards[0]`。
5. 点击“保存元数据”。也可预览、更换或删除材料库中的本地副本。

材料正文保存在扩展自己的 IndexedDB，`chrome.storage.local` 只保存资料、设置和材料元数据索引。单文件上限为 50 MB；同内容文件会通过本地 SHA-256 哈希去重。文件 ID 由导入后生成，可在 Resume JSON 的 `basic.photo`、`files.transcript`、数组条目的 `attachments` 等位置明确绑定。

## 一键填写全部

1. 自行登录学校报名系统，并停在包含报名栏目导航的页面。
2. 点击“解放”图标。
3. 点击“识别当前系统”，核对已识别栏目及 Resume JSON 条数。
4. 点击“一键填写全部”。如果只想处理当前页，点击“填写当前栏目”。
5. 在网页悬浮面板的“填写前预览”中核对计划栏目、可能使用的材料和安全暂存设置。
6. 点击“确认开始填写”。取消则不会修改网页。
7. 任务运行时可在悬浮面板点击“暂停”“继续”“停止任务”“跳过当前栏目”或“重新执行当前栏目”。停止任务需要二次确认，且不会撤销已经写入网页的内容。
8. 遇到模糊文件字段时，从材料候选中选择正确文件或“暂不上传”。
9. 完成后查看按栏目汇总的成功、人工确认、JSON 缺失和失败结果。
10. 逐页人工核对，最后由你本人点击提交。

默认填写策略是“仅填写空白字段”。网页值与 JSON 一致时跳过；已有值不同则标记冲突。可在悬浮面板“设置”中选择允许覆盖、文件上传策略、导航确认策略、自动暂存和边缘吸附。

### Popup 按钮

- **一键填写全部**：扫描导航、预览确认并按队列运行；
- **填写当前栏目**：只扫描和填写当前栏目；
- **打开网页悬浮面板**：恢复已隐藏或最小化的控制面板；
- **识别当前系统**：只扫描，不修改网页；
- **诊断当前栏目**：生成不含字段值和材料正文的结构化诊断；
- **管理申请资料 / 材料库**：打开本地管理页。

关闭 Popup 不会停止任务。关闭悬浮面板只会隐藏界面；真正停止必须点击“停止任务”并确认。悬浮面板位置、尺寸、折叠和最小化状态会在本机记忆，超出新屏幕可视范围时会自动收回。

## 文件上传策略

- **高可靠匹配自动上传**：预览会列出本次可能使用的材料。确认后，仅对 Resume 明确绑定，或分类、标签和字段语义达到高分且候选差距充分的文件执行上传。
- **每个文件上传前询问**：每次都在悬浮面板单独确认。

上传前会检查材料库白名单、页面可识别的扩展名、大小和数量限制。文件通过短时任务授权从 IndexedDB 取出，用 `File`、`DataTransfer` 和原生 `input/change` 事件交给标准文件输入框。仅出现“上传附件”等模糊文案时不会随便选择文件。

网页控件保留了所选 `FileList` 只代表浏览器端交接成功；学校服务器是否完成上传、是否需要裁剪或额外确认，仍必须人工核对。

## 自动暂存与最终提交

“自动暂存”默认关闭。开启后，引擎只考虑文字明确且通过安全规则的“保存”“暂存”“保存本页”“保存当前信息”等按钮。带“提交”“报名”“审核”“下一步”等含义的按钮不会点击；“保存并下一步”也不会自动执行。

无论任何设置、Adapter 或网站文案，最终提交关键词都会经过全局危险动作规则拦截。这条规则不能被站点配置覆盖。

## 诊断新网站

某栏目未识别、字段未匹配或动态新增失败时：

1. 停在失败栏目，打开 Popup 或网页悬浮面板。
2. 点击“诊断当前栏目”。
3. Popup 中可点击“复制诊断 JSON”或“下载诊断 JSON”；悬浮面板会直接下载。
4. 分享前仍请人工检查学校域名、页面标题和 DOM 命名。

诊断包含栏目、导航、字段类型、标签、placeholder、表头、分组、按钮、安全保存候选和匹配分数；不包含字段当前值、Resume 数据、文件正文、完整 HTML、Cookie、Token、Session 或查询参数值。开发 Adapter 请阅读 [网站适配器开发说明](docs/ADAPTERS.md)。

## 项目结构

```text
JobFill/
├─ manifest.json                 # Manifest V3；activeTab + scripting
├─ popup.html / popup.js         # 栏目摘要、统一数据摘要和任务控制
├─ options.html / options.js     # Resume JSON 与材料库管理
├─ background.js                 # TaskState、短时材料授权和安全消息
├─ src/
│  ├─ content-controller.js      # Popup、悬浮面板与引擎的集成入口
│  ├─ core/
│  │  ├─ autofill-engine.js      # 全栏目状态机
│  │  ├─ navigation-engine.js    # 栏目扫描、队列和 SPA 导航
│  │  ├─ field-detector.js / field-matcher.js
│  │  ├─ form-filler.js / event-dispatcher.js / verification-engine.js
│  │  ├─ array-handler.js        # 重复组发现与动态新增
│  │  ├─ file-*.js               # 文件字段识别、匹配与上传
│  │  ├─ page-ready.js / save-handler.js / safety.js
│  │  └─ task-state.js / report-manager.js
│  ├─ mappings/                  # 栏目、字段、选项、日期和文件别名
│  ├─ adapters/                  # Generic Adapter、站点配置和奖励回退
│  ├─ storage/                   # Resume Store、材料库与 IndexedDB
│  └─ floating-ui/               # Shadow DOM 面板、拖动、缩放和状态
├─ config/site-adapters.json     # 默认无学校特例
├─ samples/sample-unified-resume.json
├─ tests/                        # 单元与浏览器端到端测试
├─ docs/
└─ LICENSE                       # JobFill 原作者信息与 MIT License
```

## 开发、测试和构建

需要 Node.js 22 或更高版本；项目测试不要求安装第三方 npm 包。

```powershell
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd test
npm.cmd run build
```

Windows PowerShell 若阻止 `npm.ps1`，请使用上面的 `npm.cmd`。构建脚本将可加载扩展复制到 `dist`。

## 已知限制

- Generic Adapter 能覆盖常见语义和 DOM 结构，但不能保证所有学校的定制 Select、日期、富文本、上传组件或虚拟列表都可操作；失败时应导出诊断并增加 Site Adapter。
- SPA 局部路由可等待 DOM 稳定；若栏目点击触发完整页面刷新，临时注入和内存授权会失效，需要重新点击扩展、重新预览确认后继续。
- 跨源 iframe、关闭的 Shadow DOM、Canvas 和图片表单无法通用访问。
- 大文件受浏览器扩展内存/存储和网站限制影响；浏览器端选择成功不等于学校服务器已完成上传。
- 默认不删除网页已有组，也不会自动处理弹窗验证码、登录过期或最终提交。

完整列表见 [已知限制](docs/KNOWN_LIMITATIONS.md)。

## 卸载并清除本地资料

1. 如需保留资料，先在管理页导出 Resume JSON；材料文件不会包含在 JSON 备份中，请保留电脑原件。
2. 可先在材料库逐项点击“删除”，确认本地副本已移除。
3. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
4. 找到“解放”，点击“移除/删除”并确认。

移除扩展会清除该扩展域下的 `chrome.storage.local`、`chrome.storage.session` 和 IndexedDB，包括 Resume 数据、任务状态、设置、材料元数据和 Blob。你主动下载的 JSON、诊断文件以及电脑原始材料不受扩展控制，需要自行删除。

## 许可与来源

本项目基于 zhuanglaihong 的开源项目 [JobFill](https://github.com/zhuanglaihong/JobFill) 二次开发，保留原作者信息，并按 MIT License 提供。请勿将真实身份证号、手机号、家庭成员资料、API Key 或敏感材料提交到公开 Git 仓库。
