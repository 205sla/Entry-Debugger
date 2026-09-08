# 2.6.3 독립 검토 후 수정 계획 및 인계

작성일: 2026-09-08
상태: 수정·회귀 검사·실사이트 스모크·ZIP 갱신 완료 (미커밋)

## 사용자 요청과 작업 경계

- 독립 검토에서 발견한 문제를 어떻게 수정할지 기록하고, 컨텍스트 압축 후 수정을 진행한다.
- 작업 위치: `C:\Users\young\prg\ENTRY\extensions\Entry Debugger`
- 브랜치: `main`
- 기준 HEAD: `1e8e11de91db288f1b90fb94c78e2636590246cf`
- 앞선 검토는 읽기 전용이었다. 이번 요청으로 아래 코드·테스트·릴리스 산출물 수정은 승인되었다.
- 커밋, push, Chrome Web Store 업로드·제출, 실사이트 작품 저장은 수행하지 않는다.
- 기록 후 컨텍스트를 압축하고, 이 파일을 읽어 이어서 구현한다. 구현 승인 재확인은 필요 없다.
- 계획 작성 시 작업 트리는 깨끗했고 main과 origin/main, 실제 원격 main이 기준 HEAD와 일치했다.

## 확인된 문제

### P2: 팝업 설정이 열린 편집기에 전파되지 않음

- `entry-debugger-extension/background.js:33`의 `chrome.tabs.query({url: [...]})`는 현재 manifest 권한으로 URL을 조회할 수 없어 실제 브라우저에서 빈 배열을 반환했다.
- manifest는 storage만 허용한다. content_scripts.matches는 tabs URL 조회 권한을 대신하지 않는다.
- 제출용 release 빌드를 새 Chrome for Testing 프로필에 로드한 뒤 실제 팝업 `.toggle-switch`를 클릭해 재현했다.
- 결과: storage.debuggerTabEnabled=false, 팝업은 '디버깅 탭 꺼짐', 편집기 PING_STATUS.settings.debuggerTabEnabled=true, `.propertyTabdebugging`은 계속 표시됨.
- 기존 코드의 결함이며 검토 대상 5개 커밋이 처음 도입한 문제는 아니다.

### P3: 블록 복사 괄호 앞 공백 회귀

- `entry-debugger-extension/block-text-copy.js:1133`의 정규식에서 닫는 괄호 문자 자체가 삭제되었다.
- 도입 커밋: fb83420.
- 복사 VM 하네스에 staticContent('계산'), staticContent('('), staticContent('10'), staticContent(')')를 가진 블록을 전달해 확인했다.
- fb83420^의 출력은 '계산 (10)', HEAD 출력은 '계산 (10 )'.
- `지식/entry-debugger-refactor-architecture.md:110`의 '동등한 정규식' 설명과도 불일치한다.

## 구현 계획

### 1. 최소 권한을 유지하는 설정 전파

- 우선안: background의 broadcastSettings에서 URL 필터를 없애고 `chrome.tabs.query({})`로 얻은 탭 ID에 기존 APPLY_SETTINGS 메시지를 보낸다.
- 이 확장의 content script가 없는 탭은 기존 sendMessage rejection 처리로 무시한다. URL, 제목 등 민감한 탭 속성은 조회하거나 읽지 않는다.
- storage 권한만 유지하며 manifest의 content script/WAR 범위도 유지한다.
- 기존 GET_STATE, SET_STATE, SET_SETTINGS, BROADCAST_SETTINGS, GET_PAGE_STATUS 프로토콜은 보존한다.
- 초기 구상인 storage.onChanged 추가 대신 이 방식을 우선한다. 중복 설정 적용과 초기 storage 읽기의 경합을 새로 만들지 않고 기존 전달 경로만 복구하기 위해서다.
- 실제 코드를 읽고 오류 처리 보완이 필요하면 범위를 좁혀 함께 처리한다. 무관한 리팩터링은 하지 않는다.

### 2. 동작을 검증하는 설정 전파 테스트

- Node VM 기반 background 검사 추가를 검토한다. importScripts/settings 및 Chrome API를 모의화하되, URL 조회 권한이 없으면 URL 필터 결과가 비는 실제 제약을 모델링한다.
- 탭 URL이 노출되지 않는 조건에서 여러 content script 수신자의 설정이 실제 변경되는지 검사한다.
- content script 없는 탭의 전송 실패를 허용하면서 다른 탭 전달과 응답이 유지되는지 검사한다.
- SET_SETTINGS, 호환 SET_STATE, BROADCAST_SETTINGS 및 상태 조회의 핵심 계약을 확인한다.
- npm run check/verify에 검사를 포함한다. 기존 코드로 실패하고 수정 코드로 통과하는 negative 비교를 수행한다.
- 실제 제출용 빌드로 2개 편집기를 연 뒤 팝업 OFF/ON을 클릭하는 스모크를 추가한다. storage 값만 보지 말고 각 편집기의 PING_STATUS 설정과 `.propertyTabdebugging` 제거/복원을 함께 확인한다.
- 반복 ON/OFF에서 디버깅 탭과 패널이 중복 생성되지 않는지도 확인한다.
- UI에서 변경한 설정을 검증할 때 스모크가 content script에 APPLY_SETTINGS를 직접 보내 결함을 우회해서는 안 된다.

