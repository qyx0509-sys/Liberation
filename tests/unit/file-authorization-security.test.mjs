import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(testDirectory, '..', '..');
const backgroundSource = await readFile(resolve(rootDirectory, 'background.js'), 'utf8');
const uploadSource = await readFile(resolve(rootDirectory, 'src', 'core', 'file-upload-engine.js'), 'utf8');
const autofillSource = await readFile(resolve(rootDirectory, 'src', 'core', 'autofill-engine.js'), 'utf8');
const FileDetector = require(resolve(rootDirectory, 'src', 'core', 'file-field-detector.js'));
const GenericAdapter = require(resolve(rootDirectory, 'src', 'adapters', 'generic-adapter.js'));
const TaskState = require(resolve(rootDirectory, 'src', 'core', 'task-state.js'));

function loadBackground() {
  let listener;
  let payloadReads = 0;
  const openedUrls = [];
  const hash = 'a'.repeat(64);
  const context = {
    AbortController,
    URL,
    TextEncoder,
    clearTimeout,
    setTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => { throw new Error('外部网络不应被调用'); },
    JFMaterialLibrary: {
      async getPayload(id) {
        payloadReads += 1;
        return {
          metadata: {
            id,
            name: '仅供授权测试.pdf',
            hash,
            size: 4,
            mimeType: 'application/pdf',
            extension: 'pdf',
            aliases: ['不得发送到页面'],
            relatedResumePath: 'personal.private',
          },
          base64: btoa('ABCD'),
        };
      },
    },
    chrome: {
      runtime: {
        id: 'extension-id',
        getURL: path => `chrome-extension://extension-id/${path}`,
        onMessage: { addListener(callback) { listener = callback; } },
      },
      tabs: { create(options) { openedUrls.push(options?.url || ''); } },
    },
  };
  vm.runInNewContext(backgroundSource, context, { filename: 'background.js' });
  const send = (message, tabId = 7) => new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => reject(new Error(`message timeout: ${message.type}`)), 2_000);
    const sender = { id: 'extension-id', tab: { id: tabId }, frameId: 0 };
    listener(message, sender, response => {
      clearTimeout(timer);
      resolveResponse(response);
    });
  });
  return { hash, openedUrls, payloadReads: () => payloadReads, send };
}

test('后台文件 grant 精确绑定任务/nonce/tab/material，并在读取前一次性消费', async () => {
  const background = loadBackground();
  const taskId = 'task:secure-upload';
  const nonce = 'run_12345678901234567890';
  const materialId = 'file_alpha1234';
  const expiresAt = Date.now() + 60_000;
  const authorization = await background.send({
    type: 'AUTHORIZE_FILE_UPLOADS',
    taskId,
    nonce,
    userConfirmed: true,
    confirmationMode: 'preview-batch',
    materialIds: [materialId],
    previewedMaterialIds: [materialId],
    materials: [{ id: materialId, hash: background.hash, size: 4 }],
    expiresAt,
  });
  assert.equal(authorization.ok, true);
  assert.equal(authorization.authorization.oneTime, true);

  const wrongTab = await background.send({ type: 'MATERIAL_GET_PAYLOAD', id: materialId, taskId, nonce }, 8);
  assert.equal(wrongTab.ok, false);
  assert.match(wrongTab.error, /标签页|任务/);
  assert.equal(background.payloadReads(), 0);

  const first = await background.send({ type: 'MATERIAL_GET_PAYLOAD', id: materialId, taskId, nonce });
  assert.equal(first.ok, true);
  assert.equal(first.payload.metadata.id, materialId);
  assert.deepEqual(Object.keys(first.payload.metadata).sort(), ['extension', 'id', 'mimeType', 'name', 'size'].sort());
  assert.equal(background.payloadReads(), 1);

  const replay = await background.send({ type: 'MATERIAL_GET_PAYLOAD', id: materialId, taskId, nonce });
  assert.equal(replay.ok, false);
  assert.match(replay.error, /一次性授权|重新确认/);
  assert.equal(background.payloadReads(), 1, '重放必须在读取 IndexedDB 前被拒绝');

  const regrant = await background.send({
    type: 'AUTHORIZE_FILE_UPLOADS', taskId, nonce, userConfirmed: true,
    confirmationMode: 'per-file', materialIds: [materialId], confirmedMaterialId: materialId,
    materials: [{ id: materialId, hash: background.hash, size: 4 }], expiresAt,
  });
  assert.equal(regrant.ok, false, '同一任务 nonce 中已消费材料不能重新签发');
});

