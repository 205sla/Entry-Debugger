# Chrome Web Store 2.6.3 제출 점검

> 최신 제출 ZIP은 아래의 30파일 패키지다. 이후에 보존한 26파일 기록은 과거 결과다.
> 썸네일 기능과 실 서버 검증 범위는 [썸네일 실험실 기록](../thumbnail-experiment.md)을 참조한다.

## 2026-09-08 썸네일 기능 포함 최종 패키지

- 버전: 2.6.3 / Manifest V3, production 파일 30개.
- 파일: `Entry-Debugger-2.6.3-chrome-web-store.zip`, 156,564바이트.
- SHA-256: `2EB8DD58C8B8284469E14C49DB47398E63968B7F22D7F9C7039665A42CFBC265`.
- `npm run verify` 재실행 통과. ZIP 루트 manifest, 압축 무결성, allowlist 파일 집합 및
  모든 파일의 원본·release 빌드와 바이트 일치를 독립 비교했다. 개발 도구·테스트·문서·source map은 제외했다.
  배포에 필요한 `THIRD_PARTY_NOTICES.txt`는 포함했다.
- 로그인된 Chrome에서 새 비공개 작품의 정적 PNG·GIF APNG·영상 APNG 실제 저장 및
  마이페이지 표시를 확인했다. 애니메이션 두 사례는 서버에서 받은 파일의 프레임·재생 시간도 검사했다.
- ZIP 검증 기록: `dist/thumbnail-review/release-zip-verification.json`.
- 사용자 요청으로 코드·테스트·검증 문서를 커밋·푸시하는 범위이며 ZIP은 기존 ignore 정책대로
  로컬에 남긴다. Web Store 업로드·심사 제출은 실행하지 않았다.
- 서버 900KB 경계값, 모든 영상 코덱, 장기 안정성과 Web Store 심사는 검증 범위 밖이다.

## 2026-09-08 독립 검토 후 수정·재검증

**판정: 아래 수정본 ZIP은 확인된 제출 차단 결함을 해결했으며, 실행한 검사 범위에서 제출 가능.**

기준 HEAD는 `1e8e11de91db288f1b90fb94c78e2636590246cf`이고 이번 수정은 아직 커밋하지 않았다.
아래 ZIP은 **기준 HEAD + 현재 작업 트리 수정본**으로 만들었다. 원격 main의 산출물이라고
표현하지 않는다. 커밋·push·Web Store 제출은 수행하지 않았다.

### 수정 내용

- 팝업 설정 전파: storage 권한만 있는 확장에서 URL 필터 탭 조회가 빈 배열을 반환해
  열린 편집기에 설정이 전달되지 않던 문제 수정. URL·제목을 읽지 않고 탭 ID를 얻어 기존
  APPLY_SETTINGS를 전달하며, content script가 없는 탭의 전송 실패는 무시한다.
- 블록 텍스트 복사: 린트 정리 중 빠진 닫는 괄호 문자 복원.
  분리된 표시 필드의 `계산 (10 )` 출력이 `계산 (10)`으로 돌아온다.
- 권한, content script/WAR 범위, 버전 2.6.3, production allowlist 26개는 유지한다.

### 회귀 검사와 실사이트 검증

수정 전에는 새 `check-background`가 편집기 설정 미전달로 실패했고,
`check-block-text-copy`의 새 표시 필드 사례는 `계산 (10 )` 차이로 실패했다.
새 `smoke:settings-sync`도 기존 제출용 빌드에서 OFF가 두 편집기에 도달하지 않아 실패했다.
수정 후에는 모두 통과했다.

