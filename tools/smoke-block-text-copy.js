'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'dist', 'entry-debugger-extension-dev');
const localEntryUrl = process.env.ENTRY_DEBUGGER_SMOKE_URL ||
  'http://127.0.0.1:8080/ws/abcdef0123456789abcdef01';

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

async function seedExtensionSettings(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }

  await worker.evaluate(() => new Promise((resolve, reject) => {
    chrome.storage.local.set({
      enabled: true,
      debuggerTabEnabled: true,
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
    await page.goto(localEntryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    await page.waitForSelector('.propertyTab', { timeout: 180000 });
    await page.waitForFunction(
      () => window.__ENTRY_DEBUGGER_BLOCK_TEXT_COPY_INJECTED__ === true,
      { timeout: 60000 }
    );

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

    await page.getByText('텍스트로 복사하기', { exact: true }).click();
    await page.waitForFunction(
      () => !!document.querySelector('#entryToastContainer .entryToastSuccess'),
      { timeout: 30000 }
    );
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
