---
상태: 검토완료
범위: 프로젝트:Entry Debugger
갱신: 2026-08-19
승계: 채택 항목을 구현하면 entry-debugger-refactor-architecture.md에 반영하고 이 메모는 _archive/기획/으로 이관
---

# Entry Debugger 리팩터링 결정 메모 (2026-08-19)

## 결론

제안된 순서대로 바로 진행하지 않는다. **R8 린트 안전망과 D1 버그 수정부터 분리해서
진행하고, 로더 검증 구조를 고친 뒤 제한적인 R1을 적용하는 순서**가 가장 안전하다.

- 지금 채택: R8, R7, 범위를 줄인 R1, 단계적인 R5
- 선결조건 뒤 채택: R2, R6
- 특성 테스트 전까지 보류: R4
- 현재 방식은 기각: R3의 범용 유틸 파일 분리
- 기존 보류 유지: B1 fallback 제거, B2 settings 스키마화, A2/A3 god file 분리

`D1`은 실제 결함이다. 다만 블록 텍스트 복사 알림에 한정된 낮은 심각도의 결함이며,
부스트 모드의 주 알림 경로에는 같은 문제가 없다. D1은 리팩터에 묻지 말고 별도 버그 수정
PR로 먼저 처리한다.

## 검토 기준과 재측정

- 기준 커밋: `main` `0e44b789ed263d2b37ca63e8a94eb2e69b68fda5`
- 제품 버전: `2.6.2`
- 정적 검증: `npm run check` 통과
- 개발 빌드: `npm run build:dev` 통과
- 로컬 Entry: 2026-08-19 확인 시 `127.0.0.1:8080` 응답 없음. smoke 미실행
- 작업 트리에 이미 있던 문서 변경은 검토 대상과 분리했으며 제품 코드는 수정하지 않음

현재 파일 줄 수는 제안서와 일치한다.

| 파일 | 줄 수 |
| --- | ---: |
| `content.js` | 2,779 |
| `picture-tools.js` | 2,044 |
| `style.css` | 1,662 |
| `inject.js` | 1,206 |
| `block-text-copy.js` | 1,192 |

다만 일부 계량 표현은 정정이 필요하다.

- 대문자 문자열 리터럴은 77종이 맞지만 `INPUT`, `OPTION`, `VECTOR`, 정규식 조각도 포함한다.
  `post`/`sendToInject`/`case`/`msg.type` 사용을 기준으로 한 프로토콜 유사 어휘는 **69종**이다.
- `#4f80ff`는 **32개 줄, 33회 리터럴**이다. `rgb(79,128,255)`는 1회다.
- `}, 150);`는 `content.js`에 9회다.
- `clearRetry`는 10개 모듈에 있고, 이름이 정확히 `schedulePatchRetry`인 함수는 4개다.
  다른 이름의 같은 골격까지 포함하면 공유 컨트롤러 후보는 더 많다.
- `dropdown-search.js`는 `const` 58회와 `let` 15회를 사용하지만 화살표 함수는 0회다.
  ES 문법 수준이 섞였다는 진단은 맞고, "const/화살표 73회"라는 표현은 틀리다.

## 항목별 결정

| 항목 | 주장 사실 여부 | 영향 | 위험 | 결론 | 근거 |
| --- | --- | --- | --- | --- | --- |
| R1 기능 디스크립터 | 부분 사실 | 약 180~260줄 접촉, 순감소 약 90~150줄 | 중 | **채택(축소)** | 12개 주입 함수 중 플래그·OFF 게이트·apply 골격이 같은 것은 뒤쪽 6개다. settings/manifest/tools까지 하나의 런타임 SSOT로 만들 수는 없다. |
| R2 토스트 SSOT | 방향은 사실, 계수는 축소됨 | 5개 구현 경로, 순감소 약 20~50줄 | 중 | **보류** | content/block/picture/inject 외에 boost 직접 경로도 있다. page-core 로딩 실패 복구와 D1 분리가 먼저다. |
| R3 picture 유틸 추출 | 과장 | 약 211줄 이동, 총 LOC는 거의 불변 | 중 | **기각(현재 방식)** | ZIP/GIF는 모양 업로드·내보내기 도메인이고, 새 WAR·전역 API·주입 순서를 늘려 단순 파일 이동 이상의 비용이 든다. |
| R4 렌더러 통합 | 골격 중복은 사실 | 약 210줄 접촉, 순감소 약 80~120줄 | 고 | **보류** | 변수 편집 보호와 리스트 펼침·포커스·선택 범위·추가 입력·스코프 바인딩을 현재 검사가 고정하지 않는다. |
| R5 스타일 토큰/UI 킷 | 사실 | 1단계 30여 색상 사용처, 전체 이관은 250줄 이상 | 중 | **채택(단계화)** | content CSS는 DOM에 적용되므로 page-world가 만든 요소도 클래스 스타일을 받을 수 있다. 동적 좌표는 inline으로 유지한다. |
| R6 retry controller 이관 | 사실 | 8~10개 후보, 약 120~180줄 감소 가능 | 중 | **보류** | `createRetryController` 의미는 대부분 맞지만 PatchRegistry가 실패하면 모듈별 fallback까지 잃는다. 로더 복구가 선행돼야 한다. |
| R7 검사 결합 해소 | 사실 | 도구/로더 seam 약 100~180줄 | 중 | **채택** | 현재 delimiter 파서는 문자열·주석 brace를 처리하지만 12개 함수명과 본문 문자열에 결합돼 R1에서 깨진다. 관찰 범위를 줄이면 안 된다. |
| R8 린트 도입 | 사실 | 설정·lockfile 중심, 제품 LOC 변화 없음 | 저 | **채택** | `node --check`는 미정의 변수·도달 불가·중복 case를 잡지 못한다. 공개 기여 저장소라 correctness-only lint의 가치가 크다. |

