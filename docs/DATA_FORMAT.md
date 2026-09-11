# 统一 Resume JSON 数据格式

“解放”只维护一套 Resume JSON。学校网站的栏目名称、字段名称和选项差异由通用语义映射与 Site Adapter 处理，不需要复制多份网站专用资料。

推荐从 [`samples/sample-unified-resume.json`](../samples/sample-unified-resume.json) 开始修改。样例中的姓名、学校、经历和竞赛均为虚构信息，手机号、身份证号和地址等敏感字段留空。

## 顶层结构

```json
{
  "profileName": "默认申请资料",
  "basic": {},
  "contact": {},
  "application": {},
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

- `basic`、`contact`、`application`、`skills`、`files` 是对象。
- `family`、`education`、`awards`、`research`、`projects`、`papers`、`patents`、`practice`、`internships`、`student_work`、`certificates`、`language` 是数组。
- `profileName` 只用于区分本地资料名称。
- 顶层数组顺序就是重复表单组的计划顺序：`awards[0]` 对应第一组，`awards[1]` 对应第二组。
- `awards` 必须是独立一级数组，不能归入 `skills` 或 `customFields`。

旧 JobFill 的 `personal`、`internship`、`languages` 等结构仍会经过兼容视图映射，详见 [迁移说明](MIGRATION.md)。新资料建议使用上面的统一键名。

## 基本信息与联系方式

```json
{
  "basic": {
    "name": "示例同学",
    "namePinyin": "SHILI TONGXUE",
    "healthStatus": "健康",
    "gender": "男",
    "birthday": "2004-05-09",
    "idType": "居民身份证",
    "idNumber": "",
    "political": "中国共产党预备党员",
    "ethnicity": "汉族",
    "nationality": "中国",
    "hometown": "",
    "birthplaceRegion": "",
    "hometownRegion": "",
    "householdRegion": "",
    "marital": "未婚",
    "militaryStatus": "非现役军人",
    "householdAddress": ""
  },
  "contact": {
    "phone": "",
    "landline": "",
    "email": "",
    "address": "",
    "currentCity": "",
    "postcode": "",
    "archiveOrganization": "",
    "archiveRegion": "",
    "archiveAddress": "",
    "archivePostcode": "",
    "emergencyPhone": ""
  }
}
```

这些字段的含义如下：

- `namePinyin`：姓名拼音，与 `name` 独立，避免把中文姓名写进拼音字段；
- `healthStatus`：健康状况，例如“健康”“良好”，按学校要求填写；
- `political`：政治面貌；“中国共产党预备党员”“中共预备党员”和“预备党员”会作为同一语义处理，但不会与正式党员混选；
- `marital`：婚姻状况；
- `militaryStatus`：现役军人状态或页面对应代码的语义值；
- `birthplaceRegion`、`hometownRegion`、`householdRegion`：出生地、籍贯所在地和户口所在地的省／市／区县层级信息，彼此独立；
- `householdAddress`：户口或户籍所在地详细地址，不与普通通讯地址混用；
- `landline`：固定电话；
- `archiveRegion`：档案所在地的省／市／区县层级信息，不与档案单位地址混用；
- `archiveOrganization`、`archiveAddress`、`archivePostcode`：档案所在单位、地址和邮编；
- `emergencyPhone`：紧急联系人电话。

姓名拼音示例为虚构占位文本。身份证号、手机号、邮箱、家庭地址、户籍地址和档案信息等敏感内容继续留空。不需要填写的网站字段也可留空；默认“跳过空值”，所以空字符串不会写成 `undefined`、`null` 或空格。旧资料中的 `name_pinyin`、`health_status`、`military_status`、`household_address`、`fixed_phone`、`archive_organization` 等键仍由兼容视图读取，新资料建议使用上面的驼峰键名。

## 申请附加信息

```json
{
  "application": {
    "disciplinaryHistory": "",
    "personalStatement": "",
    "notes": ""
  }
}
```

- `disciplinaryHistory`：作弊、违纪或处分情况，资料管理页最多录入 200 字；
- `personalStatement`：申请个人陈述，资料管理页最多录入 1000 字；
- `notes`：申请备注或补充说明，资料管理页最多录入 1000 字。

`application.personalStatement` 与顶层 `intro`（自我评价）是两个独立字段，扩展不会在二者之间自动复制或推断内容。

## 数组经历

教育经历示例：

```json
{
  "education": [
    {
      "school": "示例大学",
      "college": "示例学院",
      "major": "材料科学与工程",
      "degree": "学士",
      "educationLevel": "本科",
      "startDate": "2022-09",
      "endDate": "2026-06",
      "studentId": "",
      "gpa": "",
      "rank": ""
    }
  ]
}
```

家庭成员示例：

```json
{
  "family": [
    {
      "name": "示例家庭成员",
      "relationship": "父亲",
      "employer": "示例单位",
      "position": "示例职务",
      "phone": "",
      "political": "",
      "description": "示例家庭成员资料，不对应任何真实个人。"
    }
  ]
}
```

实习经历示例：

```json
{
  "internships": [
    {
      "company": "示例实习单位",
      "position": "示例岗位",
      "startDate": "2024-07",
      "endDate": "2024-08",
      "location": "",
      "description": "示例实习描述，不对应任何真实经历。",
      "attachments": []
    }
  ]
}
```

其他数组可使用各自常见语义字段，例如：

- `education[]`：`school`、`major`、`educationLevel`、`startDate`、`endDate`、`studentId`（在校生注册学号）、`gpa`（可写成 `3.80/4.00`）、`rank`；
- `family[]`：`name`、`relationship`、`employer`、`position`、`phone`、`political`、`description`；
- `research[]` / `projects[]`：`name`、`organization`、`role`、`startDate`、`endDate`、`description`、`attachments`；
- `papers[]`：`title`、`journal`、`authors`、`date`、`status`、`attachments`；
- `patents[]`：`name`、`number`、`date`、`status`、`attachments`；
- `internships[]`：`company`、`position`、`startDate`、`endDate`、`location`、`description`、`attachments`；
- `practice[]` / `student_work[]`：名称或单位、角色、起止日期、描述和 `attachments`；
- `certificates[]` / `language[]`：证书或语言名称、等级/成绩、日期和附件引用。

网站出现含义过于模糊的“名称”“类别”等字段时，引擎会结合当前栏目、重复组、附近标签和控件类型评分；仍无法区分时标记“需要人工确认”，不会猜填。

如果家庭成员页面把“在何单位工作任何职务”设计成一个输入框，语义层会从 `employer` 与 `position` 派生组合值；资料管理页仍将单位和职务分开保存，方便其他网站分别填写。

## 奖励与荣誉

统一模型兼容新旧字段名：新网站通常匹配 `name` / `date`，原奖励页面回退适配器继续匹配 `time` / `location` / `content`。

```json
{
  "awards": [
    {
      "name": "示例竞赛国家级奖项",
      "date": "2025-07",
      "time": "2025-7",
      "location": "青岛",
      "content": "示例竞赛国家级奖项",
      "category": "竞赛获奖",
      "level": "国家级",
      "rank": "一等奖",
      "organizer": "示例主办单位",
      "attachments": []
    }
  ]
}
```

奖励条目支持：

```text
name / content               奖励名称或内容
date / time                  获奖日期或年月
location                     地点，可为空
category                     奖项类别（如奖学金、荣誉称号、竞赛获奖）
level                        奖项级别
rank                         获奖等级
organizer                    主办单位
certificateFileName          旧版显示文件名字段
attachments                  材料库 fileId 数组
note                         备注
```

`category`、`level`、`rank` 与 `participationMode` 是相互独立的语义。网页只显示裸标签“类别”时，只会在已可靠识别为奖励/荣誉栏目的上下文中匹配 `awards[].category`；没有栏目上下文时会保持未匹配。

`certificateFileName` 只是一项兼容文本，不会按电脑路径读取文件。正式上传应把材料导入材料库，并使用生成的 `fileId` 绑定到 `attachments`。

## 日期格式

JSON 内建议使用：

- 完整日期：`YYYY-MM-DD`，例如 `2025-07-16`；
- 年月：`YYYY-MM`，例如 `2025-07`。

兼容层也可识别 `YYYY/M/D`、`YYYY.MM.DD`、`YYYY年M月D日`、`YYYY/M`、`YYYY年M月` 等格式，并根据 `input[type=date]`、`input[type=month]` 或普通文本框转换。日期组件若无法可靠操作，会要求人工确认。

原奖励编辑器继续接受 `2025-7` 与 `2025-07`。地点为空合法，填表时会跳过。

## 文件引用

将文件导入“个人材料库”后，扩展会生成类似 `file_xxx` 的本地 ID。可按以下方式明确绑定：

```json
{
  "basic": {
    "photo": "file_photo_example"
  },
  "files": {
    "resume": "file_resume_example",
    "transcript": "file_transcript_example",
    "language_certificate": "file_cet6_example"
  },
  "awards": [
    {
      "name": "示例奖项",
      "attachments": ["file_award_example"]
    }
  ]
}
```

示例中的 ID 只是格式示意，必须换成当前浏览器材料库实际生成的 ID。也可在材料元数据中把“绑定 Resume 路径”设为 `basic.photo`、`files.transcript`、`awards[0]` 等。

文件匹配优先级为：Resume JSON 明确 fileId → 材料的 Resume 路径绑定 → 明确分类 → 标签/别名和文件名语义 → 人工确认。仅有“其他附件”或多个分数接近的候选时不会自动上传。

材料文件本身不会写入 Resume JSON，也不会随 JSON 导出；Blob 保存在扩展 IndexedDB 中。迁移浏览器时需重新导入材料并更新对应 fileId。

## 导入、规范化与校验

- 完整 JSON：拖入管理页右侧申请资料导入区；
- 奖励批量导入：在“奖励与荣誉”中粘贴数组、含 `awards` 的对象或 Tab 分隔文本；
- 材料文件：拖入“个人材料库”，不要拖到 Resume JSON 导入区。

导入时会修剪纯空白、补齐缺省顶层结构并限制异常大的输入。完整 JSON 文件最大 2 MB；本地文本解析文件最大 10 MB；单数组最多 100 项；单字符串、对象深度、键数和总节点数均有限制。格式错误会在管理页提示，不会回退到外部 AI。

奖励的 `time` 与 `content/name` 缺失时会提示；`location` 允许为空。批量导入采用追加语义，不会删除已有奖励。导出前请检查敏感字段，并把备份保存在可信位置。
