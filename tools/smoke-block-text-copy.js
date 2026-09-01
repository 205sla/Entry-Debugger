'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'dist', 'entry-debugger-extension-dev');
const localEntryUrl = process.env.ENTRY_DEBUGGER_SMOKE_URL ||
  'http://127.0.0.1:8080/ws/abcdef0123456789abcdef01';
const defaultEntryVendorDir = path.resolve(
  rootDir,
  '..',
  '..',
  'apps',
  'MYentry',
  'public',
  'lib',
  'vendor'
);

function resolvePlaywright() {
  const candidateRoots = [
    rootDir,
    path.join(rootDir, '..', '..', 'apps', 'MYentry-game'),
    process.cwd()
  ];

  for (const candidate of candidateRoots) {
    try {
      return require(require.resolve('playwright', { paths: [candidate] }));
    } catch (e) {}
  }

  throw new Error('Playwright를 찾을 수 없습니다. apps/MYentry-game의 node_modules를 확인하세요.');
}

function resolveChromiumExecutable() {
  const configured = process.env.ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE;
  if (configured) {
    if (!fs.existsSync(configured)) {
      throw new Error('ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE does not exist: ' + configured);
    }
    return configured;
  }

  if (process.platform === 'win32') {
    const puppeteerChromeRoot = path.join(
      os.homedir(),
      '.cache',
      'puppeteer',
      'chrome'
    );
    let cachedChrome;
    if (fs.existsSync(puppeteerChromeRoot)) {
      cachedChrome = fs.readdirSync(puppeteerChromeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('win64-'))
        .sort((left, right) => right.name.localeCompare(left.name, undefined, {
          numeric: true
        }))
        .map((entry) => path.join(
          puppeteerChromeRoot,
          entry.name,
          'chrome-win64',
          'chrome.exe'
        ))
        .find((candidate) => fs.existsSync(candidate));
    }

    const candidates = [
      cachedChrome,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate));
  }

  return undefined;
}

async function installLocalEntryVendorFallbacks(page) {
  const smokeUrl = new URL(localEntryUrl);
  if (smokeUrl.hostname !== '127.0.0.1' && smokeUrl.hostname !== 'localhost') {
    return 0;
  }

  const vendorDir = process.env.ENTRY_DEBUGGER_ENTRY_VENDOR_DIR ||
    defaultEntryVendorDir;
  const mappings = [
    {
      url: 'https://playentry.org/lib/lodash/dist/lodash.min.js',
      file: path.join(vendorDir, 'lodash', 'lodash.min.js')
    },
    {
      url: 'https://playentry.org/lib/jquery-ui/ui/minified/jquery-ui.min.js',
      file: path.join(vendorDir, 'jquery-ui', 'jquery-ui.min.js')
    },
    {
      url: 'https://playentry.org/js/jshint.js',
      file: path.join(vendorDir, 'jshint', 'jshint.js')
    }
  ];
  const missing = mappings.filter((mapping) => !fs.existsSync(mapping.file));

  if (missing.length) {
    if (process.env.ENTRY_DEBUGGER_ENTRY_VENDOR_DIR) {
      throw new Error(
        'ENTRY_DEBUGGER_ENTRY_VENDOR_DIR is missing required files: ' +
        missing.map((mapping) => mapping.file).join(', ')
      );
    }
    return 0;
  }

  for (const mapping of mappings) {
    await page.route(mapping.url, (route) => route.fulfill({
      path: mapping.file,
      contentType: 'application/javascript'
    }));
  }
  return mappings.length;
}

async function seedExtensionSettings(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }

  await worker.evaluate(() => new Promise((resolve, reject) => {
    chrome.storage.local.set({
      enabled: true,
      debuggerTabEnabled: false,
      blockTextCopyEnabled: true
    }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  }));
}

function createFixture() {
  const numberBlock = (id, value) => ({
    id,
    x: 0,
    y: 0,
    type: 'number',
    params: [String(value)],
    statements: []
  });
  const moveBlock = (id) => ({
    id,
    x: 0,
    y: 0,
    type: 'move_direction',
    params: [numberBlock(id + '-number', 10), null],
    statements: []
  });

  return [[
    {
      id: 'ed-copy-start',
      x: 50,
      y: 30,
      type: 'when_run_button_click',
      params: [null],
      statements: []
    },
    {
      id: 'ed-copy-repeat',
      x: 0,
      y: 0,
      type: 'repeat_basic',
      params: [numberBlock('ed-copy-repeat-number', 10), null],
      statements: [[
        {
          id: 'ed-copy-if-else',
          x: 0,
          y: 0,
          type: 'if_else',
          params: [
            {
              id: 'ed-copy-true',
              x: 0,
              y: 0,
              type: 'True',
              params: [null],
              statements: []
            },
            null,
            null
          ],
          statements: [
            [moveBlock('ed-copy-then')],
            [moveBlock('ed-copy-else')]
          ]
        }
      ]]
    }
  ]];
}