### R1 범위

첫 디스크립터에는 다음 6개만 넣는다.

- dropdown search
- block text copy
- single block drag
- high-quality block image
- picture tools
- frame profiler

각 항목은 `scriptId`, `file`, injected 상태, enabled 판정, SET 메시지, payload 빌더,
READY 메시지를 가진다. dropdown/high-quality의 전용 payload 빌더는 그대로 둔다.

다음 기능은 첫 범위에서 제외한다.

- boost mode: document_start 무조건 주입, localStorage 미러, 50ms 경로
- debugger/inject: 패널 생명주기와 polling 소유
- function usage: start/stop polling과 250ms 타이머
- turbo mode: start/stop 비대칭
- console debugging, function private variables: 별도 생명주기
- hangul search: isolated world와 page world 양쪽에 로드

현재의 **150ms 적용 경로와 READY 재적용 경로는 둘 다 유지**한다. 이중 경로를 없애는 것은
표현 통합이 아니라 타이밍 계약 변경이므로 별도 설계·검증 대상이다.

### R2 범위

현재 토스트 경로는 사실상 5개다.

1. `content.js showToast(type, title, message)`
2. `block-text-copy.js showToast(message, type)`
3. `picture-tools.js nativeToast(title, msg, err)`
4. `boost-mode.js showEntryToast(title, message, type)`
5. `inject.js showEntryToast(payload)`

공용 API는 `success | warning | alert`만 받도록 하고, 기존 block-text-copy의
`info | error` 매핑은 호출부 어댑터에서 보존한다. 진행률 UI `prog()`는 수명이 있는 상태 UI라
단발 토스트 SSOT에 포함하지 않는다.

공용 helper가 page-core에 들어가면 로더 실패가 모든 알림을 함께 죽일 수 있다. 따라서
Promise 순차 로딩, `onerror`, 재시도와 실패 테스트를 먼저 만든 뒤 진행한다.

### R3 대안

`crc32`, ZIP, GIF, progress, prompt를 "범용 utils"로 묶지 않는다. 2,044줄 파일을 실제로
분리할 시점에는 다음처럼 **기능 소유권**으로 나눈다.

- 업로드/GIF 스테이징
- 선택·드래그·컨텍스트 메뉴
- SVG 수리
- 내보내기/ZIP

현재 `smoke:picture-tools`는 단일 삭제, 복제, 재정렬·undo/redo, 스크롤, 일괄 이름변경,
10개 기준 업로드, GIF 합산, 취소를 검증한다. ZIP 내보내기, SVG 수리, 다중 복사·붙여넣기는
고정하지 않으므로 도메인 분리는 그 회귀를 추가한 뒤 재검토한다.

### R4 선결 테스트

`renderCardList()`를 만들기 전에 다음 특성 테스트가 필요하다.

- snapshot 갱신 중 변수 입력값과 `ed-editing` 유지
- 리스트 펼침 상태와 카드 DOM identity 유지
- 리스트 행 편집 중 입력값·focus·selection range 유지
- 리스트 추가 입력값 유지
- scope select 값 갱신과 change listener 중복 없음
- 검색 결과 0건/복귀, 메시지·장면 카드 재사용과 이름 갱신

콜백으로 현재 코드를 옮길 수는 있지만, 콜백이 네 개라는 사실만으로 상태 보존이 증명되지는
않는다. 따라서 제안 순서의 R4 1순위는 채택하지 않는다.