### 3. 괄호 정규화 복원

- normalizeVisualText의 닫는 괄호를 문자 클래스에 복원한다. 예시: `/\s+([,.:;%)\]])/g`.
- 정규식 자체를 복제해 테스트하지 않고 기존 copyBlockText 하네스로 분리된 표시 필드의 최종 클립보드 문자열을 검증한다.
- 괄호·대괄호·구두점 및 기존 중첩 if/else 결과가 유지되는지 확인한다.

### 4. 문서와 제출 산출물

- README의 2.6.3 변경 및 검증 명령, 관련 구조 문서를 최종 구현에 맞게 갱신한다.
- 기존 2026-09-01 릴리스 기록은 당시 이력을 보존하고 2026-09-08 후속 수정·검증 기록을 추가한다.
- 지식 README에서 이 계획을 찾을 수 있게 한다. 완료 시 상태와 실제 실행 결과를 이 파일에 갱신한다.
- 버전은 아직 제출 전인 2.6.3으로 유지한다.
- 기존 ZIP은 교체 전에 ignored dist 하위의 검토 보관 위치 등에 보관하고, release 빌드의 루트 파일 26개로 같은 제출 ZIP 경로를 재생성한다.
- ZIP 루트 manifest, 버전, 파일 집합, 각 파일의 SHA-256, 전체 ZIP SHA-256/크기를 새로 확인하고 기록한다.
- 이전 해시를 재사용하거나 수정된 산출물을 기존 HEAD와 바이트 일치한다고 표현하지 않는다. 커밋하지 않았다면 '기준 HEAD + 작업 트리 수정본'임을 명시한다.

## 이전 검토에서 실행한 결과

- Node v22.17.0, npm 10.9.2.
- npm run verify: PASS (lint 0 warning, check 6종, dev/release 빌드).
- npm ls --depth=0: @eslint/js 10.0.1, eslint 10.8.1, globals 17.11.0.
- npm run smoke:block-text-copy 기본 URL: FAIL, 127.0.0.1:8080 서버가 없어 ERR_CONNECTION_REFUSED.
- 실사이트 smoke:block-text-copy, smoke:local, smoke:frame-profiler, smoke:picture-tools: 모두 PASS.
- 실사이트 block copy는 debuggerScriptInjected=false 및 네이티브 성공 토스트를 확인했다.
- 수정 전 소스를 VM 메모리에서 넣으면 토스트 검사와 프레임 특수 ID 검사가 각각 실패했고 HEAD는 통과했다.
- 제출용 빌드의 독립 팝업 사용자 클릭 검사: FAIL, 위 P2 재현.
- git diff --check: PASS. git diff --check c93ca65^ HEAD: 결정 메모 240행 EOF 빈 줄 경고로 exit 1 (기능 문제 아님).
- 원격 확인은 기본 sandbox 네트워크에서 실패했으나 require_escalated로 git ls-remote origin refs/heads/main을 실행해 기준 HEAD 일치를 확인했다.
- Git 실행 시 사용자 전역 ignore 파일 접근 경고가 있었지만 저장소 상태 출력은 정상적으로 확인했다.

## 재검증 환경과 명령

Playwright는 이 확장 자체의 의존성이 아니라 `../../apps/MYentry-game/node_modules`에서 찾는다. 기존 smoke의 resolver를 참고한다.

```powershell
$env:ENTRY_DEBUGGER_SMOKE_URL='https://playentry.org/ws/590e746f150c3963bf86078e'
$env:ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE='C:\Users\young\.cache\puppeteer\chrome\win64-131.0.6778.204\chrome-win64\chrome.exe'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE=$env:ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE
npm run verify
npm run smoke:block-text-copy
npm run smoke:local
npm run smoke:frame-profiler
npm run smoke:picture-tools
# 추가할 설정 전파 스모크도 실행한다.
git diff --check
git status --short --branch
```

