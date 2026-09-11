// ===== 导入安全边界 =====
const IMPORT_SECURITY_LIMITS = Object.freeze({
  maxJsonFileBytes: 2 * 1024 * 1024,
  maxStringLength: 20_000,
  maxArrayItems: 100,
  maxObjectKeys: 100,
  maxDepth: 8,
  maxNodes: 5_000,
});

const IMPORT_ALLOWED_TOP_LEVEL_KEYS = new Set([
  'profileName', 'personal', 'intention', 'education', 'internship', 'work',
  'projects', 'awards', 'skills', 'languages', 'papers', 'intro', 'github',
  'homepage', 'family', 'customFields', 'basic', 'contact', 'research', 'patents',
  'practice', 'internships', 'student_work', 'certificates', 'language', 'files', 'application',
]);
const IMPORT_ARRAY_TOP_LEVEL_KEYS = new Set([
  'education', 'internship', 'work', 'projects', 'awards', 'languages', 'papers', 'customFields',
  'research', 'patents', 'practice', 'internships', 'student_work', 'certificates', 'language',
]);
const IMPORT_OBJECT_TOP_LEVEL_KEYS = new Set(['personal', 'intention', 'basic', 'contact', 'files', 'application']);
const IMPORT_STRING_TOP_LEVEL_KEYS = new Set(['profileName', 'intro', 'github', 'homepage']);
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EXPANDED_PROFILE_STRING_FIELDS = Object.freeze({
  basic: [
    'idType', 'id_type', 'documentType', 'document_type', 'certificateType', 'certificate_type',
    'namePinyin', 'name_pinyin', 'pinyin', 'healthStatus', 'health_status', 'physical_health_status',
    'health_condition', 'health', 'political', 'politicalStatus', 'political_status',
    'householdAddress', 'household_address', 'hukou_address', 'registered_address', 'militaryStatus', 'military_status',
    'birthplaceRegion', 'birthplace_region', 'birthplace', 'birth_place', 'place_of_birth',
    'hometownRegion', 'hometown_region', 'householdRegion', 'household_region', 'hukou_region', 'registered_region',
  ],
  contact: [
    'address', 'mailingAddress', 'mailing_address', 'postcode', 'postalCode', 'postal_code', 'zip_code',
    'archiveOrganization', 'archive_organization', 'archive_unit', 'archiveAddress', 'archive_address',
    'archiveRegion', 'archive_region',
    'archivePostcode', 'archive_postcode', 'landline', 'fixed_phone', 'telephone',
    'emergencyPhone', 'emergency_phone', 'emergencyContactPhone', 'emergency_contact_phone',
  ],
  personal: [
    'idType', 'id_type', 'documentType', 'document_type', 'certificateType', 'certificate_type',
    'namePinyin', 'name_pinyin', 'pinyin', 'healthStatus', 'health_status', 'physical_health_status',
    'health_condition', 'health', 'political', 'politicalStatus', 'political_status',
    'householdAddress', 'household_address', 'hukou_address', 'registered_address', 'militaryStatus', 'military_status',
    'birthplaceRegion', 'birthplace_region', 'birthplace', 'birth_place', 'place_of_birth',
    'hometownRegion', 'hometown_region', 'householdRegion', 'household_region', 'hukou_region', 'registered_region',
    'mailing_address', 'postcode', 'postal_code', 'archiveOrganization', 'archive_organization',
    'archive_unit', 'archiveAddress', 'archive_address', 'archivePostcode', 'archive_postcode',
    'archiveRegion', 'archive_region',
    'emergencyPhone', 'emergency_phone', 'emergencyContactPhone', 'emergency_contact_phone',
  ],
  education: [
    'schoolCode', 'school_code', 'school', 'college', 'department', 'major',
    'enrollmentDate', 'enrollment_date', 'startDate', 'start_date',
    'graduationDate', 'graduation_date', 'endDate', 'end_date',
    'studyDuration', 'study_duration', 'studentId', 'student_id', 'studentNo', 'student_no',
    'registration_number', 'cet4Score', 'cet4_score', 'cet6Score', 'cet6_score',
    'eliteTrainingBase', 'elite_training_base', 'eliteTrainingBaseName', 'elite_training_base_name',
    'majorRankPercent', 'major_rank_percent', 'majorRank', 'major_rank',
    'majorRankTotal', 'major_rank_total', 'professionalRank', 'professional_rank',
    'professionalRankTotal', 'professional_rank_total', 'rankTotal', 'rank_total',
    'majorStudentCount', 'major_student_count', 'gpa', 'gradePoint', 'grade_point',
    'totalGpa', 'total_gpa', 'total_grade_point', 'institution', 'institution_name',
  ],
  family: ['name', 'memberName', 'member_name', 'relationship', 'relation', 'employer', 'employer_name', 'work_unit', 'position', 'job_title', 'phone', 'mobile', 'telephone', 'contact_phone', 'address', 'mailingAddress', 'mailing_address', 'contactAddress', 'contact_address', 'residentialAddress', 'residential_address', 'political', 'political_status', 'description', 'desc'],
  internships: ['company', 'organization', 'school', 'unit', 'work_unit', 'position', 'role', 'job_title', 'startDate', 'start_date', 'start', 'begin_date', 'endDate', 'end_date', 'end', 'finish_date', 'location', 'description', 'desc'],
  research: ['startDate', 'start_date', 'endDate', 'end_date', 'name', 'advisor', 'level', 'contribution', 'description'],
  practice: ['startDate', 'start_date', 'endDate', 'end_date', 'location', 'description', 'desc'],
  papers: [
    'date', 'journal', 'journalType', 'journal_type', 'journalCategory', 'journal_category',
    'publicationType', 'publication_type', 'title', 'authorRank', 'author_rank', 'status', 'url',
    'impactFactor', 'impact_factor', 'journalImpactFactor', 'journal_impact_factor',
  ],
  language: [
    'language', 'languageType', 'language_type', 'type', 'certificate', 'exam', 'examName', 'exam_name',
    'score', 'result', 'examDate', 'exam_date', 'listeningSpeaking', 'listening_speaking',
    'readingWriting', 'reading_writing', 'level',
  ],
  application: [
    'disciplinaryHistory', 'disciplinary_history', 'disciplineHistory', 'discipline_history',
    'personalStatement', 'personal_statement', 'notes', 'applicationNotes', 'application_notes',
  ],
  awards: [
    'category', 'awardCategory', 'award_category', 'rewardCategory', 'reward_category',
    'honorCategory', 'honor_category',
    'participationMode', 'participation_mode', 'individualRank', 'individual_rank',
  ],
});

const APPLICATION_TEXT_FIELD_RULES = Object.freeze([
  Object.freeze({
    canonical: 'disciplinaryHistory',
    aliases: Object.freeze(['disciplinary_history', 'disciplineHistory', 'discipline_history']),
    maxLength: 200,
  }),
  Object.freeze({
    canonical: 'personalStatement',
    aliases: Object.freeze(['personal_statement']),
    maxLength: 1_000,
  }),
  Object.freeze({
    canonical: 'notes',
    aliases: Object.freeze(['applicationNotes', 'application_notes']),
    maxLength: 1_000,
  }),
]);

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeImportedValue(value, path = 'root', state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > IMPORT_SECURITY_LIMITS.maxNodes) {
    throw new Error(`导入数据节点数超过 ${IMPORT_SECURITY_LIMITS.maxNodes} 个`);
  }
  if (depth > IMPORT_SECURITY_LIMITS.maxDepth) {
    throw new Error(`导入数据嵌套超过 ${IMPORT_SECURITY_LIMITS.maxDepth} 层`);
  }
  if (typeof value === 'string') {
    if (value.length > IMPORT_SECURITY_LIMITS.maxStringLength) {
      throw new Error(`${path} 超过 ${IMPORT_SECURITY_LIMITS.maxStringLength} 个字符`);
    }
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (value.length > IMPORT_SECURITY_LIMITS.maxArrayItems) {
      throw new Error(`${path} 超过 ${IMPORT_SECURITY_LIMITS.maxArrayItems} 条记录`);
    }
    value.forEach((item, index) => assertSafeImportedValue(item, `${path}[${index}]`, state, depth + 1));
    return;
  }
  if (!isPlainRecord(value)) throw new Error(`${path} 必须是普通 JSON 对象`);
  const keys = Object.keys(value);
  if (keys.length > IMPORT_SECURITY_LIMITS.maxObjectKeys) {
    throw new Error(`${path} 的字段数超过 ${IMPORT_SECURITY_LIMITS.maxObjectKeys} 个`);
  }
  for (const key of keys) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) throw new Error(`${path} 包含禁止字段 ${key}`);
    if (key.length > 128) throw new Error(`${path} 包含过长字段名`);
    assertSafeImportedValue(value[key], `${path}.${key}`, state, depth + 1);
  }
}

function assertStringFields(record, fields, path) {
  if (!isPlainRecord(record)) return;
  fields.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return;
    const value = record[key];
    if (value !== null && typeof value !== 'string') throw new Error(`${path}.${key} 必须是字符串或 null`);
  });
}

function assertApplicationTextLengths(record, path = 'application') {
  if (!isPlainRecord(record)) return;
  APPLICATION_TEXT_FIELD_RULES.forEach(({ canonical, aliases, maxLength }) => {
    [canonical, ...aliases].forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(record, key)) return;
      const value = record[key];
      if (typeof value === 'string' && value.length > maxLength) {
        throw new Error(`${path}.${key} 不能超过 ${maxLength} 个字符`);
      }
    });
  });
}

function assertAttachmentIds(record, path) {
  if (!isPlainRecord(record) || !Object.prototype.hasOwnProperty.call(record, 'attachments')) return;
  if (!Array.isArray(record.attachments)
      || record.attachments.some(value => typeof value !== 'string' || !/^file_[\w-]+$/i.test(value))) {
    throw new Error(`${path}.attachments 必须是 fileId 字符串数组`);
  }
}

function validateExpandedProfileFields(payload) {
  assertStringFields(payload.basic, EXPANDED_PROFILE_STRING_FIELDS.basic, 'basic');
  assertStringFields(payload.contact, EXPANDED_PROFILE_STRING_FIELDS.contact, 'contact');
  assertStringFields(payload.personal, EXPANDED_PROFILE_STRING_FIELDS.personal, 'personal');
  assertStringFields(payload.application, EXPANDED_PROFILE_STRING_FIELDS.application, 'application');
  assertApplicationTextLengths(payload.application);
  ['education', 'family', 'internships', 'internship', 'research', 'practice', 'papers', 'awards', 'language', 'languages'].forEach(key => {
    if (!Array.isArray(payload[key])) return;
    const fieldGroup = key === 'internship'
      ? 'internships'
      : (key === 'languages' ? 'language' : key);
    payload[key].forEach((item, index) => {
      assertStringFields(item, EXPANDED_PROFILE_STRING_FIELDS[fieldGroup], `${key}[${index}]`);
      assertAttachmentIds(item, `${key}[${index}]`);
    });
  });
}

function validateImportPayload(payload, { allowAwardsArray = false } = {}) {
  if (Array.isArray(payload)) {
    if (!allowAwardsArray) throw new Error('导入文件的顶层必须是 JSON 对象');
    assertSafeImportedValue(payload, 'awards');
    return payload;
  }
  if (!isPlainRecord(payload)) throw new Error('导入文件的顶层必须是 JSON 对象');

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) throw new Error(`导入数据包含禁止字段 ${key}`);
    if (!IMPORT_ALLOWED_TOP_LEVEL_KEYS.has(key)) throw new Error(`不支持的顶层字段：${key}`);
  }
  assertSafeImportedValue(payload);

  for (const key of keys) {
    const value = payload[key];
    if (value === null) continue;
    if (IMPORT_ARRAY_TOP_LEVEL_KEYS.has(key) && !Array.isArray(value)) {
      throw new Error(`${key} 必须是数组`);
    }
    if (IMPORT_ARRAY_TOP_LEVEL_KEYS.has(key)) {
      value.forEach((item, index) => {
        if (!isPlainRecord(item)) throw new Error(`${key}[${index}] 必须是 JSON 对象`);
      });
    }
    if (IMPORT_OBJECT_TOP_LEVEL_KEYS.has(key) && !isPlainRecord(value)) {
      throw new Error(`${key} 必须是 JSON 对象`);
    }
    if (IMPORT_STRING_TOP_LEVEL_KEYS.has(key) && typeof value !== 'string') {
      throw new Error(`${key} 必须是字符串`);
    }
    if (key === 'family' && typeof value !== 'string' && !Array.isArray(value)) {
      throw new Error('family 必须是数组；旧 JobFill 数据也可以使用字符串');
    }
    if (key === 'family' && Array.isArray(value) && value.some(item => !isPlainRecord(item))) {
      throw new Error('family 数组中的每一项必须是 JSON 对象');
    }
    if (key === 'skills' && !isPlainRecord(value) && !Array.isArray(value)) {
      throw new Error('skills 必须是对象或数组');
    }
    if (key === 'skills' && Array.isArray(value) && value.some(item => !isPlainRecord(item) && typeof item !== 'string')) {
      throw new Error('skills 数组中的每一项必须是字符串或 JSON 对象');
    }
  }
  validateExpandedProfileFields(payload);
  return payload;
}

// ===== 模板生成函数 =====

