'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
// 실제 제출용 manifest와 리소스를 그대로 로드해 설정 전달을 검사한다.
const extensionDir = path.join(rootDir, 'dist', 'entry-debugger-extension-release');
const entryUrl = process.env.ENTRY_DEBUGGER_SMOKE_URL ||
  'https://playentry.org/ws/590e746f150c3963bf86078e';

function resolvePlaywright() {
  for (const candidate of [rootDir, path.resolve(rootDir, '..', '..', 'apps', 'MYentry-game')]) {
    try {
      return require(require.resolve('playwright', { paths: [candidate] }));
    } catch (e) {}
  }
  throw new Error('Playwright를 찾을 수 없습니다. apps/MYentry-game의 node_modules를 확인하세요.');
}

async function readEditors(worker) {
  return worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const results = await Promise.all(tabs.map(async (tab) => {
      const status = await chrome.tabs.sendMessage(tab.id, { type: 'PING_STATUS' })
        .catch(() => null);
      return status && status.onEntryPage ? { id: tab.id, settings: status.settings } : null;
    }));
    return results.filter(Boolean);
  });
}

async function waitForEditors(worker, enabled) {
  const deadline = Date.now() + 10000;
  let editors;
  do {
    editors = await readEditors(worker);
    if (editors.length === 2 &&
        editors.every((editor) => editor.settings.debuggerTabEnabled === enabled)) return editors;
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  } while (Date.now() < deadline);
  throw new Error('Popup setting did not reach both editors: ' + JSON.stringify({ enabled, editors }));
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  assert.deepStrictEqual(manifest.permissions, ['storage']);
  assert.strictEqual(manifest.host_permissions, undefined);
  const { chromium } = resolvePlaywright();
  const executablePath = process.env.ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-settings-sync-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      ...(executablePath ? { executablePath } : {}),
      headless: false,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--disable-extensions-except=' + extensionDir, '--load-extension=' + extensionDir]
    });
    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', { timeout: 15000 });
    const pages = [];
    for (let index = 0; index < 2; index++) {
      const page = await context.newPage();
      await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('.propertyTabdebugging', { timeout: 60000 });
      pages.push(page);
    }
    await waitForEditors(worker, true);
    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + new URL(worker.url()).hostname + '/popup.html');
    await popup.waitForFunction(() => document.querySelector('#toggle-debugger-tab').checked);
    const transitions = [];
    for (const enabled of [false, true, false, true]) {
      // 실제 팝업 change → background → 열린 content script 경로를 사용한다.
      // storage를 직접 seed하거나 APPLY_SETTINGS를 테스트에서 주입하지 않는다.
      await popup.locator('.toggle-switch').click();
      await popup.waitForFunction((expected) =>
        document.querySelector('#toggle-debugger-tab').checked === expected, enabled);
      const editors = await waitForEditors(worker, enabled);
      const stored = await worker.evaluate(() => chrome.storage.local.get('debuggerTabEnabled'));
      assert.strictEqual(stored.debuggerTabEnabled, enabled);
      for (const page of pages) {
        await page.waitForFunction((expected) => {
          const count = expected ? 1 : 0;
          return document.querySelectorAll('.propertyTabdebugging').length === count &&
            document.querySelectorAll('#ed-debugger-panel').length === count;
        }, enabled, { timeout: 15000 });
      }
      transitions.push({ enabled, editorCount: editors.length, uiCountPerEditor: enabled ? 1 : 0 });
    }
    console.log(JSON.stringify({ version: manifest.version, entryUrl, transitions }, null, 2));
  } finally {
    if (context) await context.close();
    // 이 스모크가 만든 임시 프로필만 브라우저 종료 후 정리한다.
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error) => {
  console.error('[smoke-settings-sync] ' + error.message);
  process.exitCode = 1;
});
