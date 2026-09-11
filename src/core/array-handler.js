/*
 * 解放：动态数组表单组处理。只新增缺失组，永不删除网页现有记录。
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initArrayHandler(root, factory) {
  let generic = root?.JFGeneric;
  let safety = root?.JFSafety;
  let structures = root?.JFSectionStructures;
  if (typeof require === 'function') {
    try { generic ||= require('../adapters/generic.js'); } catch (_) { /* browser */ }
    try { safety ||= require('./safety.js'); } catch (_) { /* optional in unit tests */ }
    try { structures ||= require('../mappings/section-structures.js'); } catch (_) { /* browser */ }
  }
  const api = factory(generic, safety, structures);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFArrayHandler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function arrayHandlerFactory(G, Safety, Structures) {
  'use strict';

  const ARRAY_SECTIONS = Object.freeze([
    'family', 'education', 'awards', 'research', 'projects', 'papers', 'patents',
    'practice', 'internships', 'student_work', 'certificates', 'language',
  ]);
  const ADD_PATTERNS = Object.freeze({
    family: /新增一行|添加一行|新增(?:一条|成员)?|添加(?:一条|成员)?|新增家庭|添加家庭|^\+$/,
    education: /新增(?:一条|教育|经历)?|添加(?:一条|教育|经历)?|新增学历|添加学历|^\+$/,
    awards: /新增一行|添加一行|新增奖励|添加奖励|新增奖项|添加奖项|新增获奖|添加获奖|新增|添加|^\+$/,
    research: /新增(?:一条|科研|项目|经历)?|添加(?:一条|科研|项目|经历)?|^\+$/,
    projects: /新增(?:一条|项目|经历)?|添加(?:一条|项目|经历)?|^\+$/,
    papers: /新增(?:一条|论文|成果)?|添加(?:一条|论文|成果)?|^\+$/,
    patents: /新增(?:一条|专利)?|添加(?:一条|专利)?|^\+$/,
    practice: /新增(?:一条|实践|经历)?|添加(?:一条|实践|经历)?|^\+$/,
    internships: /新增(?:一条|实习|经历)?|添加(?:一条|实习|经历)?|^\+$/,
    student_work: /新增(?:一条|学生工作|任职|经历)?|添加(?:一条|学生工作|任职|经历)?|^\+$/,
    certificates: /新增(?:一条|证书)?|添加(?:一条|证书)?|^\+$/,
    language: /新增(?:一条|语言|外语)?|添加(?:一条|语言|外语)?|^\+$/,
  });
  const CONTROL_SELECTOR = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select,[contenteditable="true"],[role="combobox"],input[type="file"]';
  const GROUP_SELECTOR = [
    '[data-repeat-item]', '[data-array-item]', '.multi-item', '.dynamic-item', '.form-group-item',
    '[class*="repeat"][class*="item"]', '[class*="dynamic"][class*="item"]',
    '[class*="experience"][class*="item"]', '[class*="award"][class*="item"]',
    '[role="row"]', 'fieldset',
  ].join(',');
  const REGION_SELECTOR = 'table,[role="table"],fieldset,[data-repeat-list],[data-array-list]';
  const SINGLETON_COLLECTIONS = Object.freeze(new Set(['education']));
  const PAGE_WIDE_ACTION_TAGS = Object.freeze(new Set(['HTML', 'BODY', 'MAIN']));
  const GLOBAL_ACTION_TAGS = Object.freeze(new Set(['FOOTER']));
  const ACTION_OWNER_MAX_DEPTH = 10;
  const COLLECTION_OWNER_ATTRIBUTES = Object.freeze([
    'data-section',
    'data-section-id',
    'data-collection',
    'data-repeat-list',
    'data-array-list',
  ]);

  const SINGLETON_VIEW_SIGNATURES =
    Object.freeze({
      education: Object.freeze([
        Object.freeze([
          '所在学校',
          '所在学校名称',
          '学校名称',
        ]),

        Object.freeze([
          '所在院系',
          '所在学院',
          '院系',
        ]),

        Object.freeze([
          '所在专业',
          '专业名称',
        ]),

        Object.freeze([
          '入学年月',
          '入学时间',
        ]),

        Object.freeze([
          '预计毕业年月',
          '毕业年月',
        ]),

        Object.freeze([
          '在校生注册学号',
          '注册学号',
          '学号',
        ]),
      ]),
    }); 

  const SECTION_TABLE_SIGNATURES =
    Structures?.SECTION_TABLE_SIGNATURES
    || Object.freeze({});


  const groupIds = new WeakMap();
  let groupSequence = 0;

  function safeText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

  function canonicalSectionId(section) {
    const value = safeText(section);
    return Structures?.canonicalSectionId?.(value) || value;
  }

  function parseChineseInteger(value) {
    const text = safeText(value);
    if (!text) return null;
    if (/^\d{1,3}$/.test(text)) return Number(text);

    const digits = Object.freeze({
      零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
      五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    });

    if (Object.prototype.hasOwnProperty.call(digits, text)) {
      return digits[text];
    }

    const tenMatch = text.match(/^([一二两三四五六七八九]?)十([一二两三四五六七八九]?)$/);
    if (tenMatch) {
      const tens = tenMatch[1] ? digits[tenMatch[1]] : 1;
      const ones = tenMatch[2] ? digits[tenMatch[2]] : 0;
      return tens * 10 + ones;
    }

    return null;
  }

  function detectItemLimit(rootNode, section = '') {
    if (!rootNode) return null;

    const configured = Number(
      rootNode.getAttribute?.('data-max-items')
      || rootNode.getAttribute?.('data-max-count')
      || 0
    );
    if (Number.isInteger(configured) && configured > 0 && configured <= 100) {
      return configured;
    }

    const text = safeText(rootNode.innerText || rootNode.textContent || '');
    if (!text) return null;

    /*
     * 只接受“项/条/份/组/篇”这一类集合数量单位。
     * 不匹配“最多300字”“最多3MB”之类字段长度/文件大小限制。
     */
    const patterns = [
      /(?:最多|至多|不超过|不得超过|限填|限报|最大(?:填写|填报)?|最多(?:填写|填报|添加|新增|选择|列举)?)[^\d一二两三四五六七八九十]{0,8}(\d{1,3}|[一二两三四五六七八九十]{1,3})\s*(?:项|条|份|组|篇)/i,
      /(?:限|仅限)[^\d一二两三四五六七八九十]{0,6}(\d{1,3}|[一二两三四五六七八九十]{1,3})\s*(?:项|条|份|组|篇)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const limit = parseChineseInteger(match?.[1]);
      if (Number.isInteger(limit) && limit > 0 && limit <= 100) {
        return limit;
      }
    }

    return null;
  }

  function addPatternFor(section) {
    const canonical = canonicalSectionId(section);
    return Structures?.definitionForSection?.(canonical)?.addPattern
      || ADD_PATTERNS[canonical]
      || /新增一条|添加一条|新增|添加|^\+$/;
  }

  function normalizeStructureText(value) {
    return Structures?.normalizeStructureText?.(value)
      || safeText(value)
        .replace(
          /[\s:：,，.。;；、（）()\[\]【】/_-]+/g,
          ''
        )
        .toLowerCase();
  }


  function isActuallyVisible(element) {
    if (!element || typeof element !== 'object') {
      return false;
    }

    const view =
      element.ownerDocument?.defaultView
      || globalThis;

    let current = element;
    let depth = 0;

    /*
    * 不只检查元素自己，
    * 还检查所有祖先节点。
    *
    * 旧式多 Tab 表单：
    * 子 input 自己没有 display:none，
    * 但外层 basic/family 容器已经隐藏。
    */
    while (
      current
      && current.nodeType === 1
      && depth < 40
    ) {
      if (
        current.hidden
        || current.getAttribute?.('aria-hidden') === 'true'
      ) {
        return false;
      }

      try {
        const style =
          view?.getComputedStyle?.(current);

        if (
          style
          && (
            style.display === 'none'
            || style.visibility === 'hidden'
            || style.opacity === '0'
          )
        ) {
          return false;
        }
      } catch (_) {
        // 保持兼容测试 DOM
      }

      current =
        current.parentElement;

      depth += 1;
    }

    return true;
  }

  function structuralOwnerPriority(element) {
    if (!element || element.nodeType !== 1) return 0;
    const tag = safeText(element.tagName).toUpperCase();
    const role = safeText(element.getAttribute?.('role') || element.role).toLowerCase();
    const hasAttribute = name => {
      if (typeof element.hasAttribute === 'function') return element.hasAttribute(name);
      const value = element.getAttribute?.(name);
      return value !== null && value !== undefined && value !== '';
    };
    if (
      hasAttribute('data-section')
      || hasAttribute('data-section-id')
      || hasAttribute('data-collection')
      || hasAttribute('data-repeat-list')
      || hasAttribute('data-array-list')
    ) {
      return 3;
    }
    if (
      tag === 'FIELDSET'
      || role === 'region'
      || hasAttribute('data-max-items')
      || hasAttribute('data-max-count')
    ) {
      return 2;
    }
    return tag === 'SECTION' || tag === 'FORM' ? 1 : 0;
  }

  function explicitOwnerCollections(element) {
    if (!element || element.nodeType !== 1) return [];
    const values = COLLECTION_OWNER_ATTRIBUTES
      .map(name => safeText(element.getAttribute?.(name)))
      // Empty data-repeat-list/data-array-list attributes are structural markers,
      // not collection identities. Every non-empty machine identity is exact.
      .filter(Boolean)
      .map(value => canonicalSectionId(value.toLowerCase()));
    return [...new Set(values)];
  }

  function ownerCollectionRelation(element, section) {
    const target = canonicalSectionId(safeText(section).toLowerCase());
    const declared = explicitOwnerCollections(element);
    if (!declared.length || !target) return 'UNSPECIFIED';
    return declared.every(value => value === target) ? 'MATCH' : 'CONFLICT';
  }

  function isPageWideActionBoundary(element) {
    if (!element || element.nodeType === 9) return true;
    return PAGE_WIDE_ACTION_TAGS.has(safeText(element.tagName).toUpperCase())
      || safeText(element.getAttribute?.('role') || element.role).toLowerCase() === 'main';
  }

  function isGlobalActionBoundary(element) {
    if (!element || element.nodeType !== 1) return false;
    const tag = safeText(element.tagName).toUpperCase();
    const role = safeText(element.getAttribute?.('role') || element.role).toLowerCase();
    const className = safeText(element.getAttribute?.('class') || element.className).toLowerCase();
    const hasAttribute = name => {
      if (typeof element.hasAttribute === 'function') return element.hasAttribute(name);
      const value = element.getAttribute?.(name);
      return value !== null && value !== undefined && value !== '';
    };
    return GLOBAL_ACTION_TAGS.has(tag)
      || role === 'contentinfo'
      || hasAttribute('data-global-actions')
      || hasAttribute('data-page-actions')
      || /(?:^|[\s_-])sticky(?:[\s_-]|$)/.test(className)
      || /(?:^|[\s_-])global[\s_-]*actions?(?:[\s_-]|$)/.test(className);
  }

  function nearestCommonActionAncestor(button, groupRoot, actionRoot) {
    let current = button?.parentElement || null;
    while (current) {
      if (current.contains?.(groupRoot)) return current;
      if (current === actionRoot) break;
      current = current.parentElement;
    }
    return null;
  }

  function strongestStructuralOwner(node, actionRoot) {
    let current = node?.nodeType === 1 ? node : node?.parentElement;
    let owner = null;
    let priority = 0;
    while (current) {
      const candidatePriority = structuralOwnerPriority(current);
      if (candidatePriority > priority) {
        owner = current;
        priority = candidatePriority;
      }
      if (current === actionRoot) break;
      current = current.parentElement;
    }
    return owner;
  }

  function nearestActionBoundary(node, commonRoot) {
    let current = node?.parentElement || null;
    while (current) {
      if (
        structuralOwnerPriority(current) > 0
        || isPageWideActionBoundary(current)
        || isGlobalActionBoundary(current)
      ) {
        return current;
      }
      if (current === commonRoot) break;
      current = current.parentElement;
    }
    return null;
  }

  function isStructurallyOwnedAdd(button, groupRoot, actionRoot, section = '') {
    if (!button || !groupRoot || !actionRoot) return false;
    if (groupRoot.nodeType === 9 || isPageWideActionBoundary(groupRoot)) return false;
    const ownsGroupRoot = actionRoot === groupRoot || actionRoot.contains?.(groupRoot);
    if (!ownsGroupRoot || !actionRoot.contains?.(button)) return false;

    const groupOwner = strongestStructuralOwner(groupRoot, actionRoot);
    const buttonOwner = strongestStructuralOwner(button, actionRoot);
    if (
      ownerCollectionRelation(groupOwner, section) === 'CONFLICT'
      || ownerCollectionRelation(buttonOwner, section) === 'CONFLICT'
    ) {
      return false;
    }

    if (groupRoot.contains?.(button)) return true;

    const commonRoot = nearestCommonActionAncestor(button, groupRoot, actionRoot);
    if (!commonRoot || isPageWideActionBoundary(commonRoot)) return false;

    const buttonBoundary = nearestActionBoundary(button, commonRoot);

    if (buttonBoundary) {
      if (isPageWideActionBoundary(buttonBoundary)) return false;
      if (isGlobalActionBoundary(buttonBoundary)) {
        return Boolean(groupOwner && groupOwner === buttonOwner);
      }
      if (!buttonBoundary.contains?.(groupRoot)) return false;
    }

    if (groupOwner || buttonOwner) {
      if (
        safeText(actionRoot.tagName).toUpperCase() === 'FORM'
        && groupOwner === actionRoot
        && buttonOwner === actionRoot
      ) {
        return false;
      }
      return Boolean(groupOwner && groupOwner === buttonOwner);
    }

    // Legacy unmarked wrappers are accepted only at their tightest common
    // ancestor. Broad application roots and two independently nested branches
    // remain fail-closed.
    return commonRoot === actionRoot
      && (
        groupRoot.parentElement === commonRoot
        || button.parentElement === commonRoot
      );
  }

  function trustedLimitRoot(groupRoot, actionRoot) {
    if (!actionRoot || actionRoot === groupRoot) return groupRoot;
    if (!actionRoot.contains?.(groupRoot) || isPageWideActionBoundary(actionRoot)) return groupRoot;
    return strongestStructuralOwner(groupRoot, actionRoot) === actionRoot
      ? actionRoot
      : groupRoot;
  }

  function controlsWithin(element) {
    return [...element.querySelectorAll(CONTROL_SELECTOR)].filter(control => !control.closest('#__jf_panel__,#__jf_modal__'));
  }

  function visibleControlsWithin(element) {
    return controlsWithin(element)
      .filter(isActuallyVisible);
  }

  function looksLikeSingletonView(
    rootNode,
    section
  ) {
    const signatures =
      SINGLETON_VIEW_SIGNATURES[
        safeText(section)
      ];

    if (
      !signatures
      || !rootNode
    ) {
      return false;
    }

    const text =
      normalizeStructureText(
        rootNode.innerText
        || rootNode.textContent
        || ''
      );

    if (!text) {
      return false;
    }

    const matchedGroups =
      signatures.filter(
        group =>
          group.some(term => {
            const normalizedTerm =
              normalizeStructureText(
                term
              );

            return (
              normalizedTerm
              && text.includes(
                normalizedTerm
              )
            );
          })
      ).length;

    const visibleControlCount =
      visibleControlsWithin(
        rootNode
      ).length;

    /*
    * 固定学习信息页：
    *
    * 至少命中 3 类教育字段，
    * 且页面存在多个真正可见控件。
    */
    return (
      matchedGroups >= 3
      && visibleControlCount >= 3
    );
  }

  function isUsableGroup(element) {
    if (!element) {
      return false;
    }

    /*
    * 整个 group 如果属于隐藏 tab，
    * 绝不能拿来映射当前栏目。
    */
    if (!isActuallyVisible(element)) {
      return false;
    }

    if (
      element.closest?.(
        '#__jf_panel__,#__jf_modal__'
      )
    ) {
      return false;
    }

    /*
    * 至少两个真正可见的控件，
    * 才能作为重复表单组。
    */
    const controls =
      visibleControlsWithin(element);

    if (controls.length < 2) {
      return false;
    }

    return true;
  }
  function isOwnedByRegion(element, rootNode) {
    if (!element || !rootNode || rootNode.nodeType === 9) return true;
    let owner = null;
    try { owner = element.closest?.(REGION_SELECTOR) || null; }
    catch (_) { return true; }
    return !owner || owner === rootNode;
  }

  function directChildCandidates(rootNode, options = {}) {
    const parents = [...rootNode.querySelectorAll('table,tbody,form,[role="table"],[data-repeat-list],[class*="list"],[class*="table"]')];
    const candidates = [];
    parents.forEach(parent => {
      [...parent.children].forEach(child => {
        if (
          isUsableGroup(child)
          && (!options.ownedOnly || isOwnedByRegion(child, rootNode))
        ) candidates.push(child);
      });
    });
    return candidates;
  }
  function tableGroups(rootNode, options = {}) {
    const groups = [];
    const tables = [];

    /*
     * querySelectorAll() 不会包含调用它的 rootNode 自身。嵌入式区域把
     * 已确认的 table/[role=table] 直接作为扫描根时，必须显式把根表格
     * 加回候选，否则新增首行后仍会被误判为 0 组。
     */
    try {
      if (rootNode.matches?.('table,[role="table"]')) tables.push(rootNode);
      tables.push(...rootNode.querySelectorAll('table,[role="table"]'));
    } catch (_) {
      return groups;
    }

    [...new Set(tables)].forEach(table => {
      if (options.ownedOnly && table !== rootNode) return;
      let rows = [];
      try {
        rows = [
          ...table.querySelectorAll('tr'),
          ...table.querySelectorAll('[role="row"]'),
        ].filter((row, index, all) => all.indexOf(row) === index)
          .filter(row => {
            const ownerTable = row.closest?.('table,[role="table"]')
              || row.closest?.('table')
              || row.closest?.('[role="table"]');
            return ownerTable === table;
          });
      } catch (_) {
        return;
      }

      const headerIndex = rows.findIndex(row =>
        row.querySelector?.('th') || row.querySelector?.('[role="columnheader"]')
      );
      rows.slice(Math.max(0, headerIndex + 1)).forEach(row => {
        if (isUsableGroup(row)) groups.push(row);
      });
    });
    return groups;
  }

  function detectSectionTable(
    rootNode = document,
    section = ''
  ) {
    const signatures = SECTION_TABLE_SIGNATURES[canonicalSectionId(section)];
    if (!signatures || !rootNode?.querySelectorAll) return null;

    let tables = [];
    try {
      if (rootNode.matches?.('table,[role="table"]')) tables.push(rootNode);
      tables.push(...rootNode.querySelectorAll('table,[role="table"]'));
    } catch (_) {
      return null;
    }

    let best = null;

    for (const table of [...new Set(tables)]) {
      if (!table || !isActuallyVisible(table)) continue;

      let headers = [];
      try {
        headers = [
          ...table.querySelectorAll(
            'th,thead td,tr:first-child td,[role="columnheader"]'
          ),
        ]
          .map(node => normalizeStructureText(
            node.innerText
            || node.textContent
            || node.getAttribute?.('aria-label')
            || ''
          ))
          .filter(Boolean);
      } catch (_) {
        continue;
      }

      const structureScore =
        Structures?.scoreHeaderGroups?.(
          headers,
          canonicalSectionId(section)
        );

      const matched =
        structureScore?.matchedCount
        ?? signatures.filter(group =>
          group.some(term => {
            const normalizedTerm = normalizeStructureText(term);
            return normalizedTerm && headers.some(header => {
              if (header === normalizedTerm) return true;
              if (header.includes(normalizedTerm)) return true;
              return header.length >= 4
                && normalizedTerm.length >= 4
                && normalizedTerm.includes(header);
            });
          })
        ).length;

      const minimum =
        structureScore?.required
        ?? (signatures.length >= 4 ? 3 : 2);

      if (
        structureScore
          ? !structureScore.qualifies
          : matched < minimum
      ) {
        continue;
      }

      if (!best || matched > best.matched) {
        best = { table, matched };
      }
    }

    return best?.table || null;
  }

  function detectSectionRoot(
    rootNode = document,
    section = '',
    options = {}
  ) {
    const table = detectSectionTable(rootNode, section);
    if (!table) return null;

    /*
     * 执行根允许向上扩展，以包含与该表格唯一对应的“添加”按钮；
     * 但字段隔离使用 detectSectionTable() 返回的最小表格根，避免误排除主栏字段。
     */
    return resolveActionOwner(table, rootNode, section, options)?.owner || table;
  }


  function uniqueDeepest(elements) {
    const unique = [...new Set(elements.filter(Boolean))];
    return unique.filter(candidate => !unique.some(other => other !== candidate && candidate.contains(other) && isUsableGroup(other)));
  }
  function detectGroups(rootNode = document, options = {}) {
    if (typeof options.getGroups === 'function') return options.getGroups().filter(Boolean);
    if (options.groupSelector) {
      try {
        const configured = [...rootNode.querySelectorAll(options.groupSelector)]
          .filter(isUsableGroup)
          .filter(group => !options.ownedOnly || isOwnedByRegion(group, rootNode));
        if (configured.length) return uniqueDeepest(configured);
      } catch (_) { /* invalid profile selector: use structural detection */ }
    }
    const tables = tableGroups(rootNode, options);
    if (tables.length) return uniqueDeepest(tables);
    const explicit = [...rootNode.querySelectorAll(GROUP_SELECTOR)]
      .filter(isUsableGroup)
      .filter(group => !options.ownedOnly || isOwnedByRegion(group, rootNode));
    if (explicit.length) return uniqueDeepest(explicit);
    return uniqueDeepest(directChildCandidates(rootNode, options));
  }

  function sectionIdOf(sectionOrContext) {
    if (sectionOrContext && typeof sectionOrContext === 'object') {
      return canonicalSectionId(
        sectionOrContext.sectionId
        || sectionOrContext.section
        || sectionOrContext.collection
      );
    }
    return canonicalSectionId(sectionOrContext);
  }

  function collectionModeOf(sectionOrContext, options = {}) {
    const explicit = safeText(options.collectionMode
      || (sectionOrContext && typeof sectionOrContext === 'object' ? sectionOrContext.collectionMode : ''));
    return explicit === 'singleton-view' ? 'singleton-view' : explicit === 'repeatable' ? 'repeatable' : '';
  }

  function idForGroup(element, section, index) {
    if (!element || typeof element !== 'object') return `${section || 'collection'}:${index}`;
    if (!groupIds.has(element)) groupIds.set(element, `${section || 'collection'}:group:${++groupSequence}`);
    return groupIds.get(element);
  }

  function mapGroups(sectionOrContext, groups = []) {
    const section = sectionIdOf(sectionOrContext);
    const collection = safeText(sectionOrContext?.collection) || section;
    return (groups || []).filter(Boolean).map((element, index) => ({
      element,
      groupId: idForGroup(element, collection, index),
      section,
      collection,
      index,
      indexContext: {
        section,
        index,
      },
    }));
  }
  function buttonText(button) {
    return safeText(button?.innerText || button?.textContent || button?.value || button?.title || button?.getAttribute?.('aria-label'));
  }
  function normalizedButtonText(button) {
    return Safety?.normalizeActionText?.(buttonText(button)) || buttonText(button);
  }
  function patternMatches(pattern, value) {
    if (!(pattern instanceof RegExp)) return false;
    return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(value);
  }
  function isDangerous(button) {
    if (Safety?.isDangerousAction) return Safety.isDangerousAction(button, { baseUrl: button?.ownerDocument?.location?.href });
    return /删除|移除|上一步|下一步|保存|提交|确认|登录|上传|完成|审核/.test(buttonText(button));
  }
  function findAddButton(rootNode = document, section, options = {}) {
    // 没有全局安全模块时保持 fail-closed；动态新增是本模块唯一允许的页面点击。
    if (!Safety?.isSafeAddRowCandidate || !Safety?.validateConfiguredCandidate) return null;
    const groupRoot = options.groupRoot || rootNode;
    const boundaryRoot = options.actionSearchBoundary || rootNode;
    const resolved = resolveActionOwner(groupRoot, boundaryRoot, section, options);
    return resolved?.analysis?.qualification === 'QUALIFIED'
      ? resolved.analysis.acceptedAdds[0] || null
      : null;
  }

  function actionButtonsWithin(owner, options = {}) {
    if (!owner?.querySelectorAll) return [];
    try {
      const selector = options.addButtonSelector
        || 'button,[role="button"],a,input[type="button"]';
      return [...owner.querySelectorAll(selector)]
        .filter(button => !(Safety?.isExtensionUi?.(button)
          ?? button.closest?.('#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]')))
        .filter(isActuallyVisible);
    } catch (_) {
      return [];
    }
  }

  function isActionDisabled(button) {
    if (!button || typeof button !== 'object') return false;
    if (button.disabled || button.getAttribute?.('aria-disabled') === 'true') return true;
    try { return Boolean(button.matches?.(':disabled')); }
    catch (_) { return false; }
  }

  function actionOwnerChain(regionRoot, boundaryRoot = null) {
    const chain = [];
    let current = regionRoot?.nodeType === 1 ? regionRoot : null;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < ACTION_OWNER_MAX_DEPTH) {
      chain.push({ owner: current, depth });
      if (
        current === boundaryRoot
        || isPageWideActionBoundary(current)
        || isGlobalActionBoundary(current)
      ) {
        break;
      }
      const parent = current.parentElement;
      if (!parent) break;
      if (
        boundaryRoot?.nodeType === 1
        && parent !== boundaryRoot
        && !boundaryRoot.contains?.(parent)
      ) {
        break;
      }
      current = parent;
      depth += 1;
    }
    return chain;
  }

  function embeddedRegionRoots(items, regionRoot) {
    const roots = (Array.isArray(items) ? items : [])
      .map(item => item?.runtimeRoot || item?.root || item)
      .filter(item => item && typeof item === 'object');
    if (regionRoot && !roots.includes(regionRoot)) roots.push(regionRoot);
    return [...new Set(roots)];
  }

  function ownerRegionCount(owner, roots) {
    return roots.filter(region => {
      try { return region === owner || Boolean(owner?.contains?.(region)); }
      catch (_) { return false; }
    }).length;
  }

  function broadActionOwner(owner) {
    return !owner
      || owner.nodeType === 9
      || safeText(owner.tagName).toUpperCase() === 'FORM'
      || isPageWideActionBoundary(owner)
      || isGlobalActionBoundary(owner);
  }

  function actionOwnerQualification({
    owner,
    ownedRegionCount,
    localButtons,
    normalizedAdds,
    acceptedAdds,
    structurallyOwnedAdds,
    collectionConflict,
  }) {
    if (ownedRegionCount !== 1) return 'REGION_OWNERSHIP_AMBIGUOUS';
    if (broadActionOwner(owner)) return 'OWNER_TOO_BROAD';
    if (!localButtons.length) return 'NO_LOCAL_ADD';
    if (!normalizedAdds.length) {
      const compactAdd = localButtons.some(button => {
        const compact = buttonText(button).replace(/[\s\u00a0]+/g, '');
        return /^(?:新增|添加)/.test(compact);
      });
      return compactAdd ? 'ADD_TEXT_NOT_NORMALIZED' : 'NO_LOCAL_ADD';
    }
    if (structurallyOwnedAdds.length > 1) return 'MULTIPLE_LOCAL_ADD';
    if (structurallyOwnedAdds.some(isActionDisabled)) return 'ADD_DISABLED';
    if (!structurallyOwnedAdds.length && collectionConflict) return 'REGION_COLLECTION_CONFLICT';
    if (!structurallyOwnedAdds.length) return 'NO_OWNER';
    if (!acceptedAdds.length) return 'SAFETY_REJECTED';
    if (acceptedAdds.length > 1) return 'MULTIPLE_LOCAL_ADD';
    return 'QUALIFIED';
  }

  function analyzeActionOwner(owner, groupRoot, section, options = {}) {
    const collection = canonicalSectionId(section);
    const pattern = options.addPattern || addPatternFor(collection);
    const localButtons = actionButtonsWithin(owner, options);
    const normalizedAdds = localButtons.filter(button =>
      patternMatches(pattern, normalizedButtonText(button))
    );
    const conflictingAdds = normalizedAdds.filter(button => {
      const groupOwner = strongestStructuralOwner(groupRoot, owner);
      const buttonOwner = strongestStructuralOwner(button, owner);
      return ownerCollectionRelation(groupOwner, collection) === 'CONFLICT'
        || ownerCollectionRelation(buttonOwner, collection) === 'CONFLICT';
    });
    const structurallyOwnedAdds = normalizedAdds.filter(button =>
      isStructurallyOwnedAdd(button, groupRoot, owner, collection)
    );
    const acceptedAdds = structurallyOwnedAdds.filter(button =>
      !isActionDisabled(button)
      && Safety?.isSafeAddRowCandidate?.(button, {
        region: owner?.nodeType === 9 ? null : owner,
        allowedTextPattern: pattern,
        baseUrl: button.ownerDocument?.location?.href,
      })
      && Safety?.validateConfiguredCandidate?.(button, 'add-row', {
        region: owner?.nodeType === 9 ? null : owner,
        allowedTextPattern: pattern,
        baseUrl: button.ownerDocument?.location?.href,
      })
    );
    const regionRoots = embeddedRegionRoots(options.embeddedRegions, groupRoot);
    const ownedRegionCount = ownerRegionCount(owner, regionRoots);
    const qualification = actionOwnerQualification({
      owner,
      ownedRegionCount,
      localButtons,
      normalizedAdds,
      acceptedAdds,
      structurallyOwnedAdds,
      collectionConflict: conflictingAdds.length > 0,
    });
    return {
      owner,
      ownedRegionCount,
      localButtons,
      normalizedAdds,
      structurallyOwnedAdds,
      acceptedAdds,
      qualification,
    };
  }

  function resolveActionOwner(groupRoot, boundaryRoot, section, options = {}) {
    for (const entry of actionOwnerChain(groupRoot, boundaryRoot)) {
      const analysis = analyzeActionOwner(entry.owner, groupRoot, section, options);
      if (analysis.qualification === 'QUALIFIED') {
        return { ...entry, analysis };
      }
    }
    return null;
  }

  /**
   * Read-only ownership trace used by Diagnosis. It never returns DOM nodes,
   * selectors, labels or values and never invokes click().
   */
  function inspectActionOwnership(regionRoot, section, options = {}) {
    const collection = canonicalSectionId(section);
    const regionRootFound = Boolean(
      regionRoot
      && typeof regionRoot === 'object'
      && regionRoot.isConnected !== false
    );
    const zeroRow = typeof options.zeroRow === 'boolean'
      ? options.zeroRow
      : regionRootFound
        ? detectGroups(regionRoot, { ...options, ownedOnly: true }).length === 0
        : true;
    const base = {
      collection,
      regionId: safeText(options.regionId).slice(0, 120),
      zeroRow,
      regionRootFound,
    };
    if (!regionRootFound) {
      return {
        ...base,
        ownerCandidateCount: 0,
        ownerCandidates: [],
        selectedOwnerDepth: null,
        localAddCandidateCount: 0,
        acceptedAddCandidateCount: 0,
        rejectionReasons: ['NO_OWNER'],
        finalReasonCode: 'NO_OWNER',
      };
    }

    const candidates = [];
    let selected = null;
    const configuredBoundary = options.actionSearchBoundary || options.addRoot;
    const boundaryRoot = !configuredBoundary
      ? null
      : configuredBoundary === regionRoot || configuredBoundary?.contains?.(regionRoot)
        ? configuredBoundary
        : regionRoot;

    for (const { owner, depth } of actionOwnerChain(regionRoot, boundaryRoot)) {
      const analysis = analyzeActionOwner(owner, regionRoot, collection, options);
      const candidate = {
        depth,
        ownedRegionCount: analysis.ownedRegionCount,
        localButtonCount: analysis.localButtons.length,
        normalizedAddCount: analysis.normalizedAdds.length,
        acceptedAddCount: analysis.acceptedAdds.length,
        qualification: analysis.qualification,
      };
      candidates.push(candidate);
      if (!selected && analysis.qualification === 'QUALIFIED') selected = candidate;
    }

    const informative = selected || candidates.find(candidate => candidate.normalizedAddCount > 0)
      || candidates.find(candidate => candidate.localButtonCount > 0)
      || candidates[0] || null;
    const observedFailures = [...new Set(candidates
      .filter(candidate => candidate.qualification !== 'QUALIFIED')
      .filter(candidate => candidate.localButtonCount > 0 || candidate.qualification !== 'NO_LOCAL_ADD')
      .map(candidate => candidate.qualification))];
    const finalReasonCode = selected
      ? 'ACTION_OWNER_RESOLVED'
      : informative?.qualification || 'NO_OWNER';

    return {
      ...base,
      ownerCandidateCount: candidates.length,
      ownerCandidates: candidates,
      selectedOwnerDepth: selected ? selected.depth : null,
      localAddCandidateCount: informative?.normalizedAddCount || 0,
      acceptedAddCandidateCount: informative?.acceptedAddCount || 0,
      rejectionReasons: selected ? [] : observedFailures,
      finalReasonCode,
    };
  }
  function waitForGroupIncrease(rootNode, getGroups, beforeCount, timeoutMs) {
    return new Promise(resolve => {
      const Observer = rootNode.ownerDocument?.defaultView?.MutationObserver || globalThis.MutationObserver;
      if (getGroups().length > beforeCount) { resolve(true); return; }
      if (typeof Observer !== 'function') { resolve(false); return; }
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve(value);
      };
      const observer = new Observer(() => {
        if (getGroups().length > beforeCount) finish(true);
      });
      observer.observe(rootNode, { childList: true, subtree: true, attributes: false });
      const timer = setTimeout(() => finish(getGroups().length > beforeCount), timeoutMs);
    });
  }
  function addSearchRoot(rootNode, configuredRoot) {
    if (!configuredRoot || configuredRoot === rootNode) return rootNode;
    try {
      // The action scope may be a narrow ancestor needed to include a sibling
      // add control, but it must never be unrelated to the owned group root.
      return configuredRoot.contains?.(rootNode) ? configuredRoot : rootNode;
    } catch (_) {
      return rootNode;
    }
  }
  async function ensureGroupCount(rootNode, targetCount, options = {}) {
    const section = options.section || '';
    const getGroups = () => detectGroups(rootNode, options);
    const actionRoot = addSearchRoot(rootNode, options.addRoot);
    const actionSearchBoundary = addSearchRoot(
      rootNode,
      options.actionSearchBoundary || actionRoot,
    );
    const initialCount = getGroups().length;
    const maxAdds = Math.min(Number(options.maxAdds || 50), 100);
    const timeoutMs = Math.max(200, Number(options.timeoutMs || 3500));
    let count = initialCount;
    let clicks = 0;
    while (count < targetCount && clicks < maxAdds) {
      const resolvedAction = resolveActionOwner(
        rootNode,
        actionSearchBoundary,
        section,
        options,
      );
      const button = resolvedAction?.analysis?.qualification === 'QUALIFIED'
        ? resolvedAction.analysis.acceptedAdds[0] || null
        : null;
      if (!button) return { ok: false, initialCount, count, added: count - initialCount, clicks, error: `未找到“${section || '当前栏目'}”的安全新增按钮` };
      const resolvedActionOwner = resolvedAction.owner;
      if (!isStructurallyOwnedAdd(button, rootNode, resolvedActionOwner, section)) {
        return { ok: false, initialCount, count, added: count - initialCount, clicks, error: '新增按钮不属于当前重复栏目结构区域' };
      }
      const finalSafe = Safety?.validateConfiguredCandidate?.(button, 'add-row', {
        region: resolvedActionOwner.nodeType === 9 ? null : resolvedActionOwner,
        allowedTextPattern: options.addPattern || addPatternFor(section),
        baseUrl: button.ownerDocument?.location?.href,
      });
      if (!finalSafe) return { ok: false, initialCount, count, added: count - initialCount, clicks, error: '新增按钮在执行前安全复核失败' };
      const beforeCount = count;
      button.click();
      clicks += 1;
      const increased = await waitForGroupIncrease(rootNode, getGroups, beforeCount, timeoutMs);
      count = getGroups().length;
      if (!increased || count <= beforeCount) {
        return { ok: false, initialCount, count, added: count - initialCount, clicks, error: '点击新增后 DOM 中的实际表单组数量没有增加' };
      }
    }
    if (count < targetCount) return { ok: false, initialCount, count, added: count - initialCount, clicks, error: `达到最大新增次数后仍只有 ${count}/${targetCount} 组` };
    return { ok: true, initialCount, count, added: count - initialCount, clicks, groups: getGroups().slice(0, targetCount) };
  }
  async function prepare(sectionOrContext, items, rootNode = document, options = {}) {
    const section = sectionIdOf(sectionOrContext);
    if (section === 'awards' && options.awardsAdapter?.getRows) {
      const awardsAdapter = options.awardsAdapter;
      options = {
        ...options,
        // The adapter remains responsible only for its legacy row mapping.
        // Expansion always uses this module's shared owner resolver.
        getGroups: () => (awardsAdapter.getRows?.() || [])
          .map(row => row?.container)
          .filter(Boolean),
      };
    }
    const requestedCount = Array.isArray(items) ? items.length : 0;
    const actionRoot = addSearchRoot(rootNode, options.addRoot);
    const localLimitRoot = trustedLimitRoot(rootNode, actionRoot);
    const rootLimit = detectItemLimit(rootNode, section);
    const detectedLimit = Number(options.itemLimit) > 0
      ? Number(options.itemLimit)
      : (rootLimit || (
          localLimitRoot !== rootNode
            ? detectItemLimit(localLimitRoot, section)
            : null
        ));
    const itemLimit = Number.isInteger(detectedLimit) && detectedLimit > 0
      ? Math.min(detectedLimit, 100)
      : null;
    const targetCount = itemLimit
      ? Math.min(requestedCount, itemLimit)
      : requestedCount;
    const limitedCount = Math.max(0, requestedCount - targetCount);

    if (!ARRAY_SECTIONS.includes(section) || requestedCount === 0) {
      return {
        ok: true,
        initialCount: detectGroups(rootNode, options).length,
        count: detectGroups(rootNode, options).length,
        groups: [],
        requestedCount,
        targetCount,
        itemLimit,
        limitedCount,
      };
    }
    const existingGroups = detectGroups(rootNode, options);
    const addButton = findAddButton(actionRoot, section, { ...options, groupRoot: rootNode });
    const explicitMode = collectionModeOf(sectionOrContext, options);
    const signatureSingleton =
      SINGLETON_COLLECTIONS.has(
        section
      )
      && looksLikeSingletonView(
        rootNode,
        section
      );
    const visibleControlCount =
      visibleControlsWithin(
        rootNode
      ).length;


    /*
    * 固定“学习信息”单条页面：
    *
    * - education 是数组模型
    * - 但网页只有一份固定表单
    * - 没有真正的 education repeat row
    * - 页面同时可能残留其他隐藏栏目“添加”
    *
    * 因此不能仅凭 addButton 判断是否 repeatable。
    */
    const fixedSingletonWithoutGroups =
      SINGLETON_COLLECTIONS.has(section)
      && existingGroups.length === 0
      && visibleControlCount >= 3;


      const singletonView =
        explicitMode === 'singleton-view'

        || signatureSingleton

        || fixedSingletonWithoutGroups

        || (
          !addButton
          && SINGLETON_COLLECTIONS.has(
            section
          )
          && existingGroups.length <= 1
        );
    if (singletonView) { 
      const singletonRoot =
        signatureSingleton
          ? rootNode
          : (
              existingGroups[0]
              || (
                visibleControlsWithin(
                  rootNode
                ).length
                  ? rootNode
                  : null
              )
            );
      if (!singletonRoot) {
        return { ok: false, mode: 'singleton-view', initialCount: 0, count: 0, added: 0, clicks: 0, groups: [], groupContexts: [], error: `未找到“${section}”固定表单视图` };
      }
      const groups = [singletonRoot];
      return {
        ok: true,
        mode: 'singleton-view',
        repeatable: false,
        initialCount: 1,
        count: 1,
        added: 0,
        clicks: 0,
        groups,
        groupContexts:
          mapGroups(
            sectionOrContext,
            groups
          ).map(
            context => ({
              ...context,

              /*
              * singleton-view:
              *
              * education 页面只有一条数据，
              * 强制绑定 education[0]
              */
              index: 0,

              indexContext: {
                section:
                  sectionIdOf(
                    sectionOrContext
                  ),

                index: 0,
              },
            })
          ),
        requestedCount,
        targetCount,
        itemLimit,
        limitedCount,
        unhandledCount: Math.max(limitedCount, Math.max(0, targetCount - 1)),
      };
    }
    const result = await ensureGroupCount(rootNode, targetCount, { ...options, section });
    const groups = result.groups || detectGroups(rootNode, options).slice(0, targetCount);
    return {
      ...result,
      mode: 'repeatable',
      repeatable: true,
      groups,
      groupContexts: mapGroups(sectionOrContext, groups),
      requestedCount,
      targetCount,
      itemLimit,
      limitedCount,
      unhandledCount: Math.max(limitedCount, Math.max(0, targetCount - groups.length)),
    };
  }
return {
  ADD_PATTERNS,
  ARRAY_SECTIONS,
  CONTROL_SELECTOR,
  SINGLETON_COLLECTIONS,
  SECTION_TABLE_SIGNATURES,

  detectGroups,
  detectItemLimit,
  detectSectionRoot,
  detectSectionTable,
  ensureGroupCount,
  findAddButton,
  inspectActionOwnership,
  mapGroups,
  parseChineseInteger,
  prepare,
  waitForGroupIncrease,
};
});