function eduTemplate(d = {}) {
  const source = isPlainRecord(d) ? d : {};
  const rawValue = key => {
    const aliases = {
      schoolCode: ['schoolCode', 'school_code', 'schoolId', 'school_id'],
      school: ['school', 'schoolName', 'school_name', 'university'],
      college: ['college', 'collegeName', 'college_name', 'department', 'department_name'],
      major: ['major', 'majorName', 'major_name'],
      educationLevel: ['educationLevel', 'education_level', 'degree'],
      enrollmentDate: ['enrollmentDate', 'enrollment_date', 'startDate', 'start_date', 'start'],
      graduationDate: ['graduationDate', 'graduation_date', 'endDate', 'end_date', 'end'],
      studyDuration: ['studyDuration', 'study_duration', 'duration', 'schoolingYears', 'schooling_years'],
      studentId: ['studentId', 'student_id', 'studentNo', 'student_no', 'registration_number'],
      cet4Score: ['cet4Score', 'cet4_score', 'cet4', 'CET4'],
      cet6Score: ['cet6Score', 'cet6_score', 'cet6', 'CET6'],
      eliteTrainingBase: ['eliteTrainingBase', 'elite_training_base', 'eliteBase', 'elite_base'],
      eliteTrainingBaseName: ['eliteTrainingBaseName', 'elite_training_base_name', 'eliteBaseName', 'elite_base_name'],
      majorRankPercent: ['majorRankPercent', 'major_rank_percent', 'rankPercent', 'rank_percent'],
      majorRank: ['majorRank', 'major_rank', 'professionalRank', 'professional_rank', 'rank'],
      majorRankTotal: ['majorRankTotal', 'major_rank_total', 'professionalRankTotal', 'professional_rank_total', 'rankTotal', 'rank_total'],
      schoolType: ['schoolType', 'school_type'],
    };
    const keys = aliases[key] || [key];
    const found = keys.find(candidate => source[candidate] !== undefined && source[candidate] !== null);
    return found ? source[found] : '';
  };
  const value = key => escHtml(rawValue(key));
  return `
  <div class="grid g2">
    <div class="field"><label>所在学校代码</label><input data-key="schoolCode" value="${value('schoolCode')}"/></div>
    <div class="field"><label>所在学校名称</label><input data-key="school" value="${value('school')}"/></div>
    <div class="field"><label>所在院系</label><input data-key="college" value="${value('college')}"/></div>
    <div class="field"><label>所在专业</label><input data-key="major" value="${value('major')}"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>入学年月</label><input data-key="enrollmentDate" value="${value('enrollmentDate')}" placeholder="2022-09"/></div>
    <div class="field"><label>预计毕业年月</label><input data-key="graduationDate" value="${value('graduationDate')}" placeholder="2026-06"/></div>
    <div class="field"><label>本科学制</label>
      <select data-key="studyDuration">
        ${['','2年','3年','4年','5年','6年'].map(v=>`<option${v===String(rawValue('studyDuration'))?' selected':''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>在校生注册学号</label><input data-key="studentId" value="${value('studentId')}"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>大学英语四级成绩</label><input data-key="cet4Score" value="${value('cet4Score')}"/></div>
    <div class="field"><label>大学英语六级成绩</label><input data-key="cet6Score" value="${value('cet6Score')}"/></div>
    <div class="field"><label>是否来自拔尖人才培养基地</label>
      <select data-key="eliteTrainingBase">
        ${['','是','否'].map(v=>`<option${v===String(rawValue('eliteTrainingBase'))?' selected':''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>拔尖人才培养基地名称</label><input data-key="eliteTrainingBaseName" value="${value('eliteTrainingBaseName')}"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>专业同年级排名（百分比）</label><input data-key="majorRankPercent" value="${value('majorRankPercent')}" placeholder="例如 10%"/></div>
    <div class="field"><label>专业同年级排名（整数）</label><input data-key="majorRank" value="${value('majorRank')}" placeholder="例如 9"/></div>
    <div class="field"><label>所在专业同年级人数</label><input data-key="majorRankTotal" value="${value('majorRankTotal')}" placeholder="例如 90"/></div>
    <div class="field"><label>成绩绩点 / 总绩点</label><input data-key="gpa" value="${value('gpa')}" placeholder="例如 3.80/4.00"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>学历</label>
      <select data-key="educationLevel">
        ${['','博士','硕士','本科','大专'].map(v=>`<option${v===rawValue('educationLevel')?' selected':''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>导师</label><input data-key="advisor" value="${value('advisor')}"/></div>
    <div class="field"><label>研究方向</label><input data-key="researchDirection" value="${value('researchDirection')}"/></div>
    <div class="field"><label>毕业论文题目</label><input data-key="thesis" value="${value('thesis')}"/></div>
  </div>`;
}

function internTemplate(d = {}) {
  const source = isPlainRecord(d) ? d : {};
  const rawValue = key => {
    const aliases = {
      startDate: ['startDate', 'start_date', 'start'],
      endDate: ['endDate', 'end_date', 'end'],
      description: ['description', 'desc'],
      company: ['company', 'organization', 'school', 'unit'],
    };
    const keys = aliases[key] || [key];
    const found = keys.find(candidate => source[candidate] !== undefined && source[candidate] !== null);
    return found ? source[found] : '';
  };
  const value = key => escHtml(rawValue(key));
  return `
  <div class="grid g2">
    <div class="field"><label>学校或工作单位</label><input data-key="company" value="${value('company')}"/></div>
    <div class="field"><label>担任职务</label><input data-key="position" value="${value('position')}"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>起始时间</label><input data-key="startDate" value="${value('startDate')}" placeholder="2024-09"/></div>
    <div class="field"><label>结束时间</label><input data-key="endDate" value="${value('endDate')}" placeholder="2025-06"/></div>
    <div class="field"><label>工作地点</label><input data-key="location" value="${value('location')}"/></div>
    <div class="field"><label>薪资</label><input data-key="salary" value="${value('salary')}"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>公司规模</label><input data-key="company_size" value="${value('company_size')}"/></div>
    <div class="field"><label>汇报人</label><input data-key="manager" value="${value('manager')}"/></div>
  </div>
  <div class="field" style="margin-top:12px"><label>学习或工作描述</label><textarea data-key="description">${value('description')}</textarea></div>
  <div class="field" style="margin-top:12px"><label>离职原因（选填）</label><input data-key="leave_reason" value="${value('leave_reason')}"/></div>`;
}

function familyTemplate(d = {}) {
  const source = isPlainRecord(d) ? d : {};
  const value = key => escHtml(source[key]);
  return `
  <div class="grid g2">
    <div class="field"><label>姓名</label><input data-key="name" value="${value('name')}"/></div>
    <div class="field"><label>关系</label><input data-key="relationship" value="${value('relationship')}" placeholder="父亲 / 母亲 / 其他社会关系"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>在何单位工作</label><input data-key="employer" value="${value('employer')}"/></div>
    <div class="field"><label>担任何职务</label><input data-key="position" value="${value('position')}"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>联系电话</label><input data-key="phone" value="${value('phone')}"/></div>
    <div class="field"><label>政治面貌（选填）</label><input data-key="political" value="${value('political')}"/></div>
  </div>
  <div class="field" style="margin-top:12px"><label>备注（选填）</label><textarea data-key="description">${value('description')}</textarea></div>`;
}

function workTemplate(d = {}) {
  return internTemplate(d); // 结构相同
}

function projTemplate(d = {}) {
  const source = isPlainRecord(d) ? d : {};
  const value = key => escHtml(source[key]);
  return `
  <div class="grid g2">
    <div class="field"><label>项目名称</label><input data-key="name" value="${value('name')}"/></div>
    <div class="field"><label>担任角色</label><input data-key="role" value="${value('role')}"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>开始时间</label><input data-key="start" value="${value('start')}" placeholder="2024-12"/></div>
    <div class="field"><label>结束时间</label><input data-key="end" value="${value('end')}" placeholder="2025-06"/></div>
    <div class="field"><label>项目链接</label><input data-key="url" value="${value('url')}"/></div>
    <div class="field"><label>团队人数</label><input data-key="team_size" value="${value('team_size')}"/></div>
  </div>
  <div class="field" style="margin-top:12px"><label>项目描述</label><textarea data-key="desc">${value('desc')}</textarea></div>`;
}

function langTemplate(d = {}) {
  const source = isPlainRecord(d) ? d : {};
  const value = key => escHtml(source[key]);
  return `
  <div class="grid g3">
    <div class="field"><label>语言</label><input data-key="language" value="${value('language')}"/></div>
    <div class="field"><label>证书/考试</label><input data-key="certificate" value="${value('certificate')}" placeholder="CET-6"/></div>
    <div class="field"><label>考试时间</label><input data-key="exam_date" value="${value('exam_date')}"/></div>
  </div>
  <div class="grid g3" style="margin-top:12px">
    <div class="field"><label>分数</label><input data-key="score" value="${value('score')}"/></div>
    <div class="field"><label>听说能力</label>
      <select data-key="listening_speaking">
        ${['','优秀','良好','一般'].map(v=>`<option${v===source.listening_speaking?' selected':''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>读写能力</label>
      <select data-key="reading_writing">
        ${['','优秀','良好','一般'].map(v=>`<option${v===source.reading_writing?' selected':''}>${v}</option>`).join('')}
      </select>
    </div>
  </div>`;
}

function researchTemplate(d = {}) {
  const source = isPlainRecord(d) ? d : {};
  const value = key => escHtml(source[key]);
  return `
  <div class="grid g3">
    <div class="field"><label>开始时间</label><input data-key="startDate" value="${value('startDate')}" placeholder="2025-01"/></div>
    <div class="field"><label>结束时间</label><input data-key="endDate" value="${value('endDate')}" placeholder="2025-12"/></div>
    <div class="field"><label>名称</label><input data-key="name" value="${value('name')}"/></div>
  </div>
  <div class="grid g3" style="margin-top:12px">
    <div class="field"><label>指导教师</label><input data-key="advisor" value="${value('advisor')}"/></div>
    <div class="field"><label>级别</label><input data-key="level" value="${value('level')}" placeholder="国家级 / 省级 / 校级 / 院级"/></div>
    <div class="field"><label>主要贡献</label><textarea data-key="contribution" style="min-height:70px">${value('contribution')}</textarea></div>
  </div>`;
}

function practiceTemplate(d = {}) {
  const source = isPlainRecord(d) ? d : {};
  const value = key => escHtml(source[key]);
  return `
  <div class="grid g2">
    <div class="field"><label>开始时间</label><input data-key="startDate" value="${value('startDate')}" placeholder="2024-01"/></div>
    <div class="field"><label>结束时间</label><input data-key="endDate" value="${value('endDate')}" placeholder="2024-12"/></div>
    <div class="field"><label>地点</label><input data-key="location" value="${value('location')}"/></div>
    <div class="field"><label>主要内容</label><textarea data-key="description" style="min-height:70px">${value('description')}</textarea></div>
  </div>`;
}

function paperTemplate(d = {}) {
  const source = isPlainRecord(d) ? d : {};
  const value = key => escHtml(source[key]);
  const authorRank = source.authorRank ?? source.author_rank ?? '';
  return `
  <div class="grid g2">
    <div class="field"><label>时间</label><input data-key="date" value="${value('date')}" placeholder="2026-01"/></div>
    <div class="field"><label>发表刊物或出版社</label><input data-key="journal" value="${value('journal')}"/></div>
    <div class="field"><label>成果名称</label><input data-key="title" value="${value('title')}"/></div>
    <div class="field"><label>作者排名</label><input data-key="authorRank" value="${escHtml(authorRank)}" placeholder="1/5 或 一作"/></div>
  </div>
  <div class="grid g3" style="margin-top:12px">
    <div class="field"><label>期刊类型（选填）</label><input data-key="journalType" value="${value('journalType')}"/></div>
    <div class="field"><label>状态（选填）</label>
      <select data-key="status">
        ${['','已发表','审稿中','录用待刊'].map(v=>`<option${v===source.status?' selected':''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>成果链接（选填）</label><input data-key="url" value="${value('url')}"/></div>
  </div>`;
}

// ===== 奖励与荣誉（独立顶级 awards 数组）=====
const AWARD_STRING_FIELDS = [
  'time', 'location', 'content', 'category', 'level', 'rank', 'participationMode', 'individualRank',
  'teamRank', 'organizer', 'certificateFileName', 'note',
];
const AWARD_COMPAT_STRING_FIELDS = [
  'awardCategory', 'award_category', 'rewardCategory', 'reward_category',
  'honorCategory', 'honor_category', 'participation_mode', 'individual_rank',
];
const AWARD_FIELDS = [...AWARD_STRING_FIELDS, 'name', 'date', 'attachments'];
const AWARD_TSV_FIELDS = [
  'time', 'location', 'content', 'level', 'rank', 'organizer', 'certificateFileName', 'note', 'category',
];
const AWARD_DATE_PATTERN = /^\d{4}-(?:0?[1-9]|1[0-2])$/;
const BASIC_UI_CANONICAL_ALIASES = Object.freeze({
  idType: Object.freeze(['id_type', 'documentType', 'document_type', 'certificateType', 'certificate_type']),
  birthplaceRegion: Object.freeze(['birthplace_region', 'birthplace', 'birth_place', 'place_of_birth']),
  hometownRegion: Object.freeze(['hometown_region', 'hometown']),
  householdRegion: Object.freeze(['household_region', 'hukou_region', 'registered_region']),
});
const CONTACT_UI_CANONICAL_ALIASES = Object.freeze({
  archiveRegion: Object.freeze(['archive_region']),
  emergencyPhone: Object.freeze(['emergency_phone', 'emergencyContactPhone', 'emergency_contact_phone']),
});
const APPLICATION_UI_CANONICAL_ALIASES = Object.freeze(Object.fromEntries(
  APPLICATION_TEXT_FIELD_RULES.map(({ canonical, aliases }) => [canonical, aliases]),
));
const AWARD_CATEGORY_CANONICAL_ALIASES = Object.freeze({
  category: Object.freeze([
    'awardCategory', 'award_category', 'rewardCategory', 'reward_category',
    'honorCategory', 'honor_category',
  ]),
});
const PERSONAL_UI_CANONICAL_ALIASES = Object.freeze({
  ...BASIC_UI_CANONICAL_ALIASES,
  ...CONTACT_UI_CANONICAL_ALIASES,
});

function stringValue(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value.trim() : String(value).trim();
}

function normalizeAwardItem(item = {}) {
  const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
  const result = { ...source };
  AWARD_STRING_FIELDS.forEach(key => { result[key] = stringValue(source[key]); });
  result.time = result.time || stringValue(source.date);
  result.date = stringValue(source.date) || result.time;
  result.content = result.content || stringValue(source.name);
  result.name = stringValue(source.name) || result.content;
  result.category = canonicalOrAliasValue(
    source,
    'category',
    AWARD_CATEGORY_CANONICAL_ALIASES.category,
  );
  result.participationMode = result.participationMode || stringValue(source.participation_mode);
  result.individualRank = result.individualRank || stringValue(source.individual_rank);
  result.teamRank = result.teamRank || stringValue(source.team_rank) || stringValue(source.ranking);
  result.attachments = Array.isArray(source.attachments)
    ? source.attachments.map(value => stringValue(value)).filter(value => /^file_[\w-]+$/i.test(value)).slice(0, 20)
    : [];
  return result;
}

function aliasValue(source, keys, fallback = '') {
  const record = isPlainRecord(source) ? source : {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null && record[key] !== undefined) {
      return stringValue(record[key]);
    }
  }
  return stringValue(fallback);
}

function firstNonEmptyAliasValue(source, keys, fallback = '') {
  const record = isPlainRecord(source) ? source : {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === null || record[key] === undefined) continue;
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return stringValue(fallback);
}

function canonicalOrAliasValue(source, canonical, aliases, fallback = '') {
  const record = isPlainRecord(source) ? source : {};
  if (Object.prototype.hasOwnProperty.call(record, canonical) && record[canonical] !== undefined) {
    return stringValue(record[canonical]);
  }
  return firstNonEmptyAliasValue(record, aliases, fallback);
}

function replaceCanonicalFields(source, aliasGroups, values = {}) {
  const result = isPlainRecord(source) ? { ...source } : {};
  Object.entries(aliasGroups).forEach(([canonical, aliases]) => {
    [canonical, ...aliases].forEach(key => { delete result[key]; });
    if (Object.prototype.hasOwnProperty.call(values, canonical)) {
      result[canonical] = stringValue(values[canonical]);
    }
  });
  return result;
}

function normalizePoliticalStatus(value) {
  const original = stringValue(value);
  const normalized = original.replace(/[\s·•]/g, '');
  if (/^(?:中共|中国共产党)?预备党员$/.test(normalized)) return '中国共产党预备党员';
  if (/^(?:中共|中国共产党|共产)?(?:正式)?党员$/.test(normalized)) return '中共党员';
  return original;
}

function normalizeEducationItem(item = {}) {
  const source = isPlainRecord(item) ? item : {};
  const enrollmentDate = aliasValue(source, ['enrollmentDate', 'enrollment_date', 'startDate', 'start_date', 'start']);
  const graduationDate = aliasValue(source, ['graduationDate', 'graduation_date', 'endDate', 'end_date', 'end']);
  const majorRank = aliasValue(source, ['majorRank', 'major_rank', 'professionalRank', 'professional_rank', 'rank']);
  const majorRankTotal = aliasValue(source, ['majorRankTotal', 'major_rank_total', 'professionalRankTotal', 'professional_rank_total', 'rankTotal', 'rank_total']);
  return {
    ...source,
    schoolCode: aliasValue(source, ['schoolCode', 'school_code', 'schoolId', 'school_id']),
    school: firstNonEmptyAliasValue(source, ['school', 'schoolName', 'school_name', 'university', 'institution', 'institution_name']),
    college: aliasValue(source, ['college', 'collegeName', 'college_name', 'department', 'department_name']),
    major: aliasValue(source, ['major', 'majorName', 'major_name']),
    educationLevel: aliasValue(source, ['educationLevel', 'education_level', 'degree']),
    enrollmentDate,
    graduationDate,
    startDate: aliasValue(source, ['startDate', 'start_date'], enrollmentDate),
    endDate: aliasValue(source, ['endDate', 'end_date'], graduationDate),
    studyDuration: aliasValue(source, ['studyDuration', 'study_duration', 'duration', 'schoolingYears', 'schooling_years']),
    studentId: aliasValue(source, ['studentId', 'student_id', 'studentNo', 'student_no', 'registration_number']),
    cet4Score: aliasValue(source, ['cet4Score', 'cet4_score', 'cet4', 'CET4']),
    cet6Score: aliasValue(source, ['cet6Score', 'cet6_score', 'cet6', 'CET6']),
    eliteTrainingBase: aliasValue(source, ['eliteTrainingBase', 'elite_training_base', 'eliteBase', 'elite_base']),
    eliteTrainingBaseName: aliasValue(source, ['eliteTrainingBaseName', 'elite_training_base_name', 'eliteBaseName', 'elite_base_name']),
    majorRankPercent: aliasValue(source, ['majorRankPercent', 'major_rank_percent', 'rankPercent', 'rank_percent']),
    majorRank,
    majorRankTotal: firstNonEmptyAliasValue(source, [
      'majorRankTotal', 'major_rank_total', 'professionalRankTotal', 'professional_rank_total',
      'rankTotal', 'rank_total', 'majorStudentCount', 'major_student_count',
    ], majorRankTotal),
    rank: aliasValue(source, ['rank', 'ranking'], majorRank),
    gpa: firstNonEmptyAliasValue(source, ['gpa', 'gradePoint', 'grade_point', 'totalGpa', 'total_gpa', 'total_grade_point']),
    schoolType: aliasValue(source, ['schoolType', 'school_type']),
    advisor: aliasValue(source, ['advisor', 'supervisor']),
    researchDirection: aliasValue(source, ['researchDirection', 'research_direction', 'research']),
    thesis: aliasValue(source, ['thesis', 'thesis_title']),
  };
}

function normalizeResearchItem(item = {}) {
  const source = isPlainRecord(item) ? item : {};
  return {
    ...source,
    startDate: aliasValue(source, ['startDate', 'start_date', 'start', 'begin_date']),
    endDate: aliasValue(source, ['endDate', 'end_date', 'end', 'finish_date']),
    name: aliasValue(source, ['name', 'projectName', 'project_name', 'title']),
    advisor: aliasValue(source, ['advisor', 'supervisor', 'teacher', 'mentor']),
    level: aliasValue(source, ['level', 'projectLevel', 'project_level']),
    contribution: aliasValue(source, ['contribution', 'mainContribution', 'main_contribution', 'description', 'desc']),
  };
}

function normalizePracticeItem(item = {}) {
  const source = isPlainRecord(item) ? item : {};
  return {
    ...source,
    startDate: aliasValue(source, ['startDate', 'start_date', 'start', 'begin_date']),
    endDate: aliasValue(source, ['endDate', 'end_date', 'end', 'finish_date']),
    location: aliasValue(source, ['location', 'place', 'address']),
    description: aliasValue(source, ['description', 'desc', 'content', 'mainContent', 'main_content']),
  };
}

function normalizePaperItem(item = {}) {
  const source = isPlainRecord(item) ? item : {};
  return {
    ...source,
    date: aliasValue(source, ['date', 'publishDate', 'publish_date', 'time']),
    journal: aliasValue(source, ['journal', 'publisher', 'publication', 'venue']),
    journalType: firstNonEmptyAliasValue(source, [
      'journalType', 'journal_type', 'journalCategory', 'journal_category',
      'publicationType', 'publication_type',
    ]),
    title: aliasValue(source, ['title', 'name', 'achievementName', 'achievement_name']),
    authorRank: aliasValue(source, ['authorRank', 'author_rank', 'rank']),
    impactFactor: firstNonEmptyAliasValue(source, [
      'impactFactor', 'impact_factor', 'journalImpactFactor', 'journal_impact_factor',
    ]),
  };
}

function normalizeFamilyItem(item = {}) {
  const source = isPlainRecord(item) ? item : {};
  const address = firstNonEmptyAliasValue(source, [
    'address', 'mailingAddress', 'mailing_address', 'contactAddress', 'contact_address',
    'residentialAddress', 'residential_address',
  ]);
  return {
    ...source,
    name: aliasValue(source, ['name', 'memberName', 'member_name', 'full_name']),
    relationship: aliasValue(source, ['relationship', 'relation']),
    employer: aliasValue(source, ['employer', 'employerName', 'employer_name', 'work_unit', 'organization']),
    position: aliasValue(source, ['position', 'jobTitle', 'job_title', 'occupation']),
    phone: aliasValue(source, ['phone', 'mobile', 'telephone', 'contact_phone']),
    ...(address ? { address } : {}),
    political: aliasValue(source, ['political', 'politicalStatus', 'political_status']),
    description: aliasValue(source, ['description', 'desc']),
  };
}

function normalizeStudyWorkItem(item = {}) {
  const source = isPlainRecord(item) ? item : {};
  return {
    ...source,
    company: aliasValue(source, ['company', 'organization', 'school', 'unit', 'work_unit']),
    position: aliasValue(source, ['position', 'role', 'jobTitle', 'job_title']),
    startDate: aliasValue(source, ['startDate', 'start_date', 'start', 'begin_date']),
    endDate: aliasValue(source, ['endDate', 'end_date', 'end', 'finish_date']),
    description: aliasValue(source, ['description', 'desc']),
  };
}

function normalizeLanguageItem(item = {}) {
  const source = isPlainRecord(item) ? item : {};
  const examDate = firstNonEmptyAliasValue(source, ['examDate', 'exam_date']);
  const listeningSpeaking = firstNonEmptyAliasValue(source, [
    'listeningSpeaking', 'listening_speaking', 'speaking',
  ]);
  const readingWriting = firstNonEmptyAliasValue(source, [
    'readingWriting', 'reading_writing', 'writing',
  ]);
  return {
    ...source,
    language: firstNonEmptyAliasValue(source, ['language', 'languageType', 'language_type', 'type']),
    certificate: firstNonEmptyAliasValue(source, ['certificate', 'exam', 'examName', 'exam_name']),
    score: firstNonEmptyAliasValue(source, ['score', 'result']),
    examDate,
    exam_date: firstNonEmptyAliasValue(source, ['exam_date'], examDate),
    listeningSpeaking,
    listening_speaking: firstNonEmptyAliasValue(source, ['listening_speaking'], listeningSpeaking),
    readingWriting,
    reading_writing: firstNonEmptyAliasValue(source, ['reading_writing'], readingWriting),
  };
}

function normalizeApplicationData(value = {}) {
  const source = isPlainRecord(value) ? value : {};
  return {
    ...source,
    disciplinaryHistory: canonicalOrAliasValue(
      source,
      'disciplinaryHistory',
      APPLICATION_UI_CANONICAL_ALIASES.disciplinaryHistory,
    ),
    personalStatement: canonicalOrAliasValue(
      source,
      'personalStatement',
      APPLICATION_UI_CANONICAL_ALIASES.personalStatement,
    ),
    notes: canonicalOrAliasValue(
      source,
      'notes',
      APPLICATION_UI_CANONICAL_ALIASES.notes,
    ),
  };
}

function normalizeResumeData(data = {}) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const safeSource = Object.fromEntries(
    Object.entries(source).filter(([key]) => !FORBIDDEN_OBJECT_KEYS.has(key)),
  );
  const normalized = {
    ...safeSource,
    profileName: stringValue(safeSource.profileName) || '默认申请资料',
    awards: Array.isArray(safeSource.awards) ? safeSource.awards.map(normalizeAwardItem) : [],
  };
  const personal = isPlainRecord(safeSource.personal) ? { ...safeSource.personal } : {};
  const sourceBasic = isPlainRecord(safeSource.basic) ? safeSource.basic : {};
  const sourceContact = isPlainRecord(safeSource.contact) ? safeSource.contact : {};
  const namePinyin = aliasValue(sourceBasic, ['namePinyin', 'name_pinyin', 'pinyin'],
    aliasValue(personal, ['namePinyin', 'name_pinyin', 'pinyin']));
  const healthStatus = aliasValue(sourceBasic,
    ['healthStatus', 'health_status', 'physical_health_status', 'health_condition', 'health'],
    aliasValue(personal, ['healthStatus', 'health_status', 'physical_health_status', 'health_condition', 'health']));
  const political = normalizePoliticalStatus(aliasValue(sourceBasic,
    ['political', 'politicalStatus', 'political_status'],
    aliasValue(personal, ['political', 'politicalStatus', 'political_status'])));
  const idType = canonicalOrAliasValue(
    sourceBasic,
    'idType',
    BASIC_UI_CANONICAL_ALIASES.idType,
    canonicalOrAliasValue(personal, 'idType', BASIC_UI_CANONICAL_ALIASES.idType),
  );
  const hometownProvince = firstNonEmptyAliasValue(
    sourceBasic,
    ['hometownProvince', 'hometown_province'],
    firstNonEmptyAliasValue(personal, ['hometownProvince', 'hometown_province']),
  );
  const hometownCity = firstNonEmptyAliasValue(
    sourceBasic,
    ['hometownCity', 'hometown_city'],
    firstNonEmptyAliasValue(personal, ['hometownCity', 'hometown_city']),
  );
  const personalHometown = [hometownProvince, hometownCity]
    .map(stringValue)
    .filter(Boolean)
    .join(' / ');
  const personalBirthplaceRegion = canonicalOrAliasValue(
    personal,
    'birthplaceRegion',
    BASIC_UI_CANONICAL_ALIASES.birthplaceRegion,
  );
  const birthplaceRegion = canonicalOrAliasValue(
    sourceBasic,
    'birthplaceRegion',
    BASIC_UI_CANONICAL_ALIASES.birthplaceRegion,
    personalBirthplaceRegion,
  );
  const personalHometownRegion = canonicalOrAliasValue(
    personal,
    'hometownRegion',
    BASIC_UI_CANONICAL_ALIASES.hometownRegion,
    personalHometown,
  );
  const hometownRegion = canonicalOrAliasValue(
    sourceBasic,
    'hometownRegion',
    BASIC_UI_CANONICAL_ALIASES.hometownRegion,
    personalHometownRegion,
  );
  const personalHouseholdRegion = canonicalOrAliasValue(
    personal,
    'householdRegion',
    BASIC_UI_CANONICAL_ALIASES.householdRegion,
  );
  const householdRegion = canonicalOrAliasValue(
    sourceBasic,
    'householdRegion',
    BASIC_UI_CANONICAL_ALIASES.householdRegion,
    personalHouseholdRegion,
  );
  normalized.personal = { ...personal, namePinyin, healthStatus, political };
  normalized.basic = {
    ...normalized.personal,
    ...sourceBasic,
    namePinyin,
    healthStatus,
    political,
    idType,
    birthplaceRegion,
    hometownRegion,
    hometownProvince,
    hometownCity,
    householdRegion,
    householdAddress: aliasValue(sourceBasic, ['householdAddress', 'household_address', 'hukou_address', 'registered_address'],
      aliasValue(personal, ['householdAddress', 'household_address', 'hukou_address', 'registered_address'])),
  };
  normalized.contact = {
    phone: aliasValue(personal, ['phone', 'mobile']),
    email: aliasValue(personal, ['email']),
    wechat: aliasValue(personal, ['wechat']),
    qq: aliasValue(personal, ['qq']),
    address: aliasValue(personal, ['mailing_address', 'address']),
    currentCity: aliasValue(personal, ['currentCity', 'current_city']),
    postcode: aliasValue(personal, ['postcode', 'postal_code', 'zip_code']),
    archiveOrganization: aliasValue(personal, ['archiveOrganization', 'archive_organization', 'archive_unit']),
    archiveAddress: aliasValue(personal, ['archiveAddress', 'archive_address']),
    archivePostcode: aliasValue(personal, ['archivePostcode', 'archive_postcode']),
    ...sourceContact,
  };
  normalized.contact.address = aliasValue(sourceContact, ['address', 'mailingAddress', 'mailing_address'], normalized.contact.address);
  normalized.contact.postcode = aliasValue(sourceContact, ['postcode', 'postalCode', 'postal_code', 'zip_code'], normalized.contact.postcode);
  normalized.contact.archiveOrganization = aliasValue(sourceContact,
    ['archiveOrganization', 'archive_organization', 'archive_unit'], normalized.contact.archiveOrganization);
  normalized.contact.archiveRegion = canonicalOrAliasValue(
    sourceContact,
    'archiveRegion',
    CONTACT_UI_CANONICAL_ALIASES.archiveRegion,
    canonicalOrAliasValue(personal, 'archiveRegion', CONTACT_UI_CANONICAL_ALIASES.archiveRegion),
  );
  normalized.contact.archiveAddress = aliasValue(sourceContact,
    ['archiveAddress', 'archive_address'], normalized.contact.archiveAddress);
  normalized.contact.archivePostcode = aliasValue(sourceContact,
    ['archivePostcode', 'archive_postcode'], normalized.contact.archivePostcode);
  normalized.contact.emergencyPhone = canonicalOrAliasValue(
    sourceContact,
    'emergencyPhone',
    CONTACT_UI_CANONICAL_ALIASES.emergencyPhone,
    canonicalOrAliasValue(personal, 'emergencyPhone', CONTACT_UI_CANONICAL_ALIASES.emergencyPhone),
  );
  normalized.education = Array.isArray(safeSource.education)
    ? safeSource.education.map(normalizeEducationItem)
    : [];
  if (Array.isArray(safeSource.family)) normalized.family = safeSource.family.map(normalizeFamilyItem);
  else if (typeof safeSource.family === 'string' && safeSource.family.trim()) {
    normalized.family = [normalizeFamilyItem({ description: safeSource.family })];
  } else normalized.family = [];
  const studyWorkSource = Array.isArray(safeSource.internships)
    ? safeSource.internships
    : (Array.isArray(safeSource.internship) ? safeSource.internship : []);
  normalized.internships = studyWorkSource.map(normalizeStudyWorkItem);
  normalized.internship = normalized.internships;
  const languageSource = Array.isArray(safeSource.language) && safeSource.language.length
    ? safeSource.language
    : (
      Array.isArray(safeSource.languages) && safeSource.languages.length
        ? safeSource.languages
        : (Array.isArray(safeSource.language)
          ? safeSource.language
          : (Array.isArray(safeSource.languages) ? safeSource.languages : []))
    );
  const languageRows = languageSource.map(normalizeLanguageItem);
  normalized.language = languageRows;
  normalized.languages = languageRows;
  normalized.research = Array.isArray(safeSource.research) ? safeSource.research.map(normalizeResearchItem) : [];
  normalized.practice = Array.isArray(safeSource.practice) ? safeSource.practice.map(normalizePracticeItem) : [];
  normalized.papers = Array.isArray(safeSource.papers) ? safeSource.papers.map(normalizePaperItem) : [];
  if (isPlainRecord(safeSource.application)) {
    normalized.application = normalizeApplicationData(safeSource.application);
  }
  ['patents', 'student_work', 'certificates'].forEach(key => {
    if (!Array.isArray(normalized[key])) normalized[key] = [];
  });
  if (!normalized.files || typeof normalized.files !== 'object' || Array.isArray(normalized.files)) normalized.files = {};
  return normalized;
}

function awardTemplate(d = {}) {
  const item = normalizeAwardItem(d);
  const value = key => escHtml(item[key]);
  return `
  <div class="grid g2">
    <div class="field"><label>时间 <span style="color:#e53e3e">*</span></label><input data-key="time" value="${value('time')}" placeholder="2025-7"/><div class="field-hint" data-hint-for="time">格式：YYYY-M 或 YYYY-MM</div></div>
    <div class="field"><label>地点（选填）</label><input data-key="location" value="${value('location')}" placeholder="可留空"/><div class="field-hint" data-hint-for="location">留空时，填表程序会跳过地点字段。</div></div>
    <div class="field"><label>奖项类别</label><input data-key="category" value="${value('category')}" placeholder="奖学金 / 荣誉称号 / 竞赛获奖"/></div>
    <div class="field"><label>奖励名称或内容 <span style="color:#e53e3e">*</span></label><input data-key="content" value="${value('content')}" placeholder="请输入奖励名称或内容"/><div class="field-hint" data-hint-for="content"></div></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>奖项级别</label><input data-key="level" value="${value('level')}" placeholder="国家级 / 省级 / 校级"/></div>
    <div class="field"><label>获奖等级</label><input data-key="rank" value="${value('rank')}" placeholder="一等奖 / 金奖"/></div>
    <div class="field"><label>排名 / 团队人数</label><input data-key="teamRank" value="${value('teamRank')}" placeholder="例如 1/4；个人奖填 1/1"/></div>
    <div class="field"><label>主办单位</label><input data-key="organizer" value="${value('organizer')}"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>个人 / 团队</label><input data-key="participationMode" value="${value('participationMode')}" placeholder="个人 / 团队"/></div>
    <div class="field"><label>个人排名</label><input data-key="individualRank" value="${value('individualRank')}" placeholder="个人在团队中的排名"/></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="field"><label>证书文件名</label><input data-key="certificateFileName" value="${value('certificateFileName')}" placeholder="仅记录文件名，不会自动上传"/></div>
    <div class="field"><label>备注</label><textarea data-key="note" style="min-height:60px">${value('note')}</textarea></div>
  </div>`;
}

function renderAwards(items = []) {
  const container = document.getElementById('award-list');
  if (!container) return;
  container.innerHTML = '';
  items.map(normalizeAwardItem).forEach((item, index, all) => {
    const div = document.createElement('div');
    div.className = 'multi-item award-item';
    div.dataset.index = index;
    div.innerHTML = `
      <div class="multi-item-header">
        <span class="multi-item-title">第 ${index + 1} 条 · ${escHtml(item.content || '未填写奖励名称')}</span>
        <span class="award-actions">
          <button class="btn-move" type="button" data-award-move="up"${index === 0 ? ' disabled' : ''}>上移</button>
          <button class="btn-move" type="button" data-award-move="down"${index === all.length - 1 ? ' disabled' : ''}>下移</button>
          <button class="btn-remove" type="button" data-container="award-list">删除</button>
        </span>
      </div>
      ${awardTemplate(item)}`;
    listItemSources.set(div, item);
    container.appendChild(div);
  });
  globalThis.JFOptionsWorkspace?.scheduleRefresh();
}

function refreshAwardOrder() {
  const items = [...document.querySelectorAll('#award-list .award-item')];
  items.forEach((item, index) => {
    item.dataset.index = index;
    const content = item.querySelector('[data-key="content"]')?.value.trim() || '未填写奖励名称';
    const title = item.querySelector('.multi-item-title');
    if (title) title.textContent = `第 ${index + 1} 条 · ${content}`;
    const up = item.querySelector('[data-award-move="up"]');
    const down = item.querySelector('[data-award-move="down"]');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === items.length - 1;
  });
}

function inspectAwardsPayload(payload) {
  const errors = [];
  let rawAwards;
  if (Array.isArray(payload)) {
    rawAwards = payload;
  } else if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    rawAwards = payload.awards;
  }
  if (!Array.isArray(rawAwards)) {
    return { valid: false, errors: ['必须提供 awards 数组，或直接提供奖励数组。'], awards: [] };
  }
  if (rawAwards.length > IMPORT_SECURITY_LIMITS.maxArrayItems) {
    return {
      valid: false,
      errors: [`awards 最多允许 ${IMPORT_SECURITY_LIMITS.maxArrayItems} 条记录。`],
      awards: [],
    };
  }

  rawAwards.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`第 ${index + 1} 条必须是 JSON 对象。`);
      return;
    }
    [...AWARD_STRING_FIELDS, ...AWARD_COMPAT_STRING_FIELDS].forEach(key => {
      const value = item[key];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        errors.push(`第 ${index + 1} 条的 ${key} 必须是字符串。`);
      } else if (typeof value === 'string' && value.length > IMPORT_SECURITY_LIMITS.maxStringLength) {
        errors.push(`第 ${index + 1} 条的 ${key} 超过 ${IMPORT_SECURITY_LIMITS.maxStringLength} 个字符。`);
      }
    });
    if (item.attachments !== undefined && (!Array.isArray(item.attachments) || item.attachments.some(value => typeof value !== 'string'))) {
      errors.push(`第 ${index + 1} 条的 attachments 必须是 fileId 字符串数组。`);
    }
    const normalized = normalizeAwardItem(item);
    if (!normalized.time) errors.push(`第 ${index + 1} 条缺少时间。`);
    else if (!AWARD_DATE_PATTERN.test(normalized.time)) {
      errors.push(`第 ${index + 1} 条时间“${normalized.time}”格式不正确，应为 YYYY-M 或 YYYY-MM。`);
    }
    if (!normalized.content) errors.push(`第 ${index + 1} 条缺少奖励名称或内容。`);
  });

  return { valid: errors.length === 0, errors, awards: rawAwards.map(normalizeAwardItem) };
}

function setAwardValidationSummary(validation) {
  const summary = document.getElementById('award-validation-summary');
  if (!summary) return;
  summary.className = `award-validation-summary ${validation.valid ? 'ok' : 'error'}`;
  summary.textContent = validation.valid
    ? `✅ 数据格式检查通过：共 ${validation.count} 条奖励。地点为空的字段将在填表时跳过。`
    : `❌ 发现 ${validation.errors.length} 个问题：\n${validation.errors.map(item => `• ${item}`).join('\n')}`;
}

function validateAwards(items, { render = false } = {}) {
  const awards = (items || []).map(normalizeAwardItem);
  const errors = [];
  let firstElement = null;

  if (render) {
    document.querySelectorAll('#award-list .field-invalid, #award-list .field-warning').forEach(el => {
      el.classList.remove('field-invalid', 'field-warning');
      el.removeAttribute('aria-invalid');
    });
    document.querySelectorAll('#award-list .field-hint').forEach(el => {
      el.classList.remove('error', 'warning');
      if (el.dataset.hintFor === 'time') el.textContent = '格式：YYYY-M 或 YYYY-MM';
      else if (el.dataset.hintFor === 'location') el.textContent = '留空时，填表程序会跳过地点字段。';
      else el.textContent = '';
    });
  }

  const markError = (index, key, message) => {
    errors.push(`第 ${index + 1} 条：${message}`);
    if (!render) return;
    const row = document.querySelectorAll('#award-list .award-item')[index];
    const input = row?.querySelector(`[data-key="${key}"]`);
    const hint = row?.querySelector(`[data-hint-for="${key}"]`);
    input?.classList.add('field-invalid');
    input?.setAttribute('aria-invalid', 'true');
    if (hint) {
      hint.textContent = message;
      hint.classList.add('error');
    }
    if (!firstElement && input) firstElement = input;
  };

  awards.forEach((award, index) => {
    if (!award.time) markError(index, 'time', '时间不能为空。');
    else if (!AWARD_DATE_PATTERN.test(award.time)) {
      markError(index, 'time', '日期格式应为 YYYY-M 或 YYYY-MM，例如 2025-7。');
    }
    if (!award.content) markError(index, 'content', '奖励名称或内容不能为空。');
  });

  const validation = { valid: errors.length === 0, errors, count: awards.length, firstElement };
  if (render) setAwardValidationSummary(validation);
  return validation;
}

function parseAwardBatch(text) {
  const source = text.trim();
  if (!source) throw new Error('请先粘贴要导入的奖励数据。');

  if (source.startsWith('[') || source.startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(source); }
    catch (error) { throw new Error(`JSON 格式错误：${error.message}`); }
    validateImportPayload(parsed, { allowAwardsArray: true });
    const inspection = inspectAwardsPayload(parsed);
    if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
    return inspection.awards;
  }

  const awards = source.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const columns = line.split('\t');
    if (columns.length < 3) {
      throw new Error(`第 ${index + 1} 行不足 3 列，请使用 Tab 分隔时间、地点和内容。`);
    }
    return normalizeAwardItem(Object.fromEntries(AWARD_TSV_FIELDS.map((key, i) => [key, columns[i] || ''])));
  });
  const inspection = inspectAwardsPayload(awards);
  if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
  return inspection.awards;
}

function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href, download: fileName });
  a.click();
  URL.revokeObjectURL(href);
}

// ===== 渲染多条目列表 =====
const listItemSources = new WeakMap();

function appendListItem(container, item, templateFn, labelFn, i) {
  item = isPlainRecord(item) ? cloneSafeMergeValue(item, `${container.id}[${i}]`) : {};
  const div = document.createElement('div');
  div.className = 'multi-item';
  div.dataset.index = i;
  div.innerHTML = `
    <div class="multi-item-header">
      <span class="multi-item-title">${escHtml(labelFn(item, i))}</span>
      <button class="btn-remove" type="button">删除</button>
    </div>
    ${templateFn(item)}`;
  listItemSources.set(div, item);
  container.appendChild(div);
  globalThis.JFOptionsWorkspace?.scheduleRefresh();
  return div;
}

function renderList(containerId, items, templateFn, labelFn) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  (items || []).forEach((item, i) => appendListItem(container, item, templateFn, labelFn, i));
}

function getLabelFn(type) {
  const fns = {
    edu:    (d, i) => `第 ${i+1} 条 · ${d.school||''}  ${d.degree||''}`,
    intern: (d, i) => `第 ${i+1} 条 · ${d.company||''}  ${d.position||''}`,
    work:   (d, i) => `第 ${i+1} 条 · ${d.company||''}  ${d.position||''}`,
    proj:   (d, i) => `第 ${i+1} 条 · ${d.name||''}`,
    research: (d, i) => `第 ${i+1} 条 · ${d.name||'未填写科研名称'}`,
    practice: (d, i) => `第 ${i+1} 条 · ${d.location||'未填写地点'}`,
    lang:   (d, i) => `第 ${i+1} 条 · ${d.language||''}  ${d.certificate||''}`,
    paper:  (d, i) => `第 ${i+1} 条 · ${(d.title||'').slice(0,30)}...`,
    family: (d, i) => `第 ${i+1} 条 · ${d.name||'未填写姓名'}  ${d.relationship||''}`,
  };
  return fns[type];
}

// ===== 从 DOM 收集某个 multi-item 的数据 =====
function collectItem(itemEl) {
  const data = {};
  itemEl.querySelectorAll('[data-key]').forEach(el => {
    data[el.dataset.key] = el.value.trim();
  });
  return data;
}

function collectList(containerId) {
  return [...document.querySelectorAll(`#${containerId} .multi-item`)].map((itemEl, index) => {
    const base = listItemSources.get(itemEl);
    const safeBase = isPlainRecord(base) ? cloneSafeMergeValue(base, `${containerId}[${index}]`) : {};
    return { ...safeBase, ...collectItem(itemEl) };
  });
}

function collectAwardRows() {
  return [...document.querySelectorAll('#award-list .award-item')].map((itemEl, index) => {
    const source = listItemSources.get(itemEl) || loadedResumeData.awards?.[index];
    const safeSource = isPlainRecord(source) ? cloneSafeMergeValue(source, `awards[${index}]`) : {};
    const collected = collectItem(itemEl);
    const category = Object.prototype.hasOwnProperty.call(collected, 'category')
      ? collected.category
      : canonicalOrAliasValue(safeSource, 'category', AWARD_CATEGORY_CANONICAL_ALIASES.category);
    return normalizeAwardItem(replaceCanonicalFields(
      { ...safeSource, ...collected },
      AWARD_CATEGORY_CANONICAL_ALIASES,
      { category },
    ));
  });
}

function refreshListOrder(container) {
  if (!container) return;
  [...container.querySelectorAll(':scope > .multi-item')].forEach((item, index) => {
    item.dataset.index = index;
    const title = item.querySelector('.multi-item-title');
    if (title) title.textContent = title.textContent.replace(/^第\s*\d+\s*条/, `第 ${index + 1} 条`);
  });
}

// ===== 收集整个表单 =====
let loadedResumeData = {};

function collectAll() {
  const v = id => document.getElementById(id)?.value.trim() || '';
  const loadedBasic = isPlainRecord(loadedResumeData.basic) ? loadedResumeData.basic : {};
  const loadedPersonal = isPlainRecord(loadedResumeData.personal) ? loadedResumeData.personal : {};
  const loadedContact = isPlainRecord(loadedResumeData.contact) ? loadedResumeData.contact : {};
  const loadedApplication = isPlainRecord(loadedResumeData.application) ? loadedResumeData.application : {};
  const hometownProvince = v('p_hometown_province');
  const hometownCity = v('p_hometown_city');
  const loadedHometownProvince = firstNonEmptyAliasValue(
    loadedPersonal,
    ['hometown_province', 'hometownProvince'],
    firstNonEmptyAliasValue(loadedBasic, ['hometown_province', 'hometownProvince']),
  );
  const loadedHometownCity = firstNonEmptyAliasValue(
    loadedPersonal,
    ['hometown_city', 'hometownCity'],
    firstNonEmptyAliasValue(loadedBasic, ['hometown_city', 'hometownCity']),
  );
  const hometownPartsChanged = hometownProvince !== loadedHometownProvince || hometownCity !== loadedHometownCity;
  const generatedHometownRegion = [hometownProvince, hometownCity].filter(Boolean).join(' / ');
  const existingHometownRegion = firstNonEmptyAliasValue(loadedBasic, ['hometownRegion', 'hometown_region']);
  const hometownRegion = hometownPartsChanged
    ? generatedHometownRegion
    : (existingHometownRegion || generatedHometownRegion);
  const personal = {
    ...replaceCanonicalFields(
      { ...loadedPersonal, ...loadedBasic },
      PERSONAL_UI_CANONICAL_ALIASES,
    ),
    name: v('p_name'), namePinyin: v('p_namePinyin'), healthStatus: v('p_healthStatus'),
    gender: v('p_gender'), birthday: v('p_birthday'), age: v('p_age'),
    phone: v('p_phone'), email: v('p_email'), wechat: v('p_wechat'), qq: v('p_qq'),
    id_number: v('p_id_number'), political: v('p_political'), ethnicity: v('p_ethnicity'), militaryStatus: v('p_militaryStatus'),
    nationality: v('p_nationality'), hometown_province: hometownProvince,
    hometown_city: hometownCity, current_city: v('p_current_city'),
    address: v('p_address'), marital: v('p_marital'), height: v('p_height'),
    household_address: v('p_household_address'), mailing_address: v('c_address'),
    postal_code: v('c_postcode'), archive_organization: v('c_archive_organization'),
    archive_address: v('c_archive_address'), archive_postcode: v('c_archive_postcode'),
  };
  const educationRows = collectList('edu-list').map(normalizeEducationItem);
  const internshipRows = collectList('intern-list').map(normalizeStudyWorkItem);
  const familyRows = collectList('family-list').map(normalizeFamilyItem);
  const languageRows = collectList('lang-list');
  const awardRows = collectAwardRows();
  const next = {
    ...loadedResumeData,
    profileName: v('profile_name') || '默认申请资料',
    personal,
    basic: replaceCanonicalFields({
      ...replaceCanonicalFields(loadedBasic, BASIC_UI_CANONICAL_ALIASES), ...personal,
      namePinyin: personal.namePinyin, healthStatus: personal.healthStatus,
      political: normalizePoliticalStatus(personal.political),
      householdAddress: v('p_household_address'),
    }, BASIC_UI_CANONICAL_ALIASES, {
      idType: v('p_idType'),
      birthplaceRegion: v('p_birthplaceRegion'),
      hometownRegion,
      householdRegion: v('p_householdRegion'),
    }),
    contact: replaceCanonicalFields({
      ...loadedContact, phone: personal.phone, email: personal.email, landline: v('c_landline'),
      wechat: personal.wechat, qq: personal.qq, currentCity: personal.current_city,
      address: v('c_address'), postcode: v('c_postcode'),
      archiveOrganization: v('c_archive_organization'),
      archiveAddress: v('c_archive_address'),
      archivePostcode: v('c_archive_postcode'),
    }, CONTACT_UI_CANONICAL_ALIASES, {
      archiveRegion: v('c_archiveRegion'),
      emergencyPhone: v('c_emergencyPhone'),
    }),
    intention: {
      status: v('i_status'), type: v('i_type'), industry: v('i_industry'),
      position: v('i_position'), city: v('i_city'), salary: v('i_salary'), available: v('i_available'),
    },
    education:   educationRows,
    internship:  internshipRows,
    internships: internshipRows,
    work:        collectList('work-list'),
    projects:    collectList('proj-list'),
    research:    collectList('research-list').map(normalizeResearchItem),
    practice:    collectList('practice-list').map(normalizePracticeItem),
    awards: awardRows,
    skills: Array.isArray(loadedResumeData.skills) ? loadedResumeData.skills : {
      ...(loadedResumeData.skills || {}),
      tech: v('s_tech'), workplace: v('s_workplace'), interests: v('s_interests'),
      career_plan: v('s_career_plan'), certificates: v('s_certificates'), cover_letter: v('s_cover_letter'),
    },
    languages: languageRows,
    language: languageRows,
    papers:      collectList('paper-list').map(normalizePaperItem),
    intro: v('intro'), github: v('github'), homepage: v('homepage'),
    application: normalizeApplicationData(replaceCanonicalFields(
      loadedApplication,
      APPLICATION_UI_CANONICAL_ALIASES,
      {
        disciplinaryHistory: v('app_disciplinaryHistory'),
        personalStatement: v('app_personalStatement'),
        notes: v('app_notes'),
      },
    )),
    family: familyRows,
    customFields: collectCustomFields(),
  };
  return normalizeResumeData(next);
}

// ===== 导入合并：新有值则更新，新无值则保留旧值 =====
function cloneSafeMergeValue(value, path) {
  if (Array.isArray(value)) return value.map((item, index) => cloneSafeMergeValue(item, `${path}[${index}]`));
  if (isPlainRecord(value)) return mergeResumeData({}, value, path);
  return value;
}

function mergeResumeData(oldData, newData, path = 'root') {
  if (newData !== null && newData !== undefined && !isPlainRecord(newData)) {
    throw new Error(`${path} 必须是普通 JSON 对象`);
  }
  const oldRecord = isPlainRecord(oldData) ? oldData : {};
  const newRecord = isPlainRecord(newData) ? newData : {};
  const result = {};

  for (const key of Object.keys(oldRecord)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) throw new Error(`${path} 包含禁止字段 ${key}`);
    result[key] = cloneSafeMergeValue(oldRecord[key], `${path}.${key}`);
  }

  for (const key of Object.keys(newRecord)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) throw new Error(`${path} 包含禁止字段 ${key}`);
    const nv = newRecord[key];
    const ov = oldRecord[key];
    if (nv === null || nv === undefined || nv === '') continue; // 新值为空，保留旧值
    if (Array.isArray(nv)) {
      if (nv.length === 0) continue;
      const oldArr = Array.isArray(ov) ? ov : [];
      // 按索引合并：新条目更新旧条目对应字段，旧有而新无的条目保留
      const len = Math.max(nv.length, oldArr.length);
      result[key] = Array.from({ length: len }, (_, i) => {
        const itemPath = `${path}.${key}[${i}]`;
        if (i >= nv.length) return cloneSafeMergeValue(oldArr[i], itemPath);
        if (i >= oldArr.length) return cloneSafeMergeValue(nv[i], itemPath);
        return isPlainRecord(nv[i])
          ? mergeResumeData(oldArr[i], nv[i], itemPath)
          : cloneSafeMergeValue(
            nv[i] !== '' && nv[i] !== null && nv[i] !== undefined ? nv[i] : oldArr[i],
            itemPath,
          );
      });
    } else if (isPlainRecord(nv)) {
      result[key] = mergeResumeData(ov, nv, `${path}.${key}`);
    } else if (typeof nv === 'object') {
      throw new Error(`${path}.${key} 必须是普通 JSON 对象`);
    } else {
      result[key] = nv; // 基本类型：新值覆盖
    }
  }
  return result;
}

// 导入统一入口：读旧数据 → 合并 → 保存 → 刷新表单
async function importMergeAndSave(newData) {
  const validated = validateImportPayload(newData);
  const incoming = { ...validated };
  if (!Object.prototype.hasOwnProperty.call(incoming, 'internships')
      && Object.prototype.hasOwnProperty.call(incoming, 'internship')) {
    incoming.internships = incoming.internship;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'awards')) {
    const inspection = inspectAwardsPayload(incoming);
    if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
    incoming.awards = inspection.awards;
  }
  const { resumeData: existing } = await chrome.storage.local.get('resumeData');
  const merged = normalizeResumeData(mergeResumeData(normalizeResumeData(existing || {}), incoming));
  fillForm(merged);
  await chrome.storage.local.set({ resumeData: merged });
  globalThis.JFOptionsWorkspace?.saved(undefined, '导入已保存，请检查资料。空白导入字段保留原有内容。');
  return merged;
}

// ===== 填充表单 =====
function fillForm(data) {
  if (!data) return;
  const normalized = normalizeResumeData(data);
  loadedResumeData = normalized;
  const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
  set('profile_name', normalized.profileName);
  const p = { ...(normalized.personal || {}), ...(normalized.basic || {}) };
  Object.keys(p).forEach(k => set('p_'+k, p[k]));
  set('p_namePinyin', normalized.basic?.namePinyin || '');
  set('p_healthStatus', normalized.basic?.healthStatus || '');
  set('p_political', normalizePoliticalStatus(normalized.basic?.political || ''));
  set('p_militaryStatus', normalized.basic?.militaryStatus || normalized.personal?.militaryStatus || '');
  set('p_idType', normalized.basic?.idType || '');
  set('p_birthplaceRegion', normalized.basic?.birthplaceRegion || '');
  set('p_hometown_province', normalized.basic?.hometownProvince || normalized.personal?.hometown_province || '');
  set('p_hometown_city', normalized.basic?.hometownCity || normalized.personal?.hometown_city || '');
  set('p_householdRegion', normalized.basic?.householdRegion || '');
  const contact = normalized.contact || {};
  set('p_household_address', normalized.basic?.householdAddress || '');
  set('c_address', contact.address || '');
  set('c_landline', contact.landline || '');
  set('c_postcode', contact.postcode || '');
  set('c_archive_organization', contact.archiveOrganization || '');
  set('c_archiveRegion', contact.archiveRegion || '');
  set('c_archive_address', contact.archiveAddress || '');
  set('c_archive_postcode', contact.archivePostcode || '');
  set('c_emergencyPhone', contact.emergencyPhone || '');
  const it = normalized.intention || {};
  Object.keys(it).forEach(k => set('i_'+k, it[k]));
  const s = normalized.skills || {};
  Object.keys(s).forEach(k => set('s_'+k, s[k]));
  set('intro', normalized.intro); set('github', normalized.github);
  set('homepage', normalized.homepage);
  set('app_disciplinaryHistory', normalized.application?.disciplinaryHistory || '');
  set('app_personalStatement', normalized.application?.personalStatement || '');
  set('app_notes', normalized.application?.notes || '');

  renderList('edu-list',    normalized.education,  eduTemplate,   getLabelFn('edu'));
  renderList('intern-list', normalized.internships, internTemplate, getLabelFn('intern'));
  renderList('work-list',   normalized.work,       workTemplate,  getLabelFn('work'));
  renderList('proj-list',   normalized.projects,   projTemplate,  getLabelFn('proj'));
  renderList('research-list', normalized.research, researchTemplate, getLabelFn('research'));
  renderList('practice-list', normalized.practice, practiceTemplate, getLabelFn('practice'));
  renderAwards(normalized.awards);
  renderList('lang-list',   normalized.languages,  langTemplate,  getLabelFn('lang'));
  renderList('paper-list',  normalized.papers,     paperTemplate, getLabelFn('paper'));
  renderList('family-list', normalized.family,     familyTemplate, getLabelFn('family'));
  if (normalized.customFields) renderCustomFields(normalized.customFields);
  updateApplicationCharacterCounters();
  globalThis.JFOptionsWorkspace?.scheduleRefresh();
}

const APPLICATION_TEXT_CONTROLS = Object.freeze([
  ['app_disciplinaryHistory', 'app_disciplinaryHistory_count'],
  ['app_personalStatement', 'app_personalStatement_count'],
  ['app_notes', 'app_notes_count'],
]);

function updateApplicationCharacterCounters() {
  APPLICATION_TEXT_CONTROLS.forEach(([inputId, counterId]) => {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    if (input && counter) counter.textContent = String(input.value.length);
  });
}

document.getElementById('sec-application')?.addEventListener('input', event => {
  if (!APPLICATION_TEXT_CONTROLS.some(([inputId]) => inputId === event.target.id)) return;
  updateApplicationCharacterCounters();
  updateNavCounts();
});

// ===== 初始化 =====
async function init() {
  const { resumeData } = await chrome.storage.local.get('resumeData');
  if (resumeData && typeof resumeData === 'object' && !Array.isArray(resumeData)) {
    const normalized = normalizeResumeData(resumeData);
    loadedResumeData = normalized;
    fillForm(normalized);
    if (!Array.isArray(resumeData.awards) || !resumeData.profileName) {
      await chrome.storage.local.set({ resumeData: normalized });
    }
  } else {
    try {
      const res = await fetch(chrome.runtime.getURL('resume-data.example.json'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      loadedResumeData = normalizeResumeData(data);
      fillForm(data);
    } catch { /* 内置示例不可用时保持空表单。 */ }
  }
  // 延迟一帧确保 DOM 渲染完毕后再统计
  requestAnimationFrame(updateNavCounts);
  globalThis.JFOptionsWorkspace?.loaded();
}

// ===== 删除条目（事件委托）=====
document.addEventListener('click', async e => {
  // 删除多条目
  const removeButton = e.target.closest('.btn-remove');
  if (removeButton) {
    const item = removeButton.closest('.multi-item');
    if (!item) return;
    if (globalThis.JFOptionsWorkspace && !await globalThis.JFOptionsWorkspace.confirmRemoval()) return;
    const isAward = item?.classList.contains('award-item');
    const container = item?.parentElement;
    item?.remove();
    if (isAward) refreshAwardOrder();
    else refreshListOrder(container);
    globalThis.JFOptionsWorkspace?.markDirty();
    updateNavCounts();
    return;
  }
  // 删除自定义字段
  const customRemove = e.target.closest('.btn-del-custom,[data-del-key]');
  if (customRemove) {
    if (globalThis.JFOptionsWorkspace && !await globalThis.JFOptionsWorkspace.confirmRemoval()) return;
    const key = customRemove.dataset.delKey;
    document.querySelector(`.custom-field-row[data-custom-key="${key}"]`)?.remove();
    document.querySelectorAll('.custom-fields-wrap').forEach(w => {
      if (!w.querySelector('.custom-field-row')) w.remove();
    });
    globalThis.JFOptionsWorkspace?.markDirty();
    updateNavCounts();
  }
});

// ===== 添加按钮 =====
const addConfigs = [
  { btn: 'edu-add',    list: 'edu-list',    tpl: eduTemplate,   label: getLabelFn('edu'),   def: {} },
  { btn: 'intern-add', list: 'intern-list', tpl: internTemplate,label: getLabelFn('intern'),def: {} },
  { btn: 'work-add',   list: 'work-list',   tpl: workTemplate,  label: getLabelFn('work'),  def: {} },
  { btn: 'proj-add',   list: 'proj-list',   tpl: projTemplate,  label: getLabelFn('proj'),  def: {} },
  { btn: 'research-add', list: 'research-list', tpl: researchTemplate, label: getLabelFn('research'), def: {} },
  { btn: 'practice-add', list: 'practice-list', tpl: practiceTemplate, label: getLabelFn('practice'), def: {} },
  { btn: 'lang-add',   list: 'lang-list',   tpl: langTemplate,  label: getLabelFn('lang'),  def: {} },
  { btn: 'paper-add',  list: 'paper-list',  tpl: paperTemplate, label: getLabelFn('paper'), def: {} },
  { btn: 'family-add', list: 'family-list', tpl: familyTemplate,label: getLabelFn('family'),def: {} },
];

addConfigs.forEach(({ btn, list, tpl, label }) => {
  document.getElementById(btn).addEventListener('click', () => {
    const container = document.getElementById(list);
    const i = container.querySelectorAll('.multi-item').length;
    const div = appendListItem(container, {}, tpl, label, i);
    globalThis.JFOptionsWorkspace?.markDirty();
    div.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateNavCounts();
  });
});

document.getElementById('award-add').addEventListener('click', () => {
  const awards = collectAwardRows();
  awards.push(normalizeAwardItem());
  renderAwards(awards);
  globalThis.JFOptionsWorkspace?.markDirty();
  const added = document.querySelector('#award-list .award-item:last-child');
  added?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  added?.querySelector('[data-key="time"]')?.focus();
  updateNavCounts();
});

document.getElementById('award-list').addEventListener('click', event => {
  const button = event.target.closest('[data-award-move]');
  if (!button || button.disabled) return;
  const rows = [...document.querySelectorAll('#award-list .award-item')];
  const row = button.closest('.award-item');
  const index = rows.indexOf(row);
  const targetIndex = index + (button.dataset.awardMove === 'up' ? -1 : 1);
  if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return;
  const awards = collectAwardRows();
  [awards[index], awards[targetIndex]] = [awards[targetIndex], awards[index]];
  renderAwards(awards);
  globalThis.JFOptionsWorkspace?.markDirty();
  document.querySelectorAll('#award-list .award-item')[targetIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  updateNavCounts();
});

document.getElementById('award-list').addEventListener('input', event => {
  if (event.target.matches('[data-key="content"]')) refreshAwardOrder();
  if (event.target.matches('[data-key="time"], [data-key="content"]')) {
    event.target.classList.remove('field-invalid');
    event.target.removeAttribute('aria-invalid');
    const hint = event.target.closest('.field')?.querySelector('.field-hint');
    if (hint) {
      hint.classList.remove('error');
      hint.textContent = event.target.dataset.key === 'time' ? '格式：YYYY-M 或 YYYY-MM' : '';
    }
  }
});

document.getElementById('award-list').addEventListener('focusout', event => {
  if (event.target.matches('[data-key="time"], [data-key="content"]')) {
    validateAwards(collectAwardRows(), { render: true });
  }
});

const awardImportPanel = document.getElementById('award-import-panel');
document.getElementById('award-import-toggle').addEventListener('click', () => {
  awardImportPanel.classList.toggle('open');
  if (awardImportPanel.classList.contains('open')) document.getElementById('award-import-text').focus();
});
document.getElementById('award-import-cancel').addEventListener('click', () => {
  awardImportPanel.classList.remove('open');
  document.getElementById('award-import-text').value = '';
});
document.getElementById('award-import-confirm').addEventListener('click', async () => {
  globalThis.JFOptionsWorkspace?.importing();
  try {
    const imported = parseAwardBatch(document.getElementById('award-import-text').value);
    const existing = collectAwardRows();
    const awards = [...existing, ...imported];
    renderAwards(awards);
    const validation = validateAwards(awards, { render: true });
    if (!validation.valid) throw new Error(validation.errors.join('\n'));
    const resumeData = collectAll();
    await chrome.storage.local.set({ resumeData });
    loadedResumeData = resumeData;
    awardImportPanel.classList.remove('open');
    document.getElementById('award-import-text').value = '';
    updateNavCounts();
    globalThis.JFOptionsWorkspace?.saved(undefined, '奖励导入已保存，请检查新增记录。');
    showToast(`✅ 已导入并保存 ${imported.length} 条奖励`);
  } catch (error) {
    globalThis.JFOptionsWorkspace?.markDirty();
    globalThis.JFOptionsWorkspace?.failed('import');
    showToast(`❌ ${String(error.message || error).split('\n')[0]}`);
    const summary = document.getElementById('award-validation-summary');
    summary.className = 'award-validation-summary error';
    summary.textContent = `❌ 批量导入失败：\n${error.message || error}`;
  }
});

document.getElementById('award-export').addEventListener('click', () => {
  const data = collectAll();
  const validation = validateAwards(data.awards, { render: true });
  if (!validation.valid) {
    showToast(`❌ 请先修正 ${validation.errors.length} 处奖励数据`);
    validation.firstElement?.focus();
    return;
  }
  downloadJson({ profileName: data.profileName, awards: data.awards }, 'awards-data.json');
  showToast('⬇ 已导出 awards-data.json');
});

document.getElementById('award-validate').addEventListener('click', () => {
  const awards = collectAwardRows();
  const validation = validateAwards(awards, { render: true });
  showToast(validation.valid ? '✅ 奖励数据格式正确' : `❌ 发现 ${validation.errors.length} 个问题`);
  if (!validation.valid) validation.firstElement?.focus();
});

// ===== 保存 =====
document.getElementById('btn-save').addEventListener('click', async () => {
  const data = collectAll();
  const validation = validateAwards(data.awards, { render: true });
  if (!validation.valid) {
    globalThis.JFOptionsWorkspace?.failed('save', '请先修正奖励信息中的格式问题，再保存申请资料。');
    showToast(`❌ 奖励数据有 ${validation.errors.length} 处需修正`);
    validation.firstElement?.focus();
    return;
  }
  const revision = globalThis.JFOptionsWorkspace?.beginSave();
  try {
    await chrome.storage.local.set({ resumeData: data });
    loadedResumeData = data;
    globalThis.JFOptionsWorkspace?.saved(revision);
    showToast('✅ 保存成功');
    updateNavCounts();
  } catch (_error) {
    globalThis.JFOptionsWorkspace?.failed('save');
    showToast('保存失败，请重试；编辑内容仍保留在页面中。');
  }
});

// ===== 导出 JSON =====
document.getElementById('btn-export').addEventListener('click', () => {
  const data = collectAll();
  const validation = validateAwards(data.awards, { render: true });
  if (!validation.valid) {
    showToast(`❌ 请先修正 ${validation.errors.length} 处奖励数据`);
    validation.firstElement?.focus();
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: 'resume-data.json'
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('⬇ 已导出 resume-data.json');
});

// ===== 导出 Markdown =====
document.getElementById('btn-export-md').addEventListener('click', () => {
  const d = collectAll();
  const p = d.personal || {};
  const lines = [];
  lines.push(`# ${p.name || '简历'}`);
  lines.push('');
  lines.push('## 个人信息');
  const basic = d.basic || {};
  const contact = d.contact || {};
  const pFields = [
    ['姓名拼音', basic.namePinyin], ['健康状况', basic.healthStatus],
    ['证件类型', basic.idType], ['出生地', basic.birthplaceRegion],
    ['性别', p.gender], ['出生日期', p.birthday], ['手机', p.phone],
    ['邮箱', p.email], ['微信', p.wechat], ['政治面貌', p.political],
    ['民族', p.ethnicity], ['籍贯所在地', basic.hometownRegion || `${p.hometown_province||''}${p.hometown_city||''}`],
    ['现居城市', p.current_city], ['婚姻状况', p.marital],
    ['户口所在地', basic.householdRegion], ['户口所在地详细地址', basic.householdAddress],
    ['通讯地址', contact.address],
    ['通讯地址邮政编码', contact.postcode], ['档案所在单位', contact.archiveOrganization],
    ['档案所在地', contact.archiveRegion], ['档案所在单位地址', contact.archiveAddress],
    ['档案所在单位邮政编码', contact.archivePostcode], ['紧急联系人电话', contact.emergencyPhone],
  ];
  pFields.forEach(([k, v]) => { if (v) lines.push(`- **${k}**：${v}`); });
  lines.push('');

  const it = d.intention || {};
  if (Object.values(it).some(Boolean)) {
    lines.push('## 求职意向');
    [['求职类型', it.type], ['期望岗位', it.position], ['期望城市', it.city],
     ['期望薪资', it.salary], ['到岗时间', it.available]].forEach(([k, v]) => {
      if (v) lines.push(`- **${k}**：${v}`);
    });
    lines.push('');
  }

  if (d.education?.length) {
    lines.push('## 教育背景');
    d.education.forEach(e => {
      lines.push(`### ${e.school || ''}（${e.educationLevel || e.degree || ''}）`);
      lines.push(`${e.startDate || e.start || ''} ~ ${e.endDate || e.end || ''}　专业：${e.major || ''}`);
      if (e.schoolCode) lines.push(`所在学校代码：${e.schoolCode}`);
      if (e.college) lines.push(`所在院系：${e.college}`);
      if (e.studentId) lines.push(`在校生注册学号：${e.studentId}`);
      if (e.studyDuration) lines.push(`本科学制：${e.studyDuration}`);
      if (e.cet4Score) lines.push(`大学英语四级成绩：${e.cet4Score}`);
      if (e.cet6Score) lines.push(`大学英语六级成绩：${e.cet6Score}`);
      if (e.eliteTrainingBase) lines.push(`是否来自拔尖人才培养基地：${e.eliteTrainingBase}`);
      if (e.eliteTrainingBaseName) lines.push(`拔尖人才培养基地名称：${e.eliteTrainingBaseName}`);
      if (e.majorRankPercent) lines.push(`专业排名百分比：${e.majorRankPercent}`);
      if (e.majorRank || e.majorRankTotal) lines.push(`专业排名：${e.majorRank || ''}${e.majorRankTotal ? ` / ${e.majorRankTotal}` : ''}`);
      if (e.gpa) lines.push(`成绩绩点 / 总绩点：${e.gpa}${e.rank ? `　排名：${e.rank}` : ''}`);
      if (e.honors) lines.push(`荣誉：${e.honors}`);
      lines.push('');
    });
  }

  const expSections = [
    ['学习和工作经历', d.internships], ['工作经历（旧版独立栏目）', d.work],
  ];
  expSections.forEach(([title, list]) => {
    if (!list?.length) return;
    lines.push(`## ${title}`);
    list.forEach(e => {
      lines.push(`### ${e.company || ''}　${e.position || ''}`);
      lines.push(`${e.startDate || e.start || ''} ~ ${e.endDate || e.end || ''}${e.location ? `　${e.location}` : ''}`);
      if (e.description || e.desc) lines.push(`\n${e.description || e.desc}`);
      lines.push('');
    });
  });

  if (d.research?.length) {
    lines.push('## 科研工作');
    d.research.forEach((item, index) => {
      lines.push(`### 第 ${index + 1} 条 · ${item.name || ''}`);
      if (item.startDate || item.endDate) lines.push(`${item.startDate || ''} ~ ${item.endDate || ''}`);
      if (item.advisor) lines.push(`指导教师：${item.advisor}`);
      if (item.level) lines.push(`级别：${item.level}`);
      if (item.contribution) lines.push(`主要贡献：${item.contribution}`);
      lines.push('');
    });
  }

  if (d.practice?.length) {
    lines.push('## 学生干部 / 实习实践经历');
    d.practice.forEach((item, index) => {
      lines.push(`### 第 ${index + 1} 条`);
      if (item.startDate || item.endDate) lines.push(`${item.startDate || ''} ~ ${item.endDate || ''}`);
      if (item.location) lines.push(`地点：${item.location}`);
      if (item.description) lines.push(`主要内容：${item.description}`);
      lines.push('');
    });
  }

  if (d.family?.length) {
    lines.push('## 家庭主要成员及主要社会关系');
    d.family.forEach((member, index) => {
      lines.push(`### 第 ${index + 1} 条 · ${member.name || ''}（${member.relationship || ''}）`);
      if (member.employer || member.position) lines.push(`单位及职务：${member.employer || ''} ${member.position || ''}`.trim());
      if (member.phone) lines.push(`联系电话：${member.phone}`);
      if (member.description) lines.push(member.description);
      lines.push('');
    });
  }

  if (d.projects?.length) {
    lines.push('## 项目经历');
    d.projects.forEach(e => {
      lines.push(`### ${e.name || ''}（${e.role || ''}）`);
      lines.push(`${e.start || ''} ~ ${e.end || ''}`);
      if (e.url) lines.push(`链接：${e.url}`);
      if (e.desc) lines.push(`\n${e.desc}`);
      lines.push('');
    });
  }

  if (d.awards?.length) {
    lines.push('## 奖励与荣誉');
    d.awards.forEach((award, index) => {
      lines.push(`### 第 ${index + 1} 条 · ${award.content || ''}`);
      lines.push(`- 时间：${award.time || ''}`);
      if (award.location) lines.push(`- 地点：${award.location}`);
      if (award.category) lines.push(`- 奖项类别：${award.category}`);
      if (award.level) lines.push(`- 奖项级别：${award.level}`);
      if (award.rank) lines.push(`- 获奖等级：${award.rank}`);
      if (award.teamRank) lines.push(`- 排名 / 团队人数：${award.teamRank}`);
      if (award.organizer) lines.push(`- 主办单位：${award.organizer}`);
      if (award.certificateFileName) lines.push(`- 证书文件名：${award.certificateFileName}`);
      if (award.note) lines.push(`- 备注：${award.note}`);
      lines.push('');
    });
  }

  const s = d.skills || {};
  if (s.tech || s.workplace || s.certificates) {
    lines.push('## 技能专长');
    if (s.tech) lines.push(s.tech);
    if (s.certificates) lines.push(`\n**证书**：${s.certificates}`);
    lines.push('');
  }

  if (d.intro) {
    lines.push('## 自我评价');
    lines.push(d.intro);
    lines.push('');
  }

  const application = d.application || {};
  if (application.disciplinaryHistory || application.personalStatement || application.notes) {
    lines.push('## 申请附加信息');
    if (application.disciplinaryHistory) lines.push(`**作弊处分等情况**：${application.disciplinaryHistory}`);
    if (application.personalStatement) lines.push(`\n**个人陈述**\n\n${application.personalStatement}`);
    if (application.notes) lines.push(`\n**备注信息**\n\n${application.notes}`);
    lines.push('');
  }

  if (d.github || d.homepage) {
    lines.push('## 链接');
    if (d.github) lines.push(`- GitHub：${d.github}`);
    if (d.homepage) lines.push(`- 主页：${d.homepage}`);
    lines.push('');
  }

  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: 'resume.md'
  });
  a.click();
  showToast('⬇ 已导出 resume.md');
});

// ===== 导入 - 拖放区域 =====
const importZone = document.getElementById('import-zone');
const importFileEl = document.getElementById('importFile');

importZone.addEventListener('click', () => importFileEl.click());

importZone.addEventListener('dragover', e => {
  e.preventDefault();
  importZone.classList.add('drag-over');
});
importZone.addEventListener('dragleave', () => importZone.classList.remove('drag-over'));
importZone.addEventListener('drop', e => {
  e.preventDefault();
  importZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleImportFile(file);
});

importFileEl.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleImportFile(file);
  e.target.value = '';
});

async function handleImportFile(file) {
  globalThis.JFOptionsWorkspace?.importing();
  try {
    return await readImportFile(file);
  } catch (_error) {
    globalThis.JFOptionsWorkspace?.failed('import');
    showToast('导入失败，请检查文件格式后重试。');
  }
}

async function readImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (file.size > 10 * 1024 * 1024) {
    showToast('❌ 文件超过 10MB，本地模式已拒绝导入');
    return;
  }
  if (ext === 'json' && file.size > IMPORT_SECURITY_LIMITS.maxJsonFileBytes) {
    showToast('❌ JSON 文件超过 2MB，本地模式已拒绝导入');
    return;
  }

  if (ext === 'json') {
    try {
      const data = validateImportPayload(JSON.parse(await file.text()));
      if (Object.prototype.hasOwnProperty.call(data, 'awards')) {
        const inspection = inspectAwardsPayload(data);
        if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
        data.awards = inspection.awards;
      }
      await importMergeAndSave(data);
      showToast('✅ JSON 导入成功');
      updateNavCounts();
    } catch (error) {
      showToast(`❌ JSON 导入失败：${String(error.message || error).split('\n')[0]}`);
      const summary = document.getElementById('award-validation-summary');
      if (summary && /awards|奖励|第 \d+ 条|时间/.test(String(error.message || error))) {
        summary.className = 'award-validation-summary error';
        summary.textContent = `❌ 奖励数据校验失败：\n${error.message || error}`;
      }
    }
    return;
  }

  // 提取文本
  let text = '';
  if (ext === 'md' || ext === 'txt') {
    text = await file.text();
  } else if (ext === 'docx') {
    text = await extractDocxText(file);
    if (!text) { showToast('❌ DOCX 解析失败，请转换为 Markdown 后导入'); return; }
  } else if (ext === 'pdf') {
    text = await extractPdfText(file);
    if (!text.trim()) { showToast('❌ PDF 文字提取失败，请转换为 TXT 或 JSON 后导入'); return; }
  } else {
    showToast('❌ 不支持的格式，请使用 JSON / MD / TXT / DOCX / PDF');
    return;
  }

  // 先用规则解析（不消耗 AI token）
  const ruleData = parseResumeText(text);
  const ruleFieldCount = countDataFields(ruleData);
  if (ruleFieldCount >= 3) {
    try {
      await importMergeAndSave(ruleData);
      showToast(`✅ 规则解析导入成功（${ruleFieldCount} 个字段）`);
      updateNavCounts();
    } catch (error) {
      showToast(`❌ 导入失败：${String(error.message || error).split('\n')[0]}`);
    }
    return;
  }

  // 保研本地模式禁止把导入文件发送给 AI；规则不足时明确停止。
  showToast('❌ 本地规则无法可靠解析，请改用 JSON 格式导入');
  return;

  // JobFill 原有 AI 回退代码保留在下方，但本地模式不可达。
  const { aiConfig } = await chrome.storage.local.get('aiConfig');
  if (!aiConfig?.apiKey) {
    showToast('❌ 规则解析字段不足，请在 AI 设置中配置 API Key 后重试');
    return;
  }

  importZone.classList.add('parsing');
  importZone.querySelector('.zone-text').textContent = '⏳ AI 解析中，请稍候...';

  // 模拟进度：快起步 → 慢爬 → 收到结果后跳满
  const bar = document.getElementById('parse-bar');
  let pct = 0;
  const setBar = (v) => { pct = v; bar.style.width = v + '%'; };
  setBar(0);
  // 阶段1：0→18%（0.4s）
  setTimeout(() => setBar(18), 50);
  // 阶段2：慢爬到 82%（每1.2s +5%，共约15s）
  const crawl = setInterval(() => {
    if (pct < 82) setBar(Math.min(82, pct + 5));
    else clearInterval(crawl);
  }, 1200);

  chrome.runtime.sendMessage({
    type: 'AI_PARSE_RESUME',
    provider: aiConfig.provider || 'openai_compat',
    apiKey: aiConfig.apiKey,
    model: aiConfig.model || '',
    baseUrl: aiConfig.baseUrl || '',
    text,
  }, async resp => {
    // 完成：进度跳满再收起
    clearInterval(crawl);
    setBar(100);
    await new Promise(r => setTimeout(r, 400));
    importZone.classList.remove('parsing');
    importZone.querySelector('.zone-text').textContent = '拖放简历文件到此处，或点击上传';
    setBar(0);
    if (chrome.runtime.lastError || resp?.error) {
      const errMsg = resp?.error || chrome.runtime.lastError?.message;
      showToast(`❌ AI 解析失败: ${errMsg}`);
      return;
    }
    await importMergeAndSave(resp.data);
    showToast('✅ AI 解析导入成功');
    updateNavCounts();
  });
}

// ===== 解压工具（返回 ArrayBuffer，调用方自行选择编码）=====
async function tryDecompress(bytes) {
  // PDF FlateDecode 是 zlib(deflate)；DOCX ZIP 条目是 deflate-raw；两者都试
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt));
      return await new Response(stream).arrayBuffer();
    } catch { /* 换下一种 */ }
  }
  return null;
}

