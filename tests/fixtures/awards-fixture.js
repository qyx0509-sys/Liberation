(function initializeAwardsFixture() {
  'use strict';

  const ALLOWED_COLUMNS = ['time', 'location', 'content'];
  const COLUMN_LABELS = {
    time: '时间',
    location: '地点',
    content: '内容',
  };
  const DEFAULT_AWARD = {
    time: '2025-7',
    location: '青岛',
    content: '中国大学生高分子材料创新创业大赛国家级奖项',
  };
  const SECOND_AWARD = {
    time: '2025-7',
    location: '青岛',
    content: '全国大学生高分子材料实验实践大赛国家级奖项',
  };
  const EXISTING_AWARD = {
    time: '2024-6',
    location: '北京',
    content: '网页原有奖励（默认不得覆盖）',
  };

  const params = new URLSearchParams(location.search);
  const requestedColumns = (params.get('order') || ALLOWED_COLUMNS.join(','))
    .split(',')
    .map(value => value.trim())
    .filter(value => ALLOWED_COLUMNS.includes(value));
  const columns = requestedColumns.length === ALLOWED_COLUMNS.length &&
    new Set(requestedColumns).size === ALLOWED_COLUMNS.length
    ? requestedColumns
    : ALLOWED_COLUMNS;
  const initialRows = clampInteger(params.get('rows'), 1, 20, 1);
  const renderDelayMs = clampInteger(params.get('delay'), 0, 3000, 80);
  const addMode = ['normal', 'missing', 'noop'].includes(params.get('add'))
    ? params.get('add')
    : 'normal';
  const existingMode = ['none', 'full', 'partial', 'duplicate'].includes(params.get('existing'))
    ? params.get('existing')
    : 'none';

  const state = {
    config: { columns: [...columns], initialRows, renderDelayMs, addMode, existingMode },
    rows: [],
    events: [],
    actions: {
      addClicks: 0,
      deleteClicks: 0,
      previousClicks: 0,
      nextClicks: 0,
      finalSubmitClicks: 0,
    },
    mutationObservers: {
      created: 0,
      observeCalls: 0,
      callbacks: 0,
    },
    attemptedNetworkRequests: [],
    ready: false,
  };

  const body = document.getElementById('awards-body');
  const head = document.getElementById('awards-head-row');
  const actionHost = document.getElementById('awards-actions');
  const status = document.getElementById('fixture-status');

  installMutationObserverInstrumentation();
  renderHeader();
  renderAddButton();
  wireSensitiveButtons();
  installNetworkTripwires();

  const readyPromise = delay(renderDelayMs).then(() => {
    for (let index = 0; index < initialRows; index += 1) {
      appendRow(initialValueFor(index));
    }
    state.ready = true;
    document.documentElement.dataset.fixtureReady = 'true';
    status.textContent = `夹具已就绪：${state.rows.length} 行，新增模式 ${addMode}`;
    document.dispatchEvent(new CustomEvent('awards-fixture-ready'));
    return snapshot();
  });

  window.__awardsFixture = Object.freeze({
    defaultAwards: Object.freeze([
      Object.freeze({ ...DEFAULT_AWARD }),
      Object.freeze({ ...SECOND_AWARD }),
    ]),
    ready: readyPromise,
    getSnapshot: snapshot,
    getRows: () => state.rows.map(row => ({ ...row.values })),
    getActions: () => ({ ...state.actions }),
    getEvents: () => state.events.map(event => ({ ...event })),
    getAttemptedNetworkRequests: () => [...state.attemptedNetworkRequests],
  });

  function clampInteger(raw, min, max, fallback) {
    const parsed = Number.parseInt(raw || '', 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }

  function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function renderHeader() {
    for (const column of columns) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = COLUMN_LABELS[column];
      head.appendChild(th);
    }
    const operation = document.createElement('th');
    operation.scope = 'col';
    operation.textContent = '操作';
    head.appendChild(operation);
  }

  function renderAddButton() {
    if (addMode === 'missing') return;
    const button = document.createElement('button');
    button.id = 'add-award-row';
    button.type = 'button';
    button.textContent = '新增一行';
    button.addEventListener('click', async () => {
      state.actions.addClicks += 1;
      if (addMode === 'noop') return;
      button.dataset.fixturePending = 'true';
      await delay(renderDelayMs);
      appendRow({});
      delete button.dataset.fixturePending;
    });
    actionHost.appendChild(button);
  }

  function initialValueFor(index) {
    if (index !== 0) return {};
    if (existingMode === 'full') return EXISTING_AWARD;
    if (existingMode === 'partial') return { time: EXISTING_AWARD.time };
    if (existingMode === 'duplicate') return DEFAULT_AWARD;
    return {};
  }

  function appendRow(initialValues) {
    const rowIndex = state.rows.length;
    const record = {
      index: rowIndex,
      values: {
        time: String(initialValues.time || ''),
        location: String(initialValues.location || ''),
        content: String(initialValues.content || ''),
      },
      elements: {},
      directSetterCalls: { time: 0, location: 0, content: 0 },
      eventCounts: {},
    };
    state.rows.push(record);

    const tr = document.createElement('tr');
    for (const column of columns) {
      const td = document.createElement('td');
      const input = document.createElement(column === 'content' ? 'textarea' : 'input');
      if (input instanceof HTMLInputElement) input.type = 'text';
      input.name = `opaque_${rowIndex}_${columns.indexOf(column)}`;
      input.placeholder = '请输入';
      input.autocomplete = 'off';
      input.value = record.values[column];
      installControlledValueTracker(input, record, column);
      installFrameworkBinding(input, record, column);
      record.elements[column] = input;
      td.appendChild(input);
      tr.appendChild(td);
    }

    const operation = document.createElement('td');
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-award-row';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => {
      state.actions.deleteClicks += 1;
      tr.remove();
    });
    operation.appendChild(deleteButton);
    tr.appendChild(operation);
    body.appendChild(tr);
    return tr;
  }

  function installFrameworkBinding(element, record, field) {
    const trackedEvents = ['focus', 'pointerdown', 'mousedown', 'input', 'change', 'blur'];
    for (const type of trackedEvents) {
      element.addEventListener(type, event => {
        record.eventCounts[type] = (record.eventCounts[type] || 0) + 1;
        state.events.push({
          row: record.index,
          field,
          type,
          bubbles: event.bubbles,
        });
        if (type === 'input' || type === 'change') {
          // 模拟 React/Vue/Angular 受控状态：只有输入事件会同步模型。
          record.values[field] = element.value;
        }
      });
    }
  }

  function installControlledValueTracker(element, record, field) {
    const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value');
    if (!descriptor?.get || !descriptor?.set) return;
    Object.defineProperty(element, 'value', {
      configurable: true,
      enumerable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        // React 的 value tracker 会区分实例赋值与原生原型 setter；测试要求后者。
        record.directSetterCalls[field] += 1;
        descriptor.set.call(this, value);
      },
    });
  }

  function installMutationObserverInstrumentation() {
    const NativeMutationObserver = window.MutationObserver;
    if (typeof NativeMutationObserver !== 'function') return;
    window.MutationObserver = class FixtureMutationObserver extends NativeMutationObserver {
      constructor(callback) {
        state.mutationObservers.created += 1;
        super((records, observer) => {
          state.mutationObservers.callbacks += 1;
          callback(records, observer);
        });
      }

      observe(target, options) {
        state.mutationObservers.observeCalls += 1;
        return super.observe(target, options);
      }
    };
  }

  function wireSensitiveButtons() {
    document.getElementById('previous-button').addEventListener('click', () => {
      state.actions.previousClicks += 1;
    });
    document.getElementById('next-button').addEventListener('click', () => {
      state.actions.nextClicks += 1;
    });
    document.getElementById('final-submit-button').addEventListener('click', () => {
      state.actions.finalSubmitClicks += 1;
    });
  }

  function installNetworkTripwires() {
    const reject = (kind, url) => {
      state.attemptedNetworkRequests.push({ kind, url: String(url || '') });
      throw new Error(`测试夹具禁止网络请求：${kind}`);
    };

    window.fetch = (...args) => Promise.reject(captureNetworkError('fetch', args[0]));
    navigator.sendBeacon = url => reject('sendBeacon', url);

    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function blockedOpen(method, url) {
      reject(`XMLHttpRequest:${method}`, url);
      return open.apply(this, arguments);
    };

    if ('WebSocket' in window) {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = function BlockedWebSocket(url) {
        reject('WebSocket', url);
        return new NativeWebSocket(url);
      };
      window.WebSocket.prototype = NativeWebSocket.prototype;
    }
  }

  function captureNetworkError(kind, url) {
    state.attemptedNetworkRequests.push({ kind, url: String(url || '') });
    return new Error(`测试夹具禁止网络请求：${kind}`);
  }

  function snapshot() {
    return {
      config: { ...state.config, columns: [...state.config.columns] },
      rows: state.rows.map(row => ({
        index: row.index,
        values: { ...row.values },
        domValues: Object.fromEntries(
          ALLOWED_COLUMNS.map(field => [field, String(row.elements[field]?.value || '')]),
        ),
        directSetterCalls: { ...row.directSetterCalls },
        eventCounts: { ...row.eventCounts },
      })),
      actions: { ...state.actions },
      mutationObservers: { ...state.mutationObservers },
      events: state.events.map(event => ({ ...event })),
      attemptedNetworkRequests: [...state.attemptedNetworkRequests],
      ready: state.ready,
      unrelated: {
        search: document.getElementById('unrelated-search').value,
        phone: document.getElementById('other-phone').value,
        reason: document.getElementById('other-reason').value,
      },
    };
  }
})();