- 실제 팝업 스위치: `.toggle-switch` / `#toggle-debugger-tab`.
- 편집기 디버깅 탭: `.propertyTabdebugging`. `#entryDebuggerTab`은 존재하지 않으므로 사용하지 않는다.
- 편집기 패널: `#ed-debugger-panel`.
- background worker는 context.serviceWorkers()[0] 또는 serviceworker 이벤트로 기다린다.
- 새 임시 프로필을 사용한다. 공개 작품을 메모리에서만 변경하고 저장 API·업로드 제출은 호출하지 않는다.
- 네트워크가 막히면 테스트 실행에 require_escalated를 사용한다. 이전에는 자동 검토가 허용했다.
- 장시간 실행은 session ID로 받고 도중 결과를 확인하며 사용자에게 진행 상황을 알린다.

## 기존 ZIP 기준값 (수정 후에는 달라져야 함)

- 경로: `C:\Users\young\prg\ENTRY\extensions\Entry Debugger\Entry-Debugger-2.6.3-chrome-web-store.zip`
- 크기: 147104 bytes, 파일 26개.
- SHA-256: D40EFDF4146E377F72F449E5743E7AA4CDADE928D8113A191D82214AB7B83BA5
- ZIP/원본/release 빌드의 파일 집합과 26개 파일별 해시가 모두 일치했음.
- production allowlist는 tools/extension-files.js, 빌드 경로는 dist/entry-debugger-extension-release.
- ZIP, dist, node_modules는 .gitignore 대상이다.

## 이번 수정 범위 밖의 남은 위험

- 최신 Chrome 검증: 기존 사용 가능한 Chrome for Testing은 131.0.6778.204이다. 최신 버전에서 확인하지 않았음을 보고한다.
- 로더 실패 복구, 장시간 메모리·반복 SPA 이동은 별도 개선 대상이다.
- 모양 스모크의 업로드 창은 fixture이며 숨은 input에 파일을 넣는다. 네이티브 선택창 및 서버 업로드 종단 검증으로 표현하지 않는다.
- 개인정보 처리방침은 HTTP 200이고 핵심 전송·추적 설명은 맞지만 페이지 localStorage 저장 설명은 보완 여지가 있다. 별도 사이트는 이번 수정에 포함하지 않는다.
- Web Store 대시보드, 원격 CI 실행 결과, 공개 작품 저장은 확인하거나 변경하지 않았다.

## 실행 체크리스트

- [x] 수정 계획 및 재현 근거 기록
- [x] 사용자 계속 요청 후 인계 기록으로 상태 복원 및 수정 재개
- [x] 설정 전파 수정 및 회귀 테스트
- [x] 괄호 공백 회귀 복원 및 복사 결과 테스트
- [x] verify와 실사이트 스모크 재실행
- [x] 문서·ZIP·SHA-256 갱신 및 파일별 비교
- [x] 최종 diff·작업 트리 검토 (커밋·push·제출 없음)

## 실제 실행 결과 (2026-09-08)

- 제품 수정은 background.js의 URL 필터 제거와 block-text-copy.js의 닫는 괄호 복원 두 곳이다.
- 새 tools/check-background.js를 npm run check에 포함했다. 민감한 탭 속성이 없는 조건에서
  두 편집기의 설정, 수신자가 없는 탭, ON/OFF 반복, 명시적 재전송, 호환 SET_STATE, 페이지 상태 응답을 검사한다.
- 기존 복사 하네스에 분리된 괄호·대괄호·구두점의 최종 복사 문자열 사례 3개를 추가했다.
- 새 tools/smoke-settings-sync.js와 npm run smoke:settings-sync를 추가했다.
  제출용 manifest를 사용하고 실제 팝업을 클릭하며, storage seed와 APPLY_SETTINGS 직접 주입을 하지 않는다.
- 수정 전 Node 검사 2개와 새 브라우저 스모크가 모두 의도한 결함으로 실패했음을 확인했다.
- 수정 후 npm run verify 통과: lint 0 warning, check 7종, dev/release 빌드.
- 실사이트 smoke:settings-sync, smoke:block-text-copy, smoke:local, smoke:frame-profiler,
  smoke:picture-tools 모두 통과. 설정 전파는 OFF/ON 두 번 반복 동안 두 편집기의 설정과
  탭·패널 0/1개를 확인했다. 중복 탭·패널 없음.
- git diff --check 통과. 기준 HEAD는 그대로이고 코드·테스트·문서는 미커밋 수정 상태다.
- 새 ZIP: 147188 bytes, 파일 26개, SHA-256
  `B66A16DA727FF759B0B3F004747DBC92C5555ADBEDF1883B9857C3875B8372EB`.
- ZIP과 원본/release 빌드의 파일 집합, 26개 파일별 해시, 루트 manifest 및 버전을 직접 검증했다.
- 기존 ZIP은 dist/release-review-2026-09-08/Entry-Debugger-2.6.3-before-review-fixes.zip에 보관했다.
- 세부 결과와 현재 제출 ZIP은 [릴리스 후속 점검](./_archive/chrome-web-store-release-2.6.3.md)을 참고한다.
