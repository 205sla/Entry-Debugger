# Entry Debugger 리팩토링 구조

확인 날짜: 2026-06-23

대상 버전: `2.6.1`

## 목적

Entry 업데이트로 내부 API나 DOM 구조가 바뀌어도 고장 지점을 빠르게 찾을 수 있도록 공통 코어를 추가했다.

기존에는 각 page-world 모듈이 `window.Entry`, `window.postMessage`, prototype patch를 직접 처리했다. 이제 다음 세 모듈을 먼저 주입하고 기능 모듈이 이를 사용한다.

## 공통 코어

파일: `entry-debugger-extension/page-bridge.js`

- `__ENTRY_DEBUGGER__` 채널 상수 관리
- `window.postMessage` 송신 공통화
- origin/channel 검증 공통화
- page-world 모듈의 `READY`/`RESULT` 메시지 형식 통일

파일: `entry-debugger-extension/entry-adapter.js`

- `Entry` / `Entry.variableContainer` / `Entry.container` 접근 공통화
- 현재 오브젝트, 오브젝트 이름, 변수/리스트 id/name 읽기 공통화
- 블록 메뉴 리로드 `refreshBlockMenu(category)` 제공
- Entry 내부 구조가 바뀌면 우선 이 파일을 확인한다.

파일: `entry-debugger-extension/patch-registry.js`

- `patchMethod(owner, methodName, patchId, createWrapper)` 제공
- 같은 메서드가 SPA 재진입이나 설정 변경으로 중복 래핑되는 것을 방지
- 원본 메서드 참조를 registry에 저장

## 이관된 기능

다음 모듈은 공통 코어를 사용하도록 정리했다.

- `boost-mode.js`: `Entry.init` 래핑을 PatchRegistry 경유로 처리
- `turbo-mode.js`: `Entry.Engine.prototype.setSpeedMeter`, `toggleSpeedPanel` 래핑을 PatchRegistry 경유로 처리
- `console-debugging.js`: `dialog` / `dialog_time` 블록 `func` 래핑을 PatchRegistry 경유로 처리
- `function-private-variables.js`: `Entry.container.getDropdownList`, `FieldDropdownDynamic.getTextByValue` 래핑을 PatchRegistry 경유로 처리
- `dropdown-search.js`: `FieldDropdownDynamic.renderOptions` 래핑을 PatchRegistry 경유로 처리
- `function-usage-inspector.js`: Entry 접근과 메시지 송신을 Adapter/Bridge 경유로 처리
- `inject.js`: Entry 접근, 스냅샷 송신, 명령 결과 송신의 1차 경로를 Adapter/Bridge 경유로 처리

## manifest 보안 범위

Chrome Web Store 제출 대비로 content script는 다음 범위로 제한했다.

```json
"matches": ["https://playentry.org/ws/*"]
```

`web_accessible_resources.matches`는 Chrome MV3에서 path가 있는 패턴을 거부할 수 있으므로 다음 origin 범위를 사용한다.

```json
"matches": ["https://playentry.org/*"]
```

실제 page-world 주입은 `/ws/*`에서만 실행되는 content script가 수행하므로, 확장 기능은 Entry 작업실 URL에서만 동작한다.

## 남은 리팩토링 후보

- `content.js`는 여전히 UI 렌더링, 설정 lifecycle, 기능 lifecycle을 함께 가진다. 다음 단계에서는 `debugger-panel`, `feature-lifecycle`, `settings-client`로 나누는 것이 좋다.
- `inject.js`는 명령 handler가 아직 한 파일에 있다. 다음 단계에서는 `runtime-variables`, `runtime-lists`, `runtime-scenes`, `runtime-generator`로 분리하는 것이 좋다.
- 내장 `.eo` 다량 이미지 업로더는 모양 탭 편의 기능과 역할이 겹쳐 2026-06-23 제거했다.

## 2.6.1 안전망과 저위험 정리

- `tools/check-settings.js`가 `settings.js`의 기본값, 전체 확장 OFF, 디버깅 탭과
  실험실의 종속 관계, 부스트 버튼과 부스트 모드의 종속 관계, 하위 검색 토글 보존,
  이미지 배율 정규화, 메인 기능 개수를 고정한다.