// ===== DOCX：解析 ZIP 结构，解压 word/document.xml =====
function findZipEntry(bytes, name) {
  let i = 0;
  while (i < bytes.length - 30) {
    if (bytes[i]===0x50 && bytes[i+1]===0x4B && bytes[i+2]===0x03 && bytes[i+3]===0x04) {
      const method   = bytes[i+8]  | (bytes[i+9]  << 8);
      const compSize = bytes[i+18] | (bytes[i+19]<<8) | (bytes[i+20]<<16) | (bytes[i+21]<<24);
      const fnLen    = bytes[i+26] | (bytes[i+27] << 8);
      const exLen    = bytes[i+28] | (bytes[i+29] << 8);
      const fn       = new TextDecoder('utf-8').decode(bytes.slice(i+30, i+30+fnLen));
      const dataStart = i + 30 + fnLen + exLen;
      if (fn === name) return { method, data: bytes.slice(dataStart, dataStart + compSize) };
      i = dataStart + Math.max(compSize, 0);
    } else { i++; }
  }
  return null;
}

async function extractDocxText(file) {
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) return '';

    const entry = findZipEntry(bytes, 'word/document.xml');
    if (!entry) return '';

    let xmlBuf;
    if (entry.method === 0) {
      xmlBuf = entry.data.buffer;
    } else {
      xmlBuf = await tryDecompress(entry.data);
      if (!xmlBuf) return '';
    }
    const xml = new TextDecoder('utf-8').decode(xmlBuf);
    const matches = [...xml.matchAll(/<w:t[^>]*>([^<]+)<\/w:t>/g)];
    const text = matches.map(m => m[1]).join(' ');
    return text;
  } catch { return ''; }
}

