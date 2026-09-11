/*
 * 解放：可执行控件能力注册表。
 * 负责确定性选择控件 Adapter，并统一写入、回读、验证结果。
 * SPDX-License-Identifier: MIT
 */
(function initControlAdapterRegistry(root, factory) {
  const api = factory();
  const commonJs = typeof module === 'object' && module.exports;
  if (commonJs) module.exports = api;
  if (root) root.JFControlAdapterRegistry = api;

  // CommonJS 单测直接加载 Registry 时也必须具备完整的内置执行能力。
  // 浏览器 Runtime 则按 manifest/popup 中的脚本顺序让各 Adapter 自注册。
  if (commonJs) {
    [
      './adapters/native-value-adapter.js',
      './adapters/native-select-adapter.js',
      './adapters/choice-adapter.js',
      './adapters/cascader-adapter.js',
      './adapters/custom-select-adapter.js',
      './adapters/date-like-adapter.js',
      './adapters/compound-picker-adapter.js',
    ].forEach(path => require(path));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function controlAdapterRegistryFactory() {
  'use strict';

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function metadata(descriptor) {
    const element = descriptor?.element;
    const interaction = descriptor?.interactionElement;
    const parentClasses = Array.isArray(descriptor?.parent?.classes)
      ? descriptor.parent.classes.join(' ')
      : '';
    return safeString([
      element?.id,
      typeof element?.className === 'string' ? element.className : '',
      typeof interaction?.className === 'string' ? interaction.className : '',
      parentClasses,
      element?.getAttribute?.('role'),
      interaction?.getAttribute?.('role'),
    ].filter(Boolean).join(' ')).toLowerCase();
  }

  function detectFramework(descriptor) {
    const element = descriptor?.element;
    const info = metadata(descriptor);
    if (/jqxwidget|(?:^|\s)jqx-|jqxdropdown|jqxcombo/.test(info)
      || element?.querySelector?.('[class*="jqx-"]')) return 'jqx';
    if (/ant-cascader|ant-select|ant-picker/.test(info)) return 'ant-design';
    if (/el-cascader|el-select|el-picker|el-date/.test(info)) return 'element-plus';
    if (/arco-select|arco-picker/.test(info)) return 'arco';
    if (/ivu-select|ivu-date/.test(info)) return 'view-ui';
    if (/react-select/.test(info)) return 'react-select';
    if (safeString(element?.getAttribute?.('role')).toLowerCase() === 'combobox'
      || safeString(descriptor?.interactionElement?.getAttribute?.('role')).toLowerCase() === 'combobox') return 'aria';
    return 'generic';
  }

  const CAPABILITIES = Object.freeze({
    'native-select': Object.freeze(['enumerate-options', 'select-option', 'verify']),
    'custom-select': Object.freeze(['open', 'enumerate-options', 'select-option', 'verify']),
    cascader: Object.freeze(['open', 'enumerate-level-options', 'select-path', 'verify']),
    radio: Object.freeze(['enumerate-options', 'select-option', 'verify']),
    checkbox: Object.freeze(['toggle', 'enumerate-options', 'verify']),
    'date-like': Object.freeze(['write-value', 'open', 'navigate-year', 'select-month', 'verify']),
    'compound-picker': Object.freeze(['open', 'needs-site-capability']),
    'native-value': Object.freeze(['write-value', 'verify']),
  });

  const adapters = new Map();

  function adapterId(adapter) {
    return safeString(adapter?.id || adapter?.adapterId);
  }

  function register(adapter) {
    const id = adapterId(adapter);
    if (!id) throw new TypeError('Adapter 必须声明稳定 id/adapterId');
    if (typeof (adapter?.supports || adapter?.match) !== 'function') {
      throw new TypeError(`Adapter ${id} 必须实现 supports(context) 或 match(context)`);
    }
    if (typeof adapter?.read !== 'function') throw new TypeError(`Adapter ${id} 必须实现 read(context)`);
    if (typeof (adapter?.write || adapter?.execute) !== 'function') {
      throw new TypeError(`Adapter ${id} 必须实现 write(context) 或 execute(context)`);
    }
    if (typeof adapter?.verify !== 'function') throw new TypeError(`Adapter ${id} 必须实现 verify(context)`);
    if (!Number.isFinite(Number(adapter.priority))) throw new TypeError(`Adapter ${id} 必须声明数字 priority`);
    adapters.set(id, adapter);
    return adapter;
  }

  function legacyAdapterId(descriptor, settings = {}) {
    const kind = safeString(descriptor?.controlKind || descriptor?.type || descriptor?.baseControlKind || 'text').toLowerCase();
    const inputType = safeString(descriptor?.inputType || descriptor?.element?.type).toLowerCase();
    const expectedType = safeString(settings.expectedType).toLowerCase();
    if (kind === 'compound-picker') return 'compound-picker';
    if (kind === 'cascader') return 'cascader';
    if (['date', 'month'].includes(kind) || ['date', 'month'].includes(inputType) || expectedType === 'date') return 'date-like';
    if (kind === 'native-select' || safeString(descriptor?.element?.tagName).toLowerCase() === 'select') return 'native-select';
    if (kind === 'custom-select') return 'custom-select';
    if (kind === 'radio') return 'radio';
    if (kind === 'checkbox') return 'checkbox';
    return 'native-value';
  }

  function buildContext(descriptor, value, settings = {}) {
    const normalizedSettings = settings && typeof settings === 'object' ? settings : {};
    const fieldPath = safeString(normalizedSettings.fieldPath || normalizedSettings.matchedPath);
    return {
      descriptor,
      value,
      fieldPath,
      expectedType: safeString(normalizedSettings.expectedType),
      framework: detectFramework(descriptor),
      settings: normalizedSettings,
      dependencies: normalizedSettings.dependencies || {},
    };
  }

  function matchingAdapters(context) {
    return [...adapters.values()]
      .filter(adapter => {
        try { return Boolean((adapter.supports || adapter.match).call(adapter, context)); }
        catch (_) { return false; }
      })
      .sort((left, right) => Number(right.priority) - Number(left.priority)
        || adapterId(left).localeCompare(adapterId(right)));
  }

  function resolvedAdapterId(adapter, context) {
    if (!adapter) return legacyAdapterId(context.descriptor, context.settings);
    if (typeof adapter.adapterIdFor === 'function') {
      const resolved = safeString(adapter.adapterIdFor(context));
      if (resolved) return resolved;
    }
    return adapterId(adapter);
  }

  function resolve(descriptor, settings = {}) {
    const context = buildContext(descriptor, undefined, settings);
    const adapter = matchingAdapters(context)[0] || null;
    const id = resolvedAdapterId(adapter, context);
    return Object.freeze({
      adapterId: id,
      framework: context.framework,
      capabilities: adapter?.capabilities || CAPABILITIES[id] || CAPABILITIES['native-value'],
      fieldPath: context.fieldPath,
      adapter,
    });
  }

  const DANGEROUS_TYPES = Object.freeze(new Set(['password', 'file', 'submit', 'reset', 'image', 'hidden']));

  function prohibitedReason(descriptor) {
    const element = descriptor?.element;
    const tag = safeString(element?.tagName).toLowerCase();
    const type = safeString(element?.type || element?.getAttribute?.('type')).toLowerCase();
    const role = safeString(element?.getAttribute?.('role')).toLowerCase();
    const kind = safeString(descriptor?.controlKind || descriptor?.type || descriptor?.baseControlKind).toLowerCase();
    if (!element) return '字段元素不存在';
    if (descriptor?.sensitive || type === 'password') return '敏感或密码字段禁止自动填写';
    if (DANGEROUS_TYPES.has(type)) return type === 'file' ? '文件字段必须交给 FileUploadEngine' : '危险控件禁止自动执行';
    const semanticComboboxButton = tag === 'button'
      && type === 'button'
      && role === 'combobox'
      && (kind === 'custom-select'
        || (kind === 'cascader'
          && descriptor?.cascaderRoot === element
          && descriptor?.cascaderTrigger === element));
    if (tag === 'button' && !semanticComboboxButton) return '按钮控件禁止作为表单字段自动执行';
    return '';
  }

  function executionResult(values = {}) {
    return {
      handled: values.handled !== false,
      ok: Boolean(values.ok),
      status: safeString(values.status || (values.ok ? 'SUCCESS' : 'FAILED')).toUpperCase(),
      reason: safeString(values.reason),
      adapterId: safeString(values.adapterId),
      framework: safeString(values.framework || 'generic'),
      strategy: safeString(values.strategy),
      actualValue: values.actualValue === undefined ? '' : values.actualValue,
      ...values.extra,
    };
  }

  const OPTION_MATCH_REASON_CODES = new Set([
    'OPTION_MATCHED',
    'NO_OPTIONS',
    'NO_CANONICAL_ALIAS',
    'LOW_SCORE',
    'AMBIGUOUS_OPTIONS',
    'INSUFFICIENT_MARGIN',
    'OPTION_SCOPE_UNCERTAIN',
    'READBACK_MISMATCH',
  ]);
  const OPTION_EXPECTED_SHAPES = new Set(['empty', 'array', 'text', 'ratio', 'number', 'boolean', 'object', 'other']);

  function optionMatchingDebug(value, reasonOverride = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const own = key => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : undefined;
      } catch (_) { return undefined; }
    };
    const traceString = (input, maxLength) => {
      try { return safeString(input).slice(0, maxLength); }
      catch (_) { return ''; }
    };
    const traceArray = (key, maxItems, maxLength) => {
      const items = own(key);
      if (!Array.isArray(items)) return Object.freeze([]);
      return Object.freeze(items.slice(0, maxItems)
        .filter(item => typeof item === 'string')
        .map(item => traceString(item, maxLength))
        .filter(Boolean));
    };
    const traceScore = key => {
      let number;
      try { number = Number(own(key)); }
      catch (_) { number = 0; }
      return Number(Math.min(1, Math.max(0, Number.isFinite(number) ? number : 0)).toFixed(3));
    };
    let optionCount;
    try { optionCount = Number(own('optionCount')); }
    catch (_) { optionCount = 0; }
    const suppliedReason = traceString(reasonOverride || own('reasonCode'), 80).toUpperCase();
    const safeReason = OPTION_MATCH_REASON_CODES.has(suppliedReason) ? suppliedReason : 'LOW_SCORE';
    const suppliedShape = traceString(own('expectedShape'), 40).toLowerCase();
    return Object.freeze({
      fieldPath: traceString(own('fieldPath'), 160),
      optionCount: Number.isInteger(optionCount) && optionCount >= 0 ? Math.min(optionCount, 10000) : 0,
      normalizedOptionLabels: traceArray('normalizedOptionLabels', 40, 80),
      expectedShape: OPTION_EXPECTED_SHAPES.has(suppliedShape) ? suppliedShape : 'other',
      canonicalCandidates: traceArray('canonicalCandidates', 20, 120),
      expectedCanonical: traceString(own('expectedCanonical'), 120),
      bestScore: traceScore('bestScore'),
      secondBestScore: traceScore('secondBestScore'),
      threshold: traceScore('threshold'),
      margin: traceScore('margin'),
      bestOptionLabel: traceString(own('bestOptionLabel'), 80),
      matchedCanonical: traceString(own('matchedCanonical'), 120),
      reasonCode: safeReason,
    });
  }

  async function execute(descriptor, value, settings = {}) {
    const baseContext = buildContext(descriptor, value, settings);
    const blocked = prohibitedReason(descriptor);
    if (blocked) {
      return executionResult({
        handled: true,
        ok: false,
        status: 'FAILED',
        reason: blocked,
        adapterId: legacyAdapterId(descriptor, settings),
        framework: baseContext.framework,
        strategy: 'safety-preflight',
        actualValue: descriptor?.element?.value ?? '',
      });
    }

    const resolution = resolve(descriptor, settings);
    const adapter = resolution.adapter;
    if (!adapter) {
      return executionResult({
        handled: false,
        ok: false,
        status: 'NEEDS_CONFIRMATION',
        reason: '没有可执行的控件 Adapter',
        adapterId: resolution.adapterId,
        framework: resolution.framework,
        strategy: 'unresolved-adapter',
        actualValue: descriptor?.element?.value ?? '',
      });
    }

    const context = {
      ...baseContext,
      adapterId: resolution.adapterId,
      capabilities: resolution.capabilities,
      adapter,
    };
    let beforeValue = '';
    let writeResult = {};
    let actualValue = '';
    let verification = {};
    try {
      beforeValue = await Promise.resolve(adapter.read(context));
      context.beforeValue = beforeValue;
      writeResult = await Promise.resolve((adapter.write || adapter.execute).call(adapter, context)) || {};
      if (writeResult.handled === false) {
        return executionResult({
          handled: false,
          ok: false,
          status: 'NEEDS_CONFIRMATION',
          reason: writeResult.reason || '控件 Adapter 未处理该字段',
          adapterId: resolution.adapterId,
          framework: resolution.framework,
          strategy: safeString(writeResult.strategy || adapterId(adapter)),
          actualValue: writeResult.actualValue !== undefined ? writeResult.actualValue : beforeValue,
          extra: {
            beforeValue,
            selectedOption: writeResult.selectedOption || null,
            optionCandidates: writeResult.optionCandidates || [],
            ...(writeResult.optionMatchingDebug
              ? { optionMatchingDebug: optionMatchingDebug(writeResult.optionMatchingDebug) }
              : {}),
          },
        });
      }
      actualValue = await Promise.resolve(adapter.read({ ...context, writeResult }));
      verification = await Promise.resolve(adapter.verify({ ...context, writeResult, actualValue })) || {};
    } catch (error) {
      const sanitizedDebug = writeResult.optionMatchingDebug
        ? optionMatchingDebug(writeResult.optionMatchingDebug)
        : null;
      const caughtWriteStatus = safeString(writeResult.status).toUpperCase();
      const selectionPrecededReadback = sanitizedDebug?.reasonCode === 'OPTION_MATCHED'
        && writeResult.ok !== false
        && (!caughtWriteStatus || caughtWriteStatus === 'SUCCESS');
      const caughtDebug = selectionPrecededReadback
        ? optionMatchingDebug(sanitizedDebug, 'READBACK_MISMATCH')
        : sanitizedDebug;
      return executionResult({
        handled: true,
        ok: false,
        status: 'FAILED',
        reason: error?.message || '控件 Adapter 执行失败',
        adapterId: resolution.adapterId,
        framework: resolution.framework,
        strategy: safeString(writeResult.strategy || adapterId(adapter)),
        actualValue,
        extra: {
          beforeValue,
          ...(caughtDebug ? { optionMatchingDebug: caughtDebug } : {}),
        },
      });
    }

    const writeStatus = safeString(writeResult.status).toUpperCase();
    const verifyStatus = safeString(verification.status).toUpperCase();
    const writeAllowsSuccess = !writeStatus || writeStatus === 'SUCCESS';
    const verifyAllowsSuccess = !verifyStatus || verifyStatus === 'SUCCESS';
    const ok = writeResult.ok !== false
      && verification.ok === true
      && writeAllowsSuccess
      && verifyAllowsSuccess;
    let status = ok ? 'SUCCESS' : 'FAILED';
    if (!ok && (writeStatus === 'NEEDS_CONFIRMATION' || verifyStatus === 'NEEDS_CONFIRMATION')) {
      status = 'NEEDS_CONFIRMATION';
    } else if (!ok && writeStatus && writeStatus !== 'SUCCESS') {
      status = writeStatus;
    } else if (!ok && verifyStatus && verifyStatus !== 'SUCCESS') {
      status = verifyStatus;
    }

    const finalActualValue = verification.actualValue !== undefined
      ? verification.actualValue
      : (writeResult.actualValue !== undefined ? writeResult.actualValue : actualValue);
    const sanitizedDebug = writeResult.optionMatchingDebug
      ? optionMatchingDebug(writeResult.optionMatchingDebug)
      : null;
    const selectedOptionWasWritten = sanitizedDebug?.reasonCode === 'OPTION_MATCHED'
      && writeResult.ok !== false
      && writeAllowsSuccess;
    const finalDebug = selectedOptionWasWritten && (verification.ok !== true || !verifyAllowsSuccess)
      ? optionMatchingDebug(sanitizedDebug, 'READBACK_MISMATCH')
      : sanitizedDebug;
    return executionResult({
      handled: true,
      ok,
      status,
      reason: ok ? '' : safeString(writeResult.reason || verification.reason || '控件写入或验证失败'),
      adapterId: resolution.adapterId,
      framework: resolution.framework,
      strategy: safeString(writeResult.strategy || verification.strategy || adapterId(adapter)),
      actualValue: finalActualValue,
      extra: {
        beforeValue,
        selectedOption: writeResult.selectedOption || null,
        optionCandidates: writeResult.optionCandidates || [],
        ...(finalDebug
          ? { optionMatchingDebug: finalDebug }
          : {}),
      },
    });
  }

  return Object.freeze({
    CAPABILITIES,
    detectFramework,
    execute,
    metadata,
    register,
    resolve,
  });
});
