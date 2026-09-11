// background.js — 后台 service worker
// “解放”固定为本地模式。任务状态模块仅访问扩展自己的 session/local 存储。
// JobFill 原有 AI 实现保留在本文件下方，但消息入口在这里统一拒绝，
// manifest 也没有任何外部主机权限。

if (typeof importScripts === 'function') {
  try {
    importScripts(
      'src/core/task-state.js',
      'src/mappings/file-field-aliases.js',
      'src/storage/indexeddb.js',
      'src/storage/material-library.js',
    );
  } catch (_) { /* 后续按明确错误响应，不降级为不受校验的存储 */ }
}

const LOCAL_MODE_ONLY = true;
const TASK_MESSAGE_TYPES = new Set(['GET_TASK_STATE', 'SET_TASK_STATE', 'CLEAR_TASK_STATE']);
const FILE_AUTH_MAX_TTL_MS = 30 * 60_000;
const FILE_AUTH_MAX_TASKS = 100;
const FILE_AUTH_MAX_MATERIALS = 100;
const FILE_PAYLOAD_MAX_BYTES = 50 * 1024 * 1024;
const FILE_PAYLOAD_MAX_BASE64_CHARS = Math.ceil(FILE_PAYLOAD_MAX_BYTES / 3) * 4 + 4;
let taskStateStore;
const fileUploadAuthorizations = new Map();

function getTaskStateStore() {
  if (taskStateStore) return taskStateStore;
  if (!globalThis.JFTaskState?.TaskStateStore) throw new Error('任务状态安全模块未加载');
  taskStateStore = new globalThis.JFTaskState.TaskStateStore({ chromeApi: chrome });
  return taskStateStore;
}

function messageError(error) {
  return String(error?.message || error || '未知错误').replace(/[\r\n]+/g, ' ').slice(0, 180);
}

function isTrustedExtensionSender(sender) {
  // 未声明 externally_connectable；额外拒绝明确来自其他扩展的消息。
  if (chrome.runtime.id && sender?.id !== chrome.runtime.id) return false;
  if (sender?.tab && sender.frameId !== undefined && sender.frameId !== 0) return false;
  return true;
}

function pruneFileAuthorizations() {
  const now = Date.now();
  for (const [nonce, authorization] of fileUploadAuthorizations) {
    if (authorization.expiresAt <= now) fileUploadAuthorizations.delete(nonce);
  }
}

function revokeTaskFileAuthorizations(taskId) {
  const normalizedTaskId = String(taskId || '');
  for (const [nonce, authorization] of fileUploadAuthorizations) {
    if (!normalizedTaskId || authorization.taskId === normalizedTaskId) fileUploadAuthorizations.delete(nonce);
  }
}

function validTabId(sender) {
  return Number.isInteger(sender?.tab?.id) && sender.tab.id >= 0 && sender.frameId === 0;
}

function normalizeMaterialIds(values) {
  return [...new Set((Array.isArray(values) ? values.slice(0, FILE_AUTH_MAX_MATERIALS + 1) : [])
    .map(value => String(value || ''))
    .filter(value => /^file_[\w-]{4,180}$/i.test(value)))].slice(0, FILE_AUTH_MAX_MATERIALS);
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every(value => right.includes(value));
}

function normalizedGrantMetadata(msg, materialId) {
  const records = Array.isArray(msg.materials) ? msg.materials.slice(0, FILE_AUTH_MAX_MATERIALS) : [];
  const record = records.find(item => item && String(item.id || '') === materialId) || {};
  const hash = /^[a-f0-9]{64}$/i.test(String(record.hash || '')) ? String(record.hash).toLowerCase() : '';
  const size = Number(record.size);
  return {
    hash,
    size: Number.isInteger(size) && size > 0 && size <= FILE_PAYLOAD_MAX_BYTES ? size : 0,
  };
}

