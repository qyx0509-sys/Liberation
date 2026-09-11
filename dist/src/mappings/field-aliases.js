/*
 * 解放：统一 Resume JSON 语义字段层
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initFieldAliases(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFieldAliases = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function fieldAliasesFactory() {
  'use strict';

  const ARRAY_SECTIONS = Object.freeze(new Set([
    'family', 'education', 'awards', 'research', 'projects', 'papers', 'patents', 'practice',
    'internships', 'student_work', 'certificates', 'language',
  ]));

  const SECTION_KEY_MAP = Object.freeze({
    'basic-information': 'basic',
    'family-members': 'family',
    'family-major-members': 'family',
    family_members: 'family',
    'study-information': 'education',
    education_experience: 'education',
    'learning-work-experience': 'internships',
    'study-work-experience': 'internships',
    learning_work_experience: 'internships',
    study_work_experience: 'internships',
    work_experience: 'internships',
    studyWorkExperience: 'internships',
    learningAndWorkExperience: 'internships',
    learningWorkExperience: 'internships',
    workExperience: 'internships',
    work: 'internships',
    work_history: 'internships',
    'foreign-language': 'language',
    'computer-level': 'skills',
    'academic-achievements': 'research',
    'awards-discipline': 'awards',
    internship: 'internships',
    internships: 'internships',
    languages: 'language',
    language: 'language',
    project: 'projects',
    paper: 'papers',
    patent: 'patents',
    award: 'awards',
  });

  function field(path, aliases, type = 'text', options = {}) {
    const sectionAliases = Array.isArray(options?.sectionAliases)
      ? options.sectionAliases.filter(alias => typeof alias === 'string' && alias.trim())
      : [];
    return Object.freeze({
      path,
      aliases: Object.freeze(aliases),
      type,
      ...(sectionAliases.length ? { sectionAliases: Object.freeze(sectionAliases) } : {}),
    });
  }

  const FIELD_DEFINITIONS = Object.freeze([
    // 基本信息
    field('basic.name', ['姓名', '本人姓名', '学生姓名', '申请人姓名', '真实姓名', 'name', 'fullname']),
    field('basic.namePinyin', ['姓名拼音', '姓名全拼', '名字拼音', '拼音姓名', 'namepinyin', 'pinyinname']),
    field('basic.gender', ['性别', '本人性别', 'gender', 'sex'], 'choice'),
    field('basic.birthday', ['出生日期', '出生年月日', '出生年月', '生日', 'birthdate', 'birthday'], 'date'),
    field('basic.age', ['年龄', '周岁', 'age'], 'number'),
    field('basic.idType', ['证件类型', '身份证件类型', '证件类别', 'idtype'], 'choice'),
    field('basic.idNumber', ['证件号码', '身份证号', '身份证号码', '居民身份证号码', 'idnumber', 'idcard']),
    field('basic.political', ['政治面貌', '政治身份', '党派', 'politicalstatus'], 'choice'),
    field('basic.healthStatus', ['健康状况', '身体健康状况', '健康情况', '身体状况', '健康状态', 'healthstatus', 'physicalhealthstatus', 'healthcondition'], 'choice'),
    field('basic.ethnicity', ['民族', '民族名称', 'ethnicity', 'nation'], 'choice'),
    field('basic.nationality', ['国籍', '国家或地区', 'nationality', 'country'], 'choice'),
    // Region controls and free-form street addresses are different semantics.
    // Keep basic.hometown as the legacy catch-all path, but route the explicit
    // hierarchical labels below to dedicated canonical fields.
    field('basic.birthplaceRegion', ['出生地', '出生地区', '出生所在地', '出生区域', 'birthplaceregion']),
    field('basic.hometownRegion', ['籍贯地所在地', '籍贯地区', '籍贯地区（级联）', '籍贯区域', 'hometownregion']),
    field('basic.householdRegion', ['户口所在地', '户口所在地区', '户籍所在地区', '户口区域', '户籍区域', 'householdregion']),
    field('basic.hometown', ['籍贯', '生源地', '户籍所在地', 'hometown']),
    field('basic.hometownProvince', ['籍贯省份', '生源省份', '户籍省份']),
    field('basic.hometownCity', ['籍贯城市', '生源城市', '户籍城市']),
    field('basic.marital', ['婚姻状况', '婚否', 'maritalstatus'], 'choice'),
    field('basic.militaryStatus', ['现役军人码', '是否现役军人', '现役军人', '军人状态', '军人类别', 'militarystatus'], 'choice'),
    field('basic.householdAddress', ['户口所在地详细地址', '户籍所在地详细地址', '户口详细地址', '户籍详细地址', 'householdaddress', 'registeredaddress']),
    field('basic.height', ['身高', '身高cm', 'height'], 'number'),

    // 联系方式
    field('contact.phone', ['手机号', '手机号码', '联系电话', '联系电话手机', '移动电话', '手机', 'mobile', 'phone', 'tel']),
    field('contact.landline', ['固定电话', '住宅电话', '座机', '座机号码', 'landline', 'fixedphone']),
    field('contact.email', ['邮箱', '电子邮箱', '电子信箱', '电子信箱地址', '考生电子邮箱', '电子邮件', '邮件地址', 'email', 'e-mail']),
    field('contact.address', ['通讯地址', '通信地址', '联系地址', '现居地址', '详细地址', '邮寄地址', 'address']),
    field('contact.currentCity', ['现居城市', '现居城市（省/市/区）', '当前城市', '居住城市', 'currentcity']),
    field('contact.postcode', ['通信地址邮政编码', '通讯地址邮政编码', '通信地址邮编', '通讯地址邮编', '邮政编码', '邮编', 'postcode', 'zipcode']),
    field('contact.archiveOrganization', ['档案所在单位', '人事档案所在单位', '档案保管单位', 'archiveorganization', 'archiveunit']),
    field('contact.archiveRegion', ['档案所在地', '档案所在地区', '人事档案所在地', '档案区域', 'archiveregion']),
    field('contact.archiveAddress', ['档案所在单位地址', '人事档案所在单位地址', '档案保管单位地址', 'archiveaddress']),
    field('contact.archivePostcode', ['档案所在单位邮政编码', '档案所在单位邮编', '档案保管单位邮编', 'archivepostcode']),
    field('contact.wechat', ['微信', '微信号', 'wechat', 'weixin']),
    field('contact.qq', ['QQ', 'QQ号', '腾讯QQ']),
    field('contact.emergencyName', ['紧急联系人', '紧急联系人姓名']),
    field('contact.emergencyPhone', ['紧急联系电话', '紧急联系人电话', '紧急联系人手机']),

    // 家庭成员
    field('family[].name', ['家庭主要成员姓名', '主要社会关系姓名', '家庭成员姓名', '成员姓名', '姓名', '家长姓名']),
    field('family[].relationship', ['与本人关系', '与考生关系', '与申请人关系', '亲属关系', '家庭关系', '社会关系', '关系', '称谓'], 'choice'),
    field('family[].employer', ['工作或学习单位', '学习或工作单位', '工作单位', '所在单位', '单位名称', '家庭成员单位', '成员工作单位']),
    field('family[].position', ['职务或职业', '职业及职务', '担任职务', '职务', '职业', '岗位', '家庭成员职务']),
    field('family[].employerPosition', ['在何单位工作任何职务', '在何单位工作，任何职务', '工作单位及职务', '单位及职务', '所在单位及职务', '在何单位任何职', '工作单位和职务']),
    field('family[].phone', ['成员联系电话', '联系电话（手机）', '联系电话手机', '联系电话', '手机号码', '移动电话', '成员电话']),
    field('family[].address', ['家庭成员通讯地址', '成员通讯地址', '家庭住址', '家庭成员地址', '通讯地址', '联系地址']),
    field('family[].political', ['政治面貌', '成员政治面貌'], 'choice'),
    field('family[].description', ['家庭情况说明', '家庭成员描述', '家庭情况'], 'textarea'),

    // 教育经历
    field('education[].schoolCode', ['所在学校代码', '学校代码', '院校代码', '毕业院校代码', 'schoolcode']),
    field('education[].school', ['所在学校', '所在学校名称', '学校', '学校名称', '毕业院校', '就读院校', '本科院校', '本科学校', '院校名称', 'university', 'school']),
    field('education[].college', ['所在院系', '所在学院', '学院', '院系', '院系名称', '院系所', 'department', 'faculty']),
    field('education[].major', ['所在专业', '专业', '专业名称', '所学专业', '本科专业', 'major']),
    field('education[].degree', ['学位', '获得学位', '学位类型', 'degree'], 'choice'),
    field('education[].educationLevel', ['学历', '学历层次', '教育层次', '最高学历', 'educationlevel'], 'choice'),
    field('education[].enrollmentDate', ['入学年月', '入学时间', '入学日期', '入校时间', '入校年月'], 'date'),
    field('education[].graduationDate', ['预计毕业年月', '预计毕业时间', '毕业年月', '毕业时间', '毕业日期'], 'date'),
    field('education[].studyDuration', ['本科学制', '学制', '本科就读年限', '学制年限'], 'choice'),
    field('education[].cet4Score', ['大学英语四级成绩', '英语四级成绩', '四级成绩', 'CET4', 'CET-4']),
    field('education[].cet6Score', ['大学英语六级成绩', '英语六级成绩', '六级成绩', 'CET6', 'CET-6']),
    field('education[].eliteTrainingBase', ['是否来自拔尖人才培养基地', '是否为拔尖人才培养基地学生', '是否拔尖人才培养基地', '拔尖人才培养基地'], 'choice'),
    field('education[].eliteTrainingBaseName', ['拔尖人才培养基地名称', '拔尖人才基地名称', '人才培养基地名称']),
    field('education[].majorRankPercent', ['总评成绩在所学专业同年级的排名（百分比）', '总评成绩在所学专业同年级的排名百分比', '专业同年级排名百分比', '专业排名百分比']),
    // 旧 JobFill 路径继续保留；明确的入学/毕业标签优先映射到上面的 canonical 字段。
    field('education[].startDate', ['开始时间', '起始年月', '就读开始时间'], 'date'),
    field('education[].endDate', ['结束时间', '就读结束时间'], 'date'),
    field('education[].gpa', ['成绩绩点', '总绩点', '本科 GPA', '本科GPA', 'GPA', '本科绩点', '平均绩点', '绩点', '平均学分绩点']),
    field('education[].gpaScale', ['绩点满分', '满绩点', 'GPA满分', '绩点总分', '绩点满分值']),
    field('education[].percentageScore', ['百分制成绩', '百分制分数', '换算百分制成绩', '平均成绩', '平均分']),
    field('education[].majorRank', ['总评成绩在所学专业同年级的排名（整数）', '总评成绩在所学专业同年级的排名', '申请人专业排名', '专业成绩排名', '专业排名', '专业名次', '年级排名']),
    field('education[].majorRankTotal', ['申请人所在专业总人数', '所在专业同年级人数', '专业同年级人数', '专业排名总人数', '专业总人数', '排名总人数', '专业人数', '年级人数']),
    field('education[].rank', ['成绩排名', '班级排名', '综合排名', '排名']),
    field('education[].studentId', ['在校生注册学号', '注册学号', '学籍号', '学号', '本科生学号', 'studentid']),
    field('education[].mode', ['学习形式', '培养方式', '学习方式'], 'choice'),
    field('education[].advisor', ['导师', '指导教师', '指导老师', 'advisor', 'supervisor']),
    field('education[].researchDirection', ['研究方向', '专业方向', '研究领域']),
    field('education[].thesis', ['毕业论文题目', '本科论文题目', '学位论文题目']),

    // 奖励与处分；兼容层会把旧 content/time 映射到 name/date。
    field('awards[].name', ['获奖名称', '奖励名称', '奖项名称', '荣誉名称', '奖励内容', '获奖内容', '内容']),
    field('awards[].date', ['获奖时间', '奖励时间', '获奖日期', '奖励日期', '时间', '日期'], 'date'),
    field('awards[].location', ['获奖地点', '奖励地点', '地点']),
    field(
      'awards[].category',
      ['奖励类别', '奖项类别', '荣誉类别', '奖学金类别'],
      'choice',
      // “类别”在其他栏目也很常见；只有已建立 awards 上下文时才使用该短别名。
      { sectionAliases: ['类别'] },
    ),
    field('awards[].level', ['竞赛级别', '奖项级别', '奖励级别', '获奖级别', '级别'], 'choice'),
    field('awards[].rank', ['获奖等级', '奖项等级', '奖励等级', '等次'], 'choice'),
    field('awards[].participationMode', ['个人/团队', '个人团队', '参赛形式', '参赛方式'], 'choice'),
    field('awards[].individualRank', ['个人排名', '个人名次']),
    field('awards[].teamRank', ['排名（排名/团队人数，单人奖项填写1/1）', '排名(排名/团队人数，单人奖项填写1/1)', '排名/团队人数', '团队排名', '获奖排名', '名次']),
    field('awards[].organizer', ['主办单位', '颁奖单位', '授予单位', '组织单位']),
    field('awards[].note', ['奖励备注', '获奖说明', '备注'], 'textarea'),

    // 科研经历
    field('research[].name', ['科研项目名称', '科研名称', '课题名称', '项目名称', '研究项目', '名称']),
    field('research[].organization', ['科研单位', '项目单位', '依托单位', '实验室']),
    field('research[].role', ['科研角色', '承担角色', '项目角色', '本人分工', '担任角色']),
    field('research[].startDate', ['科研开始时间', '项目开始时间', '开始时间'], 'date'),
    field('research[].endDate', ['科研结束时间', '项目结束时间', '结束时间'], 'date'),
    field('research[].description', ['科研内容', '研究内容', '项目简介', '科研经历描述', '项目描述'], 'textarea'),
    field('research[].outcome', ['科研成果', '研究成果', '项目成果', '结题成果'], 'textarea'),
    field('research[].advisor', ['指导教师', '指导老师', '科研指导教师', '项目指导教师', '导师']),
    field('research[].level', ['科研级别', '项目级别', '课题级别', '级别'], 'choice'),
    field('research[].contribution', ['主要贡献', '本人主要贡献', '科研主要贡献', '个人贡献', '本人贡献', '承担工作'], 'textarea'),

    // 项目经历
    field('projects[].name', ['项目名称', '项目题目', '创新项目名称', 'projectname']),
    field('projects[].role', ['项目角色', '担任角色', '本人分工', '项目职务']),
    field('projects[].startDate', ['项目开始时间', '开始日期', '开始时间'], 'date'),
    field('projects[].endDate', ['项目结束时间', '结束日期', '结束时间'], 'date'),
    field('projects[].organization', ['项目单位', '所属单位', '依托单位']),
    field('projects[].description', ['项目描述', '项目内容', '项目简介', '负责内容'], 'textarea'),
    field('projects[].result', ['项目成果', '项目产出', '取得成果'], 'textarea'),

    // 论文
    field('papers[].title', ['论文标题', '论文题目', '文章标题', '论文名称', '成果名称', 'title']),
    field('papers[].journal', ['期刊', '期刊名称', '会议名称', '发表刊物', '发表刊物或出版社', '出版社', 'journal']),
    field('papers[].journalType', ['期刊类型', '刊物类型', '发表类型', '收录类型'], 'choice'),
    field('papers[].date', ['发表时间', '发表日期', '论文时间', '出版时间', '时间'], 'date'),
    field('papers[].authorRank', ['作者排名', '本人排名', '作者位次', '署名顺序']),
    field('papers[].status', ['论文状态', '发表状态', '收录状态'], 'choice'),
    field('papers[].doi', ['DOI', '论文DOI']),
    field('papers[].impactFactor', ['影响因子', '期刊影响因子', '影响因子IF', 'impactfactor'], 'number'),
    field('papers[].description', ['论文摘要', '论文简介', '论文说明'], 'textarea'),

    // 专利
    field('patents[].name', ['专利名称', '专利题目', '发明名称']),
    field('patents[].number', ['专利号', '申请号', '授权号', '专利编号']),
    field('patents[].type', ['专利类型', '专利类别'], 'choice'),
    field('patents[].date', ['专利日期', '申请日期', '授权日期'], 'date'),
    field('patents[].inventorRank', ['发明人排名', '本人排名', '发明人位次']),
    field('patents[].status', ['专利状态', '申请状态', '授权状态'], 'choice'),

    // 社会实践
    field('practice[].name', ['实践名称', '社会实践名称', '活动名称']),
    field('practice[].organization', ['实践单位', '组织单位', '活动单位']),
    field('practice[].role', ['实践角色', '担任职务', '本人分工']),
    field('practice[].startDate', ['实践开始时间', '开始时间'], 'date'),
    field('practice[].endDate', ['实践结束时间', '结束时间'], 'date'),
    field('practice[].location', ['实践地点', '活动地点', '实习实践地点', '地点']),
    field('practice[].description', ['实践内容', '实践经历', '活动内容', '实践描述', '主要内容'], 'textarea'),

    // 实习
    field('internships[].company', ['学校或工作单位', '学习或工作单位', '学校或单位', '实习单位', '实习公司', '公司名称', '工作单位', '单位名称']),
    field('internships[].position', ['担任职务', '所任职务', '实习岗位', '实习职位', '职位', '岗位', '职务']),
    field('internships[].startDate', ['起始时间', '起止时间开始', '实习开始时间', '入职时间', '开始时间'], 'date'),
    field('internships[].endDate', ['结束时间', '起止时间结束', '实习结束时间', '离职时间'], 'date'),
    field('internships[].location', ['实习地点', '工作地点', '地点']),
    field('internships[].description', ['实习内容', '工作内容', '岗位职责', '实习描述'], 'textarea'),

    // 学生工作
    field('student_work[].organization', ['学生组织', '组织名称', '社团名称', '部门名称']),
    field('student_work[].position', ['学生干部职务', '担任职务', '任职岗位', '职务']),
    field('student_work[].startDate', ['任职开始时间', '开始时间'], 'date'),
    field('student_work[].endDate', ['任职结束时间', '结束时间'], 'date'),
    field('student_work[].description', ['学生工作内容', '任职经历', '主要工作', '工作描述'], 'textarea'),

    // 证书
    field('certificates[].name', ['证书名称', '资格证书', '技能证书', '证书']),
    field('certificates[].number', ['证书编号', '证书号码', '资格证号']),
    field('certificates[].date', ['取得时间', '发证日期', '证书日期'], 'date'),
    field('certificates[].issuer', ['发证单位', '颁发机构', '认证机构']),
    field('certificates[].level', ['证书等级', '资格等级', '级别'], 'choice'),

    // 外语
    field('language[].language', ['语种', '外语类型', '外语语种', '语言', 'language'], 'choice'),
    field('language[].certificate', ['外语证书', '英语证书', '考试名称', '外语考试', '证书考试']),
    field('language[].score', ['外语成绩', '英语成绩', '考试分数', '分数', 'score']),
    field('language[].examDate', ['考试时间', '考试日期', '取得时间'], 'date'),
    field('language[].level', ['外语水平', '语言水平', '熟练程度', '等级'], 'choice'),
    field('language[].listeningSpeaking', ['听说能力', '听力口语', '口语水平'], 'choice'),
    field('language[].readingWriting', ['读写能力', '阅读写作', '写作水平'], 'choice'),

    // 技能：保留旧 JobFill 的 skills 对象路径。
    field('skills.tech', ['专业技能', '技术技能', '计算机技能', '技能特长', '技术栈'], 'textarea'),
    field('skills.computer', ['计算机水平', '计算机能力', '计算机等级'], 'textarea'),
    field('skills.workplace', ['综合能力', '职场技能', '其他能力'], 'textarea'),
    field('skills.interests', ['兴趣爱好', '个人爱好', '特长爱好'], 'textarea'),

    // Application-only text is intentionally separate from resume intro/notes.
    // Legal/declaration acknowledgements are deliberately not represented here.
    field('application.disciplinaryHistory', ['作弊处分等情况', '作弊处分等情况200字以内', '作弊或处分情况', '违纪处分情况', '处分情况'], 'textarea'),
    field('application.personalStatement', ['个人陈述', '个人陈述1000字以内', '申请个人陈述', 'personalstatement'], 'textarea'),
    field('application.notes', ['备注信息', '备注信息1000字以内', '申请备注', '补充说明'], 'textarea'),
  ]);

  const FIELD_ALIASES = Object.freeze(Object.fromEntries(
    FIELD_DEFINITIONS.map(definition => [definition.path, definition.aliases]),
  ));
  const FIELD_TYPES = Object.freeze(Object.fromEntries(
    FIELD_DEFINITIONS.map(definition => [definition.path, definition.type]),
  ));

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function normalizeFieldText(value) {
    return safeString(value)
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/[\s\u00a0:：*（）()【】\[\]{}<>《》,，.。;；、!！?？“”‘’·…—–_\-/\\]+/g, '')
      .toLowerCase();
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function firstArray(...values) {
    return values.find(Array.isArray) || [];
  }

  function firstPopulatedArray(...values) {
    return values.find(value => Array.isArray(value) && value.length > 0) || firstArray(...values);
  }

  function nonEmpty(value, fallback = '') {
    return value !== null && value !== undefined && value !== '' ? value : fallback;
  }

  function firstNonEmpty(...values) {
    const value = values.find(candidate => candidate !== null && candidate !== undefined && candidate !== '');
    return value === undefined ? '' : value;
  }

  function canonicalFirst(source, canonical, ...fallbacks) {
    if (isRecord(source)
        && Object.prototype.hasOwnProperty.call(source, canonical)
        && source[canonical] !== undefined) {
      return source[canonical] === null ? '' : source[canonical];
    }
    return firstNonEmpty(...fallbacks);
  }

  function joinDisplayParts(...values) {
    return [...new Set(values.map(safeString).filter(Boolean))].join(' / ');
  }

  function mergeRecords(base, override) {
    return { ...(isRecord(base) ? base : {}), ...(isRecord(override) ? override : {}) };
  }

  function normalizeAward(item) {
    const source =
      isRecord(item)
        ? item
        : {};

    const teamRank =
      firstNonEmpty(
        source.teamRank,
        source.team_rank,
        source.ranking
      );
    const participationMode =
      firstNonEmpty(
        source.participationMode,
        source.participation_mode
      );
    const individualRank =
      firstNonEmpty(
        source.individualRank,
        source.individual_rank
      );
    const category =
      canonicalFirst(
        source,
        'category',
        source.awardCategory,
        source.award_category,
        source.rewardCategory,
        source.reward_category,
        source.honorCategory,
        source.honor_category
      );

    return {
      ...source,

      name:
        nonEmpty(
          source.name,
          source.content
        ),

      date:
        nonEmpty(
          source.date,
          source.time
        ),

      content:
        nonEmpty(
          source.content,
          source.name
        ),

      time:
        nonEmpty(
          source.time,
          source.date
        ),

      ...(category !== ''
        ? { category }
        : {}),

      ...(teamRank !== ''
        ? { teamRank }
        : {}),

      ...(participationMode !== ''
        ? { participationMode }
        : {}),

      ...(individualRank !== ''
        ? { individualRank }
        : {}),
    };
  }

  function normalizeEducation(item) {
    const source =
      isRecord(item)
        ? item
        : {};

    const enrollmentDate =
      firstNonEmpty(
        source.enrollmentDate,
        source.enrollment_date,
        source.admissionDate,
        source.admission_date,
        source.startDate,
        source.start_date,
        source.start_time,
        source.begin_date,
        source.start
      );

    const graduationDate =
      firstNonEmpty(
        source.graduationDate,
        source.graduation_date,
        source.expectedGraduationDate,
        source.expected_graduation_date,
        source.endDate,
        source.end_date,
        source.end_time,
        source.finish_date,
        source.end
      );

    const majorRank =
      firstNonEmpty(
        source.majorRank,
        source.major_rank,
        source.professionalRank,
        source.professional_rank,
        source.rank,
        source.ranking
      );


    /*
    * 新增申请字段：
    *
    * 为了兼容旧 Resume JSON 和原有测试，
    * 只有源数据真正提供值时，
    * 才向归一化对象增加 canonical 字段。
    */
    const schoolCode =
      firstNonEmpty(
        source.schoolCode,
        source.school_code,
        source.schoolId,
        source.school_id
      );

    const studyDuration =
      firstNonEmpty(
        source.studyDuration,
        source.study_duration,
        source.duration,
        source.schoolingYears,
        source.schooling_years
      );

    const cet4Score =
      firstNonEmpty(
        source.cet4Score,
        source.cet4_score,
        source.cet4,
        source.CET4
      );

    const cet6Score =
      firstNonEmpty(
        source.cet6Score,
        source.cet6_score,
        source.cet6,
        source.CET6
      );

    const eliteTrainingBase =
      firstNonEmpty(
        source.eliteTrainingBase,
        source.elite_training_base,
        source.eliteBase,
        source.elite_base
      );

    const eliteTrainingBaseName =
      firstNonEmpty(
        source.eliteTrainingBaseName,
        source.elite_training_base_name,
        source.eliteBaseName,
        source.elite_base_name
      );

    const majorRankPercent =
      firstNonEmpty(
        source.majorRankPercent,
        source.major_rank_percent,
        source.rankPercent,
        source.rank_percent
      );


    return {
      ...source,

      /*
      * 新字段只在有值时创建。
      */
      ...(schoolCode !== ''
        ? { schoolCode }
        : {}),

      school:
        firstNonEmpty(
          source.school,
          source.school_name,
          source.university,
          source.institution,
          source.institution_name
        ),

      college:
        firstNonEmpty(
          source.college,
          source.college_name,
          source.department,
          source.department_name
        ),

      major:
        firstNonEmpty(
          source.major,
          source.major_name
        ),

      degree:
        firstNonEmpty(
          source.degree,
          source.academic_degree
        ),

      educationLevel:
        firstNonEmpty(
          source.educationLevel,
          source.education_level,
          source.degree
        ),

      enrollmentDate,

      graduationDate,

      ...(studyDuration !== ''
        ? { studyDuration }
        : {}),

      ...(cet4Score !== ''
        ? { cet4Score }
        : {}),

      ...(cet6Score !== ''
        ? { cet6Score }
        : {}),

      ...(eliteTrainingBase !== ''
        ? { eliteTrainingBase }
        : {}),

      ...(eliteTrainingBaseName !== ''
        ? { eliteTrainingBaseName }
        : {}),

      ...(majorRankPercent !== ''
        ? { majorRankPercent }
        : {}),

      startDate:
        firstNonEmpty(
          source.startDate,
          source.start_date,
          enrollmentDate
        ),

      endDate:
        firstNonEmpty(
          source.endDate,
          source.end_date,
          graduationDate
        ),

      gpa:
        firstNonEmpty(
          source.gpa,
          source.gradePoint,
          source.grade_point,
          source.totalGpa,
          source.total_gpa,
          source.total_grade_point
        ),

      gpaScale:
        firstNonEmpty(
          source.gpaScale,
          source.gpa_scale,
          source.gpaFullScore,
          source.gpa_full_score,
          source.gradePointScale,
          source.grade_point_scale
        ),

      percentageScore:
        firstNonEmpty(
          source.percentageScore,
          source.percentage_score,
          source.percentScore,
          source.percent_score,
          source.averageScore,
          source.average_score
        ),

      majorRank,

      majorRankTotal:
        firstNonEmpty(
          source.majorRankTotal,
          source.major_rank_total,
          source.professionalRankTotal,
          source.professional_rank_total,
          source.rankTotal,
          source.rank_total,
          source.majorStudentCount,
          source.major_student_count
        ),

      rank:
        firstNonEmpty(
          source.rank,
          source.class_rank,
          source.ranking,
          majorRank
        ),

      studentId:
        firstNonEmpty(
          source.studentId,
          source.student_id,
          source.studentNo,
          source.student_no,
          source.student_number,
          source.registration_number
        ),

      mode:
        firstNonEmpty(
          source.mode,
          source.study_mode
        ),

      advisor:
        firstNonEmpty(
          source.advisor,
          source.supervisor
        ),

      researchDirection:
        firstNonEmpty(
          source.researchDirection,
          source.research_direction,
          source.research
        ),

      thesis:
        firstNonEmpty(
          source.thesis,
          source.thesis_title
        ),
    };
  }

  function normalizeFamily(item) {
    const source = isRecord(item) ? item : {};
    const employer = firstNonEmpty(source.employer, source.employer_name, source.workUnit, source.work_unit,
      source.workplace, source.company, source.company_name, source.unit, source.organization);
    const position = firstNonEmpty(source.position, source.jobTitle, source.job_title, source.job,
      source.occupation, source.profession, source.duty);
    const explicitEmployerPosition = firstNonEmpty(source.employerPosition, source.employer_position,
      source.employerAndPosition, source.employer_and_position, source.workUnitPosition,
      source.work_unit_position, source.workUnitAndPosition, source.work_unit_and_position,
      source.unitAndPosition, source.unit_and_position, source.organizationAndPosition,
      source.organization_and_position, source.companyAndPosition, source.company_and_position);
    const address = firstNonEmpty(source.address, source.mailingAddress, source.mailing_address,
      source.contactAddress, source.contact_address, source.residentialAddress, source.residential_address);
    return {
      ...source,
      name: firstNonEmpty(source.name, source.memberName, source.member_name, source.full_name),
      relationship: firstNonEmpty(source.relationship, source.relation, source.relation_to_me,
        source.relationship_type, source.relationship_to_applicant, source.relationship_to_student),
      employer,
      position,
      employerPosition: safeString(explicitEmployerPosition) || joinDisplayParts(employer, position),
      phone: firstNonEmpty(source.phone, source.mobile, source.mobile_phone, source.phone_number,
        source.contactPhone, source.contact_phone, source.telephone, source.tel),
      ...(address !== '' ? { address } : {}),
      political: firstNonEmpty(source.political, source.political_status),
      description: firstNonEmpty(source.description, source.desc),
    };
  }

  function normalizeResearch(item) {
    const source =
      isRecord(item)
        ? item
        : {};

    const dated =
      normalizeDatedItem(source);

    const name =
      firstNonEmpty(
        source.name,
        source.projectName,
        source.project_name,
        source.title
      );

    const advisor =
      firstNonEmpty(
        source.advisor,
        source.supervisor,
        source.teacher,
        source.mentor
      );

    const level =
      firstNonEmpty(
        source.level,
        source.projectLevel,
        source.project_level
      );

    const contribution =
      firstNonEmpty(
        source.contribution,
        source.mainContribution,
        source.main_contribution,
        source.description,
        source.desc
      );

    return {
      ...dated,

      ...(name !== ''
        ? { name }
        : {}),

      ...(advisor !== ''
        ? { advisor }
        : {}),

      ...(level !== ''
        ? { level }
        : {}),

      ...(contribution !== ''
        ? { contribution }
        : {}),
    };
  }

  function normalizePractice(item) {
    const source =
      isRecord(item)
        ? item
        : {};

    const dated =
      normalizeDatedItem(source);

    const location =
      firstNonEmpty(
        source.location,
        source.place,
        source.address
      );

    const description =
      firstNonEmpty(
        source.description,
        source.desc,
        source.content,
        source.mainContent,
        source.main_content
      );

    return {
      ...dated,

      ...(location !== ''
        ? { location }
        : {}),

      description,
    };
  }

  function normalizeDatedItem(item) {
    const source = isRecord(item) ? item : {};
    return {
      ...source,
      startDate: firstNonEmpty(source.startDate, source.start_date, source.start_time, source.begin_date, source.start),
      endDate: firstNonEmpty(source.endDate, source.end_date, source.end_time, source.finish_date, source.end),
      description: firstNonEmpty(source.description, source.desc),
      organization: firstNonEmpty(source.organization, source.organization_name, source.company,
        source.company_name, source.employer, source.unit),
    };
  }

  function normalizeInternship(item) {
    const source = isRecord(item) ? item : {};
    const dated = normalizeDatedItem(source);
    return {
      ...dated,
      company: firstNonEmpty(source.company, source.company_name, source.schoolOrWorkUnit,
        source.school_or_work_unit, source.school_or_company, source.organization, source.organization_name,
        source.employer, source.workplace, source.work_unit, source.unit, source.school),
      position: firstNonEmpty(source.position, source.jobPosition, source.job_position, source.jobTitle,
        source.job_title, source.job, source.occupation, source.role, source.duty, source.title),
      location: firstNonEmpty(source.location, source.work_location, source.address),
    };
  }

  function internshipSourceItems(source) {
    if (Array.isArray(source.internships) && source.internships.length) return source.internships;
    const legacyArrays = [
      source.studyWorkExperience,
      source.study_work_experience,
      source.learningAndWorkExperience,
      source.learning_and_work_experience,
      source.learningWorkExperience,
      source.learning_work_experience,
      source.workExperience,
      source.work_experience,
      source.workHistory,
      source.work_history,
      source.experience,
      source.experiences,
      source.internship,
      source.work,
    ].filter(Array.isArray);

    // Original JobFill kept internship[] and work[] separately. Merge all legacy
    // sources into the canonical view, while suppressing identical compatibility
    // copies produced by older exporters.
    const result = [];
    const signatures = new Set();
    legacyArrays.forEach(items => items.forEach(item => {
      const normalized = normalizeInternship(item);
      const signature = [
        normalized.startDate,
        normalized.endDate,
        normalized.company,
        normalized.position,
        normalized.location,
        normalized.description,
      ].map(value => safeString(value).toLowerCase()).join('\u0001');
      if (signature.replace(/\u0001/g, '') && signatures.has(signature)) return;
      if (signature.replace(/\u0001/g, '')) signatures.add(signature);
      result.push(item);
    }));
    return result;
  }

  function normalizeLanguage(item) {
    const source = isRecord(item) ? item : {};
    const language = firstNonEmpty(source.language, source.languageType, source.language_type, source.type);
    const certificate = firstNonEmpty(source.certificate, source.exam, source.examName, source.exam_name);
    const score = firstNonEmpty(source.score, source.result);
    return {
      ...source,
      ...(language !== '' ? { language } : {}),
      ...(certificate !== '' ? { certificate } : {}),
      ...(score !== '' ? { score } : {}),
      examDate: nonEmpty(source.examDate, source.exam_date),
      listeningSpeaking: nonEmpty(source.listeningSpeaking, nonEmpty(source.listening_speaking, source.speaking)),
      readingWriting: nonEmpty(source.readingWriting, nonEmpty(source.reading_writing, source.writing)),
    };
  }

  function normalizeApplication(value) {
    const source = isRecord(value) ? value : {};
    return {
      ...source,
      disciplinaryHistory: canonicalFirst(
        source,
        'disciplinaryHistory',
        source.disciplinary_history,
        source.disciplineHistory,
        source.discipline_history
      ),
      personalStatement: canonicalFirst(
        source,
        'personalStatement',
        source.personal_statement
      ),
      notes: canonicalFirst(
        source,
        'notes',
        source.applicationNotes,
        source.application_notes
      ),
    };
  }

  function legacyCertificates(skills) {
    const text = safeString(isRecord(skills) ? skills.certificates : '');
    if (!text) return [];
    return text.split(/[\n；;]+/).map(name => name.trim()).filter(Boolean).map(name => ({ name }));
  }

  /**
   * 生成只读语义视图。不会修改或删除用户原始 Resume JSON 字段。
   */
  function buildResumeView(rawResume = {}) {
    const source = isRecord(rawResume) ? rawResume : {};
    const personal = isRecord(source.personal) ? source.personal : {};
    const sourceBasic = isRecord(source.basic) ? source.basic : {};
    const basic = mergeRecords({
      name: personal.name,
      namePinyin: nonEmpty(personal.namePinyin, nonEmpty(personal.name_pinyin, personal.pinyin)),
      gender: personal.gender,
      birthday: personal.birthday,
      age: personal.age,
      idType: canonicalFirst(
        personal,
        'idType',
        personal.id_type,
        personal.documentType,
        personal.document_type,
        personal.certificateType,
        personal.certificate_type
      ),
      idNumber: personal.id_number,
      political: personal.political,
      healthStatus: firstNonEmpty(personal.healthStatus, personal.health_status,
        personal.physicalHealthStatus, personal.physical_health_status,
        personal.healthCondition, personal.health_condition, personal.health),
      ethnicity: nonEmpty(personal.ethnicity, personal.nation),
      nationality: personal.nationality,
      hometown: [personal.hometown_province, personal.hometown_city].filter(Boolean).join(''),
      birthplaceRegion: canonicalFirst(
        personal,
        'birthplaceRegion',
        personal.birthplace_region,
        personal.birthplace,
        personal.birth_place,
        personal.place_of_birth
      ),
      hometownRegion: canonicalFirst(
        personal,
        'hometownRegion',
        personal.hometown_region,
        personal.hometown
      ),
      householdRegion: canonicalFirst(
        personal,
        'householdRegion',
        personal.household_region,
        personal.hukou_region,
        personal.registered_region
      ),
      hometownProvince: personal.hometown_province,
      hometownCity: personal.hometown_city,
      marital: nonEmpty(personal.marital, personal.marital_status),
      militaryStatus: nonEmpty(personal.militaryStatus, personal.military_status),
      householdAddress: nonEmpty(personal.householdAddress,
        nonEmpty(personal.household_address, nonEmpty(personal.hukou_address, personal.registered_address))),
      height: personal.height,
      photo: personal.photo,
    }, sourceBasic);
    basic.birthday = nonEmpty(basic.birthday, basic.birth_date);
    basic.idType = canonicalFirst(
      sourceBasic,
      'idType',
      basic.idType,
      basic.id_type,
      basic.documentType,
      basic.document_type,
      basic.certificateType,
      basic.certificate_type
    );
    basic.idNumber = nonEmpty(basic.idNumber, basic.id_number);
    basic.namePinyin = nonEmpty(basic.namePinyin, nonEmpty(basic.name_pinyin, basic.pinyin));
    basic.political = nonEmpty(basic.political, basic.political_status);
    basic.healthStatus = firstNonEmpty(basic.healthStatus, basic.health_status,
      basic.physicalHealthStatus, basic.physical_health_status,
      basic.healthCondition, basic.health_condition, basic.health);
    basic.ethnicity = nonEmpty(basic.ethnicity, basic.nation);
    basic.hometownProvince = nonEmpty(basic.hometownProvince, basic.hometown_province);
    basic.hometownCity = nonEmpty(basic.hometownCity, basic.hometown_city);
    basic.birthplaceRegion = canonicalFirst(
      sourceBasic,
      'birthplaceRegion',
      basic.birthplaceRegion,
      basic.birthplace_region,
      basic.birthplace,
      basic.birth_place,
      basic.place_of_birth
    );
    // The old hometown string is the one explicit region fallback. Never reuse
    // householdAddress or any other detailed-address field as a region source.
    basic.hometownRegion = canonicalFirst(
      sourceBasic,
      'hometownRegion',
      basic.hometownRegion,
      basic.hometown_region,
      basic.hometown
    );
    basic.householdRegion = canonicalFirst(
      sourceBasic,
      'householdRegion',
      basic.householdRegion,
      basic.household_region,
      basic.hukou_region,
      basic.registered_region
    );
    basic.marital = nonEmpty(basic.marital, basic.marital_status);
    basic.militaryStatus = nonEmpty(basic.militaryStatus, basic.military_status);
    basic.householdAddress = nonEmpty(basic.householdAddress,
      nonEmpty(basic.household_address, nonEmpty(basic.hukou_address, basic.registered_address)));
    const sourceContact = isRecord(source.contact) ? source.contact : {};
    const contact = mergeRecords({
      phone: nonEmpty(personal.phone, personal.mobile),
      landline: nonEmpty(personal.landline, nonEmpty(personal.telephone, personal.fixed_phone)),
      email: personal.email,
      address: nonEmpty(personal.address, nonEmpty(personal.mailing_address, personal.contact_address)),
      currentCity: personal.current_city,
      postcode: nonEmpty(personal.postcode, nonEmpty(personal.postal_code, personal.zip_code)),
      archiveOrganization: nonEmpty(personal.archiveOrganization,
        nonEmpty(personal.archive_organization, personal.archive_unit)),
      archiveRegion: canonicalFirst(personal, 'archiveRegion', personal.archive_region),
      archiveAddress: nonEmpty(personal.archiveAddress, personal.archive_address),
      archivePostcode: nonEmpty(personal.archivePostcode, personal.archive_postcode),
      wechat: personal.wechat,
      qq: personal.qq,
      emergencyName: personal.emergency_name,
      emergencyPhone: canonicalFirst(
        personal,
        'emergencyPhone',
        personal.emergency_phone,
        personal.emergencyContactPhone,
        personal.emergency_contact_phone
      ),
    }, sourceContact);
    contact.currentCity = nonEmpty(contact.currentCity, contact.current_city);
    contact.phone = nonEmpty(contact.phone, contact.mobile);
    contact.landline = nonEmpty(contact.landline, nonEmpty(contact.fixed_phone, contact.telephone));
    contact.address = nonEmpty(contact.address, nonEmpty(contact.mailing_address, contact.contact_address));
    contact.postcode = nonEmpty(contact.postcode, nonEmpty(contact.postal_code, contact.zip_code));
    contact.archiveOrganization = nonEmpty(contact.archiveOrganization,
      nonEmpty(contact.archive_organization, contact.archive_unit));
    contact.archiveRegion = canonicalFirst(
      sourceContact,
      'archiveRegion',
      contact.archiveRegion,
      contact.archive_region
    );
    contact.archiveAddress = nonEmpty(contact.archiveAddress, contact.archive_address);
    contact.archivePostcode = nonEmpty(contact.archivePostcode, contact.archive_postcode);
    contact.emergencyName = nonEmpty(contact.emergencyName, contact.emergency_name);
    contact.emergencyPhone = canonicalFirst(
      sourceContact,
      'emergencyPhone',
      contact.emergencyPhone,
      contact.emergency_phone,
      contact.emergencyContactPhone,
      contact.emergency_contact_phone
    );

    const familyItems = firstPopulatedArray(
      source.family,
      source.families,
      source.familyMembers,
      source.family_members,
      source.familyRelationships,
      source.family_relationships,
      source.majorSocialRelations,
      source.major_social_relations,
    );
    const family = familyItems.length
      ? familyItems.map(normalizeFamily)
      : safeString(source.family) ? [{ description: safeString(source.family) }] : [];
    const certificates = firstArray(source.certificates);
    const resolvedCertificates = certificates.length ? certificates : legacyCertificates(source.skills);

    return {
      ...source,
      basic,
      contact,
      family,
      education: firstPopulatedArray(
        source.education,
        source.educations,
        source.educationExperience,
        source.education_experience,
        source.studyInformation,
        source.study_information,
      ).map(normalizeEducation),
      awards: firstArray(source.awards).map(normalizeAward),
      research: firstArray(source.research).map(normalizeResearch),
      projects: firstArray(source.projects).map(normalizeDatedItem),
      papers: firstArray(source.papers).map(item => {
        const value = isRecord(item) ? item : {};
        return {
          ...value,
          journalType: firstNonEmpty(
            value.journalType,
            value.journal_type,
            value.journalCategory,
            value.journal_category,
            value.publicationType,
            value.publication_type
          ),
          authorRank: nonEmpty(value.authorRank, value.author_rank),
          impactFactor: firstNonEmpty(
            value.impactFactor,
            value.impact_factor,
            value.journalImpactFactor,
            value.journal_impact_factor
          ),
        };
      }),
      patents: firstArray(source.patents),
      practice: firstArray(source.practice).map(normalizePractice),
      // “学习和工作经历”统一归入 internships[]；旧键只在只读语义视图中兼容。
      internships: internshipSourceItems(source).map(normalizeInternship),
      student_work: firstArray(source.student_work, source.studentWork).map(normalizeDatedItem),
      certificates: resolvedCertificates,
      language: firstPopulatedArray(source.language, source.languages).map(normalizeLanguage),
      skills: Array.isArray(source.skills) ? source.skills : mergeRecords({}, source.skills),
      ...(isRecord(source.application) ? { application: normalizeApplication(source.application) } : {}),
    };
  }

  function sectionForPath(path) {
    return normalizeSectionKey(safeString(path).split(/[.\[]/, 1)[0]);
  }

  function normalizeSectionKey(section) {
    const value = safeString(section);
    return SECTION_KEY_MAP[value] || value;
  }

  function explicitArrayIndexFor(section, context = {}) {
    const normalizedSection = SECTION_KEY_MAP[section] || section;
    if (Number.isInteger(context)) return Math.max(0, context);
    if (!context || typeof context !== 'object') return null;
    if (Number.isInteger(context.arrayIndex)) return Math.max(0, context.arrayIndex);
    if (Number.isInteger(context.index)) return Math.max(0, context.index);
    const arrayContext = context.arrayContext;
    if (Number.isInteger(arrayContext)) return Math.max(0, arrayContext);
    if (arrayContext && typeof arrayContext === 'object') {
      if (Number.isInteger(arrayContext[normalizedSection])) return Math.max(0, arrayContext[normalizedSection]);
      const contextSection = SECTION_KEY_MAP[arrayContext.section] || arrayContext.section;
      if (contextSection === normalizedSection && Number.isInteger(arrayContext.index)) {
        return Math.max(0, arrayContext.index);
      }
    }
    return null;
  }

  function arrayIndexFor(section, context = {}) {
    return explicitArrayIndexFor(section, context) ?? 0;
  }

  /**
   * resolveValue(resume, path, context)；也兼容 resolveValue(path, resume, context)。
   */
  function resolveValue(resumeOrPath, pathOrResume, context = {}) {
    const reversed = typeof resumeOrPath === 'string';
    const path = reversed ? resumeOrPath : pathOrResume;
    const resume = reversed ? pathOrResume : resumeOrPath;
    if (!safeString(path)) return undefined;
    const view = context?.resumeView || buildResumeView(resume);
    const tokens = [];
    safeString(path).replace(/([^[.\]]+)|\[(\d*)\]/g, (_match, property, index) => {
      if (property) tokens.push(property);
      else tokens.push(index === '' ? '[]' : Number(index));
      return _match;
    });
    const section = SECTION_KEY_MAP[tokens[0]] || tokens[0];
    if (section !== tokens[0]) tokens[0] = section;
    const explicitIndex = explicitArrayIndexFor(section, context);
    // A flat page may safely view language[0] only when the Resume contains one
    // language row. Multiple rows need an established language group/type owner.
    if (
      section === 'language'
      && tokens.includes('[]')
      && Array.isArray(view?.language)
      && view.language.length > 1
      && explicitIndex === null
    ) {
      return undefined;
    }
    const defaultIndex = arrayIndexFor(section, context);
    let value = view;
    for (const token of tokens) {
      if (token === '[]') value = Array.isArray(value) ? value[defaultIndex] : undefined;
      else value = value?.[token];
      if (value === undefined || value === null) break;
    }
    return value;
  }

  function hasUsableValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  return {
    ARRAY_SECTIONS,
    FIELD_ALIASES,
    FIELD_DEFINITIONS,
    FIELD_TYPES,
    SECTION_KEY_MAP,
    buildResumeView,
    hasUsableValue,
    normalizeFieldText,
    normalizeSectionKey,
    resolveValue,
    sectionForPath,
  };
});