async function main() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error('개발용 확장 manifest가 없습니다. 먼저 npm run build:dev 를 실행하세요.');
  }

  const { chromium } = resolvePlaywright();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-debugger-block-copy-'));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: resolveChromiumExecutable(),
      headless: false,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        '--disable-extensions-except=' + extensionDir,
        '--load-extension=' + extensionDir
      ]
    });
    await seedExtensionSettings(context);
    await context.grantPermissions(
      ['clipboard-read', 'clipboard-write'],
      { origin: new URL(localEntryUrl).origin }
    );

    const page = context.pages()[0] || await context.newPage();
    const localVendorFallbacks = await installLocalEntryVendorFallbacks(page);
    await page.goto(localEntryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    await page.waitForSelector('.propertyTab', { timeout: 180000 });
    await page.waitForFunction(
      () => window.__ENTRY_DEBUGGER_BLOCK_TEXT_COPY_INJECTED__ === true,
      { timeout: 60000 }
    );
    const debuggerScriptInjected = await page.evaluate(
      () => window.__ENTRY_DEBUGGER_INJECTED__ === true
    );
    if (debuggerScriptInjected) {
      throw new Error('inject.js must be absent in the debugger-tab-OFF regression scenario.');
    }

    const fixture = createFixture();
    const rendered = await page.evaluate((codeFixture) => {
      const object = window.Entry && window.Entry.playground &&
        window.Entry.playground.object;
      const code = object && object.script;
      if (!code || typeof code.load !== 'function') {
        throw new Error('Current Entry object code is unavailable.');
      }

      code.load(codeFixture);
      const thread = code.getThreads()[0];
      const firstBlock = thread && thread.getFirstBlock();
      const repeatBlock = thread && thread.getBlocks()[1];
      const statement = repeatBlock && repeatBlock.statements[0];
      const ifElseBlock = statement && statement.getFirstBlock();
      const lineBreak = ifElseBlock && ifElseBlock.view &&
        ifElseBlock.view._contents.find(
          (content) => content instanceof window.Entry.FieldLineBreak
        );
      if (!firstBlock || !firstBlock.view || !lineBreak) {
        throw new Error('Entry block fixture was not rendered.');
      }

      Object.defineProperty(lineBreak, 'constructor', {
        configurable: true,
        value: { name: 'a' }
      });

      firstBlock.view._rightClick({
        clientX: 240,
        clientY: 180,
        preventDefault: function () {},
        stopPropagation: function () {}
      });

      return {
        blockCount: thread.getBlocks().length,
        lineBreakConstructorName: lineBreak.constructor.name,
        lineBreakInstance: lineBreak instanceof window.Entry.FieldLineBreak
      };
    }, fixture);

    // 개발 서버의 기존 warning overlay가 실제 포인터 좌표를 가릴 수 있으므로
    // React 기반 ContextMenu의 대상 노드에 click 이벤트를 직접 전달한다.
    await page.getByText('텍스트로 복사하기', { exact: true })
      .dispatchEvent('click');
    try {
      await page.waitForFunction(
        () => !!document.querySelector('#entryToastContainer .entryToastSuccess'),
        { timeout: 30000 }
      );
    } catch (error) {
      const diagnostics = await page.evaluate(async () => {
        const clipboardText = await navigator.clipboard.readText().catch(() => null);
        return {
          blockTextCopyInjected:
            window.__ENTRY_DEBUGGER_BLOCK_TEXT_COPY_INJECTED__ === true,
          debuggerScriptInjected: window.__ENTRY_DEBUGGER_INJECTED__ === true,
          entryToastType: typeof window.Entry?.toast,
          toastMarkup: document.querySelector('#entryToastContainer')?.outerHTML || null,
          clipboardLength: clipboardText == null ? null : clipboardText.length,
          clipboardStartsWithFixture:
            typeof clipboardText === 'string' &&
            clipboardText.startsWith('시작하기 버튼을 클릭했을 때')
        };
      });
      throw new Error(
        (error && error.message ? error.message : String(error)) +
        '\nDiagnostics: ' + JSON.stringify(diagnostics),
        { cause: error }
      );
    }
    const copiedText = await page.evaluate(() => navigator.clipboard.readText());
    const normalizedCopiedText = copiedText.replace(/\r\n/g, '\n');
    const expectedText = [
      '시작하기 버튼을 클릭했을 때',
      '(10) 번 반복하기',
      '  만일 (참) (이)라면',
      '    이동 방향으로 (10) 만큼 움직이기',
      '  아니면',
      '    이동 방향으로 (10) 만큼 움직이기'
    ].join('\n');

    if (normalizedCopiedText !== expectedText) {
      throw new Error(
        'Copied text differs.\nExpected:\n' + expectedText +
        '\nActual:\n' + copiedText
      );
    }
    if (
      rendered.lineBreakConstructorName !== 'a' ||
      rendered.lineBreakInstance !== true
    ) {
      throw new Error('The minified-constructor regression condition was not established.');
    }

    console.log(JSON.stringify({
      url: localEntryUrl,
      blockCount: rendered.blockCount,
      lineBreakConstructorName: rendered.lineBreakConstructorName,
      lineBreakInstance: rendered.lineBreakInstance,
      debuggerScriptInjected,
      localVendorFallbacks,
      copiedText: normalizedCopiedText
    }, null, 2));
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[smoke-block-text-copy] ' +
    (error && error.message ? error.message : String(error)));
  process.exit(1);
});