function authorizeFileUploads(msg, sender) {
  pruneFileAuthorizations();
  if (!validTabId(sender)) throw new Error('文件授权只能来自当前页面主框架');
  const taskId = String(msg.taskId || '');
  const nonce = String(msg.nonce || '');
  if (msg.userConfirmed !== true) throw new Error('文件上传必须经过本次任务的明确预览确认');
  if (!/^[a-z0-9._:-]{6,160}$/i.test(taskId) || !/^[a-z0-9_-]{16,200}$/i.test(nonce)) throw new Error('文件授权标识无效');
  const confirmationMode = String(msg.confirmationMode || '');
  if (!['preview-batch', 'per-file'].includes(confirmationMode)) throw new Error('文件授权缺少明确的确认模式');
  if (Array.isArray(msg.materialIds) && msg.materialIds.length > FILE_AUTH_MAX_MATERIALS) throw new Error('单次文件授权材料数量超过上限');
  if (Array.isArray(msg.previewedMaterialIds) && msg.previewedMaterialIds.length > FILE_AUTH_MAX_MATERIALS) throw new Error('文件预览材料数量超过上限');
  if (Array.isArray(msg.materials) && msg.materials.length > FILE_AUTH_MAX_MATERIALS) throw new Error('单次文件授权元数据数量超过上限');
  const materialIds = normalizeMaterialIds(msg.materialIds);
  if (!materialIds.length) throw new Error('本次任务没有已确认的材料');
  if (confirmationMode === 'preview-batch') {
    const previewed = normalizeMaterialIds(msg.previewedMaterialIds);
    if (!sameStringSet(materialIds, previewed)) throw new Error('批量文件授权必须与本次预览明确列出的材料完全一致');
  } else if (materialIds.length !== 1 || String(msg.confirmedMaterialId || '') !== materialIds[0]) {
    throw new Error('逐文件授权每次只能确认一个明确材料');
  }
  const requestedExpiry = Number(msg.expiresAt);
  if (!Number.isFinite(requestedExpiry) || requestedExpiry <= Date.now()) throw new Error('文件授权已过期，请重新预览确认');
  const expiresAt = Math.min(Date.now() + FILE_AUTH_MAX_TTL_MS, requestedExpiry);

  for (const [activeNonce, active] of fileUploadAuthorizations) {
    if (activeNonce !== nonce && active.taskId === taskId && active.tabId === sender.tab.id) {
      throw new Error('同一任务和标签页已存在另一份文件授权，请先撤销或重新开始预览');
    }
  }
  let authorization = fileUploadAuthorizations.get(nonce);
  if (authorization && (authorization.taskId !== taskId || authorization.tabId !== sender.tab.id)) {
    throw new Error('文件授权 nonce 已绑定其他任务或标签页');
  }
  const pendingGrants = materialIds.map(materialId => {
    if (authorization?.consumedMaterialIds.has(materialId)) {
      throw new Error('该材料的一次性授权已经使用；如需再次使用，请重新预览并开启新任务');
    }
    const metadata = normalizedGrantMetadata(msg, materialId);
    const existing = authorization?.grants.get(materialId);
    if (existing && ((existing.hash && metadata.hash && existing.hash !== metadata.hash)
      || (existing.size && metadata.size && existing.size !== metadata.size))) {
      throw new Error('材料在确认后发生变化，请重新预览');
    }
    return { materialId, metadata, existing };
  });

  if (!authorization) {
    if (fileUploadAuthorizations.size >= FILE_AUTH_MAX_TASKS) throw new Error('活动文件授权过多，请结束旧任务后重试');
    authorization = {
      taskId,
      nonce,
      tabId: sender.tab.id,
      expiresAt,
      grants: new Map(),
      consumedMaterialIds: new Set(),
    };
    fileUploadAuthorizations.set(nonce, authorization);
  } else {
    // 后续逐文件确认不能延长最初预览的生命周期。
    authorization.expiresAt = Math.min(authorization.expiresAt, expiresAt);
  }

  for (const { materialId, metadata, existing } of pendingGrants) {
    if (!existing) authorization.grants.set(materialId, Object.freeze({
      materialId,
      confirmationMode,
      hash: metadata.hash,
      size: metadata.size,
    }));
  }
  return { nonce, expiresAt: authorization.expiresAt, materialCount: materialIds.length, oneTime: true };
}