test('逐文件策略拒绝批量材料和缺失的预览范围证明', async () => {
  const background = loadBackground();
  const expiresAt = Date.now() + 60_000;
  const base = { taskId: 'task:ask-every-time', nonce: 'run_abcdefghijklmnop1234', userConfirmed: true, expiresAt };
  const ids = ['file_first1234', 'file_second1234'];
  const batchWithoutPreview = await background.send({
    ...base, type: 'AUTHORIZE_FILE_UPLOADS', confirmationMode: 'preview-batch', materialIds: ids,
  });
  assert.equal(batchWithoutPreview.ok, false);

  const invalidPerFile = await background.send({
    ...base, type: 'AUTHORIZE_FILE_UPLOADS', confirmationMode: 'per-file', materialIds: ids,
    confirmedMaterialId: ids[0],
  });
  assert.equal(invalidPerFile.ok, false);

  const validPerFile = await background.send({
    ...base, type: 'AUTHORIZE_FILE_UPLOADS', confirmationMode: 'per-file', materialIds: [ids[0]],
    confirmedMaterialId: ids[0], materials: [{ id: ids[0], hash: background.hash, size: 4 }],
  });
  assert.equal(validPerFile.ok, true);

  const rotatedNonce = await background.send({
    ...base, nonce: 'run_differentnonce123456', type: 'AUTHORIZE_FILE_UPLOADS', confirmationMode: 'per-file',
    materialIds: [ids[1]], confirmedMaterialId: ids[1],
  });
  assert.equal(rotatedNonce.ok, false, '同一 taskId/tab 不能用轮换 nonce 扩张授权');
});

test('OPEN_OPTIONS 只接受固定 materials 视图，不接受消息提供的 URL/hash', async () => {
  const background = loadBackground();
  assert.equal((await background.send({ type: 'OPEN_OPTIONS', view: 'materials', url: 'https://evil.test/' })).ok, true);
  assert.equal((await background.send({ type: 'OPEN_OPTIONS', view: '../../evil#token=secret' })).ok, true);
  assert.deepEqual(background.openedUrls, [
    'chrome-extension://extension-id/options.html#sec-material-library',
    'chrome-extension://extension-id/options.html',
  ]);
});

function loadUploadEngine() {
  const sent = [];
  class FakeFile {
    constructor(parts, name, options = {}) {
      this.name = name;
      this.size = parts.reduce((sum, part) => sum + Number(part.byteLength || part.length || 0), 0);
      this.type = options.type || '';
      this.lastModified = options.lastModified || 0;
    }
  }
  class FakeDataTransfer {
    constructor() {
      this._files = [];
      this.items = { add: file => this._files.push(file) };
    }
    get files() { return this._files; }
  }
  class FakeEvent {
    constructor(type) { this.type = type; }
  }
  class FakeInput {
    constructor(view) {
      this.tagName = 'INPUT';
      this.type = 'file';
      this.isConnected = true;
      this.disabled = false;
      this.readOnly = false;
      this.events = [];
      this.ownerDocument = { defaultView: view };
    }
    dispatchEvent(event) { this.events.push(event.type); return true; }
    closest() { return null; }
  }
  Object.defineProperty(FakeInput.prototype, 'files', {
    configurable: true,
    get() { return this._files || []; },
    set(value) { this._files = [...value]; },
  });
  const view = { DataTransfer: FakeDataTransfer, Event: FakeEvent, File: FakeFile, HTMLInputElement: FakeInput, atob };
  const context = {
    atob,
    clearTimeout,
    setTimeout,
    DOMException,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sent.push(message);
          if (message.type === 'AUTHORIZE_FILE_UPLOADS') {
            callback({ ok: true, authorization: { oneTime: true } });
          } else {
            callback({
              ok: true,
              payload: {
                metadata: { id: message.id, name: '13800138000-张三成绩单.pdf', size: 4, extension: 'pdf', mimeType: 'application/pdf' },
                base64: btoa('ABCD'),
              },
            });
          }
        },
      },
    },
  };
  vm.runInNewContext(uploadSource, context, { filename: 'file-upload-engine.js' });
  return { engine: context.JFFileUploadEngine, FakeInput, sent, view };
}

