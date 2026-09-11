/*
 * 解放：内容脚本集成控制器。
 * 统一连接 AutofillEngine、FloatingPanel、Popup 消息和 TaskState。
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initContentController(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFContentController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function contentControllerFactory(root) {
  'use strict';

  // Bump this revision whenever the injected page runtime contract changes.
  // Popup uses the exact value as a freshness gate and never overlays a second
  // controller on a reachable, older page runtime.
  const RUNTIME_REVISION = 'jiefang-page-runtime-v3';
  const RUNTIME_CAPABILITIES = Object.freeze([
    'runtime-snapshot-contract-v1',
    'required-globals-verified-v1',
  ]);

  const MESSAGE_TYPES = Object.freeze(new Set([
    'SHOW_PANEL',
    'GET_SYSTEM_SNAPSHOT',
    'SCAN_SYSTEM',
    'RUN_ALL',
    'RUN_CURRENT',
    'PAUSE',
    'RESUME',
    'STOP',
    'SKIP',
    'RUN_DIAGNOSIS',
  ]));
  const ARRAY_SECTIONS = Object.freeze([
    'family', 'education', 'awards', 'research', 'projects', 'papers', 'patents',
    'practice', 'internships', 'student_work', 'certificates', 'language',
  ]);
  const SCAN_PHASES = Object.freeze({
    SCANNING: 'SCANNING',
    STABILIZING: 'STABILIZING',
    READY: 'READY',
  });
  const DEFAULT_SCAN_STABILIZATION = Object.freeze({
    delayMs: 250,
    maxMs: 1_800,
    adaptiveMaxMs: 3_600,
    maxAttempts: 8,
  });
  const REQUIRED_GLOBALS = Object.freeze([
    'JFAutofillEngine', 'JFFloatingPanel', 'JFSiteProfile', 'JFAdapterRegistry', 'JFGenericAdapter', 'JFNavigationEngine',
    'JFCurrentSectionResolver', 'JFFieldContext', 'JFFieldDetector', 'JFFieldMatcher', 'JFFormFiller', 'JFArrayHandler',
    'JFPageReady', 'JFTaskState', 'JFReportManager', 'JFBooleanSemanticAdapter', 'JFSemanticVerification',
    'JFDiagnosticSanitizer', 'JFOptionAliases', 'JFDateRules', 'JFEventDispatcher', 'JFVerificationEngine',
    'JFControlAdapterRegistry', 'JFNativeValueAdapter', 'JFNativeSelectAdapter', 'JFChoiceAdapter',
    'JFCascaderAdapter', 'JFCustomSelectAdapter', 'JFDateLikeAdapter', 'JFCompoundPickerAdapter',
    'JFUI', 'JFProfileCoverage', 'JFReviewPresenter',
  ]);

  let mounted = false;
  let listenerInstalled = false;
  let engine = null;
  let panel = null;
  let activeRun = null;
  let lastInspection = null;
  let lastDiagnosis = null;
  let lastSnapshot = null;
  let scanTelemetry = Object.freeze({
    phase: SCAN_PHASES.READY,
    countsFinal: true,
    attemptCount: 0,
    reasonCode: 'NOT_SCANNED',
    detectedFieldCount: 0,
    reliableFieldCount: 0,
    embeddedSectionCount: 0,
    topologyChanged: false,
    fieldSignatureChanged: false,
    resumeAvailable: false,
  });

  function safeString(value, max = 240) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function errorMessage(error) {
    return safeString(error?.message || error || '未知错误', 300);
  }

  function boundedNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
  }

  function delay(ms) {
    return new Promise(resolve => root.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function inspectionCounts(inspection) {
    return {
      detected: Array.isArray(inspection?.fields) ? inspection.fields.length : 0,
      reliable: Math.max(0, Number(inspection?.reliableFieldCount || 0)),
    };
  }

  function embeddedSectionCount(inspection) {
    return Array.isArray(inspection?.sectionContext?.regionCandidates)
      ? inspection.sectionContext.regionCandidates.length
      : 0;
  }

  function inspectionTopologySignature(inspection) {
    const candidates = Array.isArray(inspection?.sectionContext?.regionCandidates)
      ? inspection.sectionContext.regionCandidates
      : [];
    return JSON.stringify(candidates.map(candidate => [
      safeString(candidate?.sectionId, 80),
      safeString(candidate?.collection, 80),
      safeString(candidate?.collectionMode, 40),
      Math.max(0, Number(candidate?.groupCount || 0)),
      Boolean(candidate?.zeroRow),
    ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
  }

  function inspectionFieldSignature(inspection) {
    const fields = Array.isArray(inspection?.fields) ? inspection.fields : [];
    const matches = Array.isArray(inspection?.matches) ? inspection.matches : [];
    return JSON.stringify(fields.map((field, index) => {
      const match = matches[index] || {};
      return [
        safeString(field?.type || field?.controlType || field?.controlKind, 40),
        safeString(field?.context?.collection, 80),
        safeString(field?.context?.collectionMode, 40),
        safeString(match?.matchedPath || match?.path, 120),
        safeString(match?.status, 40),
      ];
    }));
  }

  function setScanTelemetry(phase, patch = {}, inspection = lastInspection) {
    const counts = inspectionCounts(inspection);
    const reasonCode = safeString(patch.reasonCode, 80);
    scanTelemetry = Object.freeze({
      phase,
      countsFinal: typeof patch.countsFinal === 'boolean'
        ? patch.countsFinal
        : phase === SCAN_PHASES.READY,
      attemptCount: Math.max(0, Number(patch.attemptCount || 0)),
      reasonCode,
      detectedFieldCount: counts.detected,
      reliableFieldCount: counts.reliable,
      embeddedSectionCount: embeddedSectionCount(inspection),
      topologyChanged: Boolean(patch.topologyChanged),
      fieldSignatureChanged: Boolean(patch.fieldSignatureChanged),
      resumeAvailable: Boolean(patch.resumeAvailable),
    });
    const action = phase === SCAN_PHASES.SCANNING
      ? '正在扫描当前报名系统…'
      : phase === SCAN_PHASES.STABILIZING
        ? '正在等待表单稳定…'
        : '';
    updatePanel({ ...buildSnapshot(inspection), ...(action ? { currentAction: action } : {}) });
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      if (!root.chrome?.storage?.local) { resolve({}); return; }
      root.chrome.storage.local.get(keys, result => {
        const error = root.chrome.runtime?.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result || {});
      });
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      if (!root.chrome?.storage?.local) { resolve(); return; }
      root.chrome.storage.local.set(value, () => {
        const error = root.chrome.runtime?.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  function runtimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!root.chrome?.runtime?.sendMessage) { resolve(null); return; }
      root.chrome.runtime.sendMessage(message, response => {
        const error = root.chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (response?.ok === false || response?.error) reject(new Error(response.error || '扩展后台拒绝请求'));
        else resolve(response);
      });
    });
  }

  function hasData(value, depth = 0) {
    if (depth > 5 || value === null || value === undefined) return false;
    if (typeof value === 'string') return Boolean(value.trim());
    if (typeof value === 'number' || typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.some(item => hasData(item, depth + 1));
    if (typeof value === 'object') return Object.values(value).some(item => hasData(item, depth + 1));
    return false;
  }

  function resumeStatistics(resumeView = {}) {
    const statistics = {
      basic: hasData(resumeView.basic) ? 1 : 0,
      contact: hasData(resumeView.contact) ? 1 : 0,
      skills: hasData(resumeView.skills) ? 1 : 0,
    };
    ARRAY_SECTIONS.forEach(section => {
      statistics[section] = Array.isArray(resumeView[section]) ? resumeView[section].length : 0;
    });
    return statistics;
  }

  function sectionQueueFromInspection(inspection) {
    return (inspection?.queue || []).map((item, index) => ({
      sectionId: safeString(item.sectionId || item.id, 80),
      label: safeString(item.label || item.sectionId || '其他栏目', 100),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      passiveOnly: Boolean(item.passiveOnly),
      reasonCode: safeString(item.reasonCode, 80),
      scanId: safeString(item.scanId || inspection?.scanId, 180),
      sectionSource: safeString(item.sectionSource, 60),
      collection: safeString(item.collection, 80),
      collectionMode: safeString(item.collectionMode, 40),
      status: item.state === 'current' ? 'CURRENT' : 'PENDING',
      index,
    }));
  }

  function scanTelemetryDebugView() {
    return {
      phase: scanTelemetry.phase,
      attemptCount: scanTelemetry.attemptCount,
      detectedFieldCount: scanTelemetry.detectedFieldCount,
      reliableFieldCount: scanTelemetry.reliableFieldCount,
      embeddedSectionCount: scanTelemetry.embeddedSectionCount,
      topologyChanged: scanTelemetry.topologyChanged,
      fieldSignatureChanged: scanTelemetry.fieldSignatureChanged,
      resumeAvailable: scanTelemetry.resumeAvailable,
      finalizationReason: scanTelemetry.reasonCode,
    };
  }

  function buildSnapshot(inspection = lastInspection) {
    const engineSnapshot = engine?.snapshot?.() || {};
    const inspectedQueue = sectionQueueFromInspection(inspection);
    const inspectionIsCurrent = Boolean(inspection?.scanId && inspection.scanId === (engineSnapshot.scanId || engine?.scanId));
    const sectionQueue = inspectionIsCurrent
      ? inspectedQueue
      : (Array.isArray(engineSnapshot.sectionQueue) ? engineSnapshot.sectionQueue : inspectedQueue);
    const current = inspection?.current || {};
    const liveState = safeString(engineSnapshot.state || engine?.engineState || '', 40).toUpperCase();
    const persistentState = safeString(engine?.task?.state || '', 40).toUpperCase();
    const visibleState = (!liveState || liveState === 'IDLE') && persistentState && persistentState !== 'IDLE'
      ? persistentState : (liveState || 'IDLE');
    // Metadata-only UI projection; it does not influence matching or execution.
    const activeScanId = safeString(inspectionIsCurrent ? inspection.scanId : engineSnapshot.scanId || engine?.scanId, 180);
    const uiProjection = root.JFReviewPresenter?.project?.({ report: engine?.getReport?.(), inspection, scanId: activeScanId }) || {};
    if (sectionQueue.length) {
      // Future-page field totals are unknown. Count completed queue entries rather
      // than presenting the currently recorded fields as a falsely complete run.
      const completed = sectionQueue.filter(item => /^(?:DONE|SUCCESS|COMPLETED|FILLED|PARTIAL|NO_CHANGES|SKIPPED|FAILED)$/i.test(item.status || item.state || '')).length;
      uiProjection.progress = { completed, total: sectionQueue.length, percent: Math.round(completed / sectionQueue.length * 100), unit: '栏目' };
    }
    const coverage = root.JFProfileCoverage?.fromResume?.(engine?.resumeView || {});
    const snapshot = {
      schemaVersion: 1,
      runtimeRevision: RUNTIME_REVISION,
      runtimeCapabilities: [...RUNTIME_CAPABILITIES],
      scanId: safeString(inspectionIsCurrent ? inspection.scanId : engineSnapshot.scanId || engine?.scanId, 180),
      mounted,
      systemName: safeString(root.document?.title, 120) || '当前报名系统',
      state: visibleState,
      resultStatus: safeString(engineSnapshot.resultStatus || engine?.task?.resultStatus, 60),
      siteProfileId: safeString(engineSnapshot.siteProfileId || engine?.task?.siteProfileId, 80),
      siteProfileRevision: safeString(engineSnapshot.siteProfileRevision || engine?.task?.siteProfileRevision, 128),
      siteProfile: engineSnapshot.siteProfile,
      currentIndex: Number(engineSnapshot.currentIndex || 0),
      currentSection: safeString(current.section, 80) || null,
      currentSectionSource: safeString(inspection?.sectionContext?.source, 60) || null,
      currentCollection: safeString(inspection?.sectionContext?.collection, 80) || null,
      currentCollectionMode: safeString(inspection?.sectionContext?.collectionMode, 40) || null,
      currentSectionLabel: safeString(engineSnapshot.currentSectionLabel || current.label, 120),
      currentAction: safeString(engineSnapshot.currentAction, 300),
      sectionQueue,
      sectionCount: sectionQueue.length,
      embeddedSectionCount: Array.isArray(inspection?.sectionContext?.regionCandidates)
        ? inspection.sectionContext.regionCandidates.length
        : 0,
      reliableFieldCount: Number(inspection?.reliableFieldCount || 0),
      detectedFieldCount: Array.isArray(inspection?.fields) ? inspection.fields.length : 0,
      needsConfirmationCount: Array.isArray(inspection?.matches)
        ? inspection.matches.filter(match => match?.status !== 'MATCHED').length : 0,
      resumeStats: resumeStatistics(engine?.resumeView || {}),
      profileCoverage: coverage ? { filled: coverage.filled, total: coverage.total, missing: coverage.missing, percent: coverage.percent } : null,
      ...uiProjection,
      materialCount: Array.isArray(engine?.materials) ? engine.materials.length : 0,
      running: Boolean(activeRun),
      awaitingPreview: Boolean(activeRun && engine?.prepared && !engine?.authorization),
      finalSubmitBlocked: true,
      progressionBlocked: Boolean(engineSnapshot.progressionBlocked),
      progressionReasonCode: safeString(engineSnapshot.progressionReasonCode, 80),
      progressionBlockers: Array.isArray(engineSnapshot.progressionBlockers)
        ? engineSnapshot.progressionBlockers.map(item => ({ ...item }))
        : [],
      localMode: true,
      scanPhase: scanTelemetry.phase,
      scanCountsFinal: scanTelemetry.countsFinal,
      scanAttemptCount: scanTelemetry.attemptCount,
      scanReasonCode: scanTelemetry.reasonCode,
      scanTelemetryDebug: scanTelemetryDebugView(),
    };
    lastSnapshot = snapshot;
    return snapshot;
  }

  function updatePanel(snapshot = buildSnapshot()) {
    lastSnapshot = snapshot;
    panel?.update?.(snapshot);
    return snapshot;
  }

  function selectSiteConfig(configs) {
    // 配置只允许注册表定义的 origin / prefix / 受限 wildcard 规则；
    // 内容脚本绝不执行用户提供的任意正则表达式。
    const resolution = root.JFAdapterRegistry?.resolveProfile?.(configs, root.location, { source: 'storage' });
    if (!resolution) return {};
    const siteProfile = Object.freeze({
      matched: Boolean(resolution.matched),
      id: safeString(resolution.siteProfileId || resolution.profileId, 80),
      revision: safeString(resolution.siteProfileRevision || resolution.profileRevision, 128),
      source: safeString(resolution.source || 'storage', 40) || 'storage',
      resolution: safeString(resolution.resolution || resolution.reasonCode || 'GENERIC', 80) || 'GENERIC',
    });
    return {
      ...(resolution.config || {}),
      siteProfile,
      profileWarnings: Array.isArray(resolution.warnings) ? resolution.warnings : [],
    };
  }

  function assertDependencies() {
    const missing = REQUIRED_GLOBALS.filter(name => !root[name]);
    if (missing.length) throw new Error(`核心模块加载不完整：${missing.join(', ')}`);
    if (typeof root.JFAutofillEngine.AutofillEngine !== 'function') throw new Error('AutofillEngine 接口不可用');
    if (typeof root.JFFloatingPanel.create !== 'function') throw new Error('FloatingPanel 接口不可用');
  }

  function fileConfirmationRequest(match = {}) {
    return {
      label: safeString(match.field?.labelText || match.field?.contextText || match.path || '上传材料', 160),
      candidates: Array.isArray(match.candidates) ? match.candidates.map(candidate => ({
        score: Number(candidate.score || 0),
        material: candidate.material ? {
          id: safeString(candidate.material.id, 190),
          name: safeString(candidate.material.name, 180),
          category: safeString(candidate.material.category, 80),
          size: Number(candidate.material.size || 0),
        } : null,
      })) : [],
    };
  }

  async function createEngine() {
    assertDependencies();
    const stored = await storageGet(['siteAdapterConfigs', 'fillPreferences', 'autofillPreferences']);
    const config = selectSiteConfig(stored.siteAdapterConfigs);
    const preferences = { ...(stored.fillPreferences || {}), ...(stored.autofillPreferences || {}) };
    return new root.JFAutofillEngine.AutofillEngine({
      document: root.document,
      config,
      preferences,
      callbacks: {
        onState(snapshot) {
          const scanPending = scanTelemetry.phase === SCAN_PHASES.SCANNING
            || scanTelemetry.phase === SCAN_PHASES.STABILIZING;
          const scanAction = scanTelemetry.phase === SCAN_PHASES.SCANNING
            ? '正在扫描当前报名系统…'
            : '正在等待表单稳定…';
          updatePanel({
            ...buildSnapshot(),
            ...snapshot,
            ...(scanPending ? { currentAction: scanAction } : {}),
            running: Boolean(activeRun),
          });
        },
        onLog(message) { panel?.log?.(safeString(message, 500)); },
        onReport(report) {
          const currentScanId = engine?.snapshot?.().scanId || engine?.scanId || '';
          if (!report?.scanId || report.scanId !== currentScanId) {
            panel?.log?.('已忽略不属于当前扫描的旧填写报告。');
            return;
          }
          lastSnapshot = { ...buildSnapshot(), report };
          updatePanel(lastSnapshot);
        },
        onError(error, snapshot) {
          panel?.log?.(`任务异常：${errorMessage(error)}`);
          updatePanel({ ...buildSnapshot(), ...snapshot, state: 'ERROR', currentAction: errorMessage(error) });
        },
        async requestFileConfirmation(match) {
          await panel?.show?.();
          return panel?.confirmFile?.(fileConfirmationRequest(match)) || null;
        },
        async requestSectionConfirmation(request = {}) {
          if (!panel?.openModal) return false;
          await panel.show?.();
          const sectionId = safeString(request.sectionId, 80);
          const label = safeString(request.label || sectionId || '下一栏目', 120);
          const accepted = await panel.openModal({
            title: '切换栏目前确认',
            confirmLabel: '进入该栏目',
            bodyHtml: `<p>即将进入：<strong>${escapeHtml(label)}</strong></p><p>进度：${Math.max(1, Number(request.index || 0) + 1)} / ${Math.max(1, Number(request.total || 1))}</p><p class="notice">只切换到已识别且通过安全复核的导航项；不会点击“下一步”或任何提交按钮。</p>`,
          });
          return accepted ? sectionId || true : false;
        },
      },
    });
  }

  function fireAndLog(action) {
    Promise.resolve().then(action).catch(error => {
      panel?.log?.(`操作失败：${errorMessage(error)}`);
      updatePanel({ ...buildSnapshot(), state: 'ERROR', currentAction: errorMessage(error) });
    });
  }

  async function openOptions() {
    await runtimeMessage({ type: 'OPEN_OPTIONS', view: 'materials' });
  }

  async function editSettings() {
    const next = await panel?.editSettings?.(engine?.preferences || {});
    if (!next) return { ok: false, cancelled: true };
    const { snap, ...preferences } = next;
    engine.preferences = { ...engine.preferences, ...preferences };
    await storageSet({ autofillPreferences: engine.preferences });
    if (typeof snap === 'boolean') await panel.persist?.({ snap });
    panel.log?.('设置已保存在本机。');
    return { ok: true, preferences: { ...engine.preferences } };
  }

  async function scanSystem(options = {}) {
    if (activeRun && !options.allowDuringRun) return buildSnapshot();
    const scanId = options.reset === false ? (engine.scanId || root.JFTaskState.createScanId()) : await engine.resetRecognition();
    lastInspection = null;
    lastDiagnosis = null;
    lastSnapshot = null;
    let resumeAvailable = hasData(engine?.resumeView || engine?.resume || {});
    let topologyChanged = false;
    let fieldSignatureChanged = false;
    setScanTelemetry(SCAN_PHASES.SCANNING, {
      attemptCount: 0,
      reasonCode: 'SCAN_STARTED',
      resumeAvailable,
    }, null);
    let inspection = null;
    let attemptCount = 0;
    try {
      attemptCount = 1;
      inspection = await engine.inspectSystem({ scanId });
      resumeAvailable = hasData(engine?.resumeView || engine?.resume || {});
      const initialCounts = inspectionCounts(inspection);
      const needsStabilization = initialCounts.detected === 0 || initialCounts.reliable === 0;

      if (needsStabilization) {
        const delayMs = boundedNumber(
          options.stabilizationDelayMs,
          DEFAULT_SCAN_STABILIZATION.delayMs,
          0,
          1_000,
        );
        const maxMs = boundedNumber(
          options.stabilizationMaxMs,
          DEFAULT_SCAN_STABILIZATION.maxMs,
          25,
          2_000,
        );
        const adaptiveMaxMs = boundedNumber(
          options.stabilizationAdaptiveMaxMs,
          DEFAULT_SCAN_STABILIZATION.adaptiveMaxMs,
          maxMs,
          4_000,
        );
        const maxAttempts = boundedNumber(
          options.stabilizationMaxAttempts,
          DEFAULT_SCAN_STABILIZATION.maxAttempts,
          2,
          12,
        );
        const startedAt = Date.now();
        let dynamicEvidenceObserved = false;
        let previousTopologySignature = inspectionTopologySignature(inspection);
        let previousFieldSignature = inspectionFieldSignature(inspection);
        lastInspection = inspection;
        setScanTelemetry(SCAN_PHASES.STABILIZING, {
          attemptCount,
          reasonCode: initialCounts.detected > 0
            ? 'PROVISIONAL_UNRELIABLE_SCAN'
            : 'PROVISIONAL_EMPTY_SCAN',
          resumeAvailable,
          topologyChanged,
          fieldSignatureChanged,
        }, inspection);

        while (attemptCount < maxAttempts) {
          let elapsed = Date.now() - startedAt;
          let deadlineMs = dynamicEvidenceObserved ? adaptiveMaxMs : maxMs;
          if (elapsed >= deadlineMs) break;
          const remainingBeforeDelay = deadlineMs - elapsed;
          if (delayMs > 0 && remainingBeforeDelay > 0) {
            await delay(Math.min(delayMs, remainingBeforeDelay));
          }
          elapsed = Date.now() - startedAt;
          deadlineMs = dynamicEvidenceObserved ? adaptiveMaxMs : maxMs;
          if (elapsed >= deadlineMs) break;
          const stability = await root.JFPageReady?.waitForDOMStable?.({
            document: root.document,
            root: root.document,
            timeoutMs: Math.max(25, Math.min(500, deadlineMs - elapsed)),
            quietMs: 160,
            minFrames: 2,
            signal: options.signal,
          });
          if (Number(stability?.mutationCount || 0) > 0) {
            dynamicEvidenceObserved = true;
          }
          const remaining = (dynamicEvidenceObserved ? adaptiveMaxMs : maxMs) - (Date.now() - startedAt);
          if (remaining <= 0) break;
          attemptCount += 1;
          inspection = await engine.inspectSystem({
            scanId,
            timeoutMs: Math.max(100, Math.min(600, remaining)),
            signal: options.signal,
          });
          resumeAvailable = hasData(engine?.resumeView || engine?.resume || {});
          lastInspection = inspection;
          const nextTopologySignature = inspectionTopologySignature(inspection);
          const nextFieldSignature = inspectionFieldSignature(inspection);
          if (nextTopologySignature !== previousTopologySignature) {
            topologyChanged = true;
            dynamicEvidenceObserved = true;
          }
          if (nextFieldSignature !== previousFieldSignature) {
            fieldSignatureChanged = true;
            dynamicEvidenceObserved = true;
          }
          previousTopologySignature = nextTopologySignature;
          previousFieldSignature = nextFieldSignature;
          const counts = inspectionCounts(inspection);
          setScanTelemetry(SCAN_PHASES.STABILIZING, {
            attemptCount,
            reasonCode: dynamicEvidenceObserved
              ? 'DYNAMIC_SCAN_RETRY'
              : counts.detected > 0
                ? 'PROVISIONAL_UNRELIABLE_SCAN'
                : 'PROVISIONAL_EMPTY_SCAN',
            resumeAvailable,
            topologyChanged,
            fieldSignatureChanged,
          }, inspection);
          if (counts.detected > 0 && counts.reliable > 0) break;
        }
      }

      lastInspection = inspection;
      const finalCounts = inspectionCounts(inspection);
      const finalizationReason = finalCounts.detected === 0 && finalCounts.reliable === 0
        ? 'BOUNDED_EMPTY_SCAN'
        : finalCounts.reliable === 0
          ? 'BOUNDED_UNRELIABLE_SCAN'
          : needsStabilization ? 'STABLE_RESCAN' : 'INITIAL_SCAN_READY';
      setScanTelemetry(SCAN_PHASES.READY, {
        attemptCount,
        reasonCode: finalizationReason,
        resumeAvailable,
        topologyChanged,
        fieldSignatureChanged,
      }, inspection);
      const snapshot = buildSnapshot(inspection);
      updatePanel(snapshot);
      panel?.log?.(
        `识别到 ${snapshot.sectionCount} 个可自动导航栏目、`
        + `${snapshot.embeddedSectionCount} 个页面内区域、`
        + `${snapshot.reliableFieldCount} 个当前页可靠字段。`,
      );
      return snapshot;
    } catch (error) {
      lastInspection = inspection;
      setScanTelemetry(SCAN_PHASES.READY, {
        attemptCount,
        reasonCode: 'SCAN_FAILED',
        countsFinal: false,
        resumeAvailable,
        topologyChanged,
        fieldSignatureChanged,
      }, inspection);
      throw error;
    }
  }

  function startRun(scope) {
    if (activeRun) return { ok: false, error: '已有填写任务正在运行或等待确认' };
    const operation = (async () => {
      await panel.show?.();
      const prepared = await engine.prepareRun(scope);
      lastInspection = null;
      updatePanel({
        ...buildSnapshot(),
        state: 'WAITING_USER',
        currentAction: '请在网页悬浮面板中核对本次填写预览。',
        sectionQueue: sectionQueueFromInspection({ queue: prepared.queue }),
      });
      const confirmed = await panel.confirmRun(prepared);
      if (!confirmed) {
        engine.prepared = null;
        engine.authorization = null;
        updatePanel({ ...buildSnapshot(), state: 'IDLE', currentAction: '已取消，本次未修改网页。' });
        panel.log?.('用户取消了填写预览。');
        return { cancelled: true };
      }
      const authorization = await engine.authorizeRun(prepared);
      const report = scope === 'current'
        ? await engine.runCurrent({ prepared, authorization })
        : await engine.runAll({ prepared, authorization });
      if (!report?.scanId || report.scanId !== engine.snapshot().scanId) {
        throw new Error('填写报告与当前扫描不一致，已阻止展示旧结果');
      }
      updatePanel({ ...buildSnapshot(), running: false });
      await panel.show?.();
      await panel.showReport?.(report);
      return report;
    })();
    activeRun = operation;
    operation.catch(error => {
      panel?.log?.(`任务启动失败：${errorMessage(error)}`);
      updatePanel({ ...buildSnapshot(), state: 'ERROR', currentAction: `任务启动失败：${errorMessage(error)}`, running: false });
    }).finally(() => { activeRun = null; updatePanel(buildSnapshot()); });
    return { ok: true, accepted: true, scope, state: 'WAITING_USER' };
  }

  function pause() {
    const changed = Boolean(engine?.pause?.());
    updatePanel(buildSnapshot());
    return { ok: changed, state: engine?.engineState || 'IDLE' };
  }

  function resume() {
    if (!activeRun) {
      // 刷新、跨文档导航或 Service Worker 恢复后，不存在仍有效的内存授权。
      // “继续”必须重新走完整预览确认，不能凭持久化状态恢复写操作。
      return startRun('all');
    }
    if (!engine?.authorization) return { ok: false, error: '请先在预览窗口确认或取消本次任务' };
    const changed = Boolean(engine?.resume?.());
    updatePanel(buildSnapshot());
    return { ok: changed, state: engine?.engineState || 'IDLE' };
  }

  async function stop() {
    if (!activeRun && !engine?.task) return { ok: false, error: '当前没有可停止的任务' };
    await panel.show?.();
    const confirmed = await panel.confirmStop?.();
    if (!confirmed) return { ok: false, cancelled: true };
    // 若任务正等待用户选择材料，停止确认也要解除该 UI Promise，避免任务悬挂。
    // 这里只操作扩展自身 Shadow DOM 内的“暂不上传”，不会点击网页控件。
    const fileConfirmation = panel.shadow?.getElementById?.('file-confirm');
    if (fileConfirmation && !fileConfirmation.hidden) panel.shadow.getElementById('file-skip')?.click?.();
    const changed = Boolean(engine?.stop?.());
    updatePanel({ ...buildSnapshot(), state: 'STOPPED', currentAction: '任务已停止；不会撤销已填写内容，也未执行最终提交。' });
    panel.log?.('用户二次确认后停止了任务。');
    return { ok: changed, state: 'STOPPED' };
  }

  function safeDiagnostic(raw) {
    const sanitizer = root.JFDiagnosticSanitizer;
    if (!sanitizer?.sanitize) throw new Error('诊断脱敏模块未加载，已阻止导出');
    return sanitizer.sanitize(raw, {
      generatedAt: new Date().toISOString(),
      page: {
        origin: root.location?.origin,
        title: root.document?.title,
      },
    });
  }

  function diagnosisFilename() {
    return `jiefang-diagnosis-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  }

  function downloadJson(value, filename = diagnosisFilename()) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = root.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    root.document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    root.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return filename;
  }

  async function copyDiagnostic(diagnosis) {
    if (!root.navigator?.clipboard?.writeText) return false;
    try { await root.navigator.clipboard.writeText(JSON.stringify(diagnosis, null, 2)); return true; }
    catch (_) { return false; }
  }

  async function runDiagnosis(options = {}) {
    if (!lastInspection && engine?.lastInspection) lastInspection = engine.lastInspection;
    if (!lastInspection && !activeRun) {
      const scanId = engine.scanId || root.JFTaskState.createScanId();
      lastInspection = await engine.inspectSystem({ scanId });
    }
    const rawDiagnosis = {
      ...engine.diagnoseCurrent(),
      scanTelemetryDebug: scanTelemetryDebugView(),
    };
    const sanitized = safeDiagnostic(rawDiagnosis);
    const diagnosis = sanitized.diagnosis;
    const summary = sanitized.summary;
    lastDiagnosis = diagnosis;
    const filename = diagnosisFilename();
    let downloaded = false;
    let copied = false;
    if (options.action === 'download') { downloadJson(diagnosis, filename); downloaded = true; }
    if (options.action === 'copy') copied = await copyDiagnostic(diagnosis);
    panel?.log?.(root.JFDiagnosticSanitizer.formatSummary(summary));
    return {
      ok: true,
      diagnosis,
      summary,
      diagnosticMeta: sanitized.diagnosticMeta,
      filename,
      downloaded,
      copied,
    };
  }

  async function handleMessage(message) {
    switch (message.type) {
      case 'SHOW_PANEL':
        await panel.show?.();
        if (['task', 'review', 'log'].includes(message.tab)) {
          await panel.persist?.({ collapsed: false });
          panel.selectTab?.(message.tab);
        }
        return { ok: true, visible: true, snapshot: buildSnapshot() };
      case 'GET_SYSTEM_SNAPSHOT':
        return { ok: true, snapshot: buildSnapshot() };
      case 'SCAN_SYSTEM':
        return { ok: true, snapshot: await scanSystem() };
      case 'RUN_ALL':
        return startRun('all');
      case 'RUN_CURRENT':
        return startRun('current');
      case 'PAUSE':
        return pause();
      case 'RESUME':
        return resume();
      case 'STOP':
        return stop();
      case 'SKIP':
        engine?.skipCurrent?.();
        panel?.log?.('已请求跳过当前栏目。');
        return { ok: true, snapshot: buildSnapshot() };
      case 'RUN_DIAGNOSIS':
        return runDiagnosis({ action: message.action || 'return' });
      default:
        return { ok: false, error: '不支持的页面控制消息' };
    }
  }

  function installMessageListener() {
    if (listenerInstalled || !root.chrome?.runtime?.onMessage) return;
    listenerInstalled = true;
    root.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!MESSAGE_TYPES.has(message?.type)) return undefined;
      if (sender?.id && root.chrome.runtime.id && sender.id !== root.chrome.runtime.id) {
        sendResponse({ ok: false, error: '拒绝非本扩展消息' });
        return false;
      }
      Promise.resolve(handleMessage(message)).then(
        response => sendResponse(response),
        error => sendResponse({ ok: false, error: errorMessage(error) }),
      );
      return true;
    });
  }

  async function mount() {
    if (mounted && engine && panel?.host?.isConnected) {
      await panel.show?.();
      return { ok: true, snapshot: buildSnapshot() };
    }
    assertDependencies();
    engine = await createEngine();
    panel = await root.JFFloatingPanel.create({
      runAll: () => fireAndLog(() => startRun('all')),
      runCurrent: () => fireAndLog(() => startRun('current')),
      scan: () => fireAndLog(scanSystem),
      pause: () => pause(),
      resume: () => resume(),
      stop: () => fireAndLog(stop),
      skip: () => { engine.skipCurrent?.(); panel.log?.('已请求跳过当前栏目。'); },
      rerun: () => fireAndLog(() => startRun('current')),
      diagnose: () => fireAndLog(() => runDiagnosis({ action: 'download' })),
      materials: () => fireAndLog(openOptions),
      settings: () => fireAndLog(editSettings),
    });
    mounted = true;
    installMessageListener();
    await engine.refreshData();
    const storedTask = await engine.taskStore?.load?.();
    const finalStates = root.JFTaskState?.FINAL_STATES;
    const isFinal = storedTask && finalStates?.has?.(storedTask.state);
    const recovered = storedTask && !isFinal ? await engine.recover() : null;
    if (storedTask && isFinal) engine.task = storedTask;
    if (recovered) panel.log?.('检测到未完成任务；为安全起见，继续前必须重新预览确认。');
    updatePanel(buildSnapshot());
    engine.navigation?.startWatching?.(({ queue }) => {
      if (activeRun) return;
      if (!lastInspection?.scanId || engine?.task) return;
      lastInspection = {
        ...lastInspection,
        queue: (queue || []).map(item => ({ ...item, scanId: lastInspection.scanId })),
      };
      updatePanel(buildSnapshot(lastInspection));
    });
    return { ok: true, snapshot: buildSnapshot() };
  }

  return Object.freeze({
    MESSAGE_TYPES,
    RUNTIME_CAPABILITIES,
    RUNTIME_REVISION,
    SCAN_PHASES,
    buildSnapshot,
    getEngine: () => engine,
    getLastDiagnosis: () => lastDiagnosis,
    getPanel: () => panel,
    handleMessage,
    mount,
    runDiagnosis,
    scanSystem,
  });
});
