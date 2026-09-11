/*
 * 解放 — 全栏目导航识别引擎
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initNavigationEngine(root, factory) {
  let safety = root?.JFSafety;
  let pageReady = root?.JFPageReady;
  let sectionAliases = root?.JFSectionAliases;
  if (typeof require === 'function') {
    try { safety = safety || require('./safety.js'); } catch (_) { /* browser path */ }
    try { pageReady = pageReady || require('./page-ready.js'); } catch (_) { /* browser path */ }
    try { sectionAliases = sectionAliases || require('../mappings/section-aliases.js'); } catch (_) { /* browser path */ }
  }
  const api = factory(safety, pageReady, sectionAliases);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFNavigationEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function navigationFactory(Safety, PageReady, SectionAliases) {
  'use strict';

  const SECTION_LABELS = Object.freeze({
    basic: '基本信息', contact: '联系方式', family: '家庭成员', education: '教育经历', awards: '奖励或处分',
    research: '科研经历', projects: '项目经历', papers: '论文成果', patents: '专利成果', practice: '社会实践',
    internship: '实习经历', student_work: '学生工作', certificates: '资格证书', language: '外语水平', skills: '专业技能',
  });
  const SECTION_DEFINITIONS = Object.freeze([
    ...Object.entries(SectionAliases?.SECTION_ALIASES || {}).map(([id, aliases]) => section(id, SECTION_LABELS[id] || aliases[0] || id, aliases)),
    section('application', '申请信息', ['申请信息', '申请专业', '报考信息', '志愿信息']),
    section('recommenders', '推荐人信息', ['推荐人信息', '推荐专家', '推荐人', '推荐信']),
    section('upload_photo', '上传照片', ['上传照片', '个人照片', '证件照']),
    section('upload_materials', '上传材料', ['上传材料', '材料上传', '申请材料', '附件材料']),
  ]);

  const NAV_CONTAINER_SELECTOR = [
    'nav', 'aside', '[role="navigation"]', '[role="tablist"]', '[role="menu"]',
    '[aria-label*="导航"]', '[aria-label*="步骤"]', '[aria-label*="栏目"]',
    '.sidebar', '.side-nav', '.sidenav', '.navigation', '.nav', '.menu', '.steps', '.stepper', '.tabs',
    '.list-group', '.nav-list', '.nav-pills', '.nav-tabs', '.left-nav', '.left-menu',
    '.ant-menu', '.ant-steps', '.el-menu', '.el-steps', '.ivu-menu', '.ivu-steps',
    '.arco-menu', '.arco-steps', '.semi-navigation', '.van-sidebar', '.layui-nav',
    '[class*="sidebar"]', '[class*="side-menu"]', '[class*="navigation"]',
    '[class*="nav-list"]', '[class*="menu-list"]',
  ].join(',');

  const NAV_ITEM_SELECTOR = [
    'a', 'li', 'button', '[role="tab"]', '[role="menuitem"]', '[role="link"]',
    '[data-step]', '[data-section]', '[data-menu-id]', '[data-route]',
    '.list-group-item', '.nav-link',
    '.ant-menu-item', '.ant-steps-item', '.el-menu-item', '.el-step',
    '.ivu-menu-item', '.ivu-steps-item', '.arco-menu-item', '.arco-steps-item',
    '.semi-navigation-item', '.van-sidebar-item', '.layui-nav-item',
    '[class*="menu-item"]', '[class*="step-item"]', '[class*="tab-item"]',
  ].join(',');

  // 未使用 nav/aside/role 等语义标签的旧报名系统，常以一组无 href 的 <a>
  // 实现侧栏。回退扫描只收集“叶子级可操作节点”，并且必须在局部祖先中形成
  // 至少三个不同的已知栏目，避免把正文里的单个同名链接误判成导航。
  const FALLBACK_NAV_ITEM_SELECTOR = [
    'a', 'button', 'li', '[onclick]', '[role="tab"]', '[role="menuitem"]', '[role="link"]',
    '[data-step]', '[data-section]', '[data-menu-id]', '[data-route]',
    '.list-group-item', '.nav-link',
  ].join(',');

  const ACTIVE_SELECTOR = '[aria-current="page"],[aria-selected="true"],.active,.current,.is-active,.selected';
  const MAX_SCAN_NODES = 500;
  const MAX_BROAD_SCAN_NODES = 5_000;
  const MAX_FALLBACK_ANCESTOR_DEPTH = 8;
  const MIN_FALLBACK_DISTINCT_SECTIONS = 3;
  const UPLOAD_NAVIGATION_SECTIONS = Object.freeze(new Set(['upload_photo', 'upload_materials']));
  const UPLOAD_NAVIGATION_BLOCK_RE = /(?:submit|confirm|delete|remove|save|draft|next|previous|finish|login|logout|payment|checkout|提交|确认|删除|移除|保存|暂存|下一步|上一步|完成|登录|退出|支付)/i;
  const FORM_PROGRESSION_TEXT_RE = /(?:^|\s)(?:next|continue|finish)(?:\s|$)|下一步|下一页|继续|完成|保存\s*并\s*下一步/i;
  const FORM_PROGRESSION_CONTAINER_SELECTOR = [
    'form footer', 'form [role="contentinfo"]', 'form [class*="footer"]',
    'form [class*="actions"]', 'form [class*="action-bar"]',
    'form [class*="button-bar"]', 'form [class*="form-buttons"]',
    'form [class*="steps-action"]', 'form [class*="step-action"]',
  ].join(',');

  function section(id, label, aliases) {
    return Object.freeze({ id, label, aliases: Object.freeze(aliases.slice()) });
  }

  function safeString(value) {
    return Safety?.safeString ? Safety.safeString(value) : String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalized(value) {
    return safeString(value).replace(/[：:]/g, '').replace(/[（(][^）)]{0,24}[）)]/g, '').replace(/\s+/g, '').toLocaleLowerCase();
  }

  function queryAll(rootNode, selector) {
    try { return [...(rootNode?.querySelectorAll?.(selector) || [])]; } catch (_) { return []; }
  }

  function closest(element, selector) {
    try { return element?.closest?.(selector) || null; } catch (_) { return null; }
  }

  function isExtensionUi(element) {
    return Boolean(closest(element, '#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]'));
  }

  function ancestorChain(element, document, maxDepth = MAX_FALLBACK_ANCESTOR_DEPTH) {
    const result = [];
    let current = element?.parentElement || null;
    let depth = 0;
    while (current && depth < maxDepth) {
      if (current === document?.body || current === document?.documentElement) break;
      // 很多旧报名系统把整套侧栏和内容一起包在一个大 form 中。form 只能影响
      // 最终动作安全，不能阻断语义簇向上寻找共同祖先。
      if (isExtensionUi(current)) break;
      result.push(current);
      current = current.parentElement || null;
      depth += 1;
    }
    return result;
  }

  function elementContains(container, element) {
    try { return Boolean(container?.contains?.(element)); } catch (_) { return false; }
  }

  function exactSemanticText(element, match) {
    return Boolean(match && normalized(Safety.actionText(element)) === normalized(match.alias));
  }

  function clusterSafetyOptions(element, match, document) {
    const exact = exactSemanticText(element, match);
    return {
      baseUrl: document.location?.href,
      allowLegacyNavigationHref: exact,
      allowPlainNavigationButton: exact,
      allowOnclickNavigation: exact,
    };
  }

  function analyzeSemanticClusters(document, definitions) {
    const broadCandidates = queryAll(document, FALLBACK_NAV_ITEM_SELECTOR)
      .slice(0, MAX_BROAD_SCAN_NODES)
      .filter(element => element && !isExtensionUi(element) && !Safety.isHiddenOrDisabled?.(element));
    // 先保留所有具有栏目语义的节点，再用非语义节点补足密度样本，避免正文前部
    // 大量普通按钮/列表项把页面后部的真实侧栏挤出 500 节点上限。
    const semanticCandidates = broadCandidates.filter(element => matchSection(Safety.actionText(element), definitions));
    const semanticSet = new Set(semanticCandidates);
    const rawCandidates = [
      ...semanticCandidates,
      ...broadCandidates.filter(element => !semanticSet.has(element)),
    ].slice(0, MAX_SCAN_NODES);
    const matchedCandidates = rawCandidates
      .map(element => ({ element, match: matchSection(Safety.actionText(element), definitions) }))
      .filter(item => item.match);
    const buckets = new Map();

    rawCandidates.forEach(element => {
      ancestorChain(element, document).forEach(ancestor => {
        if (!buckets.has(ancestor)) buckets.set(ancestor, { allMembers: new Set(), members: new Set(), sections: new Set() });
        buckets.get(ancestor).allMembers.add(element);
      });
    });

    // 只有普通栏目中通过逐节点安全检查的精确语义节点才能为未知容器提供证据。
    // 上传栏目不能反过来证明容器可信，提交/删除等危险节点也永不参与簇建立。
    matchedCandidates.forEach(item => {
      if (UPLOAD_NAVIGATION_SECTIONS.has(item.match.definition.id)) return;
      if (!exactSemanticText(item.element, item.match)) return;
      if (!Safety.isNavigationCandidateSafe(item.element, clusterSafetyOptions(item.element, item.match, document))) return;
      ancestorChain(item.element, document).forEach(ancestor => {
        if (!buckets.has(ancestor)) buckets.set(ancestor, { allMembers: new Set(), members: new Set(), sections: new Set() });
        const bucket = buckets.get(ancestor);
        bucket.members.add(item.element);
        bucket.sections.add(item.match.definition.id);
      });
    });

    const eligible = [...buckets.entries()].filter(([, bucket]) =>
      bucket.members.size >= MIN_FALLBACK_DISTINCT_SECTIONS
      && bucket.sections.size >= MIN_FALLBACK_DISTINCT_SECTIONS
    );
    const lcaRoots = new Set(eligible
      .filter(([ancestor]) => !eligible.some(([other]) => other !== ancestor && elementContains(ancestor, other)))
      .map(([ancestor]) => ancestor));
    const trusted = new Map();
    eligible.forEach(([ancestor, bucket]) => {
      const density = bucket.members.size / Math.max(1, bucket.allMembers.size);
      if (density >= 0.35) trusted.set(ancestor, { reason: 'SEMANTIC_CLUSTER_DENSITY', density });
      else if (lcaRoots.has(ancestor)) trusted.set(ancestor, { reason: 'SEMANTIC_CLUSTER_LCA', density });
    });

    const elements = new Set();
    const details = new Map();
    matchedCandidates.forEach(item => {
      const chain = ancestorChain(item.element, document);
      const root = chain.find(ancestor => trusted.has(ancestor));
      if (!root) return;
      elements.add(item.element);
      details.set(item.element, trusted.get(root));
    });
    return { rawCandidates, matchedCandidates, elements, details, trustedRoots: [...trusted.keys()] };
  }

  function inferNavigationClusterCandidates(document, definitions) {
    return [...analyzeSemanticClusters(document, definitions).elements];
  }

  function isSafeUploadSectionScript(rawScript, baseUrl) {
    if (!rawScript) return true;
    return Safety.isSafeLegacyNavigationScript?.(rawScript, {
      baseUrl,
      allowUploadNavigation: true,
    }) === true;
  }

  function isTrustedUploadNavigation(element, match, { document, inNavigation = false } = {}) {
    if (!element || !match || !inNavigation || !UPLOAD_NAVIGATION_SECTIONS.has(match.definition?.id)) return false;
    const metadata = Safety.collectActionMetadata?.(element) || {};
    if (Safety.isHiddenOrDisabled?.(element) || isExtensionUi(element)) return false;
    const targetText = normalized(metadata.text || Safety.actionText(element));
    const aliasText = normalized(match.alias);
    if (!targetText || targetText !== aliasText) return false;
    const tag = String(metadata.tag || '').toLowerCase();
    const semanticButton = Safety.isSemanticNavigationButton?.(element) === true;
    if (!['a', 'li', 'div', 'span'].includes(tag) && !semanticButton) return false;
    if ((tag === 'button' && !semanticButton) || metadata.formAction) return false;
    const linkType = Safety.hrefType?.(metadata.href, document?.location?.href) || 'invalid';
    if (['cross-origin', 'blocked-protocol', 'invalid'].includes(linkType)) return false;
    if (linkType === 'javascript' && !isSafeUploadSectionScript(metadata.href, document?.location?.href)) return false;
    if (metadata.onclick && !isSafeUploadSectionScript(metadata.onclick, document?.location?.href)) return false;
    if (metadata.formAction || UPLOAD_NAVIGATION_BLOCK_RE.test([
      metadata.name, metadata.id, metadata.href, metadata.formAction, metadata.onclick,
    ].filter(Boolean).join(' '))) return false;
    return true;
  }

  function isActive(element, candidates = []) {
    if (!element) return false;
    if (element.getAttribute?.('aria-current') === 'page' || element.getAttribute?.('aria-selected') === 'true') return true;
    try {
      if (element.matches?.(ACTIVE_SELECTOR)) return true;
      const activeAncestor = closest(element, ACTIVE_SELECTOR);
      if (!activeAncestor || activeAncestor === element) return false;
      let current = element.parentElement;
      let depth = 1;
      while (current && current !== activeAncestor && depth <= 3) {
        current = current.parentElement;
        depth += 1;
      }
      if (current !== activeAncestor || depth > 3 || typeof activeAncestor.contains !== 'function') return false;
      // 只接受包裹当前单个栏目项的 active 父节点，不能让整个 active 菜单容器
      // 把所有后代都标记为当前栏目。
      const activePeers = candidates.filter(candidate => activeAncestor.contains(candidate));
      return activePeers.length === 1 && activePeers[0] === element;
    }
    catch (_) { return false; }
  }

  function mergeDefinitions(customAliases) {
    if (!customAliases || typeof customAliases !== 'object' || Array.isArray(customAliases)) return SECTION_DEFINITIONS;
    return SECTION_DEFINITIONS.map(definition => {
      const additions = Array.isArray(customAliases[definition.id])
        ? customAliases[definition.id].map(safeString).filter(Boolean).slice(0, 20)
        : [];
      return section(definition.id, definition.label, [...definition.aliases, ...additions]);
    });
  }

  function matchSection(text, definitions = SECTION_DEFINITIONS) {
    const target = normalized(text);
    if (!target) return null;
    let best = null;
    for (const definition of definitions) {
      for (const alias of definition.aliases) {
        const aliasText = normalized(alias);
        if (!aliasText) continue;
        let confidence = 0;
        if (target === aliasText) confidence = 0.98;
        else if (target.includes(aliasText) && target.length <= aliasText.length + 8) confidence = 0.88;
        else if (aliasText.includes(target) && target.length >= 4) confidence = 0.78;
        if (!best || confidence > best.confidence) best = confidence ? { definition, alias, confidence } : best;
      }
    }
    return best;
  }

  function classifyNavigationIntent(element) {
    if (!element || typeof element !== 'object') {
      return Object.freeze({ kind: 'UNKNOWN', allowed: false, reasonCode: 'UNKNOWN_NAVIGATION_INTENT' });
    }
    const metadata = Safety.collectActionMetadata?.(element) || {};
    const accessibleText = safeString([
      Safety.actionText?.(element),
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      element.getAttribute?.('name'),
      element.getAttribute?.('id'),
    ].filter(Boolean).join(' '));
    const type = safeString(metadata.type || element.getAttribute?.('type') || element.type).toLowerCase();
    const inFormFooter = Boolean(closest(element, FORM_PROGRESSION_CONTAINER_SELECTOR));
    const formActionControl = Boolean(metadata.insideForm && ['submit', 'image'].includes(type));
    if (FORM_PROGRESSION_TEXT_RE.test(accessibleText) || inFormFooter || formActionControl) {
      return Object.freeze({
        kind: 'FORM_PROGRESSION',
        allowed: false,
        reasonCode: 'FORM_PROGRESSION_USER_ONLY',
      });
    }
    const role = safeString(element.getAttribute?.('role')).toLowerCase();
    const explicitSection = safeString(element.getAttribute?.('data-section'));
    const inNavigation = Boolean(closest(element, NAV_CONTAINER_SELECTOR));
    if (explicitSection || ['tab', 'menuitem'].includes(role) || inNavigation) {
      return Object.freeze({
        kind: 'SECTION_NAVIGATION',
        allowed: true,
        reasonCode: 'SECTION_NAVIGATION',
      });
    }
    return Object.freeze({ kind: 'UNKNOWN', allowed: false, reasonCode: 'UNKNOWN_NAVIGATION_INTENT' });
  }

  function assessCandidate(element, match, context = {}) {
    const document = context.document;
    const metadata = Safety.collectActionMetadata?.(element) || {};
    const semanticSection = match?.definition?.id || null;
    const linkType = Safety.hrefType?.(metadata.href, document?.location?.href) || (metadata.href ? 'invalid' : 'none');
    const inNavigation = Boolean(context.inNavigation);
    const navigationIntent = classifyNavigationIntent(element);
    const exact = exactSemanticText(element, match);
    const options = {
      baseUrl: document?.location?.href,
      allowLegacyNavigationHref: inNavigation && exact,
      allowPlainNavigationButton: inNavigation && exact,
      allowOnclickNavigation: inNavigation && exact,
    };
    const uploadNavigation = isTrustedUploadNavigation(element, match, { document, inNavigation });
    const dangerous = Safety.isDangerousAction?.(element, options) === true;
    const normalSafe = Safety.isNavigationCandidateSafe?.(element, options) === true;
    let accepted = Boolean(match && inNavigation && (normalSafe || uploadNavigation));
    let rejectReason = '';
    let acceptReason = '';

    if (!match) rejectReason = 'NO_SECTION_MATCH';
    else if (isExtensionUi(element)) rejectReason = 'EXTENSION_UI_REJECTED';
    else if (Safety.isHiddenOrDisabled?.(element)) rejectReason = 'HIDDEN_OR_DISABLED';
    else if (!inNavigation) rejectReason = 'OUTSIDE_SEMANTIC_CLUSTER';
    else if (['submit', 'reset', 'file', 'image'].includes(metadata.type)
      && !Safety.isSemanticNavigationButton?.(element)) rejectReason = 'FORM_ACTION_CONTROL_REJECTED';
    else if (navigationIntent.kind === 'FORM_PROGRESSION') rejectReason = 'FORM_PROGRESSION_USER_ONLY';
    else if (dangerous && !uploadNavigation) rejectReason = 'DANGEROUS_ACTION_REJECTED';
    else if (['cross-origin', 'blocked-protocol', 'invalid'].includes(linkType)) rejectReason = 'UNSAFE_HREF';
    else if (linkType === 'javascript' && !uploadNavigation && !Safety.isSafeLegacyNavigationScript?.(metadata.href, { baseUrl: document?.location?.href })) rejectReason = 'UNSAFE_JAVASCRIPT_HREF';
    else if (metadata.onclick && !uploadNavigation && !Safety.isSafeLegacyNavigationScript?.(metadata.onclick, { baseUrl: document?.location?.href })) rejectReason = 'UNSAFE_ONCLICK';
    else if (!normalSafe && !uploadNavigation) rejectReason = 'UNSAFE_NAVIGATION_CONTROL';

    if (rejectReason) accepted = false;
    if (accepted) {
      acceptReason = uploadNavigation
        ? 'UPLOAD_SECTION_NAVIGATION_ONLY'
        : (context.acceptReason || 'KNOWN_NAVIGATION_CONTAINER');
    }
    return {
      semanticSection,
      accepted,
      rejectReason,
      insideForm: Boolean(metadata.insideForm),
      hrefType: linkType,
      acceptReason,
      uploadNavigationOnly: Boolean(accepted && uploadNavigation),
      navigationIntent: navigationIntent.kind,
      metadata,
    };
  }

  class NavigationEngine {
    constructor(options = {}) {
      if (!Safety?.isDangerousAction || !Safety?.isNavigationCandidateSafe) {
        throw new Error('JFNavigationEngine requires JFSafety');
      }
      this.document = options.document || (typeof document !== 'undefined' ? document : null);
      if (!this.document?.querySelectorAll) throw new Error('需要有效的 document');
      this.definitions = mergeDefinitions(options.sectionAliases);
      this.configuredSelectors = Array.isArray(options.configuredSelectors)
        ? options.configuredSelectors.filter(value => typeof value === 'string' && value.length <= 300).slice(0, 30)
        : [];
      this.minimumConfidence = Math.max(0.55, Math.min(1, Number(options.minimumConfidence) || 0.78));
      this.handles = new Map();
      this.lastScan = [];
      this.lastCandidates = [];
      this.scanVersion = 0;
      this.scanUrl = '';
      this.handleCounter = 0;
      this.observer = null;
      this.watchTimer = null;
      this.lastWatchedUrl = '';
    }

    classify(elementOrText, context = {}) {
      const text = typeof elementOrText === 'object' ? Safety.actionText(elementOrText) : safeString(elementOrText);
      const match = matchSection(text, this.definitions);
      if (!match) {
        const metadata = typeof elementOrText === 'object' ? Safety.collectActionMetadata?.(elementOrText) || {} : {};
        return {
          matched: false, sectionId: null, semanticSection: null, label: '', text, confidence: 0,
          safe: false, accepted: false, passiveOnly: true, reasonCode: 'NO_SECTION_MATCH',
          rejectReason: 'NO_SECTION_MATCH', insideForm: Boolean(metadata.insideForm),
          hrefType: Safety.hrefType?.(metadata.href, this.document.location?.href) || 'none', acceptReason: '',
        };
      }

      const element = typeof elementOrText === 'object' ? elementOrText : null;
      const navContainer = element ? closest(element, NAV_CONTAINER_SELECTOR) : null;
      const inNavigation = Boolean(context.inNavigation || navContainer);
      const assessment = element
        ? assessCandidate(element, match, {
          document: this.document,
          inNavigation,
          acceptReason: context.acceptReason,
        })
        : {
          semanticSection: match.definition.id,
          accepted: !Safety.isDangerousAction(text), rejectReason: '', insideForm: false,
          hrefType: 'none', acceptReason: 'TEXT_ONLY', uploadNavigationOnly: false,
        };
      const safe = assessment.accepted;
      let confidence = match.confidence;
      if (inNavigation) confidence = Math.min(1, confidence + 0.08);
      if (context.recognizedSiblingCount >= 2) confidence = Math.min(1, confidence + 0.06);

      const reasonCode = safe
        ? (assessment.uploadNavigationOnly ? 'SAFE_UPLOAD_SECTION_NAVIGATION' : 'SAFE_NAVIGATION_ITEM')
        : (assessment.rejectReason || 'UNSAFE_NAVIGATION_CONTROL');

      return {
        matched: true,
        sectionId: match.definition.id,
        semanticSection: assessment.semanticSection,
        label: match.definition.label,
        text,
        confidence: Number(confidence.toFixed(2)),
        safe,
        accepted: assessment.accepted,
        passiveOnly: !safe,
        reasonCode,
        rejectReason: assessment.rejectReason,
        insideForm: assessment.insideForm,
        hrefType: assessment.hrefType,
        acceptReason: assessment.acceptReason,
        uploadNavigationOnly: assessment.uploadNavigationOnly,
      };
    }

    scan() {
      this.handles.clear();
      this.scanVersion += 1;
      this.scanUrl = safeString(this.document.location?.href);
      const roots = queryAll(this.document, NAV_CONTAINER_SELECTOR);
      const clusterAnalysis = analyzeSemanticClusters(this.document, this.definitions);
      const inferredNavigation = clusterAnalysis.elements;
      const candidates = [];
      const seen = new Set();
      const add = element => {
        if (!element || seen.has(element) || candidates.length >= MAX_SCAN_NODES || isExtensionUi(element)) return;
        seen.add(element);
        candidates.push(element);
      };
      roots.forEach(rootNode => queryAll(rootNode, NAV_ITEM_SELECTOR).forEach(add));
      clusterAnalysis.rawCandidates.forEach(add);
      this.configuredSelectors.forEach(selector => queryAll(this.document, selector).forEach(add));

      const records = candidates.map((element, domIndex) => {
        const match = matchSection(Safety.actionText(element), this.definitions);
        const knownContainer = Boolean(closest(element, NAV_CONTAINER_SELECTOR)
          || roots.some(rootNode => elementContains(rootNode, element)));
        const clusterDetail = clusterAnalysis.details.get(element);
        const inNavigation = knownContainer || inferredNavigation.has(element);
        const acceptReason = knownContainer
          ? 'KNOWN_NAVIGATION_CONTAINER'
          : (clusterDetail?.reason || '');
        const classification = this.classify(element, {
          inNavigation,
          clusterMember: inferredNavigation.has(element),
          acceptReason,
        });
        return { element, domIndex, match, classification };
      });

      // <li><a>栏目</a></li> / <li><button>…</button></li> 只保留最内层
      // 已通过完整安全复核的节点。被折叠的 wrapper 仍留在 scanDetailed 供诊断。
      records.forEach(record => {
        if (!record.classification.accepted || !record.match) return;
        const descendant = records.find(other => other !== record
          && other.classification.accepted
          && other.classification.semanticSection === record.classification.semanticSection
          && elementContains(record.element, other.element));
        if (!descendant) return;
        record.classification = {
          ...record.classification,
          safe: false,
          accepted: false,
          passiveOnly: true,
          reasonCode: 'DUPLICATE_WRAPPER',
          rejectReason: 'DUPLICATE_WRAPPER',
          acceptReason: '',
        };
      });

      const effectiveRecords = records.filter(record => record.classification.accepted);
      const siblingCounts = new Map();
      effectiveRecords.forEach(record => {
        const element = record.element;
        const parent = element.parentElement;
        if (!parent) return;
        const count = effectiveRecords.filter(other => other.element.parentElement === parent && other.match).length;
        siblingCounts.set(element, count);
      });

      const descriptors = effectiveRecords.map(record => {
        const { element, domIndex } = record;
        const classification = siblingCounts.get(element)
          ? this.classify(element, {
            inNavigation: true,
            clusterMember: inferredNavigation.has(element),
            recognizedSiblingCount: siblingCounts.get(element),
            acceptReason: record.classification.acceptReason,
          })
          : record.classification;
        const handleId = `nav-${this.scanVersion}-${++this.handleCounter}`;
        this.handles.set(handleId, element);
        return Object.freeze({
          handleId,
          sectionId: classification.sectionId,
          label: classification.label,
          text: classification.text.slice(0, 120),
          confidence: classification.confidence,
          safe: classification.safe,
          passiveOnly: classification.passiveOnly,
          reasonCode: classification.reasonCode,
          acceptReason: classification.acceptReason,
          uploadNavigationOnly: classification.uploadNavigationOnly,
          active: isActive(element, effectiveRecords.map(item => item.element)),
          domIndex,
        });
      });

      const occurrences = new Map();
      descriptors.forEach(item => occurrences.set(item.sectionId, (occurrences.get(item.sectionId) || 0) + 1));
      this.lastScan = descriptors.map(item => occurrences.get(item.sectionId) > 1
        ? Object.freeze({ ...item, safe: false, passiveOnly: true, reasonCode: 'AMBIGUOUS_SECTION' })
        : item);
      const ambiguousSections = new Set(this.lastScan.filter(item => item.reasonCode === 'AMBIGUOUS_SECTION').map(item => item.sectionId));
      this.lastCandidates = records.map((record, index) => {
        const classification = record.classification;
        const ambiguous = classification.semanticSection && ambiguousSections.has(classification.semanticSection)
          && classification.accepted;
        return Object.freeze({
          candidateId: `candidate-${this.scanVersion}-${index + 1}`,
          text: safeString(Safety.actionText(record.element)).slice(0, 120),
          tag: safeString(record.element?.tagName).toLowerCase().slice(0, 24),
          tagName: safeString(record.element?.tagName).toUpperCase().slice(0, 24),
          hasOnClick: Boolean(record.classification?.metadata?.onclick),
          semanticSection: classification.semanticSection,
          accepted: ambiguous ? false : Boolean(classification.accepted),
          rejectReason: ambiguous ? 'AMBIGUOUS_SECTION' : (classification.rejectReason || ''),
          insideForm: Boolean(classification.insideForm),
          hrefType: classification.hrefType || 'none',
          acceptReason: ambiguous ? '' : (classification.acceptReason || ''),
        });
      });
      return this.lastScan.slice();
    }

    scanDetailed() {
      const items = this.scan();
      return Object.freeze({
        items,
        candidates: this.lastCandidates.slice(),
      });
    }

    buildQueue(scanResult = this.lastScan.length ? this.lastScan : this.scan()) {
      const bestBySection = new Map();
      for (const item of scanResult || []) {
        if (!item?.sectionId || item.confidence < this.minimumConfidence) continue;
        const existing = bestBySection.get(item.sectionId);
        if (!existing || item.confidence > existing.confidence) bestBySection.set(item.sectionId, item);
      }
      const definitionOrder = new Map(this.definitions.map((definition, index) => [definition.id, index]));
      return [...bestBySection.values()]
        .sort((a, b) => (definitionOrder.get(a.sectionId) ?? 999) - (definitionOrder.get(b.sectionId) ?? 999) || a.domIndex - b.domIndex)
        .map((item, index) => Object.freeze({
          id: item.sectionId,
          sectionId: item.sectionId,
          label: item.label,
          index,
          state: item.active ? 'current' : 'pending',
          confidence: item.confidence,
          passiveOnly: !item.safe,
          reasonCode: item.reasonCode,
          requiresUserAction: Boolean(!item.safe),
        }));
    }

    resolveHandle(target) {
      const handleId = typeof target === 'string' && target.startsWith('nav-') ? target : target?.handleId;
      if (handleId && this.handles.has(handleId)) return { descriptor: this.lastScan.find(item => item.handleId === handleId), element: this.handles.get(handleId) };
      const sectionId = typeof target === 'string' ? target : target?.sectionId || target?.id;
      const matching = this.lastScan.filter(item => item.sectionId === sectionId);
      if (matching.length !== 1) return { descriptor: null, element: null };
      return { descriptor: matching[0], element: this.handles.get(matching[0].handleId) || null };
    }

    async navigate(target, options = {}) {
      const requestedSection = typeof target === 'string' && !target.startsWith('nav-') ? target : target?.sectionId || target?.id;
      const runAuthorization = options.runAuthorization;
      const authorizedRun = Boolean(
        runAuthorization
        && runAuthorization.userConfirmed === true
        && Number(runAuthorization.expiresAt) > Date.now()
        && Array.isArray(runAuthorization.allowedSectionIds)
        && runAuthorization.allowedSectionIds.includes(requestedSection)
        && /^[a-z0-9._:-]{6,160}$/i.test(String(runAuthorization.taskId || ''))
        && /^[a-z0-9_-]{16,200}$/i.test(String(runAuthorization.nonce || ''))
      );
      const directConfirmation = options.userInitiated === true && options.confirmSectionId === requestedSection;
      if ((!directConfirmation && !authorizedRun) || !requestedSection) {
        return { ok: false, code: 'FRESH_USER_CONFIRMATION_REQUIRED', changed: false };
      }
      if (!this.lastScan.length) this.scan();
      if (safeString(this.document.location?.href) !== this.scanUrl) {
        this.invalidate();
        return { ok: false, code: 'STALE_SCAN_AFTER_NAVIGATION', changed: false };
      }
      const { descriptor, element } = this.resolveHandle(target);
      if (!descriptor || !element) return { ok: false, code: 'NAVIGATION_TARGET_NOT_FOUND', changed: false };
      if (descriptor.sectionId !== requestedSection) return { ok: false, code: 'SECTION_CONFIRMATION_MISMATCH', changed: false };
      if (!descriptor.safe || descriptor.confidence < this.minimumConfidence) return { ok: false, code: descriptor.reasonCode || 'UNSAFE_NAVIGATION_TARGET', changed: false };
      if (!element.isConnected || element.ownerDocument !== this.document) return { ok: false, code: 'STALE_DOM_HANDLE', changed: false };
      const finalMatch = matchSection(Safety.actionText(element), this.definitions);
      if (!finalMatch || finalMatch.definition.id !== requestedSection) {
        return { ok: false, code: 'TARGET_SEMANTICS_CHANGED', changed: false };
      }
      const currentClusters = analyzeSemanticClusters(this.document, this.definitions);
      const knownContainer = Boolean(closest(element, NAV_CONTAINER_SELECTOR));
      const clusterMember = currentClusters.elements.has(element);
      const finalAssessment = assessCandidate(element, finalMatch, {
        document: this.document,
        inNavigation: knownContainer || clusterMember,
        acceptReason: knownContainer
          ? 'KNOWN_NAVIGATION_CONTAINER'
          : (currentClusters.details.get(element)?.reason || ''),
      });
      if (!finalAssessment.accepted
        || Boolean(descriptor.uploadNavigationOnly) !== Boolean(finalAssessment.uploadNavigationOnly)) {
        return { ok: false, code: finalAssessment.rejectReason || 'TARGET_FAILED_FINAL_SAFETY_CHECK', changed: false };
      }

      const beforeSnapshot = PageReady?.captureNavigationSnapshot?.(this.document) || { url: this.document.location?.href || '' };
      try { element.click(); }
      catch (error) { return { ok: false, code: 'NAVIGATION_CLICK_FAILED', changed: false, reason: safeString(error?.message).slice(0, 160) }; }

      const change = PageReady?.waitForNavigationChange
        ? await PageReady.waitForNavigationChange({
          document: this.document,
          beforeSnapshot,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
          predicate: () => isActive(element),
        })
        : { changed: isActive(element) || safeString(this.document.location?.href) !== beforeSnapshot.url, reason: 'SYNCHRONOUS_CHECK' };
      if (!change.changed) return { ok: false, code: 'NAVIGATION_DID_NOT_CHANGE_PAGE', changed: false, waitReason: change.reason };
      await PageReady?.waitForDOMStable?.({ document: this.document, timeoutMs: Math.min(Number(options.timeoutMs) || 5_000, 10_000), signal: options.signal });
      this.invalidate();
      return { ok: true, code: 'NAVIGATED', changed: true, sectionId: requestedSection, waitReason: change.reason };
    }

    startWatching(callback) {
      this.stopWatching();
      this.lastWatchedUrl = safeString(this.document.location?.href);
      const view = this.document.defaultView;
      let scheduled = false;
      const notify = reason => {
        if (scheduled) return;
        scheduled = true;
        const run = () => {
          scheduled = false;
          this.invalidate();
          if (typeof callback === 'function') callback({ reason, queue: this.buildQueue(this.scan()) });
        };
        if (typeof view?.requestAnimationFrame === 'function') view.requestAnimationFrame(run);
        else setTimeout(run, 0);
      };
      const Observer = view?.MutationObserver || (typeof MutationObserver === 'function' ? MutationObserver : null);
      if (Observer && this.document.documentElement) {
        this.observer = new Observer(records => {
          const relevant = records.some(record => {
            const target = record?.target;
            return !target?.closest?.('#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]');
          });
          if (relevant) notify('DOM');
        });
        this.observer.observe(this.document.documentElement, { childList: true, subtree: true, attributes: true });
      }
      this.watchTimer = setInterval(() => {
        const nextUrl = safeString(this.document.location?.href);
        if (nextUrl !== this.lastWatchedUrl) {
          this.lastWatchedUrl = nextUrl;
          notify('LOCATION');
        }
      }, 200);
      return () => this.stopWatching();
    }

    stopWatching() {
      this.observer?.disconnect?.();
      this.observer = null;
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }

    invalidate() {
      this.handles.clear();
      this.lastScan = [];
      this.lastCandidates = [];
      this.scanUrl = '';
    }

    destroy() {
      this.stopWatching();
      this.invalidate();
    }
  }

  function createNavigationEngine(options) {
    return new NavigationEngine(options);
  }

  return Object.freeze({
    NAV_CONTAINER_SELECTOR,
    FALLBACK_NAV_ITEM_SELECTOR,
    NAV_ITEM_SELECTOR,
    SECTION_DEFINITIONS,
    NavigationEngine,
    createNavigationEngine,
    matchSection,
    classifyNavigationIntent,
  });
});