// ===== 规则解析简历文本（MD/TXT/DOCX，无需 AI）=====
function parseResumeText(text) {
  const data = {
    profileName: '默认申请资料',
    personal: {}, intention: {}, education: [], internship: [], work: [],
    projects: [], awards: [], skills: {}, languages: [], papers: [], intro: '',
    github: '', homepage: '', family: '', customFields: []
  };

  // 标签 → 字段映射
  const personalMap = {
    '姓名':'name','名字':'name','姓名拼音':'namePinyin','姓名全拼':'namePinyin',
    '健康状况':'healthStatus','健康状态':'healthStatus','身体健康状况':'healthStatus',
    '手机':'phone','电话':'phone','邮箱':'email',
    '微信':'wechat','QQ':'qq','性别':'gender','出生日期':'birthday','生日':'birthday',
    '政治面貌':'political','籍贯':'hometown_province','民族':'ethnicity','国籍':'nationality',
    '现居城市':'current_city','现居地':'current_city','地址':'address','婚姻':'marital',
    '身高':'height','体重':'weight','身份证':'id_number',
  };
  const intentionMap = {
    '求职状态':'status','求职类型':'type','工作类型':'type','期望行业':'industry',
    '期望岗位':'position','应聘岗位':'position','期望城市':'city','期望薪资':'salary',
    '薪资期望':'salary','到岗时间':'available',
  };
  const skillsMap = {
    '技能':'tech','编程语言':'tech','专业技能':'tech','技术栈':'tech',
    '职场技能':'workplace','兴趣爱好':'interests','爱好':'interests',
    '职业规划':'career_plan','专业证书':'certificates','证书':'certificates',
    '自荐信':'cover_letter',
  };

  const lines = text.split(/\r?\n/);
  let section = 'personal';
  let currentEdu = null, currentIntern = null, currentWork = null, currentProj = null;

  function flush() {
    if (currentEdu) { data.education.push(currentEdu); currentEdu = null; }
    if (currentIntern) { data.internship.push(currentIntern); currentIntern = null; }
    if (currentWork) { data.work.push(currentWork); currentWork = null; }
    if (currentProj) { data.projects.push(currentProj); currentProj = null; }
  }

  function setField(label, value) {
    const l = label.trim();
    if (personalMap[l]) { data.personal[personalMap[l]] = value; return; }
    if (intentionMap[l]) { data.intention[intentionMap[l]] = value; return; }
    if (skillsMap[l]) { data.skills[skillsMap[l]] = value; return; }
    if (l === 'GitHub' || l === 'github') { data.github = value; return; }
    if (l === '个人主页' || l === '主页') { data.homepage = value; return; }
    if (l === '自我评价' || l === '个人简介' || l === '简介') { data.intro = value; return; }

    // 教育字段
    if (currentEdu) {
      const eduMap = {'学校':'school','专业':'major','学历':'degree','学位':'degree',
        'GPA':'gpa','排名':'rank','荣誉':'honors','课外活动':'activities',
        '研究方向':'research','毕业论文':'thesis','院校类型':'school_type'};
      if (eduMap[l]) { currentEdu[eduMap[l]] = value; return; }
    }
    // 实习字段
    if (currentIntern) {
      const internMap = {'公司':'company','职位':'position','岗位':'position',
        '地点':'location','薪资':'salary','日薪':'salary','描述':'desc','工作描述':'desc',
        '离职原因':'leave_reason','直属上级':'manager','公司规模':'company_size'};
      if (internMap[l]) { currentIntern[internMap[l]] = value; return; }
    }
    // 项目字段
    if (currentProj) {
      const projMap = {'项目名称':'name','角色':'role','团队规模':'team_size',
        '链接':'url','项目链接':'url','描述':'desc','项目描述':'desc'};
      if (projMap[l]) { currentProj[projMap[l]] = value; return; }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 章节检测
    const secMatch = line.match(/^#{1,3}\s+(.+)/);
    if (secMatch) {
      flush();
      const title = secMatch[1].trim();
      if (/个人信息|基本信息/.test(title)) section = 'personal';
      else if (/求职意向|意向/.test(title)) section = 'intention';
      else if (/教育|学历/.test(title)) section = 'education';
      else if (/实习|工作经历|工作经验/.test(title)) section = 'internship';
      else if (/全职|工作/.test(title)) section = 'work';
      else if (/项目/.test(title)) section = 'projects';
      else if (/技能|专长/.test(title)) section = 'skills';
      else if (/外语|语言能力/.test(title)) section = 'languages';
      else if (/论文|成果|发表/.test(title)) section = 'papers';
      else if (/自我评价|个人简介|自我介绍/.test(title)) section = 'intro';
      else if (/家庭/.test(title)) section = 'family';
      continue;
    }

    // 子标题（### xxx — 学校/公司/项目名）
    if (section === 'education' && line.match(/^###\s+/)) {
      flush();
      const name = line.replace(/^###\s+/, '').split('（')[0].trim();
      const deg = line.match(/（(.+?)）/);
      currentEdu = { school: name, degree: deg ? deg[1] : '', major: '', start: '', end: '' };
      continue;
    }
    if ((section === 'internship' || section === 'work') && line.match(/^###\s+/)) {
      flush();
      const parts = line.replace(/^###\s+/, '').split(/[—\-–]/);
      if (section === 'internship') currentIntern = { company: parts[0].trim(), position: (parts[1]||'').trim(), start:'', end:'', desc:'' };
      else currentWork = { company: parts[0].trim(), position: (parts[1]||'').trim(), start:'', end:'', desc:'' };
      continue;
    }
    if (section === 'projects' && line.match(/^###\s+/)) {
      flush();
      const parts = line.replace(/^###\s+/, '').split(/[（(]/);
      currentProj = { name: parts[0].trim(), role: (parts[1]||'').replace(/[）)]/,'').trim(), start:'', end:'', desc:'' };
      continue;
    }

    // 时间区间行（2021-09 ~ 2025-06 | ...）
    const dateRange = line.match(/^(\d{4}-\d{2})\s*[~～至]\s*(\S+)/);
    if (dateRange) {
      const start = dateRange[1], end = dateRange[2];
      if (currentEdu) { currentEdu.start = start; currentEdu.end = end; }
      else if (currentIntern) { currentIntern.start = start; currentIntern.end = end; }
      else if (currentWork) { currentWork.start = start; currentWork.end = end; }
      else if (currentProj) { currentProj.start = start; currentProj.end = end; }
      continue;
    }

    // 标准键值行：- **label**：value 或 label：value 或 label: value
    const kvMatch = line.match(/^[-*]\s*\*{0,2}([^*：:]+?)\*{0,2}[：:]\s*(.+)/)
                 || line.match(/^([^：:\n]{1,15})[：:]\s*(.+)/);
    if (kvMatch) {
      const label = kvMatch[1].trim();
      const value = kvMatch[2].trim();
      if (section === 'intro') { data.intro = (data.intro ? data.intro + ' ' : '') + value; continue; }
      setField(label, value);
      continue;
    }

    // 正文段落（用于 intro / desc 等）
    const plain = line.replace(/^[-*\d.]\s*/, '').trim();
    if (!plain || line.startsWith('#')) continue;
    if (section === 'intro') {
      data.intro = (data.intro ? data.intro + '\n' : '') + plain;
    } else if (section === 'skills' && !line.match(/^\|/)) {
      // 技能自由文本
      data.skills.tech = (data.skills.tech ? data.skills.tech + '\n' : '') + plain;
    } else if (currentEdu && /GPA|排名|荣誉|活动|论文|研究/.test(plain)) {
      // 子项（- GPA：3.8 / 4.0）已由 kvMatch 处理，这里处理普通描述行
    } else if (currentIntern || currentWork) {
      const target = currentIntern || currentWork;
      // 接受所有正文行（含普通段落），不只限序号/符号开头
      target.desc = (target.desc ? target.desc + '\n' : '') + plain;
    } else if (currentProj) {
      currentProj.desc = (currentProj.desc ? currentProj.desc + '\n' : '') + plain;
    }
  }
  flush();
  return data;
}

function countDataFields(data) {
  if (!data) return 0;
  let count = 0;
  function countObj(obj) {
    if (!obj) return;
    Object.values(obj).forEach(v => { if (v && typeof v === 'string' && v.trim()) count++; });
  }
  countObj(data.personal);
  countObj(data.intention);
  countObj(data.skills);
  if (data.intro) count++;
  if (data.github) count++;
  if (data.homepage) count++;
  count += (data.education||[]).length;
  count += (data.internship||[]).length;
  count += (data.work||[]).length;
  count += (data.projects||[]).length;
  count += (data.awards||[]).length;
  count += (data.languages||[]).length;
  count += (data.papers||[]).length;
  return count;
}

// ===== PDF：CID十六进制解码 + 压缩流解压 =====
function hexToUtf16be(hex) {
  const bytes = hex.match(/.{2}/g).map(h => parseInt(h, 16));
  return new TextDecoder('utf-16be').decode(new Uint8Array(bytes));
}

async function extractPdfText(file) {
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50) return '';

    const raw = new TextDecoder('latin1').decode(bytes);
    const texts = [];

    function extractTextOps(str) {
      // 1. 普通字符串 (text)Tj
      for (const m of str.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g)) {
        const t = m[1].replace(/\\n/g,' ').replace(/\\\\/g,'\\').replace(/\\(.)/g,'$1').trim();
        if (t && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(t)) texts.push(t);
      }
      // 2. CID 十六进制 <hex>Tj（中文 PDF 最常见）
      for (const m of str.matchAll(/<([0-9a-fA-F]{4,})>\s*Tj/g)) {
        try {
          const t = hexToUtf16be(m[1]).trim();
          if (t && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(t)) texts.push(t);
        } catch {}
      }
      // 3. 数组 [...] TJ（包含普通字符串和 CID 十六进制两种）
      for (const m of str.matchAll(/\[([^\]]+)\]\s*TJ/g)) {
        let combined = '';
        for (const p of m[1].matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g))
          combined += p[1].replace(/\\\\/g,'\\').replace(/\\(.)/g,'$1');
        for (const p of m[1].matchAll(/<([0-9a-fA-F]{4,})>/g)) {
          try { combined += hexToUtf16be(p[1]); } catch {}
        }
        if (combined.trim() && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(combined))
          texts.push(combined.trim());
      }
    }

    // 方法1：未压缩内容直接提取
    extractTextOps(raw);

    // 方法2：用 /Length 精确定位流数据（避免 regex 截断二进制流）
    // 找所有含 FlateDecode 的流字典，读取精确字节数
    const lengthRe = /\/Length\s+(\d+)/g;
    let lm, count = 0, decompOk = 0;
    while ((lm = lengthRe.exec(raw)) !== null && count < 50) {
      const length = parseInt(lm[1]);
      if (length < 10) continue;
      // 检查这个字典是否含 FlateDecode（前后 600 字节范围内）
      const winStart = Math.max(0, lm.index - 300);
      const winEnd = Math.min(raw.length, lm.index + 600);
      const win = raw.slice(winStart, winEnd);
      if (!/FlateDecode/.test(win)) continue;
      // 找 stream 关键字位置（从 Length 往后）
      const streamKeyIdx = raw.indexOf('stream', lm.index);
      if (streamKeyIdx < 0 || streamKeyIdx - lm.index > 800) continue;
      // 跳过 stream 后的 \r\n 或 \n
      let dataStart = streamKeyIdx + 6;
      if (bytes[dataStart] === 0x0d) dataStart++;
      if (bytes[dataStart] === 0x0a) dataStart++;
      if (dataStart + length > bytes.length) continue;
      count++;
      const streamBytes = bytes.slice(dataStart, dataStart + length);
      const decompBuf = await tryDecompress(streamBytes);
      if (decompBuf) {
        decompOk++;
        const decompStr = new TextDecoder('latin1').decode(decompBuf);
        extractTextOps(decompStr);
      }
    }
    return texts.join(' ');
  } catch { return ''; }
}

// ===== 自定义字段（Issue 3）=====
const SECTION_CARD_IDS = {
  personal:'sec-personal', intention:'sec-intention', education:'sec-education',
  internship:'sec-internship', work:'sec-work', projects:'sec-projects', research:'sec-research', practice:'sec-practice',
  awards:'sec-awards', skills:'sec-skills', languages:'sec-languages', papers:'sec-papers',
  intro:'sec-intro', application:'sec-application', family:'sec-family',
};

function renderCustomFields(customFields) {
  document.querySelectorAll('.custom-fields-wrap').forEach(el => el.remove());
  if (!customFields || customFields.length === 0) return;
  const bySection = {};
  customFields.forEach(f => {
    const sec = SECTION_CARD_IDS[f.section] ? f.section : 'skills';
    (bySection[sec] = bySection[sec] || []).push(f);
  });
  Object.entries(bySection).forEach(([section, fields]) => {
    const body = document.getElementById(SECTION_CARD_IDS[section])?.querySelector('.card-body');
    if (!body) return;
    const wrap = document.createElement('div');
    wrap.className = 'custom-fields-wrap';
    wrap.innerHTML = `<div class="custom-label">已有资料的补充字段</div>`;
    fields.forEach(f => {
      const row = document.createElement('div');
      row.className = 'custom-field-row';
      row.dataset.customKey = f.key;
      row.dataset.customSection = section;
      row.innerHTML = `
        <span class="custom-field-lbl" title="${escHtml(f.label)}">${escHtml(f.label)}</span>
        <input value="${escHtml(f.value||'')}" data-custom-key="${escHtml(f.key)}" placeholder="请填写"/>
        <button class="btn-del-custom" data-del-key="${escHtml(f.key)}" title="删除补充字段" aria-label="删除补充字段">×</button>`;
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
  });
}

function collectCustomFields() {
  return [...document.querySelectorAll('.custom-field-row[data-custom-key]')].map(row => ({
    key: row.dataset.customKey,
    label: row.querySelector('.custom-field-lbl')?.title || '',
    section: row.dataset.customSection || 'skills',
    value: row.querySelector('input')?.value.trim() || '',
  }));
}

// ===== 导航填写进度 =====
function countFilled(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return { filled: 0, total: 0 };
  // 排除右侧面板 AI 设置里的 input（sec-ai 不在 .content 里，所以不影响；但保险起见排除 type=checkbox/hidden）
  const inputs = [...section.querySelectorAll('input:not([type=checkbox]):not([type=hidden]),select,textarea')];
  return { filled: inputs.filter(el => el.value.trim()).length, total: inputs.length };
}

function updateNavCounts() {
  if (globalThis.JFOptionsWorkspace) {
    globalThis.JFOptionsWorkspace.refresh();
    return;
  }
  const sections = [
    ['personal','sec-personal'],['intention','sec-intention'],['education','sec-education'],
    ['internship','sec-internship'],['work','sec-work'],['projects','sec-projects'],['research','sec-research'],['practice','sec-practice'],
    ['awards','sec-awards'],['skills','sec-skills'],['languages','sec-languages'],['papers','sec-papers'],
    ['intro','sec-intro'],['application','sec-application'],['family','sec-family'],
  ];
  let totalFilled = 0, totalCount = 0;
  sections.forEach(([key, secId]) => {
    const el = document.getElementById(`cnt-${key}`);
    if (!el) return;
    const { filled, total } = countFilled(secId);
    el.textContent = `${filled}/${total}`;
    el.style.background = filled === total && total > 0 ? '#c6f6d5' : '';
    el.style.color = filled === total && total > 0 ? '#276749' : '';
    totalFilled += filled; totalCount += total;
  });
  const navTotal = document.getElementById('nav-total');
  if (navTotal) navTotal.textContent = `已填写 ${totalFilled} / ${totalCount} 个字段`;
}

// ===== 左侧导航高亮 + 黄金比例定位 =====
const navLinks = document.querySelectorAll('.sidenav a');

// 点击导航时：section 顶部定位在视口 38.2% 处（黄金分割，视觉中间偏上）
navLinks.forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href')?.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const offset = window.innerHeight * (1 - 0.618); // ≈ 38.2% from top
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    // 立即高亮对应导航项
    navLinks.forEach(l => l.classList.toggle('active', l === a));
    globalThis.JFOptionsWorkspace?.openSection(id);
  });
});