- `tools/check-page-core-loader.js`가 실제 `content.js`에서 주입 함수와 코어 목록을
  추출해 코어 4종의 DOM 추가 순서, 12개 기능 스크립트의 후행 추가,
  로딩 중 중복 방지, `onload` 뒤 script 정리를 검증한다.
- `inject.js`의 변경 후 즉시 스냅샷 재전송 경로 10곳은 `forceResync()`를 사용한다.
  이 중 9곳은 기존에 같은 두 줄이 반복됐고, `REQUEST_SNAPSHOT` 한 곳에는 주석이
  붙어 있었다.

현재 로더 검사는 기존 동작을 고정하는 특성 테스트다. Promise 기반 순차 로딩,
`onerror`, 실패 후 재시도는 아직 제품 코드에 반영하지 않았다. 이 안전망을 확장한
뒤 page-world fallback 제거 여부를 별도 변경으로 판단한다.

## 2026-08-19 correctness 린트 (v2.6.2)

[결정 메모](./entry-debugger-refactor-decision-2026-08-19.md)의 1순위 항목(R8)을 반영했다.
`npm run check`의 `node --check`는 **문법만** 본다. 미정의 변수, 도달 불가 코드, 중복 `case`,
중복 객체 키는 통과시킨다. 그 구멍을 ESLint로 막았다.

- 설정: 루트 `eslint.config.js`(flat config). 규칙은 `@eslint/js` recommended + correctness 6종.
  **스타일·포매팅 규칙은 넣지 않는다** — 이 저장소는 ES5 모듈과 ES6 모듈이 섞여 있고,
  외부 기여 PR을 스타일로 되돌리지 않기 위해서다.
- 실행: `npm install` 후 `npm run lint`. `npm run check`는 의존성 없이 계속 동작한다
  (두 명령을 합치지 않은 이유).
- 파일군별 전역: 확장 본체는 browser+webextensions, `background.js`는 service worker,
  `tools/`는 node+browser(스모크 스크립트가 `page.evaluate()` 안에 브라우저 코드를 담는다).
- 저장소 관용구는 규칙에서 예외 처리했다 — 빈 `catch`(`allowEmptyCatch`), 파일명 정리의
  제어문자 정규식(`no-control-regex` off).

도입 시점 결과는 **error 0 · warning 17**이다. 즉 숨은 결함(미정의 변수·도달 불가·중복 case)은
없었고, 남은 것은 죽은 코드 정리 대상뿐이다.

| 경고 | 개수 | 성격 |
| --- | ---: | --- |
| `no-prototype-builtins`(frame-profiler) | 7 | 평범한 객체를 맵으로 쓰는 관용구 |
| `no-unused-vars` | 3 | `hasKeys`, `pg` ×2 — 죽은 코드 |
| `no-useless-escape`(block-text-copy) | 3 | 문자 클래스 안의 불필요한 이스케이프 |
| `no-useless-assignment` | 2 | 분기 전 방어적 초기화 |
| `no-useless-catch`(high-quality) | 1 | `catch (e) { throw e; }` + `finally` |
| 사용되지 않는 `eslint-disable`(picture-tools) | 1 | 과거 `no-loop-func` 억제 잔재 |

이 17개를 정리하면 `lint` 스크립트에 `--max-warnings=0`을 붙여 잠근다. 그 전까지 warning은
게이트를 막지 않는다(경고가 쌓여도 CI가 멈추지 않게 하려는 게 아니라, 도구 도입 PR에
제품 코드 수정을 섞지 않기 위한 분리다).

## 검증 포인트

- page-world 코어 4개가 기능 모듈보다 먼저 주입된다.
- PatchRegistry가 같은 메서드를 두 번 감싸지 않는다.
- Bridge가 origin/channel이 맞는 메시지만 처리한다.
- manifest의 content script가 `https://playentry.org/ws/*`로 제한된다.
- `web_accessible_resources`는 Chrome이 허용하는 `https://playentry.org/*` 패턴을 사용한다.
