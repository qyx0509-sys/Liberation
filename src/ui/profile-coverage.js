/* UI-only managed-field coverage. Never represents a school's application completion. */
(function initProfileCoverage(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFProfileCoverage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function profileCoverageFactory() {
  'use strict';
  const scalar = (section, id, label, ...paths) => ({ section, id, label, paths });
  const SCALARS = Object.freeze([
    scalar('personal', 'p_name', '姓名', 'basic.name', 'personal.name'),
    scalar('personal', 'p_namePinyin', '姓名拼音', 'basic.namePinyin', 'personal.namePinyin', 'personal.name_pinyin'),
    scalar('personal', 'p_gender', '性别', 'basic.gender', 'personal.gender'),
    scalar('personal', 'p_birthday', '出生日期', 'basic.birthday', 'personal.birthday', 'basic.birthDate'),
    scalar('personal', 'p_age', '年龄', 'basic.age', 'personal.age'),
    scalar('personal', 'p_phone', '手机号', 'basic.phone', 'personal.phone', 'contact.phone'),
    scalar('personal', 'p_email', '邮箱', 'basic.email', 'personal.email', 'contact.email'),
    scalar('personal', 'p_wechat', '微信号', 'basic.wechat', 'personal.wechat', 'contact.wechat'),
    scalar('personal', 'p_qq', 'QQ 号', 'basic.qq', 'personal.qq', 'contact.qq'),
    scalar('personal', 'p_idType', '证件类型', 'basic.idType', 'personal.idType'),
    scalar('personal', 'p_id_number', '证件号码', 'basic.id_number', 'personal.id_number', 'basic.idNumber'),
    scalar('personal', 'p_marital', '婚姻状况', 'basic.marital', 'personal.marital'),
    scalar('personal', 'p_healthStatus', '健康状况', 'basic.healthStatus', 'personal.healthStatus'),
    scalar('personal', 'p_political', '政治面貌', 'basic.political', 'personal.political'),
    scalar('personal', 'p_ethnicity', '民族', 'basic.ethnicity', 'personal.ethnicity'),
    scalar('personal', 'p_nationality', '国籍', 'basic.nationality', 'personal.nationality'),
    scalar('personal', 'p_height', '身高', 'basic.height', 'personal.height'),
    scalar('personal', 'p_birthplaceRegion', '出生地', 'basic.birthplaceRegion'),
    scalar('personal', 'p_hometown_province', '籍贯省份', 'basic.hometownProvince', 'personal.hometown_province'),
    scalar('personal', 'p_hometown_city', '籍贯城市', 'basic.hometownCity', 'personal.hometown_city'),
    scalar('personal', 'p_current_city', '现居城市', 'basic.current_city', 'personal.current_city', 'contact.currentCity'),
    scalar('personal', 'p_address', '现居地址', 'basic.address', 'personal.address'),
    scalar('personal', 'p_householdRegion', '户口所在地', 'basic.householdRegion'),
    scalar('personal', 'p_household_address', '户口所在地详细地址', 'basic.householdAddress', 'personal.household_address'),
    scalar('personal', 'c_address', '通讯地址', 'contact.address', 'personal.mailing_address'),
    scalar('personal', 'c_postcode', '通讯地址邮政编码', 'contact.postcode', 'personal.postal_code'),
    scalar('personal', 'c_archiveRegion', '档案所在地', 'contact.archiveRegion'),
    scalar('personal', 'c_archive_organization', '档案所在单位', 'contact.archiveOrganization', 'personal.archive_organization'),
    scalar('personal', 'c_archive_postcode', '档案所在单位邮政编码', 'contact.archivePostcode', 'personal.archive_postcode'),
    scalar('personal', 'c_archive_address', '档案所在单位地址', 'contact.archiveAddress', 'personal.archive_address'),
    scalar('personal', 'p_militaryStatus', '是否现役军人', 'basic.militaryStatus', 'personal.militaryStatus'),
    scalar('personal', 'c_landline', '固定电话', 'contact.landline'),
    scalar('personal', 'c_emergencyPhone', '紧急联系人电话', 'contact.emergencyPhone'),
    ...[['status', '求职状态'], ['type', '求职类型'], ['available', '到岗时间'], ['industry', '期望行业'], ['position', '期望岗位'], ['city', '期望城市'], ['salary', '期望薪资']].map(([key, label]) => scalar('intention', `i_${key}`, label, `intention.${key}`)),
    ...[['tech', '技术技能'], ['workplace', '职场技能'], ['interests', '兴趣爱好'], ['career_plan', '职业规划'], ['certificates', '专业证书'], ['cover_letter', '求职信']].map(([key, label]) => scalar('skills', `s_${key}`, label, `skills.${key}`)),
    scalar('intro', 'intro', '自我评价', 'intro'),
    scalar('intro', 'github', 'GitHub', 'github'),
    scalar('intro', 'homepage', '个人主页', 'homepage'),
    ...[['disciplinaryHistory', '作弊处分等情况'], ['personalStatement', '个人陈述'], ['notes', '备注信息']].map(([key, label]) => scalar('application', `app_${key}`, label, `application.${key}`)),
  ]);
  const row = (key, label, ...aliases) => ({ key, label, aliases });
  const studyWork = [row('company', '学校或工作单位', 'organization', 'school', 'unit'), row('position', '担任职务', 'role'), row('startDate', '起始时间', 'start_date', 'start'), row('endDate', '结束时间', 'end_date', 'end'), row('location', '工作地点'), row('salary', '薪资'), row('company_size', '公司规模'), row('manager', '汇报人'), row('description', '学习或工作描述', 'desc'), row('leave_reason', '离职原因')];
  const ARRAYS = Object.freeze([
    { section: 'education', container: 'edu-list', paths: ['education'], fields: [row('schoolCode', '学校代码', 'school_code'), row('school', '学校名称', 'schoolName'), row('college', '院系', 'department'), row('major', '专业'), row('enrollmentDate', '入学年月', 'startDate', 'start'), row('graduationDate', '毕业年月', 'endDate', 'end'), row('studyDuration', '本科学制'), row('studentId', '注册学号', 'student_id'), row('cet4Score', '英语四级成绩'), row('cet6Score', '英语六级成绩'), row('eliteTrainingBase', '拔尖人才培养基地'), row('eliteTrainingBaseName', '培养基地名称'), row('majorRankPercent', '专业排名百分比'), row('majorRank', '专业排名', 'rank'), row('majorRankTotal', '专业人数'), row('gpa', '成绩绩点', 'grade_point'), row('educationLevel', '学历', 'degree'), row('advisor', '导师'), row('researchDirection', '研究方向'), row('thesis', '毕业论文题目')] },
    { section: 'internship', container: 'intern-list', paths: ['internships', 'internship'], fields: studyWork },
    { section: 'work', container: 'work-list', paths: ['work'], fields: studyWork },
    { section: 'projects', container: 'proj-list', paths: ['projects'], fields: [row('name', '项目名称'), row('role', '担任角色'), row('start', '开始时间'), row('end', '结束时间'), row('url', '项目链接'), row('team_size', '团队人数'), row('desc', '项目描述')] },
    { section: 'research', container: 'research-list', paths: ['research'], fields: [row('startDate', '开始时间'), row('endDate', '结束时间'), row('name', '科研名称'), row('advisor', '指导教师'), row('level', '科研级别'), row('contribution', '主要贡献', 'description', 'desc')] },
    { section: 'practice', container: 'practice-list', paths: ['practice'], fields: [row('startDate', '开始时间'), row('endDate', '结束时间'), row('location', '实践地点'), row('description', '主要内容', 'desc')] },
    { section: 'awards', container: 'award-list', paths: ['awards'], fields: [row('time', '奖励时间', 'date'), row('location', '奖励地点'), row('category', '奖项类别'), row('content', '奖励名称', 'name'), row('level', '奖项级别'), row('rank', '获奖等级'), row('teamRank', '排名 / 团队人数'), row('organizer', '主办单位'), row('participationMode', '个人 / 团队'), row('individualRank', '个人排名'), row('certificateFileName', '证书文件名'), row('note', '奖励备注')] },
    { section: 'languages', container: 'lang-list', paths: ['language', 'languages'], fields: [row('language', '语言'), row('certificate', '证书 / 考试'), row('exam_date', '考试时间', 'examDate'), row('score', '外语分数'), row('listening_speaking', '听说能力', 'listeningSpeaking'), row('reading_writing', '读写能力', 'readingWriting')] },
    { section: 'papers', container: 'paper-list', paths: ['papers'], fields: [row('date', '成果时间'), row('journal', '发表刊物或出版社'), row('title', '成果名称'), row('authorRank', '作者排名', 'author_rank'), row('journalType', '期刊类型'), row('status', '成果状态'), row('url', '成果链接')] },
    { section: 'family', container: 'family-list', paths: ['family'], fields: [row('name', '家庭成员姓名'), row('relationship', '关系'), row('employer', '工作单位'), row('position', '职务'), row('phone', '联系电话'), row('political', '政治面貌'), row('description', '家庭成员备注')] },
  ]);
  function hasValue(value) { return (typeof value === 'string' || typeof value === 'number') && String(value).trim() !== ''; }
  function atPath(source, path) { return path.split('.').reduce((value, key) => value?.[key], source); }
  function firstValue(source, paths) {
    for (const path of paths) { const value = atPath(source, path); if (value !== undefined && value !== null) return value; }
    return '';
  }
  function summarize(fields) {
    const total = fields.length;
    const missingFields = fields.filter(field => !field.filled).map(({ filled: _filled, ...metadata }) => metadata);
    const missing = missingFields.length;
    const filled = total - missing;
    const sections = {};
    for (const field of fields) {
      const entry = sections[field.section] ||= { filled: 0, total: 0, missing: 0 };
      entry.total += 1;
      entry[field.filled ? 'filled' : 'missing'] += 1;
    }
    return { filled, total, missing, percent: total ? Math.round(filled / total * 100) : 0, missingFields, sections };
  }
  function fromResume(resume = {}) {
    const fields = SCALARS.map(({ paths, ...field }) => ({ ...field, filled: hasValue(firstValue(resume, paths)) }));
    for (const collection of ARRAYS) {
      const candidates = collection.paths.map(path => resume?.[path]);
      const rows = (collection.section === 'languages' ? candidates.find(value => Array.isArray(value) && value.length) : null)
        || candidates.find(Array.isArray) || [];
      const safeRows = collection.section === 'family' && !rows.length && typeof resume.family === 'string' && resume.family.trim()
        ? [{ description: resume.family }] : rows;
      safeRows.forEach((record, index) => collection.fields.forEach(field => fields.push({
        section: collection.section, container: collection.container, key: field.key, index, label: field.label,
        filled: hasValue(firstValue(record, [field.key, ...field.aliases])),
      })));
    }
    for (const field of Array.isArray(resume.customFields) ? resume.customFields : []) {
      const knownSections = new Set([...SCALARS.map(item => item.section), ...ARRAYS.map(item => item.section)]);
      fields.push({ section: knownSections.has(field.section) ? field.section : 'skills', customKey: field.key, label: String(field.label || '补充字段'), filled: hasValue(field.value) });
    }
    return summarize(fields);
  }
  function fromDocument(document) {
    const fields = SCALARS.flatMap(({ paths: _paths, ...field }) => {
      const control = document.getElementById(field.id);
      return control ? [{ ...field, filled: hasValue(control.value) }] : [];
    });
    for (const collection of ARRAYS) {
      [...document.querySelectorAll(`#${collection.container} > .multi-item`)].forEach((record, index) => {
        for (const field of collection.fields) {
          const control = record.querySelector(`[data-key="${field.key}"]`);
          if (control) fields.push({ section: collection.section, container: collection.container, key: field.key, index, label: field.label, filled: hasValue(control.value) });
        }
      });
    }
    for (const row of document.querySelectorAll('.custom-field-row[data-custom-key]')) {
      const control = row.querySelector('input');
      if (control) fields.push({ section: row.dataset.customSection || 'skills', customKey: row.dataset.customKey, id: control.id, label: row.querySelector('.custom-field-lbl')?.textContent?.trim() || '补充字段', filled: hasValue(control.value) });
    }
    return summarize(fields);
  }
  return { SCALARS, ARRAYS, hasValue, summarize, fromResume, fromDocument };
});
