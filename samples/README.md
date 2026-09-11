# 安全示例文件

本目录只包含虚构或留空的数据，用于验证“解放”的本地导入、统一语义映射和旧 JobFill 兼容。请勿把真实身份证号、手机号、邮箱、家庭成员、住址、API Key 或敏感材料提交到 Git 仓库。

| 文件 | 用途 |
| --- | --- |
| [`sample-unified-resume.json`](sample-unified-resume.json) | 推荐入口：统一 Resume JSON，包含基本、联系、教育、奖励、科研、语言和文件引用结构 |
| [`sample-awards.json`](sample-awards.json) | 只测试独立顶层 `awards` 数组和奖励批量导入 |
| [`sample-resume.json`](sample-resume.json) | 旧 JobFill 完整资料兼容与迁移测试 |
| [`sample-resume.md`](sample-resume.md) | 本地文本规则解析测试；解析不足会停止，不会回退外部 AI |

## 导入统一 Resume JSON

1. 点击扩展图标。
2. 点击“管理申请资料”。
3. 将 `sample-unified-resume.json` 拖到申请资料导入区。
4. 检查基本信息、教育经历和“奖励与荣誉”。
5. 点击保存。
6. 打开本地测试夹具或学校报名页面，先点“识别当前系统”，再点“填写当前栏目”或“一键填写全部”。
7. 在网页悬浮面板中核对预览后确认。

样例中的 `files` 和 `attachments` 默认为空，因为材料库 fileId 只在当前浏览器导入文件后生成，不能预先写死。要测试文件上传：

1. 在 Popup 点击“材料库”。
2. 拖入自行准备的无敏感测试 PDF/JPG/PNG/DOCX。
3. 核对分类、标签和别名，可绑定 `basic.photo`、`files.transcript` 或 `awards[0]`。
4. 将实际生成的 `fileId` 写入 Resume JSON，或保留材料路径绑定。
5. 运行填写任务并在预览中确认本次可能使用的材料。

## 奖励批量导入

打开“管理申请资料” → “奖励与荣誉” → “批量导入”，粘贴 `sample-awards.json` 中的 `awards` 数组。批量导入采用追加语义，不删除已有奖励。

奖励的地点允许为空；空地点会跳过，不会写入 `undefined`、`null` 或空格。

## 注意

- 示例 fileId、姓名和学校不能直接用于真实申请。
- Resume JSON 不包含材料 Blob。导出、换电脑或重装后，需要重新导入材料并更新 fileId。
- 所有任务都需要预览确认；扩展永不自动最终提交。