| 명령 | 수정 후 결과 |
| --- | --- |
| `npm run verify` | PASS: lint 0 warning, check 7종, dev/release 빌드 |
| `npm run smoke:settings-sync` | PASS: 제출용 빌드, 팝업 OFF/ON 2회 반복, 두 편집기 설정 및 탭·패널 0/1개 확인 |
| `npm run smoke:block-text-copy` | PASS: 디버깅 탭 OFF, inject.js 부재, 중첩 if/else 문자열과 성공 토스트 |
| `npm run smoke:local` | PASS: 버전·핵심 UI·함수 ID 재매핑·부스트 배치 |
| `npm run smoke:frame-profiler` | PASS: 코드 이동, 일시정지·정지·재시작 |
| `npm run smoke:picture-tools` | PASS: 삭제·복제·재정렬·이름변경·GIF·배치·취소 |
| `git diff --check` | PASS |

브라우저 환경은 Chrome for Testing `131.0.6778.204`와 새 임시 프로필이다.
Entry 주소는 `https://playentry.org/ws/590e746f150c3963bf86078e`이며 작품 저장은 하지 않았다.
각 스모크의 실행 환경변수는 [수정 계획 및 실행 기록](../release-2.6.3-review-fix-plan.md)에 남겼다.

### 당시 제출 ZIP — 썸네일 기능 추가 전

- 파일: `Entry-Debugger-2.6.3-chrome-web-store.zip`
- 크기: **147,188 bytes**
- SHA-256: **B66A16DA727FF759B0B3F004747DBC92C5555ADBEDF1883B9857C3875B8372EB**
- 파일 26개, ZIP 루트 manifest.json, 버전 2.6.3/MV3 확인.
- 원본 및 release 빌드와 파일 집합 및 26개 파일별 SHA-256 모두 일치.
- 개발 도구·테스트·문서·source map 혼입 없음.
- 이전 ZIP은 `dist/release-review-2026-09-08/Entry-Debugger-2.6.3-before-review-fixes.zip`에 보관했다.
- 파일별 검증 결과는 `dist/release-review-2026-09-08/zip-verification.json`에 저장했다.

최신 Chrome, 로컬 8080 서버, 장시간 메모리 안정성, 실제 업로드·저장 완료,
원격 CI와 Web Store 대시보드 심사 결과는 이번 검증 범위 밖이다.
모양 스모크의 업로드 창은 모의 DOM이며 네이티브 파일 선택창·서버 업로드 종단 검증은 아니다.

## 2026-09-01 최초 점검 기록 (이하 당시 결과·이전 ZIP)

확인 날짜: 2026-09-01

대상 브랜치: `main`

기존 배포 버전: `2.6.2`

## 최종 판정

**제출 가능 — 확인된 릴리스 블로커 없음.**

Chrome Web Store 공식 문서에 따라 기존 버전보다 큰 `2.6.3`으로 manifest를 올렸고,
전체 확장 파일을 담은 ZIP의 루트에 `manifest.json`이 있도록 생성했다.

