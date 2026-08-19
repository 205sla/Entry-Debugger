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

  // 파일명 정리에서 제어문자를 의도적으로 제거한다(picture-tools safeName).
  'no-control-regex': 'off',

  // ── 아래는 "정리 대상"이지 동작 결함이 아니다. 게이트를 막지 않도록 warn으로 둔다.
  //    warn이 0이 되면 lint 스크립트에 --max-warnings=0을 붙여 잠글 수 있다.
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  // 평범한 객체를 맵으로 쓰는 관용구. 키가 'hasOwnProperty'일 때만 깨진다.
  'no-prototype-builtins': 'warn',
  // 분기 전에 두는 방어적 초기화.
  'no-useless-assignment': 'warn',
  'no-useless-catch': 'warn',
  'no-useless-escape': 'warn',

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
    // background.js만 service worker다(importScripts).
    files: ['entry-debugger-extension/background.js'],
    languageOptions: {
      globals: Object.assign({}, globals.serviceworker, globals.webextensions)
    }
  },
  {
    // 검증 도구: Node CommonJS. 다만 smoke 스크립트는 page.evaluate() 안에 브라우저 코드를
    // 그대로 담으므로 브라우저 전역도 함께 허용한다.
    files: ['tools/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: Object.assign(
        {},
        globals.node,
        globals.browser,
        globals.webextensions,
        sharedExtensionGlobals
      )
    },
    rules: Object.assign({}, js.configs.recommended.rules, correctnessRules)
  }
];
