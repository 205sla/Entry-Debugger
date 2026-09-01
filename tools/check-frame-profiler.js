'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'entry-debugger-extension', 'frame-profiler.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const testApiSource = [
  '  window.__ENTRY_DEBUGGER_FRAME_PROFILER_TEST__ = {',
  '    addExpanded: function (id) { expanded[id] = true; },',
  '    snapshot: function () {',
  '      return {',
  '        frameObj: Object.keys(frameObj),',
  '        frameThread: Object.keys(frameThread),',
  '        dispObj: Object.keys(dispObj),',
  '        dispThread: Object.keys(dispThread),',
  '        hatCache: Object.keys(hatCache),',
  '        expanded: Object.keys(expanded),',
  '        dictionariesHaveNullPrototype:',
  '          Object.getPrototypeOf(frameObj) === null &&',
  '          Object.getPrototypeOf(frameThread) === null &&',
  '          Object.getPrototypeOf(dispObj) === null &&',
  '          Object.getPrototypeOf(dispThread) === null &&',
  '          Object.getPrototypeOf(hatCache) === null &&',
  '          Object.getPrototypeOf(expanded) === null,',
  "        objectPrototypePolluted: Object.prototype.hasOwnProperty.call(Object.prototype, 't')",
  '      };',
  '    }',
  '  };'
].join('\n');
const instrumentedSource = source.replace(
  /\r?\n\}\)\(\);\s*$/,
  '\n' + testApiSource + '\n})();\n'
);

if (instrumentedSource === source) {
  throw new Error('frame-profiler.js test seam insertion point was not found.');
}

function Code(object) {
  this.object = object;
}
Code.prototype.tick = function () {
  return true;
};

function Executor(options) {
  Object.assign(this, options);
}
Executor.prototype.execute = function () {
  return true;
};

let nowValue = 0;
const animationFrames = [];
const Entry = {
  Code,
  Executor,
  engine: {
    isState: function (state) {
      return state === 'run';
    }
  }
};
const windowObject = {
  Entry,
  location: { origin: 'https://playentry.org' },
  localStorage: {
    getItem: function () { return '1'; },
    setItem: function () {}
  },
  performance: {
    now: function () {
      nowValue += 1;
      return nowValue;
    }
  },
  requestAnimationFrame: function (callback) {
    animationFrames.push(callback);
    return animationFrames.length;
  },
  cancelAnimationFrame: function () {},
  postMessage: function () {},
  addEventListener: function () {},
  EntryDebuggerPageBridge: {
    onMessage: function () {},
    post: function () {}
  }
};
const sandbox = {
  window: windowObject,
  document: {},
  console,
  Date,
  setTimeout,
  clearTimeout
};

vm.createContext(sandbox);
vm.runInContext(instrumentedSource, sandbox, { filename: 'frame-profiler.js' });

const testApi = windowObject.__ENTRY_DEBUGGER_FRAME_PROFILER_TEST__;
if (!testApi || animationFrames.length !== 1) {
  throw new Error('frame-profiler test API or initial animation frame was not registered.');
}

// 첫 프레임에서 enabled && run 상태가 되어 tick/execute 래퍼의 측정을 활성화한다.
animationFrames.shift()();

const specialIds = ['__proto__', 'hasOwnProperty', 'constructor'];
specialIds.forEach((id) => {
  new Entry.Code({ id, name: id }).tick();
  testApi.addExpanded(id);
});

const hat = { id: 'constructor', type: 'when_run_button_click' };
const executor = new Entry.Executor({
  id: '__proto__',
  code: { object: { id: 'hasOwnProperty', name: 'special object' } },
  scope: {
    block: {
      getThread: function () {
        return {
          getFirstBlock: function () { return hat; }
        };
      }
    }
  },
  isEnd: function () { return false; }
});
executor.execute();

const beforeFlush = testApi.snapshot();
specialIds.forEach((id) => {
  if (!beforeFlush.frameObj.includes(id) || !beforeFlush.expanded.includes(id)) {
    throw new Error('Special object id was not stored as an own map key: ' + id);
  }
});
if (!beforeFlush.hatCache.includes('__proto__')) {
  throw new Error('Special executor id was not stored in hatCache.');
}

// 다음 프레임에서 frame* 사전이 disp* 사전으로 감쇠 병합된다.
animationFrames.shift()();
const afterFlush = testApi.snapshot();
specialIds.forEach((id) => {
  if (!afterFlush.dispObj.includes(id)) {
    throw new Error('Special object id was not preserved after frame flush: ' + id);
  }
});
if (!afterFlush.dictionariesHaveNullPrototype) {
  throw new Error('A frame-profiler string-key map regained Object.prototype.');
}
if (afterFlush.objectPrototypePolluted) {
  throw new Error('frame-profiler polluted Object.prototype with timing data.');
}

console.log('[check-frame-profiler] OK');