test('文件执行器没有 payload 旁路；ask-every-time 先申请单材料 grant 再读取一次', async () => {
  const { engine, FakeInput, sent, view } = loadUploadEngine();
  const input = new FakeInput(view);
  const material = { id: 'file_explicit1234', name: '用户材料.pdf', extension: 'pdf', size: 4, hash: 'b'.repeat(64) };
  const match = {
    status: 'MATCH',
    material,
    path: 'files.transcript',
    field: { element: input, wrapper: { isConnected: true }, hiddenInput: false, visibleWrapper: true, restrictions: { extensions: ['pdf'], maxBytes: 1024, maxCount: 1 } },
  };
  const authorization = {
    taskId: 'task:upload-engine', nonce: 'run_1234567890abcdef1234', userConfirmed: true,
    filePolicy: 'ask-every-time', expiresAt: Date.now() + 60_000,
  };
  const needsConfirmation = await engine.upload(match, { authorization });
  assert.equal(needsConfirmation.status, engine.STATUS.NEEDS_CONFIRMATION);
  assert.equal(sent.length, 0);

  const result = await engine.upload(match, { authorization, perFileConfirmed: true, timeoutMs: 2_000 });
  assert.equal(result.status, engine.STATUS.SUCCESS);
  assert.deepEqual(sent.map(message => message.type), ['AUTHORIZE_FILE_UPLOADS', 'MATERIAL_GET_PAYLOAD']);
  assert.deepEqual(input.events, ['input', 'change']);
  assert.equal(Object.hasOwn(result, 'fileName'), false);
  assert.equal(Object.hasOwn(result, 'path'), false);
  assert.equal(Object.hasOwn(result, 'materialId'), false);
  assert.doesNotMatch(JSON.stringify(result), /13800138000|张三成绩单/);
  assert.doesNotMatch(uploadSource, /options\.payload|assignFileList\s*[,}]/);
});

test('diagnostic 防御性移除值/真实文件名/路径并脱敏联系方式和身份证', () => {
  const fieldDiagnostic = FileDetector.toDiagnostic({
    index: 0,
    labelText: '联系 13800138000 user@example.com，文件 张三成绩单.pdf',
    name: 'C:\\fakepath\\张三成绩单.pdf',
    id: '11010519491231002X',
    accept: '.pdf',
    multiple: false,
    hiddenInput: true,
    visibleWrapper: true,
    restrictions: { extensions: ['pdf'], maxBytes: 1024, maxCount: 1 },
    recommendations: [{ path: 'files.transcript', score: 99 }],
  });
  const hardened = GenericAdapter.sanitizeDiagnosticValue({
    field: fieldDiagnostic,
    value: '网页真实内容',
    fileName: '张三成绩单.pdf',
    buttonText: '联系 user@example.com 或 13800138000',
  });
  const serialized = JSON.stringify(hardened);
  assert.doesNotMatch(serialized, /网页真实内容|张三成绩单|fakepath|13800138000|user@example\.com|11010519491231002X/);
  assert.equal(Object.hasOwn(hardened, 'value'), false);
  assert.equal(Object.hasOwn(hardened, 'fileName'), false);
  assert.match(serialized, /redacted-email|redacted-phone|redacted-id|redacted-path|redacted-filename/);
  assert.equal(FileDetector.sanitizeDiagnosticText('已选择：张 三 成绩单.pdf（1MB）'), '<redacted-filename>');
  assert.equal(FileDetector.sanitizeDiagnosticText('C:\\Users\\张 三\\成绩单.pdf'), '<redacted-path>');
  assert.equal(FileDetector.sanitizeDiagnosticText('.pdf,.jpg'), '.pdf,.jpg', 'accept 扩展名列表不是用户真实文件名');
});

test('诊断字段关联只导出 matchedJsonPath/score/status/reason，不导出 matcher value', () => {
  const attached = GenericAdapter.attachFieldMatchDiagnostics(
    [{ detectorId: 'field_0', labelText: '姓名' }],
    [{ matchedPath: 'personal.name', score: 96, status: 'MATCHED', reason: '语义匹配', value: '绝不能导出的真实姓名' }],
  );
  assert.deepEqual(attached[0], {
    detectorId: 'field_0',
    labelText: '姓名',
    matchedJsonPath: 'personal.name',
    score: 96,
    status: 'MATCHED',
    reason: '语义匹配',
  });
  assert.doesNotMatch(JSON.stringify(attached), /绝不能导出的真实姓名|"value"/);
});

test('恢复 paused 任务也必须转 needs_user_review，授权字段大小写变体不可序列化', () => {
  const task = TaskState.createTask({ queue: [{ sectionId: 'awards' }], state: TaskState.TASK_STATES.PAUSED, paused: true });
  const restored = TaskState.normalizeTaskState(task, { forRestore: true });
  assert.equal(restored.state, TaskState.TASK_STATES.NEEDS_USER_REVIEW);
  assert.equal(restored.paused, true);
  assert.throws(() => TaskState.cloneSerializable({ Authorization: 'secret' }), /禁止持久化字段/);
  assert.throws(() => TaskState.cloneSerializable({ Nonce: 'run_secret' }), /禁止持久化字段/);
});

test('ask-every-time 调用链逐文件请求，且不再把已可靠匹配当作免确认条件', () => {
  assert.match(autofillSource, /match\.status !== 'MATCH' \|\| askEveryTime/);
  assert.match(autofillSource, /perFileConfirmed/);
  assert.match(autofillSource, /requestFileConfirmation/);
  assert.match(autofillSource, /confirmationMode:\s*'preview-batch'/);
});
