# 从原 JobFill 迁移

“解放”是在 JobFill 基础上的二次开发，不要求重新手工录入全部资料。旧 JSON 可以先导入管理页，再逐步补齐新的统一结构。

迁移前建议在旧版本中导出一份 JSON 备份，并把备份保存在可信位置。不要把含真实身份证号、手机号、家庭成员或地址的备份提交到公开仓库。

## 推荐迁移步骤

1. 安装“解放”，打开“管理申请资料”。
2. 将原 JobFill 导出的 JSON 拖入申请资料导入区。
3. 检查基本信息、教育、实习、项目、技能等原有字段。
4. 按照 [`samples/sample-unified-resume.json`](../samples/sample-unified-resume.json) 补充 `basic`、`contact`、`family`、`awards`、`research`、`papers` 等统一顶层数据。
5. 在“奖励与荣誉”中检查时间、地点、内容、级别和附件绑定。
6. 保存申请资料，再导出一次新的统一 JSON 作为备份。
7. 将常用附件单独拖入“个人材料库”，确认分类和 Resume 路径绑定。

## 自动兼容的旧字段

运行时的兼容视图会优先使用新结构，并在缺失时读取常见旧结构：

- `personal` → `basic` 与 `contact`；
- `internship` → `internships`；
- `languages` → `language`；
- 原有 `education`、`work`、`projects`、`skills` 等字段继续保留；
- 缺少 `profileName` 时使用“默认申请资料”；
- 缺少统一数组时补为空数组；
- 奖励中的 `time/content` 与 `date/name` 互相兼容；
- 管理页保存时会保留已加载、未在旧 UI 中逐项展示的统一顶层模块。

导入后仍应人工检查。旧字段含义可能与新语义不完全一致，兼容转换不会凭空推断个人信息。

## 奖励迁移

旧 JobFill 没有完整、独立的 `awards` 模型。有些数据可能写在：

- `skills.certificates`；
- `education[].honors`；
- `customFields`；
- 其他自由文本。

“解放”不会自动把这些自由文本拆成奖励条目，以免把证书、处分、课程荣誉或普通技能误迁移。请把确认后的内容整理到顶层 `awards` 数组，可参考：

```json
{
  "awards": [
    {
      "name": "示例奖项",
      "date": "2025-07",
      "time": "2025-7",
      "location": "",
      "content": "示例奖项",
      "level": "校级",
      "attachments": []
    }
  ]
}
```

地点为空会跳过，不会写入 `undefined`、`null` 或空格。

## 材料库不能随 JSON 自动迁移

Resume JSON 只保存 fileId 引用，不包含 PDF/图片/DOCX 的 Blob。材料库 Blob 位于当前浏览器扩展的 IndexedDB，因此：

- 从旧 JobFill 迁移时，需要把电脑上的原文件重新拖入材料库；
- 换电脑、换浏览器配置文件或卸载重装后，也需要重新导入材料；
- 重新导入会生成新的 fileId，应更新 `basic.photo`、`files.*`、`attachments` 等引用；
- 材料元数据中的 `relatedResumePath` 可用于绑定 `basic.photo`、`education[0]`、`awards[0]` 等路径。

不要把电脑绝对路径写进 Resume JSON。浏览器不会允许扩展通过字符串路径读取本地文件。

## 旧 AI 配置

旧浏览器存储中可能仍存在 `aiConfig` 或 API Key。保研本地模式不会读取它执行请求，也不会在 Resume 导出或诊断中包含 API Key。为避免意外暴露：

1. 不要把旧扩展配置目录提交到 Git；
2. 完成迁移和备份后，卸载旧扩展；
3. 卸载会清除旧扩展自己的本地存储。

“解放”的 AI 入口保持隐藏，后台拒绝旧 AI 消息，manifest 和 CSP 也不允许外部 AI 连接。

## 回滚

如需暂时回到旧 JobFill：

- 保留迁移前的旧 JSON；
- 不要把“解放”生成的材料 fileId 当作可移植文件路径；
- 最好在另一个浏览器配置文件中安装旧版，避免两个版本共用同一学校页面时混淆；
- 无论使用哪个版本，都应人工核对网页并自行最终提交。

“解放”继续保留 JobFill 原作者信息和 MIT License；迁移不会改变原 JSON 文件本身，除非你主动导出覆盖电脑上的同名文件。