### R5 단계

1. `style.css`에 색상·테두리·overlay 계층 토큰을 선언하고 정적 CSS에서 사용한다.
2. popup은 별도 문서이므로 공유 토큰 CSS를 명시적으로 링크하거나 값을 별도로 관리한다.
3. page-world DOM에 안정적인 클래스명을 부여하고 정적 `cssText`만 `style.css`로 이동한다.
4. drag ghost의 좌표·크기처럼 프레임마다 바뀌는 값은 inline으로 유지한다.

WAR의 `matches`가 더 넓어도 모듈은 `/ws/*` content script에서만 주입되므로, 현재 구조에서는
`style.css` 적용 범위와 page module 실행 범위가 일치한다.

## D1 결함 판정

### 판정

**실재, 심각도 낮음(P3), 별도 버그 수정 PR 필요.**

새로고침 시 `debuggerTabEnabled=false`, `blockTextCopyEnabled=true`인 조합에서 다음 사슬이 성립한다.

1. block-text-copy는 독립적으로 주입되고 복사 자체도 실행된다.
2. 성공/실패 알림은 `BLOCK_TEXT_COPY_TOAST`로 content world에 온다.
3. content의 `showToast()`는 `SHOW_ENTRY_TOAST`를 다시 page world로 보낸다.
4. 이 메시지의 유일한 수신자는 `inject.js`다.
5. `inject.js`는 `initDebuggerTabFeature()` 안에서만 주입되고 debugger tab OFF면 주입되지 않는다.

따라서 복사 결과는 정상인데 알림만 사라진다. 현재 페이지에서 디버깅 탭을 한 번이라도 켜서
`inject.js`가 이미 실행됐다면 탭을 다시 꺼도 스크립트 실행 결과는 남으므로 문제가 가려진다.
실사이트 검증은 반드시 **디버깅 탭 OFF 상태로 새로고침한 새 세션**에서 해야 한다.

기본값은 debugger tab ON, block copy OFF라 영향 범위가 좁고 데이터 손실도 없어 P3로 본다.

### 부스트 모드 주장은 기각

boost-mode는 `content.js` 초기화 시 무조건 주입되고, 토글 알림은 `boost-mode.js`가
`Entry.toast.warning()`을 직접 호출한 뒤 `notified`를 반환한다. 정상적인 사용자 클릭 시
`inject.js`에 의존하지 않으므로 D1과 같은 결함이 아니다. content fallback은 직접 알림이 실패한
경우에만 실행된다.

### 수정 경계

D1은 사용자 관찰 동작을 바꾸므로 R2 순수 리팩터 커밋에 섞지 않는다. 좁은 수정은
block-text-copy가 공용 Entry 접근 helper를 통해 직접 토스트를 시도하고, 사용할 수 없을 때만 기존
`BLOCK_TEXT_COPY_TOAST` 경로로 fallback하는 방식이다. 성공·오류 두 타입을 모두 테스트한다.

## 권장 PR 순서

제안된 `R4 → R2+D1 → R6 → R3 → R7 → R1` 순서는 뒤집는다.

| 순서 | PR | 성격 | 이유 |
| ---: | --- | --- | --- |
| 1 | R8 correctness-only lint | 도구 | 제품 동작 없이 이후 PR의 기초 안전망을 높인다. 스타일 통일·자동 포맷은 하지 않는다. |
| 2 | D1 블록 복사 토스트 | 버그 수정 | 낮은 범위의 실제 결함을 리팩터와 분리한다. |
| 3 | R7 로더 테스트 seam | 순수 리팩터/테스트 | 함수명·본문 문자열 파싱 대신 로더의 관찰 가능한 계약을 직접 검사한다. 기존 검사는 새 검사가 모두 잡을 때까지 유지한다. |
| 4 | page-core 실패 복구 | 인프라 동작 변경 | Promise 순차 로딩, `onerror`, in-flight/loaded 상태, 제한 재시도를 검증한다. B1 제거는 아직 하지 않는다. |
| 5 | R1 제한적 디스크립터 | 순수 리팩터 | 6개 동질 기능만 묶고 150ms+READY 이중 경로를 보존한다. |
| 6 | R6 retry controller | 순수 리팩터 | 단순 모듈 1개에서 시범 후 확대한다. boost는 마지막이다. |
| 7 | R2 page toast SSOT | 순수 리팩터 | D1이 이미 고쳐진 상태에서 타입·fallback 동일성을 확인하며 중복을 제거한다. |
| 8 | R5 토큰과 정적 스타일 | 시각 리팩터 | 토큰 PR과 page UI 클래스 이관 PR을 분리한다. |
| 9 | R4 특성 테스트 | 테스트 | 편집·펼침·focus·scope 동작을 먼저 고정한다. |
| 10 | R4 렌더 골격 통합 | 순수 리팩터 | 테스트가 생긴 뒤 작은 renderer부터 적용한다. lists는 마지막이다. |