function sanitizeAuthorizedPayload(payload, materialId, grant) {
  if (!payload || typeof payload !== 'object' || typeof payload.base64 !== 'string') throw new Error('材料载荷格式无效');
  if (!payload.base64 || payload.base64.length > FILE_PAYLOAD_MAX_BASE64_CHARS) throw new Error('材料载荷为空或超过 50MB 限制');
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  if (String(metadata.id || '') !== materialId) throw new Error('材料载荷与授权标识不匹配');
  if (grant.hash && String(metadata.hash || '').toLowerCase() !== grant.hash) throw new Error('材料在确认后发生变化，请重新预览');
  if (grant.size && Number(metadata.size) !== grant.size) throw new Error('材料大小在确认后发生变化，请重新预览');
  const size = Number(metadata.size);
  if (!Number.isInteger(size) || size <= 0 || size > FILE_PAYLOAD_MAX_BYTES) throw new Error('材料大小无效或超过 50MB 限制');
  const name = String(metadata.name || '').replace(/[\u0000-\u001f\u007f/\\]+/g, '_').trim().slice(0, 255);
  const mimeType = /^[\w.+-]+\/[\w.+-]+$/i.test(String(metadata.mimeType || ''))
    ? String(metadata.mimeType).slice(0, 160)
    : 'application/octet-stream';
  const extension = /^[a-z0-9]{1,10}$/i.test(String(metadata.extension || '')) ? String(metadata.extension).toLowerCase() : '';
  return { metadata: { id: materialId, name, mimeType, extension, size }, base64: payload.base64 };
}

async function authorizedMaterialPayload(msg, sender) {
  pruneFileAuthorizations();
  const nonce = String(msg.nonce || '');
  const authorization = fileUploadAuthorizations.get(nonce);
  const materialId = String(msg.id || '');
  if (!authorization || authorization.expiresAt <= Date.now()) throw new Error('文件上传授权不存在或已过期，请重新确认');
  if (!validTabId(sender) || authorization.taskId !== String(msg.taskId || '') || authorization.tabId !== sender.tab.id) throw new Error('文件上传授权与当前任务或标签页不匹配');
  const grant = authorization.grants.get(materialId);
  if (!grant || authorization.consumedMaterialIds.has(materialId)) throw new Error('该材料没有可用的一次性授权，请重新确认');
  // 在任何异步材料读取前原子消费，避免并发消息重放同一授权。
  authorization.grants.delete(materialId);
  authorization.consumedMaterialIds.add(materialId);
  if (!globalThis.JFMaterialLibrary?.getPayload) throw new Error('材料库服务未加载');
  const payload = await globalThis.JFMaterialLibrary.getPayload(materialId);
  return sanitizeAuthorizedPayload(payload, materialId, grant);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = typeof msg?.type === 'string' && msg.type.length <= 80 ? msg.type : '';

  if (LOCAL_MODE_ONLY && /^(?:AI_|JD_MOCK_INTERVIEW)/.test(type)) {
    sendResponse({
      error: '解放第一阶段为保研本地模式，AI 与外部网络请求已禁用。',
      localMode: true,
    });
    return false;
  }

  if (!isTrustedExtensionSender(sender)) {
    sendResponse({ ok: false, error: '拒绝非本扩展消息' });
    return false;
  }

  if (type === 'OPEN_OPTIONS') {
    let opening;
    try {
      const view = msg.view === 'materials' ? 'materials' : '';
      // 只允许固定的本地视图；消息不能提供 URL 或任意 hash。
      opening = view === 'materials'
        ? chrome.tabs.create({ url: chrome.runtime.getURL('options.html#sec-material-library') })
        : typeof chrome.runtime.openOptionsPage === 'function'
          ? chrome.runtime.openOptionsPage()
          : chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    } catch (error) {
      sendResponse({ ok: false, error: messageError(error) });
      return false;
    }
    Promise.resolve(opening).then(
      () => sendResponse({ ok: true }),
      error => sendResponse({ ok: false, error: messageError(error) }),
    );
    return true;
  }

  if (TASK_MESSAGE_TYPES.has(type)) {
    (async () => {
      const store = getTaskStateStore();
      if (type === 'GET_TASK_STATE') {
        const taskState = await store.load();
        if (taskState?.state === 'needs_user_review') revokeTaskFileAuthorizations(taskState.taskId);
        return { ok: true, taskState };
      }
      if (type === 'SET_TASK_STATE') {
        if (!msg.taskState || typeof msg.taskState !== 'object' || Array.isArray(msg.taskState)) {
          throw new Error('SET_TASK_STATE 需要 taskState 对象');
        }
        const taskState = await store.save(msg.taskState);
        if (['needs_user_review', 'paused', 'completed', 'failed', 'cancelled'].includes(taskState.state)) {
          revokeTaskFileAuthorizations(taskState.taskId);
        }
        return { ok: true, taskState };
      }
      // 清除/恢复任务绝不能沿用页面文件授权；授权本身从不写入 storage。
      fileUploadAuthorizations.clear();
      await store.clear();
      return { ok: true, taskState: null };
    })().then(
      response => sendResponse(response),
      error => sendResponse({ ok: false, error: messageError(error) }),
    );
    return true;
  }

  if (type === 'AUTHORIZE_FILE_UPLOADS') {
    try { sendResponse({ ok: true, authorization: authorizeFileUploads(msg, sender) }); }
    catch (error) { sendResponse({ ok: false, error: messageError(error) }); }
    return false;
  }

  if (type === 'REVOKE_FILE_UPLOAD_AUTH') {
    const nonce = String(msg.nonce || '');
    const authorization = fileUploadAuthorizations.get(nonce);
    if (authorization
      && validTabId(sender)
      && authorization.tabId === sender.tab.id
      && authorization.taskId === String(msg.taskId || '')) {
      fileUploadAuthorizations.delete(nonce);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (type === 'MATERIAL_GET_PAYLOAD') {
    authorizedMaterialPayload(msg, sender).then(
      payload => sendResponse({ ok: true, payload }),
      error => sendResponse({ ok: false, error: messageError(error) }),
    );
    return true;
  }

  return false;
});

// ===== AI 填写入口 =====
async function handleAIFill({ provider, apiKey, model, baseUrl, elementDict, resumeFlat, jdText, _rawPrompt }) {
  const prompt = _rawPrompt || buildPrompt(elementDict, resumeFlat, jdText || '');
  // 根据调用场景选择 max_tokens：面试/优化回复较长，普通填表较短
  let maxTokens = MAX_TOKENS.fill;
  if (_rawPrompt) {
    const sysText = _rawPrompt.system || '';
    maxTokens = /面试官|挑剔|刁钻|interview/i.test(sysText)
      ? MAX_TOKENS.interview
      : MAX_TOKENS.optimize;
  }
  if (provider === 'claude') {
    return await callClaude(apiKey, model, prompt, maxTokens);
  } else {
    // openai / openai_compat / 国内厂商（通义、Kimi、DeepSeek 等）全走 OpenAI 兼容格式
    return await callOpenAI(apiKey, model, baseUrl, prompt, maxTokens);
  }
}

// max_tokens 按功能区分：填表简短、优化/面试回复较长
const MAX_TOKENS = {
  fill:      2048,   // AI 填表：JSON token-value 数组，字段值短
  optimize:  4096,   // AI 优化：每个字段优化后内容可能较长
  interview: 3000,   // 模拟面试：5题+点评
  parse:     4096,   // 简历解析：完整 JSON 结构
};

// ===== 截断 JSON 修复（数组被截断时尝试补全）=====
function tryRepairJson(text) {
  const cleaned = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  // 尝试补全被截断的 JSON 数组：找最后一个完整的 } 并补 ]
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace > 0) {
    try { return JSON.parse(cleaned.slice(0, lastBrace + 1) + ']'); } catch {}
  }
  return null;
}

