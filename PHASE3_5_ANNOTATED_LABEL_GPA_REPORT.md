# Phase 3.5 Annotated Label / GPA 报告

## 结论

本项不是新增 schema。GPA 的 canonical 路径继续使用现有 `education[].gpa`；`education[].gpaScale` 也保持独立。本轮修复的是带说明文字的完整 label 如何产生严格的 annotation-base evidence。

## 归一化规则

`src/core/field-matcher.js` 先保留完整 primary label 的精确证据；只有 alias 后立即出现明确注释分隔符时，才额外提取 base label。认可的边界是中文/英文括号或方括号等显式 annotation delimiter，而不是任意字符串前缀。

以下均映射 `education[].gpa`：

- `本科GPA`
- `本科 GPA`
- `本科GPA（绩点/满绩，示例：3.5/4）`
- `本科GPA(示例3.5/4)`

以下保持安全区分：

- `本科GPA排名`：没有 annotation delimiter，不因前缀而映射 GPA；
- `本科GPA排名（示例：第2名）`：base 是“本科GPA排名”，仍不是 GPA；
- `绩点满分`：映射现有 `education[].gpaScale`；
- `满绩`：单独出现时不映射 GPA。

同一机制还加入了精确 primary label 的稳定优先级：真实级联字段中，精确 label `籍贯地区（级联）` 不再被 placeholder/id/groupText 的重复弱回声挤掉。该排序不修改分数阈值，也不进行危险 prefix matching。

## 安全边界

- 没有改 FieldMatcher threshold。
- 没有全局放宽 alias prefix。
- annotation base 只来自字段自己的 primary `labelText`，不从 nearby/group/placeholder 的噪声推断。
- 原始完整 label 仍参与区分 GPA、GPA 排名和满分字段。
- 不新增或复制 GPA schema 字段，不改变 Resume JSON。

## 验证

GPA 精确过滤专项：`1 / 1 PASS`，一个测试内覆盖四个成功标签、`gpaScale` 和三个反例。Singleton/Matcher 组合：`13 / 13 PASS`；完整 Unit：`743 / 743 PASS`；headed Edge 完整 E2E：`51 / 51 PASS`。

Matrix capability `annotated-field-label-normalization` 会执行对应 runtime unit evidence，不是 catalog-only PASS。
