/*
 * 解放 — 全局页面动作安全边界
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initSafety(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFSafety = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function safetyFactory() {
  'use strict';

  /*
   * 这是全局、不可关闭的拒绝清单。调用方只能通过 extraDangerousKeywords
   * 增加规则，不能删除或覆盖这些规则。
   */
  const DANGEROUS_ACTION_KEYWORDS = Object.freeze([
    '下一步', '上一步', '下一页', '上一页', '继续', '完成',
    '提交', '确认提交', '正式提交', '申请信息提交', '保存并提交', '保存并下一步',
    '确认', '确定提交', '发送', '发布',
    '删除', '移除', '清空', '重置', '撤销申请',
    '登录', '退出登录', '注册',
    '上传', '开始上传', '确认上传',
    '支付', '付款',
    'next', 'previous', 'prev', 'continue', 'finish',
    'submit', 'confirm', 'send', 'publish',
    'delete', 'remove', 'clear', 'reset',
    'login', 'log in', 'sign in', 'logout', 'sign out',
    'upload', 'pay', 'payment',
  ]);

  const SAFE_SAVE_LABELS = Object.freeze([
    '保存', '暂存', '保存本页', '保存当前信息',
    'save', 'save draft', 'save this page', 'save current information',
  ]);
  // 配置只能进一步缩小这个内置集合，不能把“保存/下一步/提交”等任意文字
  // 重新解释成新增按钮。
  const DEFAULT_ADD_ROW_PATTERN = /^(?:新增|添加)(?:一行|一条|奖励|奖项|获奖|成员|家庭|教育|经历|学历|科研|项目|论文|成果|专利|实践|实习|学生工作|任职|证书|语言|外语)?$|^\+$/;

  const DANGEROUS_ATTRIBUTE_RE = /(?:submit|confirm|delete|remove|upload|login|logout|sign[-_ ]?in|sign[-_ ]?out|next|previous|finish|publish|payment|checkout|正式提交|确认提交|下一步|上一步|上传|删除|移除)/i;
  const SAFE_PROTOCOL_RE = /^https?:$/i;
  const LEGACY_NAVIGATION_SCRIPT_BLOCK_RE = /(?:requestSubmit|\.submit\s*\(|\.click\s*\(|dispatchEvent\s*\(|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|DataTransfer|FileReader|\.files\b|cookie\b|localStorage|sessionStorage|eval\s*\(|Function\s*\(|document\.|window\.open|postMessage|setTimeout|setInterval|submit|confirm|delete|remove|login|logout|next|previous|finish|publish|payment|checkout|正式提交|确认提交|下一步|上一步|删除|移除)/i;
  const LEGACY_NAVIGATION_FUNCTION_RE = /(?:nav|menu|tab|step|section|page|view|panel|item|show|open|switch|change|load|goto)/i;
  const LEGACY_ADD_ROW_FUNCTION_RE =
    /(?:^|[_$.])(?:add|append|insert|create|new|increase|plus|tianjia|xinzeng)[a-z0-9_$]{0,40}$/i;
  const LEGACY_NAVIGATION_LITERAL_RE = /^(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[-+]?\d+(?:\.\d+)?|true|false|null|undefined)(?:\s*,\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[-+]?\d+(?:\.\d+)?|true|false|null|undefined))*$/i;

  const ADD_ROW_SCRIPT_BLOCK_RE =
    /(?:requestSubmit|\.submit\s*\(|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|DataTransfer|FileReader|\.files\b|cookie\b|localStorage|sessionStorage|eval\s*\(|Function\s*\(|window\.open|postMessage|submit|confirm|delete|remove|upload|login|logout|next|previous|finish|publish|payment|checkout|保存|提交|删除|移除|上传)/i;

  const ADD_ROW_SCRIPT_HINT_RE =
    /(?:add|append|insert|create|new|increase|plus|row|item|record|member|family|新增|添加)/i;

  function safeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeActionText(value) {
    return safeString(value)
      .replace(/[：:]/g, '')
      // Chinese action labels are often rendered as separate glyphs (for
      // example “新 增”). Join whitespace only when it sits between CJK
      // characters; English word boundaries stay intact for the deny-list.
      .replace(/([\u3400-\u9fff])[\s\u00a0]+(?=[\u3400-\u9fff])/g, '$1')
      .replace(/[\s\u00a0]+/g, ' ')
      .trim()
      .toLocaleLowerCase();
  }

  function getAttribute(element, name) {
    try { return safeString(element?.getAttribute?.(name)); } catch (_) { return ''; }
  }

  function actionText(elementOrText) {
    if (typeof elementOrText === 'string' || typeof elementOrText === 'number') {
      return safeString(elementOrText);
    }
    const element = elementOrText;
    return [
      element?.value,
      getAttribute(element, 'aria-label'),
      getAttribute(element, 'title'),
      element?.textContent,
    ].map(safeString).find(Boolean) || '';
  }

  function elementTag(element) {
    return safeString(element?.tagName).toLowerCase();
  }

  function elementType(element) {
    const tag = elementTag(element);
    const declared = normalizeActionText(element?.type || getAttribute(element, 'type'));
    if (tag === 'button') return declared || 'submit';
    if (tag === 'input') return declared || 'text';
    return declared;
  }

  function resolveForm(element) {
    if (element?.form) return element.form;
    try { return element?.closest?.('form') || null; } catch (_) { return null; }
  }

  function formAction(element) {
    const ownAction = getAttribute(element, 'formaction');
    if (ownAction) return ownAction;
    const tag = elementTag(element);
    const type = elementType(element);
    // 普通链接、列表项、type=button 导航即使嵌在旧站点的大 form 中，
    // 也不会提交该 form；只有真正具备提交能力的控件继承 form.action。
    if (!((tag === 'button' || tag === 'input') && ['submit', 'image'].includes(type))) return '';
    const form = resolveForm(element);
    return safeString(form?.action) || getAttribute(form, 'action');
  }

  function hrefFor(element) {
    return safeString(element?.href) || getAttribute(element, 'href');
  }

  function isHiddenOrDisabled(element) {
    if (!element || typeof element !== 'object') return false;
    if (element.hidden || element.disabled || getAttribute(element, 'aria-hidden') === 'true' || getAttribute(element, 'aria-disabled') === 'true') return true;
    try {
      if (element.matches?.('[hidden],:disabled,input[type="hidden"]')) return true;
    } catch (_) { /* synthetic test doubles may not implement selectors */ }
    const view = element.ownerDocument?.defaultView;
    try {
      const style = view?.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return true;
    } catch (_) { /* cross-realm style access */ }
    return false;
  }

  function isExtensionUi(element) {
    try { return Boolean(element?.closest?.('#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]')); }
    catch (_) { return true; }
  }

  function keywordMatches(text, keyword) {
    const normalizedText = normalizeActionText(text);
    const normalizedKeyword = normalizeActionText(keyword);
    if (!normalizedText || !normalizedKeyword) return false;
    if (/^[a-z0-9 _-]+$/i.test(normalizedKeyword)) {
      const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(normalizedText);
    }
    return normalizedText.includes(normalizedKeyword);
  }

  function collectActionMetadata(elementOrText) {
    if (!elementOrText || typeof elementOrText !== 'object') {
      return {
        text: actionText(elementOrText), tag: '', type: '', name: '', id: '', role: '',
        href: '', formAction: '', formMethod: '', onclick: '', insideForm: false,
      };
    }
    const element = elementOrText;
    const form = resolveForm(element);
    return {
      text: actionText(element),
      tag: elementTag(element),
      type: elementType(element),
      name: safeString(element?.name) || getAttribute(element, 'name'),
      id: safeString(element?.id),
      role: getAttribute(element, 'role'),
      href: hrefFor(element),
      formAction: formAction(element),
      formMethod: normalizeActionText(getAttribute(element, 'formmethod') || form?.method || getAttribute(form, 'method')),
      onclick: getAttribute(element, 'onclick'),
      insideForm: Boolean(form),
    };
  }

  function hrefType(rawUrl, baseUrl) {
    const value = safeString(rawUrl);
    if (!value) return 'none';
    if (value === '#' || value.startsWith('#')) return 'hash';
    if (/^javascript:/i.test(value)) return 'javascript';
    if (/^(?:data|file|blob|mailto|tel):/i.test(value)) return 'blocked-protocol';
    try {
      const base = new URL(baseUrl || (typeof location !== 'undefined' ? location.href : 'https://invalid.local/'));
      const parsed = new URL(value, base);
      if (!SAFE_PROTOCOL_RE.test(parsed.protocol)) return 'blocked-protocol';
      return parsed.origin === base.origin ? 'same-origin' : 'cross-origin';
    } catch (_) {
      return 'invalid';
    }
  }

  function sameOriginNavigationTarget(rawTarget, baseUrl) {
    const target = safeString(rawTarget);
    // `//host/path` 会继承协议但切换主机，不能把它当成普通 `/path`。
    if (!target || target.startsWith('//') || /^(?:javascript|data|file|blob|mailto|tel):/i.test(target)) return false;
    try {
      const base = new URL(baseUrl || (typeof location !== 'undefined' ? location.href : 'https://invalid.local/'));
      const parsed = new URL(target, base);
      return SAFE_PROTOCOL_RE.test(parsed.protocol) && parsed.origin === base.origin;
    } catch (_) {
      return false;
    }
  }

  function isSafeLegacyNavigationScript(rawScript, options = {}) {
    const source = safeString(rawScript).replace(/^javascript\s*:/i, '').trim();
    if (!source || source.length > 600 || LEGACY_NAVIGATION_SCRIPT_BLOCK_RE.test(source)) return false;
    if (/^(?:void\s*\(\s*0\s*\)\s*;?|;?)$/.test(source)) return true;
    const navigationExpression = source.replace(/;\s*return\s+false\s*;?$/i, '').trim();
    if (/[{}\[\]`]/.test(navigationExpression) || /(?:&&|\|\||;\s*\S)/.test(navigationExpression)) return false;

    // location 赋值必须解析后仍为同源；拒绝 `//evil.example/path` 之类协议相对 URL。
    const locationMatch = navigationExpression.match(/^(?:window\.)?location(?:\.href)?\s*=\s*(['"])([^'"\\]{1,300})\1\s*;?$/i);
    if (locationMatch) return sameOriginNavigationTarget(locationMatch[2], options.baseUrl);

    // 旧报名系统常用 showPage('jbxx')、switchTab(2)。只接受一个导航式函数调用，
    // 参数只能是字符串/数字/布尔/null/undefined 字面量，禁止嵌套调用和成员访问。
    const call = navigationExpression.match(/^(?:(?:void|return)\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,3})\s*\((.*)\)\s*;?$/);
    if (!call) return false;
    const functionName = call[1];
    const terminalName = functionName.split('.').pop() || '';
    const argumentsSource = call[2].trim();
    if (!LEGACY_NAVIGATION_FUNCTION_RE.test(terminalName)) return false;
    if (!options.allowUploadNavigation && /upload|上传/i.test(navigationExpression)) return false;
    if (options.allowUploadNavigation) {
      if (!/(?:upload|photo|material|上传|照片|材料)/i.test(navigationExpression)) return false;
      if (!/(?:nav|menu|tab|step|section|page|view|panel|route|show|switch|change|load|goto)/i.test(terminalName)) return false;
      if (/(?:dialog|picker|chooser|browse|input|file|attach|submit|save|select|对话框|选择文件|浏览文件|保存|提交)/i.test(terminalName)) return false;
    }
    if (argumentsSource && !LEGACY_NAVIGATION_LITERAL_RE.test(argumentsSource)) return false;
    return true;
  }

  function isSafeAddRowScript(rawScript) {
    const source = safeString(rawScript)
      .replace(/^javascript\s*:/i, '')
      .trim();

    if (!source || source.length > 500) return false;

    if (ADD_ROW_SCRIPT_BLOCK_RE.test(source)) {
      return false;
    }

    if (/^void\s*\(\s*0\s*\)\s*;?$/i.test(source)) {
      return false;
    }

    const expression = source
      .replace(/;\s*return\s+false\s*;?$/i, '')
      .trim();

    if (/[{}\[\]`]/.test(expression)) {
      return false;
    }

    if (/(?:&&|\|\||;\s*\S)/.test(expression)) {
      return false;
    }

    const call = expression.match(
      /^(?:(?:void|return)\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,3})\s*\((.*)\)\s*;?$/
    );

    if (!call) {
      return false;
    }

    const functionName = call[1];
    const argumentsSource = call[2].trim();

    if (!ADD_ROW_SCRIPT_HINT_RE.test(
      `${functionName} ${argumentsSource}`
    )) {
      return false;
    }

    if (
      argumentsSource
      && !LEGACY_NAVIGATION_LITERAL_RE.test(argumentsSource)
    ) {
      return false;
    }

    return true;
  }

  function isSafeLegacyAddRowScript(
    rawScript,
    options = {}
  ) {
    const source = safeString(rawScript)
      .replace(/^javascript\s*:/i, '')
      .trim();

    if (!source || source.length > 400) {
      return false;
    }

    /*
    * 老网站常见：
    *
    * href="javascript:void(0)"
    *
    * 实际行为由事件绑定完成。
    *
    * 只有外层 isSafeAddRowCandidate 已经确认：
    * - 文案是新增/添加
    * - 位于指定 family 区域
    * 才允许走到这里。
    */
    if (
      /^(?:void\s*\(\s*0\s*\)\s*;?|;?)$/i.test(
        source
      )
    ) {
      return true;
    }

    /*
    * 新增动作绝不能包含：
    * 提交、保存、删除、上传、网络请求、
    * 任意代码执行等副作用。
    */
    const blocked =
      /(?:requestSubmit|\.submit\s*\(|\.click\s*\(|dispatchEvent\s*\(|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|eval\s*\(|Function\s*\(|document\.|window\.open|postMessage|setTimeout|setInterval|submit|save|confirm|delete|remove|upload|login|logout|next|previous|finish|publish|payment|checkout|提交|保存|确认|删除|移除|上传|下一步|上一步)/i;

    if (blocked.test(source)) {
      return false;
    }

    const expression = source
      .replace(
        /;\s*return\s+false\s*;?$/i,
        ''
      )
      .replace(
        /^return\s+/i,
        ''
      )
      .trim();

    /*
    * 禁止代码块、数组、模板字符串、
    * 多语句和逻辑表达式。
    */
    if (
      /[{}\[\]`]/.test(expression)
      || /(?:&&|\|\||;\s*\S)/.test(expression)
    ) {
      return false;
    }

    /*
    * 只允许：
    *
    * add()
    * addRow()
    * addFamily()
    * appendItem(1)
    * createMember('family')
    * addJtcy()
    *
    * 参数只能是简单字面量。
    */
    const call = expression.match(
      /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,2})\s*\((.*)\)\s*;?$/
    );

    if (!call) {
      return false;
    }

    const functionName = call[1];

    const terminalName =
      functionName
        .split('.')
        .pop()
      || '';

    if (
      !LEGACY_ADD_ROW_FUNCTION_RE.test(
        terminalName
      )
    ) {
      return false;
    }

    const argumentsSource =
      call[2].trim();

    if (
      argumentsSource
      && !LEGACY_NAVIGATION_LITERAL_RE.test(
        argumentsSource
      )
    ) {
      return false;
    }

    return true;
  }

  function isUnsafeUrl(rawUrl, baseUrl, { allowSameOrigin = true } = {}) {
    const value = safeString(rawUrl);
    if (!value || value === '#' || value.startsWith('#')) return false;
    if (/^(?:javascript|data|file|blob|mailto|tel):/i.test(value)) return true;
    try {
      const base = baseUrl || (typeof location !== 'undefined' ? location.href : 'https://invalid.local/');
      const parsed = new URL(value, base);
      if (!SAFE_PROTOCOL_RE.test(parsed.protocol)) return true;
      if (allowSameOrigin && baseUrl) {
        const baseParsed = new URL(baseUrl);
        if (parsed.origin !== baseParsed.origin) return true;
      }
      return false;
    } catch (_) {
      return true;
    }
  }

  function isDangerousAction(elementOrText, options = {}) {
    const metadata = collectActionMetadata(elementOrText);
    const extra = Array.isArray(options.extraDangerousKeywords) ? options.extraDangerousKeywords : [];
    const keywords = [...DANGEROUS_ACTION_KEYWORDS, ...extra.map(safeString).filter(Boolean)];
    const combinedText = [
      metadata.text, metadata.name, metadata.id, metadata.role,
      metadata.href, metadata.formAction, metadata.onclick,
    ].filter(Boolean).join(' ');

    if (keywords.some(keyword => keywordMatches(combinedText, keyword))) return true;
    if (DANGEROUS_ATTRIBUTE_RE.test([metadata.name, metadata.id, metadata.href, metadata.formAction, metadata.onclick].join(' '))) return true;
    if (['reset', 'file', 'image'].includes(metadata.type)) return true;
    if (metadata.tag === 'input' && metadata.type === 'submit'
      && !SAFE_SAVE_LABELS.includes(normalizeActionText(metadata.text))) return true;
    const legacyNavigationHrefAllowed =
      options.allowLegacyNavigationHref === true
      && hrefType(
        metadata.href,
        options.baseUrl
      ) === 'javascript'
      && isSafeLegacyNavigationScript(
        metadata.href,
        {
          baseUrl:
            options.baseUrl,
        }
      );

    const legacyAddRowHrefAllowed =
      options.allowLegacyAddRowHref === true
      && hrefType(
        metadata.href,
        options.baseUrl
      ) === 'javascript'
      && isSafeLegacyAddRowScript(
        metadata.href,
        {
          baseUrl:
            options.baseUrl,
        }
      );

    if (
      !legacyNavigationHrefAllowed
      && !legacyAddRowHrefAllowed
      && isUnsafeUrl(
        metadata.href,
        options.baseUrl,
        {
          allowSameOrigin: true,
        }
      )
    ) {
      return true;
    }
    if (isUnsafeUrl(metadata.formAction, options.baseUrl, { allowSameOrigin: true })) return true;
    return false;
  }

  function isFormControl(element) {
    const tag = elementTag(element);
    return tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea';
  }

  function isSemanticNavigationButton(element) {
    const metadata = collectActionMetadata(element);
    const declaredType = normalizeActionText(getAttribute(element, 'type'));
    const safeButtonType = declaredType === 'button'
      || (!declaredType && !resolveForm(element) && !metadata.formAction);
    if (metadata.tag !== 'button' || !safeButtonType || metadata.formAction) return false;
    return ['tab', 'menuitem'].includes(metadata.role)
      || Boolean(getAttribute(element, 'data-step') || getAttribute(element, 'data-section'));
  }

  function isNavigationCandidateSafe(element, options = {}) {
    if (!element || isExtensionUi(element) || isHiddenOrDisabled(element) || isDangerousAction(element, options)) return false;
    const metadata = collectActionMetadata(element);
    const semanticButton = isSemanticNavigationButton(element);
    const plainButtonAllowed = options.allowPlainNavigationButton === true
      && metadata.tag === 'button' && metadata.type === 'button' && !metadata.formAction;
    const onclickNodeAllowed = options.allowOnclickNavigation === true
      && Boolean(metadata.onclick)
      && !['button', 'input', 'select', 'textarea', 'form'].includes(metadata.tag)
      && isSafeLegacyNavigationScript(metadata.onclick, { baseUrl: options.baseUrl });
    if (isFormControl(element) && !semanticButton && !plainButtonAllowed) return false;
    const linkType = hrefType(metadata.href, options.baseUrl);
    if (metadata.tag === 'a') {
      if (['cross-origin', 'blocked-protocol', 'invalid'].includes(linkType)) return false;
      if (linkType === 'javascript'
        && !(options.allowLegacyNavigationHref === true && isSafeLegacyNavigationScript(metadata.href, { baseUrl: options.baseUrl }))) return false;
    }
    if (metadata.onclick && !isSafeLegacyNavigationScript(metadata.onclick, { baseUrl: options.baseUrl })) return false;
    return ['a', 'li', 'div', 'span'].includes(metadata.tag)
      || semanticButton
      || plainButtonAllowed
      || onclickNodeAllowed
      || ['tab', 'menuitem', 'link', 'option'].includes(metadata.role)
      || Boolean(getAttribute(element, 'data-step') || getAttribute(element, 'data-section'));
  }

  function isSafeSaveCandidate(element, options = {}) {
    if (!element || typeof element !== 'object' || isExtensionUi(element) || isHiddenOrDisabled(element)) return false;
    const metadata = collectActionMetadata(element);
    const label = normalizeActionText(metadata.text);

    // 危险动作永远优先；调用方或配置无法通过任何参数关闭。
    if (isDangerousAction(element, options)) return false;
    if (!SAFE_SAVE_LABELS.includes(label)) return false;
    if (!['button', 'input'].includes(metadata.tag) && metadata.role !== 'button') return false;
    // Automated draft saving is deliberately narrower than normal browser
    // interaction: only inert type=button controls may be clicked.
    if (metadata.tag === 'input' && metadata.type !== 'button') return false;
    if (metadata.tag === 'button' && metadata.type !== 'button') return false;
    if (metadata.href) return false;
    if (metadata.formMethod && !['get', 'post', 'dialog'].includes(metadata.formMethod)) return false;
    if (metadata.formAction && isUnsafeUrl(metadata.formAction, options.baseUrl, { allowSameOrigin: true })) return false;
    if (metadata.formAction && DANGEROUS_ATTRIBUTE_RE.test(metadata.formAction)) return false;
    return true;
  }

  function isSafeAddRowCandidate(
    element,
    options = {}
  ) {
    if (
      !element
      || typeof element !== 'object'
      || isExtensionUi(element)
      || isHiddenOrDisabled(element)
    ) {
      return false;
    }

    const metadata =
      collectActionMetadata(element);

    const label =
      normalizeActionText(metadata.text);

    /*
    * 第一层：
    * 文案必须属于系统内置的“新增/添加”集合。
    */
    const basePattern =
      new RegExp(
        DEFAULT_ADD_ROW_PATTERN.source,
        DEFAULT_ADD_ROW_PATTERN.flags
          .replace(/[gy]/g, '')
      );

    if (!basePattern.test(label)) {
      return false;
    }

    /*
    * 第二层：
    * 调用方如果给出了当前栏目专用规则，
    * 必须同时满足。
    */
    if (
      options.allowedTextPattern
        instanceof RegExp
    ) {
      const configuredPattern =
        new RegExp(
          options.allowedTextPattern.source,
          options.allowedTextPattern.flags
            .replace(/[gy]/g, '')
        );

      if (
        !configuredPattern.test(label)
      ) {
        return false;
      }
    }

    /*
    * 第三层：
    * 必须位于调用方已经识别出的
    * family / education 等目标区域内。
    */
    if (
      options.region
      && typeof options.region.contains
        === 'function'
      && !options.region.contains(element)
    ) {
      return false;
    }

    /*
    * formAction 一律不允许。
    * 新增一行不应该直接提交表单。
    */
    if (metadata.formAction) {
      return false;
    }

    const linkType =
      hrefType(
        metadata.href,
        options.baseUrl
      );

    /*
    * 南京大学等旧系统：
    *
    * <a href="javascript:addXXX()">添加</a>
    *
    * 只允许经过专门严格解析的
    * add-row javascript。
    */
    const safeLegacyAddHref =
      linkType === 'javascript'
      && isSafeLegacyAddRowScript(
        metadata.href,
        {
          baseUrl:
            options.baseUrl,
        }
      );

    /*
    * onclick 如果存在，也只能是
    * 同样受限的新增脚本。
    */
    if (
      metadata.onclick
      && !isSafeLegacyAddRowScript(
        metadata.onclick,
        {
          baseUrl:
            options.baseUrl,
        }
      )
    ) {
      return false;
    }

    /*
    * 危险动作检查仍然保留。
    * 唯一额外授权就是上面验证过的
    * legacy add-row href。
    */
    if (
      isDangerousAction(
        element,
        {
          ...options,

          allowLegacyAddRowHref:
            safeLegacyAddHref,
        }
      )
    ) {
      return false;
    }

    /*
    * 普通 URL 仍然不能作为新增按钮。
    */
    if (
      metadata.href
      && metadata.href !== '#'
      && !metadata.href.startsWith('#')
      && !safeLegacyAddHref
    ) {
      return false;
    }

    if (metadata.tag === 'button') {
      return metadata.type === 'button';
    }

    if (metadata.tag === 'input') {
      return metadata.type === 'button';
    }

    if (metadata.tag === 'a') {
      return (
        metadata.role === 'button'
        || !metadata.href
        || metadata.href === '#'
        || metadata.href.startsWith('#')
        || safeLegacyAddHref
      );
    }

    return (
      metadata.role === 'button'
      && !resolveForm(element)
    );
  }

  function validateConfiguredCandidate(element, purpose, options = {}) {
    // 配置选择器只负责“找到”元素，不能成为信任来源。
    if (purpose === 'save') return isSafeSaveCandidate(element, options);
    if (purpose === 'add-row') return isSafeAddRowCandidate(element, options);
    if (purpose === 'navigation') return isNavigationCandidateSafe(element, options);
    return !isHiddenOrDisabled(element) && !isDangerousAction(element, options);
  }

  return Object.freeze({
    DANGEROUS_ACTION_KEYWORDS,
    DEFAULT_ADD_ROW_PATTERN,
    SAFE_SAVE_LABELS,
    actionText,
    collectActionMetadata,
    formAction,
    hrefType,
    isDangerousAction,
    isFormControl,
    isHiddenOrDisabled,
    isExtensionUi,
    isNavigationCandidateSafe,
    isSafeLegacyAddRowScript,
    isSafeLegacyNavigationScript,
    isSafeAddRowScript,
    isSemanticNavigationButton,
    isSafeAddRowCandidate,
    isSafeSaveCandidate,
    isUnsafeUrl,
    normalizeActionText,
    safeString,
    validateConfiguredCandidate,
  });
});