- [기존 항목 업데이트](https://developer.chrome.com/docs/webstore/update/)
- [확장 제출 준비와 ZIP 구조](https://developer.chrome.com/docs/webstore/prepare/)

## 릴리스 범위

- 디버깅 탭을 끈 새 세션에서도 블록 텍스트 복사 성공·실패 알림 표시
- `Entry.toast` 호출 예외와 비동기 clipboard 실패 뒤 브라우저 fallback 회귀 고정
- 프레임 프로파일러의 `__proto__`, `constructor`, `hasOwnProperty` 특수 ID 충돌 방지
- correctness 전용 ESLint 0-warning 게이트와 GitHub Actions 추가
- allowlist 기반 개발·제출용 빌드로 내부 문서와 개발 파일 혼입 차단
- 실사이트 안내 레이어·오브젝트 초기 선택·Chromium 경로 차이를 견디도록 smoke 안정화

## manifest·권한·보안 검토

| 항목 | 결과 |
| --- | --- |
| `manifest_version` | `3` |
| 확장 버전 | `2.6.3` |
| 권한 | `storage`만 사용, 신규 권한 없음 |
| `host_permissions` | 없음 |
| content script 범위 | `https://playentry.org/ws/*` |
| WAR 공개 범위 | `https://playentry.org/*` |
| 외부 실행 코드 | 신규 추가 없음. 실행 스크립트는 패키지 내부 파일만 사용 |
| 데이터 전송·추적 | 신규 추가 없음 |
| 설명 길이 | 56자, Web Store 제한 이내 |

제품 변경 diff에서 권한 확대, 원격 코드 로딩, 분석·추적 코드, 새 외부 API 호출은
발견되지 않았다. `picture-tools.js`의 기존 `fetch`는 Entry 작품에 이미 연결된 이미지·SVG를
사용자 명령으로 읽는 경로이며 실행 코드를 내려받지 않는다.

## 자동 검증

다음 명령을 최종 working tree에서 통과했다.

```powershell
npm run verify
git diff --check
```

`npm run verify` 결과:

- ESLint: error 0, warning 0
- `check-extension`, `check-settings`, `check-page-core-loader`: PASS
- `check-function-library`, `check-block-text-copy`, `check-frame-profiler`: PASS
- 개발용 빌드: PASS
- 제출용 allowlist 빌드: PASS, 26개 파일

수정 전 제품 코드를 대상으로 한 mutation 비교에서는 블록 복사 직접 토스트와
프레임 프로파일러 `__proto__` 특수 ID 검사가 각각 실패해 새 검사가 실제 회귀를 잡는 것도
확인했다.

## Chromium 검증

새 임시 프로필과 Chrome for Testing을 사용했다. 실사이트 검증은 공개 작품의
`https://playentry.org/ws/590e746f150c3963bf86078e`를 열어 수행했으며 저장 API는 호출하지 않았다.

| 검증 | 환경 | 결과 |
| --- | --- | --- |
| `smoke:block-text-copy` | 로컬 Entry, 디버깅 탭 OFF | PASS |
| `smoke:block-text-copy` | 실사이트, 디버깅 탭 OFF | PASS |
| `smoke:frame-profiler` | 실사이트 | PASS |
| `smoke:local` | 실사이트 종합 UI | PASS |
| `smoke:picture-tools` | 실사이트 | PASS |

블록 복사 스모크에서는 `debuggerScriptInjected=false`를 먼저 확인한 뒤 축약 생성자 이름
`a`, 중첩 if/else 복사 결과, 네이티브 성공 토스트를 검증했다. 프레임 프로파일러는 코드 이동
`activate=1`, 선택 변경 `select=0`, 일시정지·정지·재시작 수명주기를 확인했다.

종합 UI 스모크는 팝업 버전 `v2.6.3`, 디버깅 탭, 설정·실험실, 함수 보관함 ID 재매핑,
부스트 버튼의 일반·전체화면 위치를 확인했다. 모양 도구 스모크는 삭제·복제·재정렬·undo/redo,
일괄 이름변경, GIF 분해, 3개/11개 업로드 경계와 25개 업로드 취소를 확인했다.

## 제출 ZIP

- 파일: `Entry-Debugger-2.6.3-chrome-web-store.zip`
- 크기: `147,104 bytes`
- SHA-256: `D40EFDF4146E377F72F449E5743E7AA4CDADE928D8113A191D82214AB7B83BA5`
- 원본 allowlist 파일: 26개
- ZIP 내부 파일: 26개
- ZIP 루트 `manifest.json`: 확인
- manifest 버전: `2.6.3`
- 원본과 ZIP의 파일명 차이: 0개
- 원본과 ZIP의 파일별 SHA-256 차이: 0개
- `dist/`, `tools/`, `지식/`, test/fixture, `.md`, source map 포함: 0개

## 대시보드 제출 시 확인

- Package 탭에서 위 ZIP을 **Upload New Package**로 업로드한다.
- Store listing의 변경사항에는 사용자 영향이 있는 토스트 복구와 프레임 프로파일러 안정성
  개선을 우선 기재한다.
- 신규 권한이나 데이터 수집은 없으므로 기존 Privacy practices 선언과 일치하는지만 다시
  확인한다.
- 업로드 뒤 자동 manifest 검사 결과를 확인하고 새 검토를 제출한다.
