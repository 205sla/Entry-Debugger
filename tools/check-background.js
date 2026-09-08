'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const extensionDir = path.resolve(__dirname, '..', 'entry-debugger-extension');
const clone = (value) => JSON.parse(JSON.stringify(value));

async function main() {
  let handler;
  let stored = {};
  const editors = new Map([[11, null], [33, null]]);
  let activeTabId = 11;
  let missingReceiverCount = 0;
  const sandbox = {
    chrome: {
      storage: {
        local: {
          get: (defaults, callback) => queueMicrotask(() => callback({ ...defaults, ...stored })),
          set: (settings, callback) => {
            stored = { ...stored, ...clone(settings) };
            if (callback) queueMicrotask(callback);
          }
        }
      },
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: (listener) => { handler = listener; } }
      },
      tabs: {
        query: (query, callback) => {
          // storage 권한만 있는 실제 Chrome처럼 URL/제목은 노출하지 않는다.
          // URL 필터에는 일치하는 탭이 없다. 중간 탭에는 content script도 없다.
          const tabs = query.url ? [] : query.active
            ? [{ id: activeTabId }]
            : [{ id: 11 }, { id: 22 }, { id: 33 }];
          queueMicrotask(() => callback(tabs));
        },
        sendMessage: async (id, message) => {
          if (!editors.has(id)) {
            missingReceiverCount += 1;
            throw new Error('Could not establish connection. Receiving end does not exist.');
          }
          if (message.type === 'APPLY_SETTINGS') {
            editors.set(id, clone(message.settings));
            return { success: true };
          }
          assert.strictEqual(message.type, 'PING_STATUS');
          return { onEntryPage: true, settings: editors.get(id) };
        }
      }
    }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  sandbox.importScripts = (file) => {
    assert.strictEqual(file, 'settings.js');
    vm.runInContext(fs.readFileSync(path.join(extensionDir, file), 'utf8'), sandbox);
  };
  vm.runInContext(fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8'), sandbox);

  function request(message) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No response: ' + message.type)), 1000);
      try {
        const asynchronous = handler(message, {}, (response) => {
          clearTimeout(timeout);
          resolve(clone(response));
        });
        assert.strictEqual(asynchronous, true, 'Keep the message response channel open');
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  function assertEditors(expected) {
    for (const [id, settings] of editors) {
      assert.deepStrictEqual(settings, expected, 'Settings did not reach editor ' + id);
    }
  }

  const defaults = await request({ type: 'GET_STATE' });
  for (const enabled of [false, true, false, true]) {
    const response = await request({
      type: 'SET_SETTINGS',
      settings: { ...defaults, debuggerTabEnabled: enabled }
    });
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.settings.debuggerTabEnabled, enabled);
    assertEditors(response.settings);
    assert.deepStrictEqual(await request({ type: 'GET_STATE' }), response.settings);
  }

  // 저장값이 바뀌지 않는 명시적 재전송도 열린 편집기에 같은 설정을 전달한다.
  editors.set(11, null);
  assert.strictEqual((await request({ type: 'BROADCAST_SETTINGS' })).success, true);
  assertEditors(await request({ type: 'GET_STATE' }));

  for (const enabled of [false, true]) {
    const response = await request({ type: 'SET_STATE', enabled });
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.settings.enabled, enabled);
    assert.strictEqual(response.settings.debuggerTabEnabled, enabled);
    assertEditors(response.settings);
  }
  assert(missingReceiverCount > 0, 'Exercise missing content-script receivers');
  assert.strictEqual((await request({ type: 'GET_PAGE_STATUS' })).onEntryPage, true);
  activeTabId = 22;
  assert.strictEqual((await request({ type: 'GET_PAGE_STATUS' })).onEntryPage, false);
  console.log('[check-background] OK');
}

main().catch((error) => {
  console.error('[check-background] ' + error.message);
  process.exitCode = 1;
});