R3는 이 순서에 넣지 않는다. 기능별 분리가 필요해질 때 별도 설계 메모로 다시 제안한다.

## PR별 검증 게이트

| PR | 자동 검증만으로 충분한 부분 | Chromium/실사이트 확인 |
| --- | --- | --- |
| R8 | `npm run lint`, `npm run check`, `npm run build:dev` | 불필요 |
| D1 | block toast unit/VM 검사, check, build | **실사이트 필수**: debugger OFF + block copy ON으로 새로고침 후 성공·실패 토스트 |
| R7 tools-only | 새 검사가 기존 순서·중복·cleanup을 모두 잡는 mutation/negative case | 제품 파일·manifest를 옮기면 local smoke 필수 |
| page-core 복구 | 성공·onerror·timeout·재시도·동시 호출·순서 특성 테스트 | **전체 local smoke + 실사이트 필수** |
| R1 | 6개 descriptor 완전성, OFF-before-load, ON/OFF, 150ms, READY, payload 검사 | **전체 local smoke + 실사이트 필수** |
| R6 | fake timer로 성공·timeout·reschedule·clear·onReady 동일성 | 변경 모듈 smoke 필수, boost는 실사이트 필수 |
| R2 | 세 타입·잘못된 타입·Entry 부재·fallback·중복 없음 검사 | **실사이트 필수**: 우하단 위치·색·자동 닫힘·debugger OFF |
| R5 | CSS selector/token 존재, 금지된 중복 literal 검사 | **실사이트 스크린샷 필수**: overlay, prompt, drag ghost, progress, fullscreen |
| R4 | 전용 renderer 특성 테스트 | **local smoke + 실사이트 필수**: 입력 중 snapshot과 검색·목록 상호작용 |

현재 로컬 8080 서버가 없으므로 smoke가 필요한 PR은 지금 즉시 완료 판정을 내릴 수 없다. 구현 시
`_docs/local-entry-testing/LOCAL_ENTRY_TESTING.md`의 서버 시작 절차를 사용하고, PR 생성 직전에
Chromium smoke를 수행한다. 로컬 smoke 통과를 실제 `playentry.org/ws` 검증으로 표현하지 않는다.

## 기존 보류 항목 재판정

| 항목 | 현재 판정 | 이유 |
| --- | --- | --- |
| B1 page-world fallback 제거 | **보류 유지** | `injectPageScript()`에 `onerror`가 없고 `pageCoreScriptsInjected=true`를 완료 전에 기록한다. 실패 복구 PR 이후 다시 판단한다. |
| B2 settings 스키마화 | **보류 유지** | `check-settings`로 위험은 낮아졌지만 19키의 예외·불변조건을 새 스키마로 옮겨 얻는 순감소가 약 50줄이라 우선순위가 낮다. |
| A2 content.js 분리 | **보류 유지** | R1/R4/R5 뒤 책임 경계가 안정된 후 물리적으로 분리하는 편이 이중 이동을 줄인다. |
| A3 inject.js 분리 | **보류 유지** | 토스트·라우터 계약과 page-core 생명주기가 정리된 뒤 serializers/mutators/router로 나눈다. |
| B5 Adapter 이전 | **점진 채택 유지** | 새 기능 또는 Entry 내부 접근을 수정할 때 해당 리더만 Adapter로 옮긴다. 일괄 변환은 하지 않는다. |
| E4 `*ScriptInjected` 제거 | **기각 유지** | script DOM은 onload 후 사라지고, 불린은 OFF 메시지 게이트로 사용된다. |

B2를 나중에 진행한다면 현재 구현과 새 구현의 모든 설정 조합을 비교하는 differential test를
추가하고, cross-field 불변조건은 스키마 밖의 명시적 단계로 남긴다.

## 문서 갱신 판단

기존 [`entry-debugger-refactor-review.md`](./entry-debugger-refactor-review.md)는 2026-06-23
시점의 2.6.1 기준 검토 기록이므로 수치를 덮어써 역사성을 없애지 않는다. 문서 상단에서 이 메모를
최신 판정으로 연결한다. 채택된 작업이 실제 반영되면 구조적 결론은
[`entry-debugger-refactor-architecture.md`](./entry-debugger-refactor-architecture.md)에 승계하고,
완료된 기획 문서는 `_archive/기획/`으로 옮긴다.

