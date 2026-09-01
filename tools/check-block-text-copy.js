'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(rootDir, 'entry-debugger-extension', 'block-text-copy.js'),
  'utf8'
);

function staticContent(text) {
  return {
    _text: text,
    textElement: { textContent: text }
  };
}

function valueContent(index, block) {
  return {
    _index: index,
    getValueBlock: function () {
      return block;
    }
  };
}

function lineBreakContent(index) {
  return {
    _index: index,
    constructor: { name: 'a' }
  };
}

function createBlock(type, text, statements) {
  const contents = text == null ? [] : [staticContent(text)];
  return {
    type,
    params: [],
    statements: statements || [],
    _schema: {
      skeleton: 'basic',
      params: []
    },
    view: { _contents: contents },
    getNextBlock: function () {
      return this.nextBlock || null;
    }
  };
}

function createIfElseBlock() {
  const condition = {
    type: 'boolean',
    params: ['참'],
    statements: [],
    _schema: {
      skeleton: 'basic_boolean_field',
      params: []
    }
  };
  const thenBlock = createBlock(
    'move_direction',
    '이동 방향으로 (10) 만큼 움직이기'
  );
  const elseBlock = createBlock(
    'move_direction',
    '이동 방향으로 (10) 만큼 움직이기'
  );
  const block = createBlock('if_else', null, [[thenBlock], [elseBlock]]);

  block.params = [condition, null, null];
  block._schema.params = [
    { type: 'Block', accept: 'boolean' },
    { type: 'Indicator' },
    { type: 'LineBreak' }
  ];
  block.view._contents = [
    staticContent('만일'),
    valueContent(0, condition),
    staticContent('(이)라면'),
    lineBreakContent(2),
    staticContent('아니면')
  ];

  return block;
}

function createNestedFixture() {
  const start = createBlock(
    'when_run_button_click',
    '시작하기 버튼을 클릭했을 때'
  );
  const repeat = createBlock(
    'repeat_basic',
    '(10) 번 반복하기',
    [[createIfElseBlock()]]
  );
  start.nextBlock = repeat;
  return start;
}

function createSingleStatementFixture() {
  const child = createBlock('move_direction', '이동 방향으로 (10) 만큼 움직이기');
  return createBlock('if', '만일 (참) (이)라면', [[child]]);
}

async function copyBlockText(block, options) {
  options = options || {};

  let messageHandler = null;
  let shownOptions = null;
  let copiedText = null;
  let fallbackTextarea = null;
  const toastCalls = [];

  const contextMenu = {
    show: function (options) {
      shownOptions = options;
      return options;
    }
  };

  function BlockView(targetBlock) {
    this.block = targetBlock;
    this.isInBlockMenu = false;
  }

  BlockView.prototype._rightClick = function () {
    return contextMenu.show([{ text: '삭제하기' }]);
  };

  const Entry = {
    BlockView,
    ContextMenu: contextMenu
  };

  // 디버깅 탭이 꺼져 있어도 알림이 뜨려면 page world에서 Entry.toast를 직접 써야 한다.
  // toast가 없는 페이지(구버전 Entry 등)를 재현하려면 options.toast를 끈다.
  if (options.toast) {
    Entry.toast = {
      success: function (title, message) {
        if (options.toastThrows) throw new Error('toast unavailable');
        toastCalls.push({ type: 'success', title, message });
      },
      warning: function (title, message) {
        if (options.toastThrows) throw new Error('toast unavailable');
        toastCalls.push({ type: 'warning', title, message });
      },
      alert: function (title, message) {
        if (options.toastThrows) throw new Error('toast unavailable');
        toastCalls.push({ type: 'alert', title, message });
      }
    };
  }

  const posts = [];
  const documentObject = {
    body: {
      appendChild: function (element) {
        fallbackTextarea = element;
      }
    },
    createElement: function (tagName) {
      if (tagName !== 'textarea') throw new Error('Unexpected fallback element: ' + tagName);
      return {
        value: '',
        style: {},
        setAttribute: function () {},
        focus: function () {},
        select: function () {},
        remove: function () {
          fallbackTextarea = null;
        }
      };
    },
    execCommand: function (command) {
      if (command !== 'copy') return false;
      if (!options.fallbackCopySucceeds) return false;
      copiedText = fallbackTextarea && fallbackTextarea.value;
      return true;
    }
  };
  const windowObject = {
    Entry,
    location: { origin: 'https://playentry.org' },
    postMessage: function () {},
    addEventListener: function () {},
    EntryDebuggerPageBridge: {
      onMessage: function (handler) {
        messageHandler = handler;
      },
      post: function (type, payload, requestId) {
        posts.push({ type, payload, requestId });
      }
    }
  };
  const sandbox = {
    window: windowObject,
    navigator: {
      clipboard: {
        writeText: function (text) {
          if (options.failCopy) {
            // 비동기 clipboard 실패 뒤 실제 fallbackCopyText 분기로 넘어간다.
            return Promise.reject(new Error('clipboard denied'));
          }
          copiedText = text;
          return Promise.resolve();
        }
      }
    },
    document: documentObject,
    console,
    Date,
    Promise,
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'block-text-copy.js' });

  if (typeof messageHandler !== 'function') {
    throw new Error('block-text-copy.js message handler was not registered.');
  }

  messageHandler({
    type: 'SET_BLOCK_TEXT_COPY_ENABLED',
    requestId: 'block-text-copy-check',
    payload: { enabled: true }
  });

  const view = new Entry.BlockView(block);
  view._rightClick();
  const option = shownOptions && shownOptions.find(
    (item) => item && item.text === '텍스트로 복사하기'
  );
  if (!option || typeof option.callback !== 'function') {
    throw new Error('Block text copy context-menu item was not added.');
  }

  option.callback();
  // 복사 → 알림까지 마이크로태스크가 여러 번 이어지므로 매크로태스크 한 번으로 모두 비운다.
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  if (!posts.some((item) =>
    item.type === 'BLOCK_TEXT_COPY_RESULT' &&
    item.requestId === 'block-text-copy-check' &&
    item.payload &&
    item.payload.success
  )) {
    throw new Error('Block text copy enable result was not posted.');
  }

  return {
    copiedText,
    toastCalls,
    toastPosts: posts.filter((item) => item.type === 'BLOCK_TEXT_COPY_TOAST')
  };
}

