import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export async function launchHeadlessBrowser(options = {}) {
  if (typeof options === 'string') options = { initialUrl: options };
  const executable = await findBrowserExecutable({ preferExtensionLoader: Boolean(options.preferExtensionLoader) });
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'jiefang-wizard-e2e-'));
  const child = spawn(executable, [
    ...(process.env.JF_E2E_HEADED
      ? [
          '--start-minimized',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ]
      : ['--headless=new', '--disable-gpu']),
    // Chromium 152 on Windows can still initialize Dawn/Graphite in headless
    // mode and lose its own persistent-cache file race. The upstream switch
    // makes the test renderer deterministic without changing extension code.
    '--disable-skia-graphite',
    '--disable-software-rasterizer',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-features=OptimizationHints,MediaRouter,AutofillServerCommunication',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-proxy-server',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDirectory}`,
    ...(options.browserArgs || []),
    options.initialUrl || 'about:blank',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  try {
    const { url: browserWebSocketUrl, output: initialBrowserOutput } = await waitForDevToolsUrl(child, 15_000);
    const endpoint = new URL(browserWebSocketUrl);
    const debuggerHttpBase = `http://${endpoint.hostname}:${endpoint.port}`;
    const targets = await waitForTargets(debuggerHttpBase);
    const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!page) throw new Error('未找到浏览器页面调试目标');
    const cdp = await CdpConnection.connect(page.webSocketDebuggerUrl);
    let browserOutput = initialBrowserOutput;
    const appendBrowserOutput = chunk => { browserOutput += chunk.toString(); };
    child.stdout.on('data', appendBrowserOutput);
    child.stderr.on('data', appendBrowserOutput);
    const externalRequests = [];
    const consoleMessages = [];

    cdp.on('Network.requestWillBeSent', ({ request }) => {
      if (/^https?:/i.test(request?.url || '')) externalRequests.push(request.url);
    });
    cdp.on('Runtime.consoleAPICalled', event => {
      if (!['warning', 'error'].includes(event.type)) return;
      consoleMessages.push({
        source: 'console',
        level: event.type,
        text: (event.args || []).map(arg => arg.value ?? arg.description ?? '').join(' '),
      });
    });
    cdp.on('Runtime.exceptionThrown', event => {
      consoleMessages.push({
        source: 'exception',
        level: 'error',
        text: event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'Uncaught exception',
      });
    });
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (!['warning', 'error'].includes(entry?.level)) return;
      consoleMessages.push({ source: entry.source || 'log', level: entry.level, text: entry.text || '' });
    });

    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Network.enable');
    await cdp.call('Log.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: Number(options.width) || 1440,
      height: Number(options.height) || 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    return {
      cdp,
      externalRequests,
      consoleMessages,
      debuggerHttpBase,
      getBrowserOutput() {
        return browserOutput;
      },
      async listTargets() {
        return waitForTargets(debuggerHttpBase);
      },
      async connectTarget(target) {
        if (!target?.webSocketDebuggerUrl) throw new Error('目标不支持 CDP 连接');
        return CdpConnection.connect(target.webSocketDebuggerUrl);
      },
      resetSignals() {
        externalRequests.length = 0;
        consoleMessages.length = 0;
      },
      async close() {
        cdp.close();
        await terminateBrowser(child);
        await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      },
    };
  } catch (error) {
    await terminateBrowser(child);
    await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw error;
  }
}

export async function evaluate(cdp, expression, options = {}) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: Boolean(options.awaitPromise),
    returnByValue: options.returnByValue !== false,
    userGesture: Boolean(options.userGesture),
  }, options.timeoutMs || 10_000);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '页面脚本执行失败');
  }
  return result.result?.value;
}

export async function waitFor(predicate, timeoutMs, description, intervalMs = 40) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${description}${lastError ? `：${lastError.message}` : ''}`);
}

export async function clickPoint(cdp, x, y) {
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

export async function dragPointer(cdp, from, to, steps = 5) {
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
      button: 'left',
      buttons: 1,
    });
  }
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
}

async function findBrowserExecutable(options = {}) {
  const windowsChrome = [
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  const windowsEdge = [
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  const candidates = process.platform === 'win32'
    ? [
        process.env.JF_BROWSER_PATH,
        ...(options.preferExtensionLoader ? windowsEdge : windowsChrome),
        ...(options.preferExtensionLoader ? windowsChrome : windowsEdge),
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 继续检查已知浏览器安装目录。
    }
  }
  throw new Error('未找到可用于测试的 Chrome 或 Edge 浏览器');
}

async function terminateBrowser(child) {
  if (child.killed || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3_000))]);
}

function waitForDevToolsUrl(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`浏览器调试端口启动超时：${output.slice(-500)}`)), timeoutMs);
    const consume = chunk => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve({ url: match[1], output });
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      if (output.includes('DevTools listening on')) return;
      clearTimeout(timer);
      reject(new Error(`浏览器提前退出（${code}）：${output.slice(-500)}`));
    });
  });
}

async function waitForTargets(httpBase) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${httpBase}/json/list`);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`无法读取浏览器调试目标：${lastError?.message || '未知错误'}`);
}

class CdpConnection {
  static async connect(url) {
    const connection = new CdpConnection(url);
    await connection.opened;
    return connection;
  }

  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => this.handleMessage(event.data));
    this.socket.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('浏览器调试连接已关闭'));
      }
      this.pending.clear();
    });
  }

  call(method, params = {}, timeoutMs = 10_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`浏览器调试命令超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket.close();
  }

  handleMessage(data) {
    const message = JSON.parse(String(data));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
  }
}
