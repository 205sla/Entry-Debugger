/**
 * eslint.config.js - correctness-only lint.
 *
 * 목적은 `node --check`가 잡지 못하는 결함(미정의 변수, 도달 불가 코드, 중복 case,
 * 중복 키 등)을 잡는 것이다. 스타일·포매팅 규칙은 의도적으로 넣지 않는다 —
 * 이 저장소는 ES5 모듈과 ES6 모듈이 섞여 있고, 외부 기여 PR을 스타일로 되돌리지 않는다.
 */
'use strict';

const js = require('@eslint/js');
const globals = require('globals');

const sharedExtensionGlobals = {
  // 확장 내부에서 파일 경계를 넘어 공유되는 전역(각각 자기 파일에서 정의).
  EntryDebuggerSettings: 'readonly',
  EntryDebuggerHangulSearch: 'readonly',
  EntryDebuggerFunctionLibraryTemplates: 'readonly',
  EntryDebuggerPageBridge: 'readonly',
  EntryDebuggerEntryAdapter: 'readonly',
  EntryDebuggerPatchRegistry: 'readonly',
  // 페이지(playentry.org)가 제공하는 전역.
  Entry: 'readonly',
  Lang: 'readonly',
  GEHelper: 'readonly'
};

const correctnessRules = {
  // 빈 catch는 이 저장소의 의도된 관용구다(Entry 내부 접근 실패를 삼킨다).
  'no-empty': ['error', { allowEmptyCatch: true }],

  // 제품·도구 코드 모두 warning 없이 통과해야 한다. 예외가 필요한 한 줄은 해당 위치에서
  // eslint-disable-next-line과 이유를 함께 기록한다.
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],

  // ── recommended에 없는 correctness 규칙 추가.
  'array-callback-return': 'error',
  'no-promise-executor-return': 'error',
  'no-self-compare': 'error',
  'no-template-curly-in-string': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error'
};

module.exports = [
  {
    ignores: ['dist/**', 'entry-debugger-site/**', 'node_modules/**']
  },
  {
    // 확장 본체: 브라우저 + 크롬 확장 API. content script와 page-world 모듈이 섞여 있다.
    files: ['entry-debugger-extension/**/*.js'],
    ignores: ['entry-debugger-extension/background.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: Object.assign(
        {},
        globals.browser,
        globals.webextensions,
        sharedExtensionGlobals
      )
    },
    rules: Object.assign({}, js.configs.recommended.rules, correctnessRules)
  },
  {
    // background.js는 DOM 전역이 없는 MV3 service worker다(importScripts).
    files: ['entry-debugger-extension/background.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: Object.assign({}, globals.serviceworker, globals.webextensions)
    },
    rules: Object.assign({}, js.configs.recommended.rules, correctnessRules)
  },
  {
    // 검증·빌드 도구: Node CommonJS. 브라우저 전역을 허용하지 않아 런타임 경계 실수를 잡는다.
    files: ['tools/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: Object.assign(
        {},
        globals.node
      )
    },
    rules: Object.assign({}, js.configs.recommended.rules, correctnessRules)
  },
  {
    // smoke 파일은 page.evaluate()/waitForFunction 콜백에 page-world 코드를 포함한다.
    // 이중 런타임 파일에만 browser/webextensions/Entry 전역을 추가한다.
    files: ['tools/smoke-*.js'],
    languageOptions: {
      globals: Object.assign(
        {},
        globals.browser,
        globals.webextensions,
        sharedExtensionGlobals
      )
    }
  }
];