function assertToast(label, actual, expected) {
  if (actual.toastCalls.length !== expected.toastCalls.length) {
    throw new Error(
      label + ': expected ' + expected.toastCalls.length + ' Entry.toast call(s), got ' +
      actual.toastCalls.length + ' (' + JSON.stringify(actual.toastCalls) + ')'
    );
  }
  expected.toastCalls.forEach((want, index) => {
    const got = actual.toastCalls[index];
    if (got.type !== want.type || got.title !== want.title || got.message !== want.message) {
      throw new Error(
        label + ': Entry.toast call ' + index + ' differs.\nExpected: ' +
        JSON.stringify(want) + '\nActual: ' + JSON.stringify(got)
      );
    }
  });

  if (actual.toastPosts.length !== expected.toastPosts.length) {
    throw new Error(
      label + ': expected ' + expected.toastPosts.length + ' BLOCK_TEXT_COPY_TOAST post(s), got ' +
      actual.toastPosts.length + ' (' + JSON.stringify(actual.toastPosts) + ')'
    );
  }
  expected.toastPosts.forEach((want, index) => {
    const got = actual.toastPosts[index].payload || {};
    if (got.type !== want.type || got.message !== want.message) {
      throw new Error(
        label + ': BLOCK_TEXT_COPY_TOAST payload ' + index + ' differs.\nExpected: ' +
        JSON.stringify(want) + '\nActual: ' + JSON.stringify(got)
      );
    }
  });
}

// 디버깅 탭 OFF에서도 알림이 뜨는지 고정한다.
// Entry.toast가 있으면 직접 호출하고, 없을 때만 content world 경유 경로로 넘어가야 한다.
async function checkToastPaths() {
  assertToast(
    'toast available / copy success',
    await copyBlockText(createSingleStatementFixture(), { toast: true }),
    {
      toastCalls: [{ type: 'success', title: '블록 텍스트 복사', message: '복사되었습니다.' }],
      toastPosts: []
    }
  );

  assertToast(
    'toast available / copy failure',
    await copyBlockText(createSingleStatementFixture(), { toast: true, failCopy: true }),
    {
      toastCalls: [
        { type: 'alert', title: '블록 텍스트 복사', message: '텍스트 복사에 실패했습니다.' }
      ],
      toastPosts: []
    }
  );

  assertToast(
    'toast available / async clipboard denied / browser fallback success',
    await copyBlockText(createSingleStatementFixture(), {
      toast: true,
      failCopy: true,
      fallbackCopySucceeds: true
    }),
    {
      toastCalls: [{ type: 'success', title: '블록 텍스트 복사', message: '복사되었습니다.' }],
      toastPosts: []
    }
  );

  assertToast(
    'Entry.toast throws / relay fallback preserved',
    await copyBlockText(createSingleStatementFixture(), { toast: true, toastThrows: true }),
    {
      toastCalls: [],
      toastPosts: [{ type: 'info', message: '복사되었습니다.' }]
    }
  );

  assertToast(
    'toast unavailable / fallback preserved',
    await copyBlockText(createSingleStatementFixture(), { toast: false }),
    {
      toastCalls: [],
      toastPosts: [{ type: 'info', message: '복사되었습니다.' }]
    }
  );

  assertToast(
    'toast unavailable / fallback error type preserved',
    await copyBlockText(createSingleStatementFixture(), { toast: false, failCopy: true }),
    {
      toastCalls: [],
      toastPosts: [{ type: 'error', message: '텍스트 복사에 실패했습니다.' }]
    }
  );
}

async function main() {
  const nestedActual = (await copyBlockText(createNestedFixture())).copiedText;
  const nestedExpected = [
    '시작하기 버튼을 클릭했을 때',
    '(10) 번 반복하기',
    '  만일 (참) (이)라면',
    '    이동 방향으로 (10) 만큼 움직이기',
    '  아니면',
    '    이동 방향으로 (10) 만큼 움직이기'
  ].join('\n');

  if (nestedActual !== nestedExpected) {
    throw new Error(
      'Nested if/else copy result differs.\nExpected:\n' +
      nestedExpected + '\nActual:\n' + nestedActual
    );
  }

  const singleActual = (await copyBlockText(createSingleStatementFixture())).copiedText;
  const singleExpected = [
    '만일 (참) (이)라면',
    '  이동 방향으로 (10) 만큼 움직이기'
  ].join('\n');

  if (singleActual !== singleExpected) {
    throw new Error(
      'Single-statement copy result differs.\nExpected:\n' +
      singleExpected + '\nActual:\n' + singleActual
    );
  }

  await checkToastPaths();

  console.log('[check-block-text-copy] OK');
}

main().catch((error) => {
  console.error('[check-block-text-copy] ' + error.message);
  process.exitCode = 1;
});
