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

async function copyBlockText(block) {
  let messageHandler = null;
  let shownOptions = null;
  let copiedText = null;

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
  const posts = [];
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
          copiedText = text;
          return Promise.resolve();
        }
      }
    },
    document: {},
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
  await Promise.resolve();

  if (!posts.some((item) =>
    item.type === 'BLOCK_TEXT_COPY_RESULT' &&
    item.requestId === 'block-text-copy-check' &&
    item.payload &&
    item.payload.success
  )) {
    throw new Error('Block text copy enable result was not posted.');
  }

  return copiedText;
}

async function main() {
  const nestedActual = await copyBlockText(createNestedFixture());
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

  const singleActual = await copyBlockText(createSingleStatementFixture());
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

  console.log('[check-block-text-copy] OK');
}

main().catch((error) => {
  console.error('[check-block-text-copy] ' + error.message);
  process.exitCode = 1;
});