// ===== OpenAI 兼容格式（含国内厂商）=====
async function callOpenAI(apiKey, model, baseUrl, { system, user }, maxTokens = MAX_TOKENS.fill) {
  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const resolvedModel = model || 'gpt-4o-mini';

  const body = {
    model: resolvedModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
    temperature: 0,
    max_tokens: maxTokens,
  };

  // 支持 JSON 模式的厂商（AI 填表、简历解析、AI 优化时开启）
  const supportsJsonMode = !baseUrl || base.includes('openai.com') ||
    base.includes('deepseek.com') || base.includes('dashscope');
  // 模拟面试是自由文本，不用 json_object 模式
  if (supportsJsonMode && maxTokens !== MAX_TOKENS.interview) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000); // 长回复给更多时间

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`API 错误 ${resp.status}: ${err?.error?.message || resp.statusText}`);
    }
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    const finishReason = data.choices?.[0]?.finish_reason;
    // 回复被截断时附加警告
    if (finishReason === 'length') {
      return { text, truncated: true };
    }
    return { text };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('请求超时，请检查网络或选择更快的模型');
    throw e;
  }
}

// ===== Anthropic Claude 格式 =====
async function callClaude(apiKey, model, { system, user }, maxTokens = MAX_TOKENS.fill) {
  const resolvedModel = model || 'claude-3-haiku-20240307';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Claude API 错误 ${resp.status}: ${err?.error?.message || resp.statusText}`);
    }
    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    const stopReason = data.stop_reason;
    if (stopReason === 'max_tokens') {
      return { text, truncated: true };
    }
    return { text };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  }
}

// ===== AI 解析简历文本 =====
async function handleAIParseResume({ provider, apiKey, model, baseUrl, text }) {
  const system = `你是简历解析助手。将用户提供的简历原文解析为结构化 JSON 对象。
字段说明（尽量填充，缺失字段留空字符串）：
personal: { name, gender, birthday, phone, email, wechat, qq, political, ethnicity, nationality, hometown_province, hometown_city, current_city, address, marital, height }
intention: { status, type, available, industry, position, city, salary }
education: [{ school, major, degree, start, end, school_type, gpa, rank, honors, activities, research, thesis }]
internship: [{ company, position, start, end, location, salary, desc }]
work: [{ company, position, start, end, location, salary, desc }]
projects: [{ name, role, start, end, url, team_size, desc }]
skills: { tech, workplace, interests, career_plan, certificates, cover_letter }
languages: [{ language, certificate, exam_date, score, speaking, writing }]
papers: [{ title, journal, author_rank, status, url }]
intro, github, homepage, family

重要原则：desc（工作/实习/项目描述）、intro（自我介绍）、thesis、activities 等所有长文本字段，必须完整照录原文，禁止压缩、改写、总结或省略任何内容。
只输出 JSON 对象，不含 Markdown 代码块或额外说明。`;

  const user = `简历原文：\n${text}`;
  let result;
  if (provider === 'claude') {
    result = await callClaude(apiKey, model, { system, user }, MAX_TOKENS.parse);
  } else {
    result = await callOpenAI(apiKey, model, baseUrl, { system, user }, MAX_TOKENS.parse);
  }
  // strip markdown code fences
  let raw = result.text.trim();
  raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  try {
    return { data: JSON.parse(raw) };
  } catch {
    return { error: 'AI 返回格式错误，请重试' };
  }
}

// ===== 构建 Prompt =====
function buildPrompt(elementDict, resumeFlat, jdText) {
  const hasJD = jdText && jdText.trim().length > 50;

  const system = `你是一个求职表单自动填写助手。根据用户的简历数据，为网页表单字段匹配最合适的值。

规则：
1. 严格输出 JSON 数组，不含任何额外文字、Markdown 代码块或说明。
2. 只输出有把握匹配的字段，跳过验证码、密码、无关字段。
3. select 或 custom_select 类型必须从 options 列表中选取（options 为 null 时可猜测常见选项文本）。
4. 日期保留简历中原有格式（如 2024-09），不自行转换格式。
5. value 字段已有内容时可跳过（避免覆盖用户已填信息）。
6. 输出格式：[{"token":"rf_0","value":"填写值"}, ...]${hasJD ? `
7. 技能、自我介绍、工作描述、项目描述等开放性文本字段，请结合 JD 关键词定制内容，突出与 JD 匹配的技能和经历。
8. 内容必须基于候选人简历事实，不可捏造经历。` : ''}`;

  const jdSection = hasJD ? `\n职位描述 (JD)：\n${jdText.slice(0, 3000)}\n` : '';

  const user = `简历数据：
${JSON.stringify(resumeFlat, null, 2)}
${jdSection}
表单字段列表（共 ${elementDict.length} 个）：
${JSON.stringify(elementDict, null, 2)}

请为每个可匹配字段返回填写值，只输出 JSON 数组。`;

  return { system, user };
}

// ===== 模拟面试 Prompt =====
async function handleMockInterview({ provider, apiKey, model, baseUrl, jdText, resumeFlat }) {
  const system = `你是一位资深技术面试官。根据候选人的简历和目标职位描述，生成 8 道针对性面试题（含参考答案）。
覆盖：技术能力考察（3题）、项目经验深挖（2题）、行为面试 STAR（2题）、开放性问题（1题）。
严格输出 JSON 数组，不含任何额外文字。
格式：[{"q":"问题","a":"参考答案（结合候选人简历定制）","type":"技术|项目|行为|开放"}]`;

  const user = `职位描述：\n${(jdText || '').slice(0, 3000)}\n\n候选人简历摘要：\n${JSON.stringify(resumeFlat, null, 2)}`;

  const prompt = { system, user };
  if (provider === 'claude') {
    return await callClaude(apiKey, model, prompt, MAX_TOKENS.interview);
  } else {
    return await callOpenAI(apiKey, model, baseUrl, prompt, MAX_TOKENS.interview);
  }
}