const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#'+e.target.id));
      globalThis.JFOptionsWorkspace?.openSection(e.target.id);
    }
  });
}, { rootMargin: '-20% 0px -70% 0px' });
document.querySelectorAll('.card[id]').forEach(s => observer.observe(s));

// ===== Toast =====
function showToast(msg) {
  const t = document.getElementById('toast');
  if (/^❌/.test(msg) && document.getElementById('save-state')?.dataset.state === 'importing') globalThis.JFOptionsWorkspace?.failed('import');
  t.textContent = String(msg).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim(); t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== 通用：简历转 MD（紧凑格式，省 token）=====
function resumeToMD(d) {
  if (!d) return '';
  const lines = [];
  const p = { ...(d.personal || {}), ...(d.basic || {}) };
  if (p.name) lines.push(`# ${p.name}`);
  const basicFields = [
    ['姓名拼音',p.namePinyin],['健康状况',p.healthStatus],['手机',p.phone],['邮箱',p.email],
    ['证件类型',p.idType],['出生地',p.birthplaceRegion],['籍贯所在地',p.hometownRegion],
    ['户口所在地',p.householdRegion],['现居城市',p.current_city],['政治面貌',p.political],
  ];
  basicFields.filter(([,v])=>v).forEach(([k,v]) => lines.push(`- **${k}**：${v}`));
  const contact = d.contact || {};
  [['档案所在地',contact.archiveRegion],['紧急联系人电话',contact.emergencyPhone]]
    .filter(([,v])=>v).forEach(([k,v]) => lines.push(`- **${k}**：${v}`));

  const intent = d.intention || {};
  if (Object.values(intent).some(Boolean)) {
    lines.push('\n## 求职意向');
    [['岗位',intent.position],['行业',intent.industry],['城市',intent.city],['薪资',intent.salary],['到岗',intent.available]]
      .filter(([,v])=>v).forEach(([k,v]) => lines.push(`- ${k}：${v}`));
  }

  (d.education||[]).forEach(e => {
    lines.push(`\n## 教育 — ${e.school||''} ${e.educationLevel||e.degree||''} ${e.major||''}`);
    if (e.startDate||e.endDate||e.start||e.end) lines.push(`${e.startDate||e.start||''}～${e.endDate||e.end||''}`);
    if (e.schoolCode) lines.push(`所在学校代码：${e.schoolCode}`);
    if (e.college) lines.push(`所在院系：${e.college}`);
    if (e.studentId) lines.push(`在校生注册学号：${e.studentId}`);
    if (e.studyDuration) lines.push(`本科学制：${e.studyDuration}`);
    if (e.cet4Score) lines.push(`CET-4：${e.cet4Score}`);
    if (e.cet6Score) lines.push(`CET-6：${e.cet6Score}`);
    if (e.eliteTrainingBase) lines.push(`拔尖人才培养基地：${e.eliteTrainingBase}${e.eliteTrainingBaseName ? ` · ${e.eliteTrainingBaseName}` : ''}`);
    if (e.majorRankPercent) lines.push(`专业排名百分比：${e.majorRankPercent}`);
    if (e.majorRank || e.majorRankTotal) lines.push(`专业排名：${e.majorRank || ''}${e.majorRankTotal ? `/${e.majorRankTotal}` : ''}`);
    if (e.gpa) lines.push(`成绩绩点 / 总绩点：${e.gpa}${e.rank?`，排名 ${e.rank}`:''}`);
    if (e.honors) lines.push(`荣誉：${e.honors}`);
    if (e.thesis) lines.push(`论文：${e.thesis}`);
  });

  (d.internships||d.internship||[]).forEach(e => {
    lines.push(`\n## 学习和工作经历 — ${e.company||''} · ${e.position||''}`);
    if (e.startDate||e.endDate||e.start||e.end) lines.push(`${e.startDate||e.start||''}～${e.endDate||e.end||''}`);
    if (e.description||e.desc) lines.push(e.description||e.desc);
  });

  (d.work||[]).forEach(e => {
    lines.push(`\n## 工作 — ${e.company||''} · ${e.position||''}`);
    if (e.start||e.end) lines.push(`${e.start||''}～${e.end||''}`);
    if (e.desc) lines.push(e.desc);
  });

  (d.projects||[]).forEach(e => {
    lines.push(`\n## 项目 — ${e.name||''}`);
    if (e.role) lines.push(`角色：${e.role}`);
    if (e.desc) lines.push(e.desc);
  });

  (d.research||[]).forEach((item, index) => {
    lines.push(`\n## 科研工作 ${index + 1} — ${item.name || ''}`);
    if (item.startDate||item.endDate) lines.push(`${item.startDate||''}～${item.endDate||''}`);
    if (item.advisor) lines.push(`指导教师：${item.advisor}`);
    if (item.level) lines.push(`级别：${item.level}`);
    if (item.contribution) lines.push(`主要贡献：${item.contribution}`);
  });

  (d.practice||[]).forEach((item, index) => {
    lines.push(`\n## 学生干部 / 实习实践 ${index + 1}`);
    if (item.startDate||item.endDate) lines.push(`${item.startDate||''}～${item.endDate||''}`);
    if (item.location) lines.push(`地点：${item.location}`);
    if (item.description) lines.push(item.description);
  });

  (d.family||[]).forEach(member => {
    lines.push(`\n## 家庭成员 — ${member.name||''} · ${member.relationship||''}`);
    if (member.employer||member.position) lines.push(`${member.employer||''} ${member.position||''}`.trim());
    if (member.phone) lines.push(`联系电话：${member.phone}`);
    if (member.description) lines.push(member.description);
  });

  (d.awards||[]).forEach((award, index) => {
    lines.push(`\n## 奖励与荣誉 ${index + 1} — ${award.content || ''}`);
    if (award.time) lines.push(`时间：${award.time}`);
    if (award.location) lines.push(`地点：${award.location}`);
    if (award.category) lines.push(`奖项类别：${award.category}`);
    if (award.level) lines.push(`奖项级别：${award.level}`);
    if (award.rank) lines.push(`获奖等级：${award.rank}`);
    if (award.teamRank) lines.push(`排名 / 团队人数：${award.teamRank}`);
    if (award.organizer) lines.push(`主办单位：${award.organizer}`);
    if (award.certificateFileName) lines.push(`证书文件名：${award.certificateFileName}`);
    if (award.note) lines.push(`备注：${award.note}`);
  });

  const sk = d.skills || {};
  if (sk.tech||sk.workplace||sk.certificates) {
    lines.push('\n## 技能');
    if (sk.tech) lines.push(sk.tech);
    if (sk.certificates) lines.push(`证书：${sk.certificates}`);
  }

  (d.languages||[]).forEach(l => {
    if (l.language) lines.push(`外语：${l.language} ${l.certificate||''} ${l.score||''}`);
  });

  (d.papers||[]).forEach(p => {
    if (p.title) lines.push(`\n论文：${p.title} — ${p.journal||''} ${p.author_rank||''}`);
  });

  if (d.intro) lines.push(`\n## 自我评价\n${d.intro}`);
  const application = d.application || {};
  if (application.disciplinaryHistory || application.personalStatement || application.notes) {
    lines.push('\n## 申请附加信息');
    if (application.disciplinaryHistory) lines.push(`作弊处分等情况：${application.disciplinaryHistory}`);
    if (application.personalStatement) lines.push(`个人陈述：${application.personalStatement}`);
    if (application.notes) lines.push(`备注信息：${application.notes}`);
  }
  return lines.join('\n');
}

// ===== 折叠展开（替代 inline onclick，CSP 合规）=====
document.querySelectorAll('[data-toggle-section]').forEach(btn => {
  btn.addEventListener('click', () => {
    const el = document.getElementById(btn.dataset.toggleSection);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? '' : 'none';
  });
});

// ===== JD 描述 =====
async function initJDSection() {
  const { currentJD } = await chrome.storage.local.get('currentJD');
  renderJDSection(currentJD);

  document.getElementById('btn-clear-jd').addEventListener('click', async () => {
    await chrome.storage.local.remove('currentJD');
    renderJDSection(null);
    document.getElementById('revise-result').innerHTML = '';
    document.getElementById('interview-result').innerHTML = '';
    showToast('JD 已清除');
  });
}

function renderJDSection(jd) {
  const empty = document.getElementById('jd-empty-tip');
  const content = document.getElementById('jd-content');
  if (!jd?.text) {
    empty.style.display = '';
    content.style.display = 'none';
    document.getElementById('revise-no-jd').style.display = '';
    document.getElementById('btn-ai-revise').disabled = true;
    document.getElementById('btn-gen-interview').disabled = true;
    return;
  }
  empty.style.display = 'none';
  content.style.display = '';
  document.getElementById('revise-no-jd').style.display = 'none';
  document.getElementById('btn-ai-revise').disabled = false;
  document.getElementById('btn-gen-interview').disabled = false;

  document.getElementById('jd-job-title').textContent = jd.jobTitle || jd.title || '—';
  document.getElementById('jd-site').textContent = jd.site || new URL(jd.url||'http://x').hostname.replace('www.','') || '—';
  document.getElementById('jd-time').textContent = jd.time ? new Date(jd.time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
  document.getElementById('jd-source-link').href = jd.url || '#';
  document.getElementById('jd-desc-body').textContent = jd.description || jd.text || '';
  document.getElementById('jd-req-body').textContent = jd.requirements || '';

  // 关键词标签
  const kwEl = document.getElementById('jd-keywords');
  const kws = jd.keywords || [];
  if (kws.length) {
    kwEl.innerHTML = kws.map(k =>
      `<span style="background:#ebf8ff;color:#2b6cb0;font-size:11px;padding:2px 8px;border-radius:10px">${escHtml(k)}</span>`
    ).join('');
  } else {
    kwEl.textContent = '（未识别到关键词）';
  }
}

// ===== AI 优化 =====
function initAIReviseSection() {
  document.getElementById('btn-ai-revise').addEventListener('click', async () => {
    const { aiConfig, resumeData, currentJD } = await chrome.storage.local.get(['aiConfig','resumeData','currentJD']);
    if (!aiConfig?.apiKey) { showToast('❌ 请先配置 AI API Key'); return; }

    const doSkills   = document.getElementById('revise-skills').checked;
    const doIntro    = document.getElementById('revise-intro').checked;
    const doProjects = document.getElementById('revise-projects').checked;
    if (!doSkills && !doIntro && !doProjects) { showToast('请至少勾选一项'); return; }

    const userInstruction = document.getElementById('revise-prompt').value.trim()
      || '提取JD中的关键词和能力要求，对照着帮我优化简历，让我看起来就是他们想要的人';

    const btn = document.getElementById('btn-ai-revise');
    btn.disabled = true; btn.textContent = '⏳ AI 优化中...';
    document.getElementById('revise-result').innerHTML = '<div style="color:#718096;font-size:13px;padding:8px 0">正在生成优化建议...</div>';

    // 收集待优化字段
    const fields = [];
    if (doSkills && resumeData?.skills?.tech) fields.push({ key:'skills_tech', label:'技能专长', current: resumeData.skills.tech });
    if (doIntro && resumeData?.intro) fields.push({ key:'intro', label:'自我评价', current: resumeData.intro });
    if (doProjects) {
      (resumeData?.projects||[]).forEach((p,i) => {
        if (p.desc) fields.push({ key:`proj_${i}_desc`, label:`项目「${p.name||i+1}」描述`, current: p.desc });
      });
    }
    if (!fields.length) { showToast('所选内容简历中暂无数据'); btn.disabled=false; btn.textContent='🤖 AI 优化内容'; return; }

    // 用 MD 格式发送简历（比 JSON 省约 40% token）
    const resumeMD = resumeToMD(resumeData);
    const jdPart = currentJD?.text ? `\n\n## 目标职位描述\n${currentJD.text.slice(0, 2000)}` : '';

    const system = `你是一位专业的简历优化顾问。
用户指令：${userInstruction}
规则：
1. 内容必须基于候选人原始简历事实，不可捏造经历。
2. 自然融入 JD 关键词，不要机械堆砌。
3. 严格输出 JSON 数组，不含其他文字：[{"key":"字段key","label":"字段名","optimized":"优化后内容"}]`;

    const user = `## 候选人简历\n${resumeMD}${jdPart}\n\n## 待优化字段\n${JSON.stringify(fields,null,2)}`;

    chrome.runtime.sendMessage({
      type: 'AI_FILL',
      provider: aiConfig.provider||'openai_compat',
      apiKey: aiConfig.apiKey, model: aiConfig.model||'', baseUrl: aiConfig.baseUrl||'',
      elementDict: [], resumeFlat: {},
      _rawPrompt: { system, user },
    }, resp => {
      btn.disabled = false; btn.textContent = '🤖 AI 优化内容';
      if (resp?.error) {
        document.getElementById('revise-result').innerHTML = `<div style="color:#c53030;font-size:13px">❌ ${escHtml(resp.error)}</div>`;
        return;
      }
      if (resp?.truncated) {
        document.getElementById('revise-result').insertAdjacentHTML('beforebegin',
          `<div style="color:#b7791f;font-size:12px;margin-bottom:6px">⚠ AI 回复已被截断，结果可能不完整。可尝试减少勾选字段数量。</div>`);
      }
      renderReviseResult(resp.text, resumeData);
    });
  });
}

function renderReviseResult(aiText, resumeData) {
  let results;
  try {
    const cleaned = aiText.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
    results = JSON.parse(cleaned);
    if (!Array.isArray(results)) throw new Error();
  } catch {
    // AI 未返回 JSON，直接展示纯文本（便于用户自行参考）
    document.getElementById('revise-result').innerHTML =
      `<pre style="font-size:12px;color:#4a5568;white-space:pre-wrap;background:#f7fafc;padding:12px;border-radius:6px">${escHtml(aiText)}</pre>`;
    return;
  }

  const html = results.map(r => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;overflow:hidden">
      <div style="padding:8px 12px;background:#f7fafc;font-size:12px;font-weight:600;color:#2d3748">${escHtml(r.label||r.key||'字段')}</div>
      <div style="padding:10px 12px">
        <div style="font-size:11px;color:#a0aec0;margin-bottom:4px">优化后内容（可直接编辑）：</div>
        <textarea data-revise-key="${escHtml(r.key)}" style="width:100%;min-height:80px;font-size:12px;border:1px solid #bee3f8;border-radius:6px;padding:8px;resize:vertical;box-sizing:border-box;background:#ebf8ff">${escHtml(r.optimized||'')}</textarea>
        <button class="btn btn-save btn-apply-revise" data-revise-key="${escHtml(r.key)}" style="margin-top:6px;padding:5px 14px;font-size:12px">✅ 应用到简历</button>
      </div>
    </div>`).join('');
  document.getElementById('revise-result').innerHTML = html;

  document.querySelectorAll('.btn-apply-revise').forEach(applyBtn => {
    applyBtn.addEventListener('click', async () => {
      const key = applyBtn.dataset.reviseKey;
      const val = applyBtn.closest('div').querySelector('textarea').value;
      const { resumeData: rd } = await chrome.storage.local.get('resumeData');
      if (!rd) return;
      if (key === 'skills_tech') {
        rd.skills = rd.skills || {};
        rd.skills.tech = val;
        const el = document.getElementById('s_tech');
        if (el) el.value = val;
      } else if (key === 'intro') {
        rd.intro = val;
        const el = document.getElementById('intro');
        if (el) el.value = val;
      } else if (key.startsWith('proj_')) {
        const idx = parseInt(key.split('_')[1]);
        if (rd.projects?.[idx]) rd.projects[idx].desc = val;
      }
      await chrome.storage.local.set({ resumeData: rd });
      applyBtn.textContent = '✅ 已应用';
      applyBtn.disabled = true;
      showToast('已应用到简历，记得点「保存简历」');
    });
  });
}

// ===== 模拟面试 =====
function initInterviewSection() {
  const genBtn = document.getElementById('btn-gen-interview');
  const regenBtn = document.getElementById('btn-regen-interview');

  async function generateInterview() {
    const { aiConfig, resumeData, currentJD: jd } = await chrome.storage.local.get(['aiConfig', 'resumeData', 'currentJD']);
    if (!aiConfig?.apiKey) { showToast('❌ 请先配置 AI API Key'); return; }
    if (!resumeData) { showToast('❌ 请先保存简历'); return; }

    const userInstruction = document.getElementById('interview-prompt').value.trim()
      || '你现在是一个挑剔的面试官，看完我的简历，请提出5个刁钻问题或指出哪段数据不清晰';

    genBtn.disabled = true;
    regenBtn.style.display = 'none';
    genBtn.textContent = '⏳ 面试官思考中...';
    document.getElementById('interview-result').innerHTML = '<div style="color:#718096;font-size:13px;padding:12px 0">AI 面试官正在准备问题...</div>';

    const resumeMD = resumeToMD(resumeData);
    const jdPart = jd?.text ? `\n\n## 目标职位描述\n${jd.text.slice(0, 2000)}` : '';

    // 面试用自由文本回复，不要求 JSON（问题+追问+评析）
    const system = `${userInstruction}`;
    const user = `## 候选人简历\n${resumeMD}${jdPart}\n\n请开始提问。`;

    chrome.runtime.sendMessage({
      type: 'AI_FILL',
      provider: aiConfig.provider || 'openai_compat',
      apiKey: aiConfig.apiKey, model: aiConfig.model || '', baseUrl: aiConfig.baseUrl || '',
      elementDict: [], resumeFlat: {},
      _rawPrompt: { system, user },
    }, resp => {
      genBtn.disabled = false;
      genBtn.textContent = '🤖 开始面试';
      regenBtn.style.display = '';
      if (resp?.error) {
        document.getElementById('interview-result').innerHTML = `<div style="color:#c53030;font-size:13px">❌ ${escHtml(resp.error)}</div>`;
        return;
      }
      // 面试回复是自由文本，直接渲染
      const truncWarn = resp?.truncated
        ? `<div style="color:#b7791f;font-size:12px;margin-bottom:6px">⚠ AI 回复已被截断，题目可能不完整。</div>`
        : '';
      document.getElementById('interview-result').innerHTML =
        truncWarn + `<div style="font-size:13px;color:#2d3748;line-height:1.8;background:#fffbeb;border:1px solid #f6e05e;border-radius:8px;padding:14px;white-space:pre-wrap">${escHtml(resp.text||'')}</div>`;
    });
  }

  genBtn.addEventListener('click', generateInterview);
  regenBtn.addEventListener('click', generateInterview);
}

initJDSection();
initAIReviseSection();
initInterviewSection();
init().catch(() => { globalThis.JFOptionsWorkspace?.failed('save', '无法读取本地资料，请刷新页面重试；不要覆盖保存旧资料。'); });

// ===== AI 配置 =====

// 厂商预置：provider → { baseUrl, defaultModel }
const AI_PRESETS = {
  openai:       { baseUrl: '',                                                    model: 'gpt-4o-mini' },
  claude:       { baseUrl: '',                                                    model: 'claude-3-haiku-20240307' },
  qwen:         { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',  model: 'qwen-plus' },
  kimi:         { baseUrl: 'https://api.moonshot.cn/v1',                         model: 'moonshot-v1-8k' },
  deepseek:     { baseUrl: 'https://api.deepseek.com/v1',                        model: 'deepseek-chat' },
  glm:          { baseUrl: 'https://open.bigmodel.cn/api/paas/v4',              model: 'glm-4-flash' },
  openai_compat:{ baseUrl: '',                                                    model: '' },
};

// provider 切换 → 自动填充 base_url 和推荐模型
document.getElementById('ai_provider')?.addEventListener('change', () => {
  const provider = document.getElementById('ai_provider').value;
  const preset = AI_PRESETS[provider] || {};
  const wrapEl = document.getElementById('ai_baseurl_wrap');
  const baseUrlEl = document.getElementById('ai_base_url');
  const modelEl = document.getElementById('ai_model');

  // 显示/隐藏 base_url 输入框
  const showBaseUrl = !['openai', 'claude'].includes(provider);
  wrapEl.style.display = showBaseUrl ? '' : 'none';

  // 自动填充 base_url（若用户已手动修改则跳过）
  if (preset.baseUrl !== undefined) baseUrlEl.value = preset.baseUrl;
  if (preset.model && !modelEl.value) modelEl.placeholder = preset.model;
});

async function loadAIConfig() {
  const { aiConfig } = await chrome.storage.local.get('aiConfig');
  if (!aiConfig) return;

  const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
  document.getElementById('ai_enabled').checked = !!aiConfig.enabled;
  set('ai_provider', aiConfig.provider);
  set('ai_model', aiConfig.model);
  set('ai_api_key', aiConfig.apiKey);
  set('ai_base_url', aiConfig.baseUrl);

  // 触发一次 change 以同步显示状态
  document.getElementById('ai_provider')?.dispatchEvent(new Event('change'));
}

document.getElementById('btn-save-ai')?.addEventListener('click', async () => {
  const provider = document.getElementById('ai_provider').value;
  const preset = AI_PRESETS[provider] || {};
  const baseUrlInput = document.getElementById('ai_base_url').value.trim();
  const config = {
    enabled:  document.getElementById('ai_enabled').checked,
    provider,
    model:    document.getElementById('ai_model').value.trim() || preset.model || '',
    apiKey:   document.getElementById('ai_api_key').value.trim(),
    baseUrl:  baseUrlInput || preset.baseUrl || '',
  };
  await chrome.storage.local.set({ aiConfig: config });
  showToast('✅ AI 配置已保存');
});

document.getElementById('btn-test-ai')?.addEventListener('click', () => {
  const resultEl = document.getElementById('ai-test-result');
  resultEl.textContent = '测试中...';
  resultEl.style.color = '#718096';

  const provider = document.getElementById('ai_provider').value;
  const preset = AI_PRESETS[provider] || {};
  const baseUrlInput = document.getElementById('ai_base_url').value.trim();

  chrome.runtime.sendMessage({
    type: 'AI_FILL',
    provider,
    apiKey: document.getElementById('ai_api_key').value.trim(),
    model: document.getElementById('ai_model').value.trim() || preset.model || '',
    baseUrl: baseUrlInput || preset.baseUrl || '',
    elementDict: [{
      token: 'test_0', tag: 'input', type: 'text',
      label: '姓名', placeholder: '请输入姓名',
      name: 'name', id: '', aria_label: '',
      context: '姓名 请输入您的姓名', options: null, value: '',
    }],
    resumeFlat: { name: '测试用户' },
  }, resp => {
    if (chrome.runtime.lastError || resp?.error) {
      resultEl.textContent = `❌ ${resp?.error || chrome.runtime.lastError?.message}`;
      resultEl.style.color = '#e53e3e';
    } else {
      resultEl.textContent = '✅ 连接成功';
      resultEl.style.color = '#38a169';
    }
  });
});

loadAIConfig();
