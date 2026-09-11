/* Read-only, value-free UI projection. Never persisted or used for fill decisions. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFReviewPresenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const SECTIONS = Object.freeze({ basic: '基本信息', contact: '联系方式', family: '家庭成员', education: '教育经历', internships: '学习/工作经历', work: '工作经历', projects: '项目经历', research: '科研经历', papers: '学术论文', patents: '专利成果', practice: '社会实践', awards: '获奖经历', language: '语言能力', languages: '语言能力', skills: '技能证书', certificates: '技能证书', student_work: '校园经历', application: '申请附加信息', intro: '自我评价', files: '上传材料' });
  const REVIEW = new Set(['NEEDS_CONFIRMATION', 'CONFLICT', 'MISSING_JSON', 'UNMATCHED', 'ERROR']);
  const priority = { ERROR: 0, CONFLICT: 1, NEEDS_CONFIRMATION: 2, MISSING_JSON: 3, UNMATCHED: 4 };
  const normalizePath = value => typeof value === 'string' ? value.replace(/\[\d+\]/g, '[]') : '';
  function labelFor(path, supplied) {
    const definitions = root.JFFieldAliases?.FIELD_DEFINITIONS || [];
    const normalized = normalizePath(path);
    const matched = definitions.find(item => item.path === normalized);
    if (matched) return matched.aliases[0];
    // Unknown DOM text is not trusted metadata. Accept only known semantic labels.
    const known = definitions.find(item => item.aliases.includes(supplied));
    if (known) return known.aliases[0];
    if (/^(?:files\.|basic\.photo)/.test(normalized)) return '上传材料';
    return '待检查字段';
  }
  function sectionFor(section, path) {
    const normalized = root.JFFieldAliases?.SECTION_KEY_MAP?.[section] || section;
    return SECTIONS[normalized] || SECTIONS[String(path || '').split(/[.\[]/)[0]] || '当前页面';
  }
  function itemView(item, section) {
    const state = root.JFUI.status(item.status);
    const path = item.matchedPath || item.path || item.field;
    return Object.freeze({
      fieldLabel: labelFor(path, item.fieldName || item.fieldLabel || item.descriptor?.labelText),
      section: sectionFor(section, path),
      status: state.key,
      reason: root.JFUI.reasonText(item.status, item.reasonCode),
    });
  }
  function project({ report, inspection, scanId } = {}) {
    if (!root.JFUI) return { reviewItems: [], recentFields: [], progress: { completed: 0, total: 0, percent: 0, unit: '项' } };
    const reportItems = [];
    const summaryItems = [];
    let summaryReviewCount = 0;
    if (scanId && report?.scanId === scanId) {
      for (const section of report.sections || []) {
        if (section.scanId && section.scanId !== scanId) continue;
        for (const item of section.items || []) reportItems.push(itemView(item, section.sectionId));
        if (!(section.items || []).length) {
          // A restored task retains only aggregate counts, never old field values.
          const summary = section.summary || {};
          for (const [status, rawCount] of Object.entries({ ERROR: summary.failed, CONFLICT: summary.conflicts, NEEDS_CONFIRMATION: summary.manualReview || summary.needsConfirmation, MISSING_JSON: summary.missingJson, UNMATCHED: summary.unmatched || summary.notFound })) {
            const count = Math.max(0, Math.min(1000, Number(rawCount) || 0));
            if (!count) continue;
            summaryReviewCount += count;
            summaryItems.push({ fieldLabel: `该栏目有 ${count} 项${root.JFUI.status(status).label}`, section: sectionFor(section.sectionId), status, reason: '上次任务只保留统计，请重新检查当前页面以查看字段详情' });
          }
        }
      }
    }
    // Reports supersede scan-time matching. Never show stale missing entries after a fill.
    const inspectionItems = !reportItems.length && !summaryItems.length && scanId && inspection?.scanId === scanId
      ? (inspection.matches || []).filter(item => REVIEW.has(root.JFUI.status(item.status).key)).map(item => itemView(item, item.scope?.section || inspection.current?.section))
      : [];
    const items = reportItems.length || summaryItems.length ? [...reportItems, ...summaryItems] : inspectionItems;
    const reviewItems = items.filter(item => REVIEW.has(item.status)).sort((a, b) => priority[a.status] - priority[b.status]).slice(0, 1000);
    const completed = reportItems.filter(item => item.status !== 'PLANNED').length;
    const total = Math.max(completed, reportItems.length, scanId && inspection?.scanId === scanId ? (inspection.fields || []).length : 0);
    return { reviewItems, reviewCount: reviewItems.length - summaryItems.length + summaryReviewCount, recentFields: reportItems.slice(-6), progress: { completed, total, percent: total ? Math.min(100, Math.round(completed / total * 100)) : 0, unit: '项' } };
  }
  return Object.freeze({ project, labelFor, sectionFor });
});
